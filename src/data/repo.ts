import { DEVICE_UID, readDevice, watchDevice, deviceMeta, commitDevice, mergeDevice } from './deviceStore';
/**
 * Firestore 저장 계층.
 *
 * 이전 구조는 users/{uid}/items 전체를 onSnapshot 으로 통째로 구독했다. 1인 사용에서는
 * 문제가 없지만, 항목이 쌓일수록 접속마다 전량이 전송되고 읽기 과금이 (사용자 수 ×
 * 보유 항목 수)로 늘어난다. (F-06) 여기서는 ymSpan 인덱스로 보고 있는 달 주변만 구독한다.
 *
 * 쓰기는 await 하지 않는다. 오프라인 지속성이 켜져 있으면 setDoc 이 로컬 캐시를 먼저
 * 갱신하고 onSnapshot 이 즉시 발화하므로, 별도의 낙관적 상태를 두지 않아도 입력이
 * 곧바로 반영된다. (F-08)
 */
import {
  deleteDoc, getDoc, getDocs, getDocsFromServer, onSnapshot, query, runTransaction, setDoc, where, writeBatch,
  type Firestore, type QuerySnapshot,
} from 'firebase/firestore';
import { normalizeDate, ymOf } from '../domain/date';
import { describeFirestoreError } from './errors';
import { layoutFrom, type Layout } from '../domain/layout';
import type {
  AnnualBudget, Account, Budget, Card, Category, CategoryBudget, Debt, Entry, LedgerNote, LedgerSettings, Pin, RecoveryRule, Reserve, YearMonth,
} from '../domain/types';
import {
  annualBudgetFromDoc, annualBudgetToDoc, accountFromDoc, accountToDoc, budgetFromDoc, budgetToDoc, cardFromDoc, cardToDoc,
  categoryBudgetFromDoc, categoryBudgetToDoc, categoryFromDoc, categoryToDoc, ledgerNoteFromDoc, ledgerNoteToDoc,
  debtFromDoc, debtToDoc, entryFromDoc, entryToDoc, ledgerSettingsFromDoc, ledgerSettingsToDoc,
  pinFromDoc, pinToDoc, recoveryRuleFromDoc, recoveryRuleToDoc, reserveFromDoc, reserveToDoc,
} from './converters';
import { COL, col, docIn, userDoc } from './paths';

export type Unsubscribe = () => void;

/** onSnapshot 은 에러를 던지지 않고 콜백으로 준다. 삼켜지면 원인을 못 찾는다. */
export type ErrorSink = (scope: string, err: unknown) => void;

/**
 * 스냅샷이 어디서 왔는지.
 *
 * 오프라인 지속성이 켜져 있어서 첫 스냅샷은 대개 로컬 캐시에서 온다. 캐시가 비어 있으면
 * **빈 목록**이 오는데, 그것은 "자료가 없다" 가 아니라 "아직 서버 것을 못 받았다" 다.
 * 둘을 같은 값으로 다루면 화면이 자료 없음을 0원으로 그린다.
 */
export interface SnapMeta {
  /** 서버가 아니라 로컬 캐시에서 온 값. */
  fromCache: boolean;
  /** 아직 서버가 확인하지 않은 로컬 쓰기가 섞여 있다. */
  hasPendingWrites: boolean;
}

export type SnapSink<T> = (items: T[], meta: SnapMeta) => void;

const metaOf = (snap: QuerySnapshot): SnapMeta => ({
  fromCache: snap.metadata.fromCache,
  hasPendingWrites: snap.metadata.hasPendingWrites,
});

function mapSnap<T>(snap: QuerySnapshot, make: (id: string, raw: Record<string, unknown>) => T): T[] {
  const out: T[] = [];
  snap.forEach((d) => out.push(make(d.id, d.data() as Record<string, unknown>)));
  return out;
}

/**
 * 메타데이터 변경까지 받는 리스너의 손잡이.
 *
 * `fromCache` 는 자료가 그대로인 채로 true → false 로 바뀐다 (캐시로 먼저 그리고, 잠시 뒤
 * 서버가 같은 값을 확인해 준다). 기본 리스너는 **문서가 바뀔 때만** 발화하므로 그 전환을
 * 받지 못한다 — 화면은 영원히 "캐시 기준" 으로 남는다. 그래서 `includeMetadataChanges`
 * 를 켠다.
 *
 * 대신 문서가 하나도 안 바뀐 발화가 늘어난다. 그때마다 새 배열을 만들면 위쪽 useMemo 가
 * 전부 다시 돌므로, 문서 변경이 없으면 **앞서 만든 배열을 그대로** 돌려준다. 그러면
 * React 가 상태 변경을 걸러 내고 리렌더는 메타데이터 때문에 실제로 달라진 값에서만 난다.
 */
function keepingIdentity<T>(
  make: (id: string, raw: Record<string, unknown>) => T, cb: SnapSink<T>,
): (snap: QuerySnapshot) => void {
  let last: T[] | null = null;
  return (snap) => {
    // docChanges() 는 메타데이터 변경을 세지 않는다 — 비어 있으면 문서는 그대로다.
    if (last === null || snap.docChanges().length > 0) last = mapSnap(snap, make);
    cb(last, metaOf(snap));
  };
}

/** 정렬이 필요한 컬렉션용. 같은 이유로 배열 동일성을 지킨다. */
function keepingSorted<T>(
  make: (id: string, raw: Record<string, unknown>) => T,
  sort: (a: T, b: T) => number, cb: SnapSink<T>,
): (snap: QuerySnapshot) => void {
  let last: T[] | null = null;
  return (snap) => {
    if (last === null || snap.docChanges().length > 0) last = mapSnap(snap, make).sort(sort);
    cb(last, metaOf(snap));
  };
}

/** 메타데이터 변경까지 받는다. 이 옵션이 없으면 캐시 → 서버 전환을 알 수 없다. */
const WITH_META = { includeMetadataChanges: true } as const;

/** `array-contains-any` 한 번에 넣을 수 있는 값의 상한. */
export const MAX_MONTHS_PER_QUERY = 30;

