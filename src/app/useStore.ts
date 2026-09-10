import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeFirestoreError, isPermissionDenied } from '../data/errors';
import { getFirebase } from '../data/firebase';
import {
  monthWindow, subscribeAccounts, subscribeDebts, subscribeEntriesForMonths,
  subscribePins, subscribeRecurringEntries, tideWindow,
  type SnapMeta,
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
  /**
   * 화면용 자료의 상태. `loading` 은 이 값에서 나온다.
   */
  display: FeedState;
  /**
   * 금액 계산용 자료의 상태.
   *
   * 화면용과 따로 둔다. 예전에는 `loading` 이 화면용 구독 하나만 보고 있어서,
   * 계산 구독이 아직 한 건도 못 받은 사이에도 화면이 "다 불러왔다" 로 굴었다.
   * 그 순간 잔고만 있고 예정 입출금이 없으니 한도가 잔고 그대로 떴다가, 잠시 뒤
   * 값이 튀었다. `ready` 가 false 면 화면은 숫자를 지어내지 않는다.
   */
  calc: FeedState;
  loading: boolean;
  error: string | null;
  /**
   * 보안 규칙이 새 컬렉션을 막고 있는 상태.
   * 규칙 배포 전에는 모든 조회가 이 상태가 되므로 따로 구분해 안내한다.
   */
  rulesBlocked: boolean;
}

/**
 * 한 갈래 구독의 상태.
 *
 * "비어 있다" 와 "아직 못 받았다" 는 다른 상태다. 오프라인 지속성 때문에 첫 스냅샷은
 * 대개 캐시에서 오고, 캐시가 비어 있으면 빈 목록이 온다 — 그것을 자료 없음으로 읽으면
 * 화면이 0원을 그린다.
 */
export interface FeedState {
  /**
   * loading  아직 한 건도 못 받았다
   * cache    받았지만 로컬 캐시에서 온 값이다 (오프라인이거나 서버 응답 전)
   * live     서버가 확인한 값이다
   * error    조회가 실패했다
   */
  status: 'loading' | 'cache' | 'live' | 'error';
  /** 한 번이라도 받았는가. */
  ready: boolean;
  /** 받은 것이 비어 있는가. `ready` 가 true 일 때만 뜻이 있다. */
  empty: boolean;
  /** 로컬 캐시에서 온 값인가. */
  fromCache: boolean;
  /** 아직 서버가 확인하지 않은 로컬 쓰기가 섞여 있는가. */
  pending: boolean;
}

const FEED_LOADING: FeedState =
  { status: 'loading', ready: false, empty: false, fromCache: false, pending: false };
/** 메모리에서 만든 자료 (데모). 기다릴 것도 실패할 것도 없다. */
export const FEED_DEMO: FeedState =
  { status: 'live', ready: true, empty: false, fromCache: false, pending: false };
const FEED_ERROR: FeedState =
  { status: 'error', ready: false, empty: false, fromCache: false, pending: false };

const feedFrom = (count: number, meta: SnapMeta): FeedState => ({
  status: meta.fromCache ? 'cache' : 'live',
  ready: true,
  empty: count === 0,
  fromCache: meta.fromCache,
  pending: meta.hasPendingWrites,
});

/**
 * 여러 구독을 하나의 상태로 합친다.
 *
 * 금액 계산에 필요한 자료는 **셋**이다 — 계산용 월 항목, 반복 항목, 잔고. 셋 중 하나만
 * 늦어도 숫자는 틀린다. 예전에는 월 구독 하나만 보고 있어서, 2025년에 시작한 반복 지출이
 * 아직 도착하지 않은 사이에 그 지출이 빠진 한도를 확정값처럼 보여 줬다.
 *
 * 규칙은 가장 나쁜 갈래를 따른다.
 *   - 하나라도 실패했으면 error
 *   - 하나라도 못 받았으면 loading
 *   - 하나라도 캐시에서 왔으면 cache (완전하다고 말할 수 없다)
 *   - `empty` 는 **전부** 비어 있을 때만 true
 */
export function combineFeeds(feeds: readonly FeedState[]): FeedState {
  if (feeds.length === 0) return FEED_LOADING;
  if (feeds.some((f) => f.status === 'error')) return FEED_ERROR;
  if (feeds.some((f) => !f.ready)) return FEED_LOADING;
  const fromCache = feeds.some((f) => f.fromCache);
  return {
    status: fromCache ? 'cache' : 'live',
    ready: true,
    empty: feeds.every((f) => f.empty),
    fromCache,
    pending: feeds.some((f) => f.pending),
  };
}

