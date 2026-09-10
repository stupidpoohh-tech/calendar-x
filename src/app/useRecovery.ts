/**
 * 회복 상태 훅.
 *
 * 규칙을 구독하고, 예정일이 코앞에 오면 실제 항목 한 건을 만든다 (rolling generation).
 * 몇 달치를 미리 만들지 않는 것이 이 기능의 전제라, "언제 만들 것인가" 를 판정하는
 * 자리는 여기 하나뿐이다.
 *
 * 중복 생성을 막는 값은 `rule.activeEntryId` 다. 항목 구독은 보고 있는 달 주변만
 * 받으므로, "이미 만들었나" 를 항목 목록으로 판정하면 사용자가 먼 달을 열어 둔 사이에
 * 같은 회차가 한 번 더 만들어진다. 규칙 문서는 달과 무관하게 항상 구독돼 있다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeFirestoreError } from '../data/errors';
import { getFirebase } from '../data/firebase';
import { subscribeRecoveryRule } from '../data/repo';
import { displayTitle } from '../domain/entry';
import {
  completeRecovery, defaultRecoveryRule, generateRecovery, moveRecovery,
  primeRule, scheduleDebtRecovery, skipRecovery,
  type RecoveryTransition,
} from '../domain/recovery';
import type { Entry, RecoveryRule, TimeHM } from '../domain/types';
import type { Commit } from './useWriteQueue';

export interface RecoveryApi {
  rule: RecoveryRule;
  /** 설정에서 규칙을 통째로 바꾼다. */
  saveRule: (next: RecoveryRule) => void;
  /** 이 회차만 고친다 (메모 · OFF 항목). 규칙 기본값은 건드리지 않는다. */
  saveEntryOnly: (entry: Entry) => void;
  complete: (entry: Entry, onISO: string) => void;
  move: (entry: Entry, toDate: string, toTime: TimeHM | null) => void;
  skip: (entry: Entry) => void;
  scheduleDebt: (dateISO: string, time: TimeHM | null) => void;
  /** 항목이 통째로 사라지는 경로(전체 교체 가져오기)에서 매달린 참조를 끊는다. */
  clearActive: () => void;
}

interface Options {
  uid: string | null;
  todayISO: string;
  /** 조회 실패를 알린다. */
  onError: (message: string) => void;
  /**
   * 쓰기 한 건을 보내고 서버가 거절하면 다시 보낼 기회를 준다.
   *
   * 회복은 항목과 규칙이 한 배치라 반쪽만 올라가는 일은 없지만, 배치가 통째로
   * 거절당하면 로컬에만 남는다 — 다음 회차 계산이 그 로컬 값에서 시작해 조용히
   * 어긋난다. 그래서 회복도 다른 쓰기와 같은 길을 쓴다.
   */
  commit: Commit;
}

export function useRecovery({ uid, todayISO, onError, commit }: Options): RecoveryApi {
  const [rule, setRule] = useState<RecoveryRule>(defaultRecoveryRule);
  const { db } = getFirebase();

  // 콜백을 의존성에 넣으면 구독이 매 렌더 다시 붙는다.
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    if (!uid) { setRule(defaultRecoveryRule()); return; }
    return subscribeRecoveryRule(db, uid, setRule, (scope, err) => {
      console.error(`[${scope}]`, err);
      errorRef.current(`회복 설정을 불러오지 못했습니다. ${describeFirestoreError(err)}`);
    });
  }, [db, uid]);

  /**
   * 항목과 규칙을 한 배치로 쓴다.
   *
   * 이어 붙여 쓰면 항목만 남고 규칙이 뒤처지는 창이 열린다 — 그 사이에 새로고침하면
   * 다음 접속이 같은 회차를 한 번 더 만든다. 배치는 로컬 캐시에 원자적으로 들어간다.
   */
  const push = useCallback((t: RecoveryTransition, removeEntryId?: string) => {
    if (!uid) return;
    commit({
      kind: 'recoveryCommit', label: '회복',
      summary: t.entry ? `${t.entry.startDate} 회차` : '회복 상태',
      payload: { rule: t.rule, entry: t.entry, removeEntryId: removeEntryId ?? null },
    });
  }, [uid, commit]);

  /**
   * 예정 채우기 + 실제 항목 생성.
   *
   * 규칙 스냅샷이 올 때마다 다시 도는데, 한 번 만들고 나면 `activeEntryId` 때문에
   * 두 번째부터는 아무것도 하지 않는다. StrictMode 의 이중 실행은 ref 로 막는다 —
   * 같은 인스턴스에서 두 번 도는 동안에는 스냅샷이 아직 돌아오지 않았을 수 있다.
   */
  const generatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!uid) return;

    const primed = primeRule(rule, todayISO);
    if (primed !== rule) {
      // 계산한 필드만 쓴다. 규칙 전체를 쓰면 같은 순간 설정 화면에서 적고 있던 값을 덮는다.
      commit({
        kind: 'recoveryPatch', label: '회복 예정일',
        summary: primed.nextDueAt ?? '예정 없음',
        payload: { nextDueAt: primed.nextDueAt },
      });
      return;
    }

    const t = generateRecovery(rule, todayISO);
    if (!t || !t.entry) return;
    if (generatedFor.current === rule.nextDueAt) return;
    generatedFor.current = rule.nextDueAt;
    push(t);
  }, [uid, rule, todayISO, push, commit]);

  return useMemo<RecoveryApi>(() => ({
    rule,

    saveRule: (next) => {
      if (!uid) return;
      commit({
        kind: 'recoveryRule', label: '회복 설정',
        summary: `${next.intervalDays}일 간격`, payload: next,
      });
    },

    saveEntryOnly: (entry) => {
      if (!uid) return;
      commit({ kind: 'entry', label: '회복 항목', summary: displayTitle(entry), payload: entry });
    },

    complete: (entry, onISO) => push(completeRecovery(rule, entry, onISO)),

    move: (entry, toDate, toTime) => push(moveRecovery(rule, entry, toDate, toTime)),

    // 건너뛰기는 항목을 지우고 빚을 남긴다. 지워서 빚이 증발하는 상태를 만들지 않는다.
    // 삭제와 빚도 한 배치다 — 항목만 지워지고 빚이 안 남으면 건너뛴 사실이 사라진다.
    skip: (entry) => push(skipRecovery(rule), entry.id),

    scheduleDebt: (dateISO, time) => {
      generatedFor.current = null;
      push(scheduleDebtRecovery(rule, dateISO, time));
    },

    clearActive: () => {
      if (!uid || !rule.activeEntryId) return;
      generatedFor.current = null;
      commit({
        kind: 'recoveryPatch', label: '회복 참조 정리',
        summary: '진행 중 회차 지우기', payload: { activeEntryId: null },
      });
    },
  }), [uid, rule, push, commit]);
}