/** 달 목록을 조회 한 번에 들어갈 크기로 나눈다. 같은 달은 한 번만 넣는다. */
export function chunkMonths(
  months: readonly YearMonth[], size = MAX_MONTHS_PER_QUERY,
): YearMonth[][] {
  const uniq = [...new Set(months)];
  const out: YearMonth[][] = [];
  for (let i = 0; i < uniq.length; i += size) out.push(uniq.slice(i, i + size));
  return out;
}

/**
 * 여러 조각 구독을 하나의 목록으로 합친다.
 *
 *   - **모든 조각이 한 번씩 도착하기 전에는 내보내지 않는다.** 앞 조각만 받은 목록을
 *     내보내면 뒤 조각의 거래가 빠진 한도가 확정값처럼 뜬다.
 *   - 두 조각에 함께 걸린 문서(경계 달에 걸친 항목)는 한 번만 담는다. 잠깐 두 조각이
 *     다른 판을 들고 있을 수 있으므로 `updatedAt` 이 늦은 쪽을 쓴다.
 *   - 하나라도 캐시에서 왔으면 캐시 기준, 하나라도 미확정 쓰기가 있으면 미확정이다.
 *   - 한 조각이라도 실패하면 그 뒤로는 내보내지 않는다. 남은 조각의 발화가 실패 상태를
 *     덮어 "다 받았다" 로 돌아가면 안 된다.
 *   - 문서가 바뀐 조각이 없으면 앞서 만든 배열을 그대로 돌려준다 (`keepingIdentity`).
 *
 * 순서는 문서 id 순이다 — 조각 하나짜리 조회가 돌려주던 순서와 같다.
 */
export interface ChunkCombiner<T> {
  sinks: SnapSink<T>[];
  /** 조각 하나가 실패했다. 이후 발화를 막는다. 처음 한 번만 true 를 돌려준다. */
  fail: () => boolean;
}

export function combineChunks<T extends { id: string; updatedAt?: string }>(
  n: number, cb: SnapSink<T>,
): ChunkCombiner<T> {
  const latest: (T[] | null)[] = Array.from({ length: n }, () => null);
  const metas: (SnapMeta | null)[] = Array.from({ length: n }, () => null);
  let merged: T[] | null = null;
  let mergedFrom: (T[] | null)[] = [];
  let failed = false;

  const sinks = latest.map((_, i): SnapSink<T> => (items, meta) => {
    if (failed) return;
    latest[i] = items;
    metas[i] = meta;
    if (latest.some((x) => x === null)) return;
    if (merged === null || latest.some((x, j) => x !== mergedFrom[j])) {
      const byId = new Map<string, T>();
      for (const list of latest) {
        for (const e of list!) {
          const prev = byId.get(e.id);
          if (!prev || (e.updatedAt ?? '') > (prev.updatedAt ?? '')) byId.set(e.id, e);
        }
      }
      merged = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      mergedFrom = [...latest];
    }
    cb(merged, {
      fromCache: metas.some((m) => m!.fromCache),
      hasPendingWrites: metas.some((m) => m!.hasPendingWrites),
    });
  });

  return {
    sinks,
    fail: () => {
      if (failed) return false;
      failed = true;
      return true;
    },
  };
}

/**
 * 달 목록에 걸친 항목을 구독한다.
 *
 * 화면용은 보고 있는 달과 앞뒤 한 달이다 — 월을 넘길 때마다 새로 받아오면 화면이
 * 비었다가 채워지므로, 이웃 달을 미리 들고 있는다.
 *
 * 계산용은 잔고 기준일까지 거슬러 갈 수 있어 30달을 넘을 수 있다. `array-contains-any`
 * 는 값 30개까지라, 예전에는 31번째 달부터 **조용히 잘렸다**. 이제 30달씩 나눠 조회하고
 * 합친다 (`combineChunks`). 30달 이하면 지금과 똑같이 조회 한 번이다.
 */
export function subscribeEntriesForMonths(
  db: Firestore, uid: string, months: YearMonth[],
  cb: SnapSink<Entry>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.entries.filter(e => e.ymSpan.some(m => months.includes(m))), value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  // 달이 하나도 없으면 조회 자체가 성립하지 않는다. 캐시에서 온 빈 목록과 구분되도록
  // fromCache 를 세워 둔다 — 이 상태를 "자료 없음" 으로 읽으면 안 된다.
  if (months.length === 0) { cb([], { fromCache: true, hasPendingWrites: false }); return () => {}; }
  const chunks = chunkMonths(months);
  const listen = (part: YearMonth[], sink: SnapSink<Entry>, fail: (err: unknown) => void) => onSnapshot(
    query(col(db, uid, COL.entries), where('ymSpan', 'array-contains-any', part)),
    WITH_META,
    keepingIdentity(entryFromDoc, sink),
    fail,
  );
  if (chunks.length === 1) return listen(chunks[0]!, cb, (err) => onError('entries', err));

  const combined = combineChunks<Entry>(chunks.length, cb);
  const unsubs = chunks.map((part, i) => listen(part, combined.sinks[i]!, (err) => {
    if (combined.fail()) onError('entries', err);
  }));
  return () => unsubs.forEach((u) => u());
}

/**
 * 반복 항목은 첫 발생 달의 ymSpan 만 갖고 있어 월 조회로 잡히지 않는다.
 * 개수가 적으므로 전량을 따로 구독하고 클라이언트에서 펼친다.
 */
export function subscribeRecurringEntries(
  db: Firestore, uid: string,
  cb: SnapSink<Entry>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.entries.filter(e => e.isRecurring), value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  const q = query(col(db, uid, COL.entries), where('isRecurring', '==', true));
  return onSnapshot(
    q, WITH_META,
    keepingIdentity(entryFromDoc, cb),
    (err) => onError('recurring', err),
  );
}

export function subscribeAccounts(
  db: Firestore, uid: string, cb: SnapSink<Account>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.accounts, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.accounts), WITH_META,
    keepingSorted(accountFromDoc, (a, b) => a.order - b.order, cb),
    (err) => onError('accounts', err),
  );
}

