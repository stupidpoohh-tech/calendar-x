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
  deleteDoc, getDoc, getDocs, onSnapshot, query, setDoc, where, writeBatch,
  type Firestore, type QuerySnapshot,
} from 'firebase/firestore';
import { ymOf } from '../domain/date';
import { describeFirestoreError } from './errors';
import type { Account, Debt, Entry, Pin, YearMonth } from '../domain/types';
import {
  accountFromDoc, accountToDoc, debtFromDoc, debtToDoc,
  entryFromDoc, entryToDoc, pinFromDoc, pinToDoc,
} from './converters';
import { COL, col, docIn, userDoc } from './paths';

export type Unsubscribe = () => void;

/** onSnapshot 은 에러를 던지지 않고 콜백으로 준다. 삼켜지면 원인을 못 찾는다. */
export type ErrorSink = (scope: string, err: unknown) => void;

function mapSnap<T>(snap: QuerySnapshot, make: (id: string, raw: Record<string, unknown>) => T): T[] {
  const out: T[] = [];
  snap.forEach((d) => out.push(make(d.id, d.data() as Record<string, unknown>)));
  return out;
}

/**
 * 보고 있는 달과 앞뒤 한 달을 함께 구독한다.
 * 월을 넘길 때마다 새로 받아오면 화면이 비었다가 채워지므로, 이웃 달을 미리 들고 있는다.
 * array-contains-any 는 값 30개까지 허용하므로 3개는 여유가 있다.
 */
export function subscribeEntriesForMonths(
  db: Firestore, uid: string, months: YearMonth[],
  cb: (entries: Entry[]) => void, onError: ErrorSink,
): Unsubscribe {
  if (months.length === 0) { cb([]); return () => {}; }
  const q = query(col(db, uid, COL.entries), where('ymSpan', 'array-contains-any', months.slice(0, 30)));
  return onSnapshot(
    q,
    (snap) => cb(mapSnap(snap, entryFromDoc)),
    (err) => onError('entries', err),
  );
}

/**
 * 반복 항목은 첫 발생 달의 ymSpan 만 갖고 있어 월 조회로 잡히지 않는다.
 * 개수가 적으므로 전량을 따로 구독하고 클라이언트에서 펼친다.
 */
export function subscribeRecurringEntries(
  db: Firestore, uid: string,
  cb: (entries: Entry[]) => void, onError: ErrorSink,
): Unsubscribe {
  const q = query(col(db, uid, COL.entries), where('isRecurring', '==', true));
  return onSnapshot(
    q,
    (snap) => cb(mapSnap(snap, entryFromDoc)),
    (err) => onError('recurring', err),
  );
}

export function subscribeAccounts(
  db: Firestore, uid: string, cb: (v: Account[]) => void, onError: ErrorSink,
): Unsubscribe {
  return onSnapshot(
    col(db, uid, COL.accounts),
    (snap) => cb(mapSnap(snap, accountFromDoc).sort((a, b) => a.order - b.order)),
    (err) => onError('accounts', err),
  );
}

export function subscribeDebts(
  db: Firestore, uid: string, cb: (v: Debt[]) => void, onError: ErrorSink,
): Unsubscribe {
  return onSnapshot(
    col(db, uid, COL.debts),
    (snap) => cb(mapSnap(snap, debtFromDoc).sort((a, b) => a.order - b.order)),
    (err) => onError('debts', err),
  );
}

export function subscribePins(
  db: Firestore, uid: string, cb: (v: Pin[]) => void, onError: ErrorSink,
): Unsubscribe {
  return onSnapshot(
    col(db, uid, COL.pins),
    (snap) => cb(mapSnap(snap, pinFromDoc).sort((a, b) => a.order - b.order)),
    (err) => onError('pins', err),
  );
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
}> {
  const [e, a, d, p] = await Promise.all([
    getDocs(col(db, uid, COL.entries)),
    getDocs(col(db, uid, COL.accounts)),
    getDocs(col(db, uid, COL.debts)),
    getDocs(col(db, uid, COL.pins)),
  ]);
  return {
    entries: mapSnap(e, entryFromDoc),
    accounts: mapSnap(a, accountFromDoc),
    debts: mapSnap(d, debtFromDoc),
    pins: mapSnap(p, pinFromDoc),
  };
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
  payload: { entries?: Entry[]; accounts?: Account[]; debts?: Debt[]; pins?: Pin[] },
  onProgress?: (done: number, total: number) => void,
): Promise<WriteManyResult> {
  type Job = { name: string; id: string; data: Record<string, unknown> };
  const jobs: Job[] = [
    ...(payload.entries ?? []).map((x) => ({ name: COL.entries, id: x.id, data: entryToDoc(x) })),
    ...(payload.accounts ?? []).map((x) => ({ name: COL.accounts, id: x.id, data: accountToDoc(x) })),
    ...(payload.debts ?? []).map((x) => ({ name: COL.debts, id: x.id, data: debtToDoc(x) })),
    ...(payload.pins ?? []).map((x) => ({ name: COL.pins, id: x.id, data: pinToDoc(x) })),
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

export async function deleteAllEntries(db: Firestore, uid: string): Promise<number> {
  const snap = await getDocs(col(db, uid, COL.entries));
  const ids = snap.docs.map((d) => d.id);
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + CHUNK)) batch.delete(docIn(db, uid, COL.entries, id));
    await batch.commit();
  }
  return ids.length;
}

/** 보고 있는 달을 중심으로 구독할 달 목록. */
export function monthWindow(cursorISO: string): YearMonth[] {
  const [y, m] = ymOf(cursorISO).split('-').map(Number) as [number, number];
  const at = (offset: number): YearMonth => {
    const d = new Date(y, m - 1 + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  return [at(-1), at(0), at(1)];
}

/**
 * 이관을 이미 끝냈는지 기록한다.
 *
 * 이관해도 원본 items 는 남기므로, 표식이 없으면 설정에 안내가 계속 뜬다.
 * 사용자가 한 번 더 누르면 대출이 두 건으로 늘어나는 식의 사고가 난다.
 */
export async function readMigrationMark(db: Firestore, uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(userDoc(db, uid));
    const value = snap.data()?.migratedAt;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function markMigrated(db: Firestore, uid: string, at = new Date().toISOString()): Promise<void> {
  return setDoc(userDoc(db, uid), { migratedAt: at }, { merge: true });
}
