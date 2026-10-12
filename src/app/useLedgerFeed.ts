/**
 * 결산 화면의 거래 — 고른 기간 범위만 받는다.
 *
 * 화면용 구독(보고 있는 달 ±1)과 계산용 구독(오늘 기준)은 결산이 필요로 하는 범위를
 * 덮지 않는다. 지난 해 통계를 보려면 그 해의 거래가 있어야 한다. 그렇다고 모든 과거를
 * 늘 구독하지 않는다 — 가계부 상세 화면이 열려 있을 때, 고른 기간이 걸친 달만 받는다.
 *
 * 범위가 바뀌면 앞 범위의 목록과 준비 상태를 물려주지 않는다(`useStore` 와 같은 규칙).
 * 키가 어긋난 값은 렌더에서 버린다 — 앞 범위의 거래로 새 범위의 합계를 내면 그럴듯하게
 * 틀린 숫자가 확정값처럼 뜬다.
 */
import { useEffect, useRef, useState } from 'react';
import { getFirebase } from '../data/firebase';
import { subscribeEntriesForMonths } from '../data/repo';
import type { Entry } from '../domain/types';
import { FEED_ERROR, FEED_LOADING, feedFrom, type FeedState } from './useStore';

export interface LedgerFeed {
  items: Entry[];
  feed: FeedState;
}

const NO_ITEMS: Entry[] = [];

export function useLedgerFeed(uid: string | null, months: readonly string[], enabled: boolean): LedgerFeed {
  const key = `${uid ?? ''}|${months.join(',')}`;
  const [state, setState] = useState<{ key: string; value: LedgerFeed }>(
    { key: '', value: { items: NO_ITEMS, feed: FEED_LOADING } });
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!uid || !enabled || months.length === 0) return;
    const { db } = getFirebase();
    const mine = key;
    return subscribeEntriesForMonths(
      db, uid, [...months],
      (items, meta) => {
        // 늦게 도착한 앞 범위 · 앞 계정의 스냅샷은 버린다.
        if (keyRef.current !== mine) return;
        setState({ key: mine, value: { items, feed: feedFrom(items.length, meta) } });
      },
      (scope, err) => {
        console.error(`[${scope} (결산)]`, err);
        if (keyRef.current !== mine) return;
        setState({ key: mine, value: { items: NO_ITEMS, feed: FEED_ERROR } });
      },
    );
    // key 가 uid 와 months 를 담는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return state.key === key ? state.value : { items: NO_ITEMS, feed: FEED_LOADING };
}