export function subscribeDebts(
  db: Firestore, uid: string, cb: (v: Debt[]) => void, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.debts, value => cb(value), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.debts),
    (snap) => cb(mapSnap(snap, debtFromDoc).sort((a, b) => a.order - b.order)),
    (err) => onError('debts', err),
  );
}

/**
 * 생활비 예산 · 세이브.
 *
 * 둘 다 개수가 적고 **달과 무관하다** — 9월 예산은 12월 달력을 보고 있어도 한도를
 * 잡고 있어야 한다. 그래서 월 창이 아니라 전량을 구독한다. 잔고·대출과 같은 갈래다.
 */
export function subscribeBudgets(
  db: Firestore, uid: string, cb: SnapSink<Budget>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.budgets, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.budgets), WITH_META,
    keepingSorted(budgetFromDoc, (a, b) => a.startDate.localeCompare(b.startDate), cb),
    (err) => onError('budgets', err),
  );
}

export function subscribeReserves(
  db: Firestore, uid: string, cb: SnapSink<Reserve>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.reserves, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.reserves), WITH_META,
    keepingSorted(reserveFromDoc, (a, b) => a.name.localeCompare(b.name), cb),
    (err) => onError('reserves', err),
  );
}

export function subscribePins(
  db: Firestore, uid: string, cb: (v: Pin[]) => void, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.pins, value => cb(value), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.pins),
    (snap) => cb(mapSnap(snap, pinFromDoc).sort((a, b) => a.order - b.order)),
    (err) => onError('pins', err),
  );
}

/**
 * 회복 규칙.
 *
 * 컬렉션이 아니라 `users/{uid}` 문서의 필드 하나다. 사용자당 하나뿐인 상태라
 * 문서를 따로 셀 이유가 없고, 이 경로는 보안 규칙이 이미 소유자에게 열어 두었다.
 * 문서가 작아 통째로 구독해도 부담이 없다 — 대신 예정일·빚이 다른 기기에서 바뀌어도
 * 즉시 따라온다.
 */
export function subscribeRecoveryRule(
  db: Firestore, uid: string, cb: (r: RecoveryRule) => void, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.recovery, value => cb(value), error => onError('기기 저장소', error));
  return onSnapshot(
    userDoc(db, uid),
    (snap) => cb(recoveryRuleFromDoc(snap.data()?.recovery)),
    (err) => onError('recovery', err),
  );
}

/**
 * 카테고리 · 카테고리 예산. 둘 다 작고 달과 무관해 전량 구독한다 — 예산 · 세이브와 같은 갈래다.
 */
export function subscribeCategories(
  db: Firestore, uid: string, cb: SnapSink<Category>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.categories, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.categories), WITH_META,
    keepingSorted(categoryFromDoc, (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'), cb),
    (err) => onError('categories', err),
  );
}

export function subscribeCategoryBudgets(
  db: Firestore, uid: string, cb: SnapSink<CategoryBudget>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.categoryBudgets, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.categoryBudgets), WITH_META,
    keepingIdentity(categoryBudgetFromDoc, cb),
    (err) => onError('categoryBudgets', err),
  );
}

/** 신용카드(P4). 몇 장뿐이라 전량 받는다. */
export function subscribeCards(
  db: Firestore, uid: string, cb: SnapSink<Card>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.cards, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.cards), WITH_META,
    keepingIdentity(cardFromDoc, cb),
    (err) => onError('cards', err),
  );
}

/**
 * 카드에 걸린 거래 전량 (P4) — 카드 사용 · 카드 대금, 실제 · 예정 모두.
 *
 * 미결제는 청구(실제 카드 사용) − 납부(실제 카드 대금)를 회차마다 센 값이다(`card.ts`). 계산 창의 거래만 보면 창 밖의
 * 지난 사용 · 대금이 빠져 미결제가 틀린다 — 그래서 달과 무관하게 받는다. `!= null` 은 그 필드가 없는 예전 문서와
 * null 인 문서를 함께 뺀다. 단일 필드 색인으로 조회된다. 카드 거래가 쌓일수록 읽기가 늘어난다(남은 일).
 */
export function subscribeCardLinkedEntries(
  db: Firestore, uid: string, cb: SnapSink<Entry>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.entries.filter(e => !!e.money?.cardId), value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    query(col(db, uid, COL.entries), where('money.cardId', '!=', null)), WITH_META,
    keepingIdentity(entryFromDoc, cb),
    (err) => onError('cardLinked', err),
  );
}

/** 연간 카테고리 예산. 카테고리 × 연도라 작고 기간과 무관하게 전량 받는다. */
export function subscribeAnnualBudgets(
  db: Firestore, uid: string, cb: SnapSink<AnnualBudget>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.annualBudgets, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.annualBudgets), WITH_META,
    keepingIdentity(annualBudgetFromDoc, cb),
    (err) => onError('annualBudgets', err),
  );
}

/** 정산 기간 메모. 한 달에 한 장이라 작고 기간과 무관하게 전량 받는다. */
export function subscribeLedgerNotes(
  db: Firestore, uid: string, cb: SnapSink<LedgerNote>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.ledgerNotes, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    col(db, uid, COL.ledgerNotes), WITH_META,
    keepingIdentity(ledgerNoteFromDoc, cb),
    (err) => onError('ledgerNotes', err),
  );
}

/** 가계부 설정(정산 시작일). 회복 규칙과 같은 사용자 문서의 다른 필드다. */
export function subscribeLedgerSettings(
  db: Firestore, uid: string, cb: (s: LedgerSettings, meta: SnapMeta) => void, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.ledger, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    userDoc(db, uid), WITH_META,
    (snap) => cb(ledgerSettingsFromDoc(snap.data()?.ledger), {
      fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites,
    }),
    (err) => onError('ledger', err),
  );
}