/**
 * 범위가 딸린 값.
 *
 * 조회 범위(보고 있는 달·계산 창)가 바뀌면 앞 범위의 준비 상태를 그대로 쓰면 안 된다.
 * 새 구독은 아직 한 건도 받지 않았는데 "다 받았다" 로 굴면, 새 범위의 자료가 도착하기
 * 전에 옛 범위의 목록으로 계산한 숫자가 확정값처럼 뜬다. 값에 범위를 붙여 두고
 * 렌더에서 키가 어긋나면 버린다 — effect 로 비우면 한 번은 어긋난 채로 그려진다.
 */
interface Keyed<T> { key: string; value: T }

const NO_ENTRIES: Entry[] = [];

const EMPTY: StoreState = {
  entries: [], tideEntries: [], tideMonths: [],
  accounts: [], debts: [], pins: [],
  display: FEED_LOADING, calc: FEED_LOADING,
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

  // 범위가 딸린 둘은 키와 함께 든다. 키가 어긋나면 렌더에서 버린다.
  const [monthFeed, setMonthFeed] = useState<Keyed<{ items: Entry[]; feed: FeedState }>>(
    { key: '', value: { items: NO_ENTRIES, feed: FEED_LOADING } });
  const [tideFeed, setTideFeed] = useState<Keyed<{ items: Entry[]; feed: FeedState }>>(
    { key: '', value: { items: NO_ENTRIES, feed: FEED_LOADING } });

  const [recurring, setRecurring] = useState<Entry[]>(NO_ENTRIES);
  const [recurringFeed, setRecurringFeed] = useState<FeedState>(FEED_LOADING);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsFeed, setAccountsFeed] = useState<FeedState>(FEED_LOADING);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rulesBlocked, setRulesBlocked] = useState(false);

  /*
    ── 계정이 바뀌면 앞 계정의 자료를 화면에 남기지 않는다 ──────────────

    구독을 끊어도 마지막 스냅샷은 상태에 그대로 남는다. 새 계정의 첫 스냅샷이
    올 때까지 그 사이 화면에는 앞사람의 일정·잔고가 떠 있었다.

    렌더 중에 비운다 (React 가 권장하는 "이전 렌더 결과 버리기"). effect 로 미루면
    비우기 전에 한 번 그려진다. 아래 반환문도 `dataUid !== uid` 인 동안은 EMPTY 를
    내보내, 늦게 도착한 스냅샷이 있어도 새 계정 화면에 섞이지 않는다.
  */
  const [dataUid, setDataUid] = useState<string | null>(uid);
  if (dataUid !== uid) {
    setDataUid(uid);
    setMonthFeed({ key: '', value: { items: NO_ENTRIES, feed: FEED_LOADING } });
    setTideFeed({ key: '', value: { items: NO_ENTRIES, feed: FEED_LOADING } });
    setRecurring(NO_ENTRIES); setRecurringFeed(FEED_LOADING);
    setAccounts([]); setAccountsFeed(FEED_LOADING);
    setDebts([]); setPins([]);
    setError(null); setRulesBlocked(false);
  }

  const sinkRef = useRef<{ setError: typeof setError; setBlocked: typeof setRulesBlocked }>({
    setError, setBlocked: setRulesBlocked,
  });
  sinkRef.current = { setError, setBlocked: setRulesBlocked };

  /*
    지금 화면이 누구 것인지. 구독을 끊은 뒤 늦게 도착한 콜백을 버리는 데 쓴다.

    Firestore 의 unsubscribe 는 이후 콜백을 막아 주지만, 그 보장에만 기대면 계정이
    바뀌는 순간이 남의 자료가 새 화면에 섞이는 유일한 통로가 된다. 여기서 한 번 더 건다.
  */
  const uidRef = useRef(uid);
  uidRef.current = uid;

  /** `owner` 의 구독에서 온 값만 통과시킨다. */
  const own = useCallback(<A extends unknown[]>(owner: string, fn: (...a: A) => void) =>
    (...a: A) => { if (uidRef.current === owner) fn(...a); }, []);

  /** 오류 처리는 세 effect 가 같이 쓴다. */
  const onError = useCallback((scope: string, err: unknown) => {
    // 조용히 삼키면 "저장은 되는데 안 보이는" 상태의 원인을 찾을 수 없다.
    console.error(`[${scope}]`, err);
    if (isPermissionDenied(err)) { sinkRef.current.setBlocked(true); return; }
    sinkRef.current.setError(`${scope} 를 불러오지 못했습니다. ${describeFirestoreError(err)}`);
  }, []);

  /*
    실패한 갈래는 로딩으로 두지 않는다. 영원히 도는 스피너는 오류를 감추는 것과 같다.

    갈래마다 따로 표시한다 — 반복 구독만 실패했는데 계산이 "다 받았다" 로 굴면,
    반복 지출이 통째로 빠진 한도가 확정값처럼 뜬다.
  */
  const failWith = useCallback(
    (set: (f: FeedState) => void, scope: string, err: unknown) => { set(FEED_ERROR); onError(scope, err); },
    [onError],
  );

  /*
    ── effect 를 셋으로 나눈 이유 ────────────────────────────────

    하나로 묶으면 달을 넘길 때마다(monthKey 변경) 계산 구독과 잔고·대출·고정 메모까지
    전부 끊고 다시 붙는다. 계산 창은 오늘 기준이라 커서와 무관한데도 재구독이 돌고,
    그때마다 잠깐 빈 목록이 흘러 머리 숫자가 깜빡인다.

    이제 커서를 옮기면 화면용 구독만 다시 붙는다.
  */

  // 1. 화면용 — 커서를 따라 움직인다.
  useEffect(() => {
    if (!uid) return;
    const { db } = getFirebase();
    return subscribeEntriesForMonths(
      db, uid, monthKey.split(','),
      own(uid, (items, meta) => setMonthFeed({
        key: monthKey, value: { items, feed: feedFrom(items.length, meta) },
      })),
      own(uid, (scope, err) => failWith(
        (f) => setMonthFeed({ key: monthKey, value: { items: NO_ENTRIES, feed: f } }), scope, err)),
    );
  }, [uid, monthKey, failWith, own]);

  // 2. 계산용 — 오늘 기준. 커서를 옮겨도 다시 붙지 않는다.
  useEffect(() => {
    if (!uid) return;
    const { db } = getFirebase();
    return subscribeEntriesForMonths(
      db, uid, tideKey.split(','),
      own(uid, (items, meta) => setTideFeed({
        key: tideKey, value: { items, feed: feedFrom(items.length, meta) },
      })),
      own(uid, (scope, err) => failWith(
        (f) => setTideFeed({ key: tideKey, value: { items: NO_ENTRIES, feed: f } }), `${scope} (계산)`, err)),
    );
  }, [uid, tideKey, failWith, own]);

  // 3. 나머지 — uid 가 바뀔 때만.
  useEffect(() => {
    if (!uid) return;
    const { db } = getFirebase();
    const unsubs = [
      subscribeRecurringEntries(
        db, uid,
        own(uid, (items, meta) => { setRecurring(items); setRecurringFeed(feedFrom(items.length, meta)); }),
        own(uid, (scope, err) => failWith(setRecurringFeed, `${scope} (반복)`, err)),
      ),
      subscribeAccounts(
        db, uid,
        own(uid, (items, meta) => { setAccounts(items); setAccountsFeed(feedFrom(items.length, meta)); }),
        own(uid, (scope, err) => failWith(setAccountsFeed, scope, err)),
      ),
      subscribeDebts(db, uid, own(uid, setDebts), own(uid, onError)),
      subscribePins(db, uid, own(uid, setPins), own(uid, onError)),
    ];
    return () => {
      unsubs.forEach((u) => u());
      setRulesBlocked(false);
      setError(null);
    };
  }, [uid, onError, failWith, own]);

  /*
    범위가 어긋난 값은 버린다. 커서를 옮긴 직후·자정을 넘긴 직후의 첫 렌더에서
    앞 범위의 목록과 준비 상태가 새 범위의 것으로 읽히지 않게 한다.
  */
  const monthNow = monthFeed.key === monthKey ? monthFeed.value : null;
  const tideNow = tideFeed.key === tideKey ? tideFeed.value : null;
  const monthEntries = monthNow?.items ?? NO_ENTRIES;
  const tideRaw = tideNow?.items ?? NO_ENTRIES;
  const display = monthNow?.feed ?? FEED_LOADING;

  // 반복 항목은 첫 발생 달의 ymSpan 을 갖고 있어 월 조회에도 걸린다.
  // 두 번 들어가지 않도록 id 로 합친다.
  const entries = useMemo(() => mergeById(monthEntries, recurring), [monthEntries, recurring]);
  const tideEntries = useMemo(() => mergeById(tideRaw, recurring), [tideRaw, recurring]);

  /*
    계산 상태는 세 구독을 종합한다. 월 항목만 도착해도 반복 지출과 잔고가 없으면
    한도는 틀린다 — 그 상태를 "준비됨" 으로 내보내지 않는다.
  */
  const calc = useMemo(
    () => combineFeeds([tideNow?.feed ?? FEED_LOADING, recurringFeed, accountsFeed]),
    [tideNow?.feed, recurringFeed, accountsFeed],
  );

  // 계정이 막 바뀐 렌더에서는 아직 앞 계정의 값이 상태에 남아 있다. 내보내지 않는다.
  if (!uid || dataUid !== uid) return EMPTY;

  return {
    entries, tideEntries, tideMonths,
    accounts, debts, pins,
    display, calc,
    loading: !display.ready, error, rulesBlocked,
  };
}

function mergeById(a: readonly Entry[], b: readonly Entry[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const e of a) byId.set(e.id, e);
  for (const e of b) byId.set(e.id, e);
  return [...byId.values()];
}
