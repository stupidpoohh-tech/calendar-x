import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeFirestoreError, isPermissionDenied } from '../data/errors';
import { getFirebase } from '../data/firebase';
import {
  monthWindow, subscribeAccounts, subscribeDebts, subscribeEntriesForMonths,
  subscribePins, subscribeRecurringEntries, tideWindow,
} from '../data/repo';
import type { Account, Debt, Entry, Pin, YearMonth } from '../domain/types';

export interface StoreState {
  /**
   * 화면에 그릴 항목의 **원본**. 보고 있는 달 주변만 받는다.
   * 반복은 아직 펼쳐지지 않았다 — 펼치는 것은 화면 쪽 `materialize()` 의 일이다.
   */
  entries: Entry[];
  /**
   * 금액 계산용 **원본**. 오늘 기준 고정 구간이라 달력을 넘겨도 바뀌지 않는다.
   *
   * 화면용으로 펼친 목록(`materialize()` 결과)을 여기에 쓰면 안 된다. tide 가 발생분을
   * 다시 반복 전개해 같은 입출금을 여러 번 센다. 그 사고는 `tide.ts` 가 `virtual`
   * 표식을 보고 거절해 막지만, 애초에 두 목록을 섞지 않는 것이 이 필드의 존재 이유다.
   */
  tideEntries: Entry[];
  /**
   * `tideEntries` 가 실제로 덮는 달.
   * 달력이 "이 셀의 한도를 계산할 자료가 있는가" 를 판정하는 데 쓴다.
   */
  tideMonths: YearMonth[];
  accounts: Account[];
  debts: Debt[];
  pins: Pin[];
  loading: boolean;
  error: string | null;
  /**
   * 보안 규칙이 새 컬렉션을 막고 있는 상태.
   * 규칙 배포 전에는 모든 조회가 이 상태가 되므로 따로 구분해 안내한다.
   */
  rulesBlocked: boolean;
}

const EMPTY: StoreState = {
  entries: [], tideEntries: [], tideMonths: [],
  accounts: [], debts: [], pins: [],
  loading: false, error: null, rulesBlocked: false,
};

/**
 * 구독 계층.
 *
 * 세 갈래로 받는다.
 *   1. 보고 있는 달 주변 — 화면에 그릴 항목
 *   2. 오늘 주변 고정 구간 — 금액 계산 (커서와 무관해야 한다)
 *   3. 반복 항목 전량 — 월 조회로 잡히지 않는다
 *
 * 1번만 두고 계산까지 시키면 달력을 넘길 때마다 한도·다음 입금일·정산이 달라진다.
 * 이전 구조는 users/{uid}/items 전체를 한 번에 구독했다 (F-06). 여기서는 셋 다
 * 상한이 있다 — 2번이 16달로 가장 넓고, 그 값은 커서를 아무리 옮겨도 그대로다.
 */
export function useStore(uid: string | null, cursorISO: string, todayISO: string): StoreState {
  const months = useMemo(() => monthWindow(cursorISO), [cursorISO]);
  const monthKey = months.join(',');

  const tideMonths = useMemo(() => tideWindow(todayISO), [todayISO]);
  const tideKey = tideMonths.join(',');

  const [monthEntries, setMonthEntries] = useState<Entry[]>([]);
  const [tideRaw, setTideRaw] = useState<Entry[]>([]);
  const [recurring, setRecurring] = useState<Entry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rulesBlocked, setRulesBlocked] = useState(false);
  const [ready, setReady] = useState(false);

  const sinkRef = useRef<{ setError: typeof setError; setBlocked: typeof setRulesBlocked }>({
    setError, setBlocked: setRulesBlocked,
  });
  sinkRef.current = { setError, setBlocked: setRulesBlocked };

  /** 오류 처리는 세 effect 가 같이 쓴다. */
  const onError = useCallback((scope: string, err: unknown) => {
    // 조용히 삼키면 "저장은 되는데 안 보이는" 상태의 원인을 찾을 수 없다.
    console.error(`[${scope}]`, err);
    if (isPermissionDenied(err)) { sinkRef.current.setBlocked(true); return; }
    sinkRef.current.setError(`${scope} 를 불러오지 못했습니다. ${describeFirestoreError(err)}`);
  }, []);

  /*
    ── effect 를 셋으로 나눈 이유 ────────────────────────────────

    하나로 묶으면 달을 넘길 때마다(monthKey 변경) 계산 구독과 잔고·대출·고정 메모까지
    전부 끊고 다시 붙는다. 계산 창은 오늘 기준이라 커서와 무관한데도 재구독이 돌고,
    그때마다 잠깐 빈 목록이 흘러 머리 숫자가 깜빡인다.

    이제 커서를 옮기면 화면용 구독만 다시 붙는다.
  */

  // 1. 화면용 — 커서를 따라 움직인다.
  useEffect(() => {
    if (!uid) { setMonthEntries([]); setReady(false); return; }
    const { db } = getFirebase();
    return subscribeEntriesForMonths(
      db, uid, monthKey.split(','),
      (e) => { setMonthEntries(e); setReady(true); },
      onError,
    );
  }, [uid, monthKey, onError]);

  // 2. 계산용 — 오늘 기준. 커서를 옮겨도 다시 붙지 않는다.
  useEffect(() => {
    if (!uid) { setTideRaw([]); return; }
    const { db } = getFirebase();
    return subscribeEntriesForMonths(
      db, uid, tideKey.split(','), setTideRaw,
      (scope, err) => onError(`${scope} (계산)`, err),
    );
  }, [uid, tideKey, onError]);

  // 3. 나머지 — uid 가 바뀔 때만.
  useEffect(() => {
    if (!uid) { setRecurring([]); setAccounts([]); setDebts([]); setPins([]); return; }
    const { db } = getFirebase();
    const unsubs = [
      subscribeRecurringEntries(db, uid, setRecurring, onError),
      subscribeAccounts(db, uid, setAccounts, onError),
      subscribeDebts(db, uid, setDebts, onError),
      subscribePins(db, uid, setPins, onError),
    ];
    return () => {
      unsubs.forEach((u) => u());
      setRulesBlocked(false);
      setError(null);
    };
  }, [uid, onError]);

  // 반복 항목은 첫 발생 달의 ymSpan 을 갖고 있어 월 조회에도 걸린다.
  // 두 번 들어가지 않도록 id 로 합친다.
  const entries = useMemo(() => mergeById(monthEntries, recurring), [monthEntries, recurring]);
  const tideEntries = useMemo(() => mergeById(tideRaw, recurring), [tideRaw, recurring]);

  if (!uid) return EMPTY;

  return {
    entries, tideEntries, tideMonths,
    accounts, debts, pins,
    loading: !ready, error, rulesBlocked,
  };
}

function mergeById(a: readonly Entry[], b: readonly Entry[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const e of a) byId.set(e.id, e);
  for (const e of b) byId.set(e.id, e);
  return [...byId.values()];
}