/** 내 캘린더 구성. 같은 사용자 문서의 `layout` 필드 — 없으면 지금까지 보던 구성이다(`layoutFrom`). */
export function subscribeLayout(
  db: Firestore, uid: string, cb: (l: Layout, meta: SnapMeta) => void, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.layout, value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    userDoc(db, uid), WITH_META,
    (snap) => cb(layoutFrom(snap.data()?.layout), {
      fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites,
    }),
    (err) => onError('layout', err),
  );
}

/** 가입하는 순간 새 사용자의 구성을 적는다. 실패해도 지금까지의 구성(예상 잔고)으로 돌 뿐이다. */
export function saveLayout(db: Firestore, uid: string, layout: Layout): Promise<void> {
  if (uid === DEVICE_UID) return commitDevice({ kind: 'layout', label: '구성', summary: '', payload: layout });
  return setDoc(userDoc(db, uid), { layout }, { merge: true });
}

/**
 * 실제 거래 전량. **전체 검색에서만** 쓴다 — 사용자가 고른 순간 한 번 읽는다.
 *
 * `money.status` 는 Firestore 가 저절로 만드는 단일 필드 색인으로 조회된다. 원장 필드가
 * 없던 시절의 문서는 실제 거래일 수 없으므로 빠져도 된다.
 */
export async function fetchActualEntries(db: Firestore, uid: string): Promise<Entry[]> {
  if (uid === DEVICE_UID) return (await readDevice()).entries.filter(e => e.money?.status === 'actual');
  const snap = await getDocs(query(col(db, uid, COL.entries), where('money.status', '==', 'actual')));
  return mapSnap(snap, entryFromDoc);
}

/**
 * 세이브에 건 거래 전량 (P3) — 실제 · 예정 모두.
 *
 * 세이브의 사용액은 연결된 실제 지출의 합이다(`budget.reserveUsageOf`). 계산 창(잔고 기준일 ~ +14달)의 거래만
 * 보면 창 밖의 지난 사용이 빠져 남은 금액이 실제보다 크게 잡힌다 — 그래서 달과 무관하게 연결된 거래를 따로 받는다.
 * `!= null` 은 그 필드가 없는 예전 문서와 null 인 문서를 함께 뺀다. 단일 필드 색인으로 조회된다.
 */
export function subscribeReserveLinkedEntries(
  db: Firestore, uid: string, cb: SnapSink<Entry>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.entries.filter(e => !!e.money?.reserveId), value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    query(col(db, uid, COL.entries), where('money.reserveId', '!=', null)), WITH_META,
    keepingIdentity(entryFromDoc, cb),
    (err) => onError('reserveLinked', err),
  );
}

/**
 * 실제 거래 전량을 구독한다 — 전체 검색이 켜져 있는 동안만.
 *
 * 한 번 읽어 두면 검색 결과에서 고치거나 지운 거래가 옛 모습 그대로 남는다. 구독이면
 * 이 기기의 쓰기가 로컬 캐시를 거쳐 곧바로 결과에 반영된다.
 */
export function subscribeActualEntries(
  db: Firestore, uid: string, cb: SnapSink<Entry>, onError: ErrorSink,
): Unsubscribe {
  if (uid === DEVICE_UID) return watchDevice(d => d.entries.filter(e => e.money?.status === 'actual'), value => cb(value, deviceMeta), error => onError('기기 저장소', error));
  return onSnapshot(
    query(col(db, uid, COL.entries), where('money.status', '==', 'actual')), WITH_META,
    keepingIdentity(entryFromDoc, cb),
    (err) => onError('actuals', err),
  );
}

/** 한 건. 화면 · 계산 · 결산 구독 어디에도 없는 원본을 열 때 쓴다. 없으면 null. */
export async function fetchEntry(db: Firestore, uid: string, id: string): Promise<Entry | null> {
  if (uid === DEVICE_UID) return (await readDevice()).entries.find(e => e.id === id) ?? null;
  const snap = await getDoc(docIn(db, uid, COL.entries, id));
  return snap.exists() ? entryFromDoc(snap.id, snap.data() as Record<string, unknown>) : null;
}

/**
 * 이 예정을 가리키는 확정 거래 전량. 예정을 고치기 전에 연결을 잃는 것을 찾는 데 쓴다 —
 * 화면 구독은 보고 있는 달 근처만 받으므로 지난해 확정분이 빠진다.
 * `complete` 가 false 면 서버에 닿지 못하고 이 기기 캐시만 본 것이다.
 */
export async function fetchConfirmationsOf(
  db: Firestore, uid: string, planId: string,
): Promise<{ entries: Entry[]; complete: boolean }> {
  if (uid === DEVICE_UID) return { entries: (await readDevice()).entries.filter(e => e.money?.plannedRef?.entryId === planId), complete: true };
  const snap = await getDocs(query(col(db, uid, COL.entries), where('money.plannedRef.entryId', '==', planId)));
  return { entries: mapSnap(snap, entryFromDoc), complete: !snap.metadata.fromCache };
}

/**
 * 그 생활비 주머니를 가리키는 거래 전부 — 화면 · 계산 구독 창 밖의 지난 거래까지.
 * 주머니의 기간을 바꾸거나 지울 때, 연결을 어떻게 할지 고르려면 빠짐없이 봐야 한다.
 * 서버에 닿지 못하면 캐시 결과와 함께 complete: false 를 돌려준다.
 */
export async function fetchPocketEntries(
  db: Firestore, uid: string, budgetId: string,
): Promise<{ entries: Entry[]; complete: boolean }> {
  if (uid === DEVICE_UID) return { entries: (await readDevice()).entries.filter(e => e.money?.budgetId === budgetId), complete: true };
  const snap = await getDocs(query(col(db, uid, COL.entries), where('money.budgetId', '==', budgetId)));
  return { entries: mapSnap(snap, entryFromDoc), complete: !snap.metadata.fromCache };
}

/**
 * 가계부 계산에 드는 자료 전부 — **서버에서만** 읽는다(캐시로 물러나지 않는다).
 * 지난 예정 정리가 쓴다. 캐시는 비었거나 낡았을 수 있어, 그것으로 지울 목록을 고르거나 "지워졌다"
 * 를 확인하면 안 된다. 오프라인이면 던진다.
 */
