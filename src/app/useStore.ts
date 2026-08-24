import { useEffect, useMemo, useRef, useState } from 'react';
import { describeFirestoreError, isPermissionDenied } from '../data/errors';
import { getFirebase } from '../data/firebase';
import {
  monthWindow, subscribeAccounts, subscribeDebts, subscribeEntriesForMonths,
  subscribePins, subscribeRecurringEntries,
} from '../data/repo';
import type { Account, Debt, Entry, Pin } from '../domain/types';

export interface StoreState {
  entries: Entry[];
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
  entries: [], accounts: [], debts: [], pins: [],
  loading: false, error: null, rulesBlocked: false,
};

/**
 * 구독 계층.
 *
 * 이전 구조는 users/{uid}/items 전체를 한 번에 구독했다. 여기서는 보고 있는 달과 앞뒤
 * 한 달만 받고, 월 조회로 잡히지 않는 반복 항목만 따로 받는다. (F-06)
 */
export function useStore(uid: string | null, cursorISO: string): StoreState {
  const months = useMemo(() => monthWindow(cursorISO), [cursorISO]);
  const monthKey = months.join(',');

  const [monthEntries, setMonthEntries] = useState<Entry[]>([]);
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

  useEffect(() => {
    if (!uid) {
      setMonthEntries([]); setRecurring([]); setAccounts([]); setDebts([]); setPins([]);
      setReady(false);
      return;
    }

    const { db } = getFirebase();
    const onError = (scope: string, err: unknown) => {
      // 조용히 삼키면 "저장은 되는데 안 보이는" 상태의 원인을 찾을 수 없다.
      console.error(`[${scope}]`, err);
      if (isPermissionDenied(err)) {
        sinkRef.current.setBlocked(true);
        return;
      }
      sinkRef.current.setError(`${scope} 를 불러오지 못했습니다. ${describeFirestoreError(err)}`);
    };

    const unsubs = [
      subscribeEntriesForMonths(db, uid, monthKey.split(','), (e) => { setMonthEntries(e); setReady(true); }, onError),
      subscribeRecurringEntries(db, uid, setRecurring, onError),
      subscribeAccounts(db, uid, setAccounts, onError),
      subscribeDebts(db, uid, setDebts, onError),
      subscribePins(db, uid, setPins, onError),
    ];
    return () => {
      unsubs.forEach((u) => u());
      // 달을 옮길 때마다 지난 오류가 남아 있으면 안 된다.
      setRulesBlocked(false);
      setError(null);
    };
  }, [uid, monthKey]);

  const entries = useMemo(() => {
    // 반복 항목은 첫 발생 달의 ymSpan 을 갖고 있어 월 조회에도 걸린다.
    // 두 번 펼쳐지지 않도록 id 로 합친다.
    const byId = new Map<string, Entry>();
    for (const e of monthEntries) byId.set(e.id, e);
    for (const e of recurring) byId.set(e.id, e);
    return [...byId.values()];
  }, [monthEntries, recurring]);

  if (!uid) return EMPTY;

  return { entries, accounts, debts, pins, loading: !ready, error, rulesBlocked };
}
