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
import type { Account, Debt, Entry, Pin, RecoveryRule, YearMonth } from '../domain/types';
import {
  accountFromDoc, accountToDoc, debtFromDoc, debtToDoc,
  entryFromDoc, entryToDoc, pinFromDoc, pinToDoc,
  recoveryRuleFromDoc, recoveryRuleToDoc,
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
  return onSnapshot(
    userDoc(db, uid),
    (snap) => cb(recoveryRuleFromDoc(snap.data()?.recovery)),
    (err) => onError('recovery', err),
  );
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

/**
 * 다건 삭제. 어느 컬렉션이든 문서 단위로 지운다.
 *
 * 결과 모양을 `writeMany` 와 같게 맞춘 이유는, 부르는 쪽이 "몇 건 지웠고 몇 건이
 * 왜 남았는지" 를 쓰기와 똑같이 확인해야 하기 때문이다. 배치가 깨지면 문서 단위로
 * 다시 시도해 범인을 추린다.
 *
 * 예전에는 `deleteAllEntries()` 하나뿐이었고 전체 교체가 그것을 **먼저** 불렀다.
 * 그래서 저장이 실패해도 이미 지운 뒤였다. 지금 이 함수는 저장이 모두 성공한 뒤에만
 * 불린다 (`restore.ts` 의 순서).
 */
export async function deleteMany(
  db: Firestore, uid: string,
  targets: readonly { collection: string; id: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<WriteManyResult> {
  const result: WriteManyResult = { written: 0, failed: [], allFailed: false };
  const CHUNK = 400;

  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK);
    try {
      const batch = writeBatch(db);
      for (const t of slice) batch.delete(docIn(db, uid, t.collection, t.id));
      await batch.commit();
      result.written += slice.length;
    } catch {
      for (const t of slice) {
        try {
          await deleteDoc(docIn(db, uid, t.collection, t.id));
          result.written += 1;
        } catch (err) {
          result.failed.push({ collection: t.collection, id: t.id, reason: describeFirestoreError(err) });
        }
      }
    }
    onProgress?.(Math.min(i + CHUNK, targets.length), targets.length);
  }

  result.allFailed = targets.length > 0 && result.written === 0;
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
 * 금액 계산이 덮어야 하는 달 — 뒤로 1달, 앞으로 14달.
 *
 * **커서가 아니라 오늘을 기준으로 잡는다.** 한도·다음 입금일·정산은 오늘의 함수이지
 * 보고 있는 달의 함수가 아니다. 커서 창으로 계산하면 달력을 넘길 때마다 머리 숫자가
 * 바뀌고, 그 값이 그럴듯해서 틀린 줄 모른다.
 *
 * 앞으로 14달인 이유는 `horizonOf` 가 다음 입금을 400일까지 찾기 때문이다. 창이 그보다
 * 좁으면 실제로 있는 입금을 못 보고 "입금 없음 → 30일 뒤" 로 조용히 물러난다.
 * 어느 날에서 재도 이 창의 끝이 400일보다 뒤에 오도록 잡았다 (달 말일 기준 426일).
 *
 * `array-contains-any` 상한이 30이므로 16달은 여유가 있다.
 */
export const TIDE_WINDOW_BACK_MONTHS = 1;
export const TIDE_WINDOW_FORWARD_MONTHS = 14;

export function tideWindow(todayISO: string): YearMonth[] {
  return monthsAround(todayISO, TIDE_WINDOW_BACK_MONTHS, TIDE_WINDOW_FORWARD_MONTHS);
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