export async function fetchLedgerFromServer(db: Firestore, uid: string): Promise<{
  entries: Entry[]; accounts: Account[]; budgets: Budget[]; reserves: Reserve[]; cards: Card[];
}> {
  if (uid === DEVICE_UID) return readDevice();
  const [e, a, b, r, c] = await Promise.all([
    getDocsFromServer(col(db, uid, COL.entries)),
    getDocsFromServer(col(db, uid, COL.accounts)),
    getDocsFromServer(col(db, uid, COL.budgets)),
    getDocsFromServer(col(db, uid, COL.reserves)),
    getDocsFromServer(col(db, uid, COL.cards)),
  ]);
  return {
    entries: mapSnap(e, entryFromDoc), accounts: mapSnap(a, accountFromDoc),
    budgets: mapSnap(b, budgetFromDoc), reserves: mapSnap(r, reserveFromDoc), cards: mapSnap(c, cardFromDoc),
  };
}

/** migratedAt 같은 이웃 필드를 지우지 않도록 merge 로 쓴다. */
export function saveRecoveryRule(db: Firestore, uid: string, rule: RecoveryRule): Promise<void> {
  return setDoc(userDoc(db, uid), { recovery: recoveryRuleToDoc(rule) }, { merge: true });
}

/**
 * 규칙의 일부 필드만 고친다.
 *
 * merge 는 맵 안쪽까지 필드 단위로 합치므로, 여기서 준 키만 바뀌고 나머지는 그대로 남는다.
 * 규칙 전체를 쓰는 경로(설정 화면)와 자동으로 도는 경로(예정일 채우기)가 동시에
 * 규칙 전체를 쓰면 나중 것이 앞선 것을 통째로 덮는다 — 설정에서 방금 적은 기본 메모가
 * 예정일 계산에 지워지는 식이다. 자동 경로는 자기가 계산한 필드만 건드린다.
 */
export function patchRecoveryRule(
  db: Firestore, uid: string, patch: Partial<RecoveryRule>,
): Promise<void> {
  return setDoc(userDoc(db, uid), { recovery: patch }, { merge: true });
}

/**
 * 회복 항목과 규칙을 한 번에 쓴다.
 *
 * 두 쓰기를 이어 붙이면(`saveEntry(...).then(() => saveRecoveryRule(...))`) 항목만 남고
 * 규칙이 갱신되지 않는 창이 열린다. 오프라인 지속성이 켜져 있어 쓰기 promise 는 서버가
 * 받을 때까지 resolve 하지 않는데, 그 사이에 탭을 닫거나 새로고침하면 항목은 큐에 남아
 * 나중에 올라가고 `activeEntryId` 는 비어 있다. 다음 접속이 그것을 "아직 안 만들었다"로
 * 읽고 같은 회차를 한 번 더 만든다.
 *
 * 배치는 로컬 캐시에 원자적으로 반영되므로 두 값이 어긋난 상태 자체가 생기지 않는다.
 */
export function commitRecovery(
  db: Firestore, uid: string,
  change: { rule: RecoveryRule; entry?: Entry | null; removeEntryId?: string | null },
): Promise<void> {
  const batch = writeBatch(db);
  if (change.entry) batch.set(docIn(db, uid, COL.entries, change.entry.id), entryToDoc(change.entry));
  if (change.removeEntryId) batch.delete(docIn(db, uid, COL.entries, change.removeEntryId));
  batch.set(userDoc(db, uid), { recovery: recoveryRuleToDoc(change.rule) }, { merge: true });
  return batch.commit();
}

// ---------- 쓰기 ----------

export function saveEntry(db: Firestore, uid: string, e: Entry): Promise<void> {
  return setDoc(docIn(db, uid, COL.entries, e.id), entryToDoc(e));
}

export function deleteEntry(db: Firestore, uid: string, id: string): Promise<void> {
  return deleteDoc(docIn(db, uid, COL.entries, id));
}

export function saveAccount(db: Firestore, uid: string, a: Account): Promise<void> {
  return setDoc(docIn(db, uid, COL.accounts, a.id), accountToDoc(a));
}

export function deleteAccount(db: Firestore, uid: string, id: string): Promise<void> {
  return deleteDoc(docIn(db, uid, COL.accounts, id));
}

export function saveDebt(db: Firestore, uid: string, d: Debt): Promise<void> {
  return setDoc(docIn(db, uid, COL.debts, d.id), debtToDoc(d));
}

export function deleteDebt(db: Firestore, uid: string, id: string): Promise<void> {
  return deleteDoc(docIn(db, uid, COL.debts, id));
}

export function saveBudget(db: Firestore, uid: string, b: Budget): Promise<void> {
  return setDoc(docIn(db, uid, COL.budgets, b.id), budgetToDoc(b));
}

export function deleteBudget(db: Firestore, uid: string, id: string): Promise<void> {
  return deleteDoc(docIn(db, uid, COL.budgets, id));
}

export function saveReserve(db: Firestore, uid: string, r: Reserve): Promise<void> {
  return setDoc(docIn(db, uid, COL.reserves, r.id), reserveToDoc(r));
}

export function deleteReserve(db: Firestore, uid: string, id: string): Promise<void> {
  return deleteDoc(docIn(db, uid, COL.reserves, id));
}

export function savePin(db: Firestore, uid: string, p: Pin): Promise<void> {
  return setDoc(docIn(db, uid, COL.pins, p.id), pinToDoc(p));
}

export function deletePin(db: Firestore, uid: string, id: string): Promise<void> {
  return deleteDoc(docIn(db, uid, COL.pins, id));
}

/**
 * 정렬 순서를 한 번에 저장한다. (F-02)
 * 이전 코드는 드래그 결과를 로컬 상태에만 반영하고 Firestore 에 쓰지 않아,
 * 다음 스냅샷이 오면 원위치했다.
 */
