/**
 * 내 캘린더 구성 훅(`domain/layout.ts`).
 *
 * 값의 주인은 사용자 문서(`users/{uid}.layout`)다 — 다른 기기에서 바꾼 구성도 구독으로 따라온다.
 * 기기에는 마지막으로 받은 값을 계정별로 한 벌 남겨(`calendarx.layout.<uid>`) 첫 화면을 그 값으로
 * 그린다. 그러지 않으면 가계부를 숨긴 사람도 열 때마다 가계부 탭이 잠깐 떴다 사라진다.
 *
 * 쓰기는 다른 저장과 같은 쓰기 큐다(`kind: 'layout'`). 화면은 로컬 반영으로 바로 바뀌고, 서버가
 * 거절하면 Firestore 가 로컬 값을 되돌려 구독이 이전 구성을 다시 보내며, 그 쓰기는 '저장하지 못한 것'
 * 목록에 남는다 — 성공한 것처럼 남지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getFirebase } from '../data/firebase';
import { subscribeLayout } from '../data/repo';
import { CALENDAR_AMOUNTS, LEGACY_LAYOUT, layoutFrom, type Layout } from '../domain/layout';
import type { Commit } from './useWriteQueue';

const keyOf = (uid: string) => `calendarx.layout.${uid}`;

function cached(uid: string | null): Layout {
  if (!uid) return LEGACY_LAYOUT;
  try {
    const raw = localStorage.getItem(keyOf(uid));
    return raw ? layoutFrom(JSON.parse(raw)) : LEGACY_LAYOUT;
  } catch {
    return LEGACY_LAYOUT;
  }
}

/** 기기에 남겨 둔다. 가입 직후 첫 화면을 새 사용자 구성으로 그리는 데도 쓴다. */
export function rememberLayout(uid: string, layout: Layout) {
  try { localStorage.setItem(keyOf(uid), JSON.stringify(layout)); } catch { /* 보관이 막혀도 구독 값으로 돈다 */ }
}

export interface LayoutApi {
  layout: Layout;
  /** 서버 · 로컬 캐시에서 한 번이라도 받았는가. 받기 전에는 기기에 남긴 값이다. */
  ready: boolean;
  set: (patch: Partial<Layout>) => void;
}

export function useLayout({ uid, commit }: { uid: string | null; commit: Commit }): LayoutApi {
  const [state, setState] = useState<{ uid: string | null; layout: Layout; ready: boolean }>(
    () => ({ uid, layout: cached(uid), ready: false }),
  );
  // 계정이 바뀌면 앞 계정의 구성을 한 렌더도 남기지 않는다.
  const current = state.uid === uid ? state : { uid, layout: cached(uid), ready: false };
  if (current !== state) setState(current);

  useEffect(() => {
    if (!uid) return;
    const { db } = getFirebase();
    return subscribeLayout(db, uid, (layout) => {
      rememberLayout(uid, layout);
      setState((s) => (s.uid === uid ? { uid, layout, ready: true } : s));
    }, (scope, err) => console.error(`[${scope}]`, err));
  }, [uid]);

  // 쓰기는 updater 밖에서 한 번만 낸다 — updater 안에서 내면 StrictMode 의 이중 호출에 두 번 나간다.
  const latest = useRef(current);
  latest.current = current;
  const set = useCallback((patch: Partial<Layout>) => {
    const s = latest.current;
    if (!s.uid) return;
    const next = { ...s.layout, ...patch };
    latest.current = { ...s, layout: next };
    rememberLayout(s.uid, next);
    setState(latest.current);
    void commit({ kind: 'layout', label: '내 캘린더 구성', summary: describe(patch), payload: next });
  }, [commit]);

  return { layout: current.layout, ready: current.ready, set };
}

function describe(p: Partial<Layout>): string {
  const parts: string[] = [];
  if (p.ledger !== undefined) parts.push(`가계부 ${p.ledger ? '표시' : '숨김'}`);
  if (p.notes !== undefined) parts.push(`노트 ${p.notes ? '표시' : '숨김'}`);
  if (p.sharedSwitcher !== undefined) parts.push(`공간 전환 ${p.sharedSwitcher ? '표시' : '숨김'}`);
  if (p.calendarAmount !== undefined) parts.push(`달력 금액 ${CALENDAR_AMOUNTS.find((a) => a.id === p.calendarAmount)?.label ?? p.calendarAmount}`);
  return parts.join(' · ') || '구성';
}