export async function saveTaskOrder(
  db: Firestore, uid: string, ordered: readonly { id: string; order: number }[],
): Promise<void> {
  const CHUNK = 400; // Firestore 배치 상한은 500. 여유를 둔다.
  for (let i = 0; i < ordered.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const { id, order } of ordered.slice(i, i + CHUNK)) {
      batch.update(docIn(db, uid, COL.entries, id), { 'task.order': order });
    }
    await batch.commit();
  }
}

/** 전체를 한 번에 읽는다. 백업·이관처럼 드물게 도는 작업에서만 쓴다. */
export async function fetchAll(db: Firestore, uid: string): Promise<{
  entries: Entry[]; accounts: Account[]; debts: Debt[]; pins: Pin[];
  budgets: Budget[]; reserves: Reserve[];
  categories: Category[]; categoryBudgets: CategoryBudget[]; ledgerNotes: LedgerNote[];
  annualBudgets: AnnualBudget[]; cards: Card[];
}> {
  if (uid === DEVICE_UID) return readDevice();
  const [e, a, d, p, b, r, c, cb, ln, ab, cd] = await Promise.all([
    getDocs(col(db, uid, COL.entries)),
    getDocs(col(db, uid, COL.accounts)),
    getDocs(col(db, uid, COL.debts)),
    getDocs(col(db, uid, COL.pins)),
    getDocs(col(db, uid, COL.budgets)),
    getDocs(col(db, uid, COL.reserves)),
    getDocs(col(db, uid, COL.categories)),
    getDocs(col(db, uid, COL.categoryBudgets)),
    getDocs(col(db, uid, COL.ledgerNotes)),
    getDocs(col(db, uid, COL.annualBudgets)),
    getDocs(col(db, uid, COL.cards)),
  ]);
  return {
    entries: mapSnap(e, entryFromDoc),
    accounts: mapSnap(a, accountFromDoc),
    debts: mapSnap(d, debtFromDoc),
    pins: mapSnap(p, pinFromDoc),
    budgets: mapSnap(b, budgetFromDoc),
    reserves: mapSnap(r, reserveFromDoc),
    categories: mapSnap(c, categoryFromDoc),
    categoryBudgets: mapSnap(cb, categoryBudgetFromDoc),
    ledgerNotes: mapSnap(ln, ledgerNoteFromDoc),
    annualBudgets: mapSnap(ab, annualBudgetFromDoc),
    cards: mapSnap(cd, cardFromDoc),
  };
}

/** 가계부 설정을 읽는다. 백업에 싣는다. */
export async function fetchLedgerSettings(db: Firestore, uid: string): Promise<LedgerSettings> {
  if (uid === DEVICE_UID) return (await readDevice()).ledger;
  const snap = await getDoc(userDoc(db, uid));
  return ledgerSettingsFromDoc(snap.data()?.ledger);
}

/** 이웃 필드(recovery · migratedAt)를 지우지 않도록 merge 로 쓴다. */
export function saveLedgerSettings(db: Firestore, uid: string, settings: LedgerSettings): Promise<void> {
  if (uid === DEVICE_UID) return commitDevice({ kind: 'ledgerSettings', label: '가계부 설정', summary: '', payload: settings });
  return setDoc(userDoc(db, uid), { ledger: ledgerSettingsToDoc(settings) }, { merge: true });
}

export interface WriteManyResult {
  written: number;
  /** 저장하지 못한 문서. 어느 것이 왜 막혔는지 알려 준다. */
  failed: { collection: string; id: string; reason: string }[];
  /** 한 건도 저장되지 않음. 규칙이 컬렉션을 통째로 막고 있을 때의 모습이다. */
  allFailed: boolean;
}

/**
 * 다건 저장. 가져오기·이관에서 쓴다.
 *
 * 배치 쓰기는 원자적이라 한 문서가 규칙에 걸리면 배치 전체가 실패하고,
 * 어느 문서 때문인지 알려주지 않는다. 그래서 배치가 깨지면 문서 단위로 다시 시도해
 * 실패한 것만 추려 낸다. 실패 경로에서만 도는 비용이라 평소에는 배치 그대로다.
 */
export async function writeMany(
  db: Firestore, uid: string,
  payload: {
    entries?: Entry[]; accounts?: Account[]; debts?: Debt[]; pins?: Pin[];
    budgets?: Budget[]; reserves?: Reserve[];
    categories?: Category[]; categoryBudgets?: CategoryBudget[]; ledgerNotes?: LedgerNote[];
    annualBudgets?: AnnualBudget[]; cards?: Card[];
  },
  onProgress?: (done: number, total: number) => void,
): Promise<WriteManyResult> {
  if (uid === DEVICE_UID) return mergeDevice(payload);
  type Job = { name: string; id: string; data: Record<string, unknown> };
  const jobs: Job[] = [
    ...(payload.entries ?? []).map((x) => ({ name: COL.entries, id: x.id, data: entryToDoc(x) })),
    ...(payload.accounts ?? []).map((x) => ({ name: COL.accounts, id: x.id, data: accountToDoc(x) })),
    ...(payload.debts ?? []).map((x) => ({ name: COL.debts, id: x.id, data: debtToDoc(x) })),
    ...(payload.pins ?? []).map((x) => ({ name: COL.pins, id: x.id, data: pinToDoc(x) })),
    ...(payload.budgets ?? []).map((x) => ({ name: COL.budgets, id: x.id, data: budgetToDoc(x) })),
    ...(payload.reserves ?? []).map((x) => ({ name: COL.reserves, id: x.id, data: reserveToDoc(x) })),
    ...(payload.categories ?? []).map((x) => ({ name: COL.categories, id: x.id, data: categoryToDoc(x) })),
    ...(payload.categoryBudgets ?? []).map((x) => ({
      name: COL.categoryBudgets, id: x.id, data: categoryBudgetToDoc(x),
    })),
    ...(payload.ledgerNotes ?? []).map((x) => ({ name: COL.ledgerNotes, id: x.id, data: ledgerNoteToDoc(x) })),
    ...(payload.annualBudgets ?? []).map((x) => ({ name: COL.annualBudgets, id: x.id, data: annualBudgetToDoc(x) })),
    ...(payload.cards ?? []).map((x) => ({ name: COL.cards, id: x.id, data: cardToDoc(x) })),
  ];

  const result: WriteManyResult = { written: 0, failed: [], allFailed: false };
  const CHUNK = 400;

  for (let i = 0; i < jobs.length; i += CHUNK) {
    const slice = jobs.slice(i, i + CHUNK);
    try {
      const batch = writeBatch(db);
      for (const j of slice) batch.set(docIn(db, uid, j.name, j.id), j.data);
      await batch.commit();
      result.written += slice.length;
    } catch {
      // 배치는 원자적이라 한 문서가 막히면 전체가 같은 오류로 실패하고,
      // 어느 문서 때문인지 알려주지 않는다. 문서 단위로 다시 시도해 범인을 추린다.
      for (const j of slice) {
        try {
          await setDoc(docIn(db, uid, j.name, j.id), j.data);
          result.written += 1;
        } catch (err) {
          result.failed.push({ collection: j.name, id: j.id, reason: describeFirestoreError(err) });
        }
      }
    }
    onProgress?.(Math.min(i + CHUNK, jobs.length), jobs.length);
  }

  result.allFailed = jobs.length > 0 && result.written === 0;
  return result;
}

/**
 * 다건 생성 — **이미 있으면 건드리지 않는다.**
 *
 * 병합의 약속은 "같은 id 는 지금 것을 남긴다" 인데, `fetchAll()` 로 없는 id 를 고른 뒤
 * `setDoc` 으로 쓰면 그 사이에 다른 탭이 같은 id 를 만들었을 때 덮어쓴다. 읽는 시점과
 * 쓰는 시점이 다르기 때문이다.
 *
 * 트랜잭션 안에서 존재 확인과 쓰기를 함께 해야 그 창이 닫힌다. 커밋 직전에 문서가
 * 생기면 트랜잭션이 다시 돌고, 두 번째 읽기에서 발견해 충돌로 남긴다.
 *
 * 오프라인에서는 트랜잭션이 돌지 않는다 (`unavailable`). 그때는 한 건도 쓰지 않고
 * 실패로 돌아온다 — 조용히 나중에 반영되는 것보다 낫다.
 */
export interface CreateManyResult {
  created: number;
  /** 이미 있어서 건드리지 않은 문서. **기존 내용이 그대로 남는다.** */
  conflicts: { collection: string; id: string }[];
  failed: { collection: string; id: string; reason: string }[];
  allFailed: boolean;
}

export async function createManyIfAbsent(
  db: Firestore, uid: string,
  payload: {
    entries?: Entry[]; accounts?: Account[]; debts?: Debt[]; pins?: Pin[];
    budgets?: Budget[]; reserves?: Reserve[];
    categories?: Category[]; categoryBudgets?: CategoryBudget[]; ledgerNotes?: LedgerNote[];
    annualBudgets?: AnnualBudget[]; cards?: Card[];
  },
  onProgress?: (done: number, total: number) => void,
): Promise<CreateManyResult> {
  if (uid === DEVICE_UID) return mergeDevice(payload, true);
  type Job = { name: string; id: string; data: Record<string, unknown> };
  const jobs: Job[] = [
    ...(payload.entries ?? []).map((x) => ({ name: COL.entries, id: x.id, data: entryToDoc(x) })),
    ...(payload.accounts ?? []).map((x) => ({ name: COL.accounts, id: x.id, data: accountToDoc(x) })),
    ...(payload.debts ?? []).map((x) => ({ name: COL.debts, id: x.id, data: debtToDoc(x) })),
    ...(payload.pins ?? []).map((x) => ({ name: COL.pins, id: x.id, data: pinToDoc(x) })),
    ...(payload.budgets ?? []).map((x) => ({ name: COL.budgets, id: x.id, data: budgetToDoc(x) })),
    ...(payload.reserves ?? []).map((x) => ({ name: COL.reserves, id: x.id, data: reserveToDoc(x) })),
    ...(payload.categories ?? []).map((x) => ({ name: COL.categories, id: x.id, data: categoryToDoc(x) })),
    ...(payload.categoryBudgets ?? []).map((x) => ({
      name: COL.categoryBudgets, id: x.id, data: categoryBudgetToDoc(x),
    })),
    ...(payload.ledgerNotes ?? []).map((x) => ({ name: COL.ledgerNotes, id: x.id, data: ledgerNoteToDoc(x) })),
    ...(payload.annualBudgets ?? []).map((x) => ({ name: COL.annualBudgets, id: x.id, data: annualBudgetToDoc(x) })),
    ...(payload.cards ?? []).map((x) => ({ name: COL.cards, id: x.id, data: cardToDoc(x) })),
  ];

  const result: CreateManyResult = { created: 0, conflicts: [], failed: [], allFailed: false };
  // 트랜잭션은 읽기를 모두 마친 뒤에 써야 한다. 한 번에 너무 많이 읽지 않도록 끊는다.
  const CHUNK = 100;

  for (let i = 0; i < jobs.length; i += CHUNK) {
    const slice = jobs.slice(i, i + CHUNK);
    try {
      const absent = await runTransaction(db, async (tx) => {
        const refs = slice.map((j) => docIn(db, uid, j.name, j.id));
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        const made: Job[] = [];
        snaps.forEach((snap, at) => {
          if (snap.exists()) return;
          const job = slice[at]!;
          tx.set(refs[at]!, job.data);
          made.push(job);
        });
        return made;
      });
      result.created += absent.length;
      const madeIt = new Set(absent.map((j) => `${j.name}/${j.id}`));
      for (const j of slice) {
        if (!madeIt.has(`${j.name}/${j.id}`)) result.conflicts.push({ collection: j.name, id: j.id });
      }
    } catch {
      // 트랜잭션은 통째로 실패한다. 어느 문서 때문인지 알 수 없으므로 하나씩 다시 본다.
      for (const j of slice) {
        try {
          const made = await runTransaction(db, async (tx) => {
            const ref = docIn(db, uid, j.name, j.id);
            const snap = await tx.get(ref);
            if (snap.exists()) return false;
            tx.set(ref, j.data);
            return true;
          });
          if (made) result.created += 1;
          else result.conflicts.push({ collection: j.name, id: j.id });
        } catch (inner) {
          result.failed.push({ collection: j.name, id: j.id, reason: describeFirestoreError(inner) });
        }
      }
    }
    onProgress?.(Math.min(i + CHUNK, jobs.length), jobs.length);
  }

  result.allFailed = jobs.length > 0 && result.created === 0 && result.conflicts.length === 0;
  return result;
}

function monthsAround(anchorISO: string, back: number, forward: number): YearMonth[] {
  const [y, m] = ymOf(anchorISO).split('-').map(Number) as [number, number];
  const out: YearMonth[] = [];
  for (let offset = -back; offset <= forward; offset++) {
    const d = new Date(y, m - 1 + offset, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** 보고 있는 달을 중심으로 구독할 달 목록. 화면에 그릴 항목용이다. */
export function monthWindow(cursorISO: string): YearMonth[] {
  return monthsAround(cursorISO, 1, 1);
}

/**
 * 금액 계산이 덮어야 하는 달 — 뒤로 1달(또는 잔고 기준일의 달까지), 앞으로 14달.
 *
 * **커서가 아니라 오늘을 기준으로 잡는다.** 한도·다음 입금일·정산은 오늘의 함수이지
 * 보고 있는 달의 함수가 아니다. 커서 창으로 계산하면 달력을 넘길 때마다 머리 숫자가
 * 바뀌고, 그 값이 그럴듯해서 틀린 줄 모른다.
 *
 * 앞으로 14달인 이유는 `horizonOf` 가 다음 입금을 400일까지 찾기 때문이다. 창이 그보다
 * 좁으면 실제로 있는 입금을 못 보고 "입금 없음 → 30일 뒤" 로 조용히 물러난다.
 * 어느 날에서 재도 이 창의 끝이 400일보다 뒤에 오도록 잡았다 (달 말일 기준 426일).
 *
 * ── 잔고 기준일이 더 오래됐을 때 ──────────────────────────────
 *
 * 한도는 잔고 기준일 **다음 날부터** 센다 (`tide.unsettledAfter`). 기준일이 석 달 전이면
 * 그 석 달 사이의 한 번짜리 예정과 실제 거래가 모두 필요하다. 예전 창(뒤로 1달)은 그것을
 * 못 받아, 정산은 확정 차액을 감췄지만(`coverage`) 머리 숫자는 빠진 지출만큼 크게 떴다.
 * 이제 창의 시작을 **가장 이른 계좌 기준일의 달**까지 당긴다. 그보다 앞은 받지 않는다 —
 * 기준일 앞의 예정은 이미 잔고에 들어 있고, 실제 거래도 그 날짜로 잔고 안이다
 * (`ledger.balanceInclusion`). 모든 과거를 상시 구독하지 않는 이유가 이것이다.
 *
 * 창이 30달을 넘으면 조회를 나눈다 (`subscribeEntriesForMonths`).
 */
export const TIDE_WINDOW_BACK_MONTHS = 1;
export const TIDE_WINDOW_FORWARD_MONTHS = 14;
/**
 * 기준일을 따라 거슬러 가는 상한 — 10년. 조회는 30달씩 나뉘므로 많아야 다섯 번이다.
 *
 * 이보다 오래된 기준일은 창을 늘리지 않고 **계산을 멈춘다** (`tideWindowReaches`).
 * 끝없이 늘리면 잘못 적힌 연도 하나가 수백 번의 조회가 되고, 잘라서 계산하면 빠진
 * 입출금만큼 틀린 한도가 확정값처럼 뜬다.
 */
export const TIDE_WINDOW_MAX_BACK_MONTHS = 120;

function monthsBetween(fromISO: string, toISO: string): number {
  const [fy, fm] = ymOf(fromISO).split('-').map(Number) as [number, number];
  const [ty, tm] = ymOf(toISO).split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

export function tideWindow(todayISO: string, earliestAsOf?: string | null): YearMonth[] {
  const asOf = earliestAsOf ? normalizeDate(earliestAsOf) : '';
  const back = asOf
    ? Math.min(TIDE_WINDOW_MAX_BACK_MONTHS, Math.max(TIDE_WINDOW_BACK_MONTHS, monthsBetween(asOf, todayISO)))
    : TIDE_WINDOW_BACK_MONTHS;
  return monthsAround(todayISO, back, TIDE_WINDOW_FORWARD_MONTHS);
}

/** 계산 창이 잔고 기준일의 달까지 닿는가. 닿지 않으면 한도를 낼 자료가 모자라다. */
export function tideWindowReaches(months: readonly YearMonth[], earliestAsOf: string | null): boolean {
  const asOf = earliestAsOf ? normalizeDate(earliestAsOf) : '';
  const first = months[0];
  return !asOf || !first || ymOf(asOf) >= first;
}

/** 계좌들 가운데 가장 이른 잔고 기준일. 계산 창의 시작을 정한다. */
export function earliestAsOfOf(accounts: readonly Pick<Account, 'asOf'>[]): string | null {
  let out: string | null = null;
  for (const a of accounts) {
    const d = normalizeDate(a.asOf);
    if (d && (out === null || d < out)) out = d;
  }
  return out;
}

/**
 * 이관을 이미 끝냈는지 기록한다.
 *
 * 이관해도 원본 items 는 남기므로, 표식이 없으면 설정에 안내가 계속 뜬다.
 * 사용자가 한 번 더 누르면 대출이 두 건으로 늘어나는 식의 사고가 난다.
 */
export async function readMigrationMark(db: Firestore, uid: string): Promise<string | null> {
  if (uid === DEVICE_UID) return null;
  try {
    const snap = await getDoc(userDoc(db, uid));
    const value = snap.data()?.migratedAt;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function markMigrated(db: Firestore, uid: string, at = new Date().toISOString()): Promise<void> {
  if (uid === DEVICE_UID) return Promise.resolve();
  return setDoc(userDoc(db, uid), { migratedAt: at }, { merge: true });
}
