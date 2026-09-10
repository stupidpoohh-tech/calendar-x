/**
 * 백업 복원 — 검증과 순서.
 *
 * ## 무엇이 잘못됐었나
 *
 * 전체 교체가 `deleteAllEntries()` 로 **먼저 지우고** 그다음 저장했다. 저장은
 * `writeMany()` 인데 이건 실패를 던지지 않고 `{ written, failed, allFailed }` 로
 * 돌려준다. 그 결과를 아무도 읽지 않아, 한 건도 저장되지 않아도 "가져왔습니다" 가 떴다.
 * 지운 뒤 저장에 실패하면 남는 것이 없었고, 되돌릴 방법도 없었다.
 * 게다가 "전체 교체" 라면서 잔고·대출·고정 메모는 지우지 않아 파일에 없는 데이터가 남았다.
 *
 * ## 지금의 순서
 *
 *   1. 파일 전체를 검증한다. 한 건이라도 문제가 있으면 **아무것도 건드리지 않는다**
 *   2. 백업의 모든 문서를 먼저 **쓴다** (upsert). 이 단계에는 파괴가 없다
 *   3. 쓰기 결과를 확인한다. 한 건이라도 실패하면 여기서 멈춘다 — 지우지 않는다
 *   4. 그러고 나서야 백업에 없는 기존 문서를 지운다 (네 컬렉션 모두)
 *
 * 중간에 끊겨도 "지웠는데 복원이 안 된" 구간이 없다. 2~3 사이에서 끊기면 기존 데이터와
 * 복원 데이터가 **둘 다** 남고(합집합), 같은 파일로 다시 가져오면 이어서 끝난다.
 * 메모리에 들고 있던 원본으로 되돌리는 식이 아니라 순서 자체가 안전하다.
 *
 * 여러 번 실행해도 결과가 같다 — 같은 id 를 다시 쓰고 같은 여분을 다시 지운다.
 */
import { isValidDate, normalizeDate } from '../domain/date';
import type { Account, BackupCollection, Debt, Entry, Pin } from '../domain/types';
import type { BackupData } from './backup';
import { COL } from './paths';
import type { WriteManyResult } from './repo';

/** 파일 한 건이 왜 들어갈 수 없는지. */
export interface BackupProblem {
  collection: BackupCollection;
  /** 몇 번째 항목인지. id 가 비어 있을 때도 어디인지 가리킬 수 있어야 한다. */
  at: number;
  id: string;
  reason: string;
}

/**
 * 저장 규칙(`firestore.rules`)이 실제로 거부하는 한계.
 * 여기서 미리 걸러야 "저장은 눌렀는데 일부만 들어간" 상태를 만들지 않는다.
 */
export const LIMITS = {
  title: 500,
  note: 20_000,
  tags: 50,
  ymSpan: 200,
  name: 100,
  pinText: 2_000,
  /** 규칙이 문자열 길이로 검사하는 값이라 여기서도 같은 상한을 본다. */
  checkedAt: 40,
  /** Firestore 문서 ID 상한(바이트). */
  idBytes: 1_500,
} as const;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/**
 * 문서 ID 로 쓸 수 있는 값인가.
 *
 * Firestore 는 '/' 와 '.' · '..' 와 `__x__` 를 거부한다. '@' 는 Firestore 가 받지만
 * 이 앱에서는 반복 전개분의 id 모양(`원본id@날짜`)이라 `baseIdOf()` 가 잘라 버린다 —
 * 그런 id 가 들어오면 그 항목을 편집·삭제할 때 엉뚱한 문서를 향한다.
 */
function idProblem(id: string): string | null {
  if (!id) return 'id 가 비어 있습니다.';
  if (id.includes('/')) return "id 에 '/' 가 들어 있습니다.";
  if (id === '.' || id === '..') return 'id 가 . 또는 .. 입니다.';
  if (/^__.*__$/.test(id)) return 'id 가 Firestore 예약어(__x__) 모양입니다.';
  if (id.includes('@')) return "id 에 '@' 가 들어 있습니다 — 반복 전개분과 구분되지 않습니다.";
  if (new TextEncoder().encode(id).length > LIMITS.idBytes) return 'id 가 너무 깁니다.';
  return null;
}

function dateProblem(label: string, v: string): string | null {
  if (!v) return `${label} 가 비어 있습니다.`;
  if (!isValidDate(v)) return `${label} 가 날짜(YYYY-MM-DD)가 아닙니다: ${v}`;
  return null;
}

function timeProblem(label: string, v: string | null): string | null {
  if (v === null) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return `${label} 가 시각(HH:mm)이 아닙니다: ${v}`;
  return null;
}

function checkEntry(e: Entry): string | null {
  if (e.kind !== 'task' && e.kind !== 'idea' && e.kind !== 'money') {
    return `종류를 알 수 없습니다: ${String(e.kind)}`;
  }
  if (e.title.length > LIMITS.title) return `제목이 ${LIMITS.title}자를 넘습니다.`;
  if (e.note.length > LIMITS.note) return `메모가 ${LIMITS.note}자를 넘습니다.`;
  if (e.tags.length > LIMITS.tags) return `태그가 ${LIMITS.tags}개를 넘습니다.`;
  if (e.ymSpan.length > LIMITS.ymSpan) return `걸친 달이 ${LIMITS.ymSpan}개를 넘습니다.`;

  const start = dateProblem('날짜', e.startDate);
  if (start) return start;
  if (e.endDate !== null) {
    const end = dateProblem('종료일', e.endDate);
    if (end) return end;
    if (normalizeDate(e.endDate) < normalizeDate(e.startDate)) return '종료일이 시작일보다 앞섭니다.';
  }
  const st = timeProblem('시작 시각', e.startTime);
  if (st) return st;
  const et = timeProblem('종료 시각', e.endTime);
  if (et) return et;

  if (e.recurrence) {
    const r = e.recurrence;
    if (r.freq !== 'daily' && r.freq !== 'weekly' && r.freq !== 'monthly') {
      return `반복 주기를 알 수 없습니다: ${String(r.freq)}`;
    }
    if (!isInt(r.interval) || r.interval < 1) return '반복 간격이 1 이상의 정수가 아닙니다.';
    if (r.until !== null) {
      const u = dateProblem('반복 종료일', r.until);
      if (u) return u;
    }
    if (r.count !== null && (!isInt(r.count) || r.count < 1)) {
      return '반복 횟수가 1 이상의 정수가 아닙니다.';
    }
  }

  if (e.kind === 'money') {
    if (!e.money) return '가계부 항목에 금액이 없습니다.';
    if (!isInt(e.money.amountMinor)) return '금액이 정수가 아닙니다 — 원 단위 정수여야 합니다.';
    if (e.money.amountMinor < 0) return '금액이 음수입니다 — 부호는 종류가 정합니다.';
    if (!e.money.currency) return '통화가 비어 있습니다.';
  }
  if (e.kind === 'task' && !e.task) return '할 일 항목에 상태가 없습니다.';
  return null;
}

function checkAccount(a: Account): string | null {
  if (!a.name) return '이름이 비어 있습니다.';
  if (a.name.length > LIMITS.name) return `이름이 ${LIMITS.name}자를 넘습니다.`;
  if (!isInt(a.balanceMinor)) return '잔고가 정수가 아닙니다.';
  if (!a.currency) return '통화가 비어 있습니다.';
  // 규칙이 길이로 거부한다. 여기서 안 보면 "저장은 눌렀는데 이 한 건만 안 들어간" 상태가 된다.
  if (a.checkedAt.length > LIMITS.checkedAt) return `확인 시각이 ${LIMITS.checkedAt}자를 넘습니다.`;
  return dateProblem('기준일', a.asOf);
}

function checkDebt(d: Debt): string | null {
  if (d.name.length > LIMITS.name) return `이름이 ${LIMITS.name}자를 넘습니다.`;
  if (!isInt(d.balanceMinor)) return '잔액이 정수가 아닙니다.';
  if (!isInt(d.monthlyMinor)) return '월 상환액이 정수가 아닙니다.';
  if (d.rate !== null && !Number.isFinite(d.rate)) return '이율이 숫자가 아닙니다.';
  return null;
}

function checkPin(p: Pin): string | null {
  if (p.lens !== 'task' && p.lens !== 'idea' && p.lens !== 'money') {
    return `렌즈를 알 수 없습니다: ${String(p.lens)}`;
  }
  if (p.text.length > LIMITS.pinText) return `내용이 ${LIMITS.pinText}자를 넘습니다.`;
  return null;
}

function scan<T extends { id: string }>(
  collection: BackupCollection, list: readonly T[],
  check: (v: T) => string | null, out: BackupProblem[],
): void {
  const seen = new Set<string>();
  list.forEach((item, at) => {
    const push = (reason: string) => out.push({ collection, at, id: item.id, reason });
    const bad = idProblem(item.id);
    if (bad) { push(bad); return; }
    if (seen.has(item.id)) { push(`id 가 파일 안에서 겹칩니다: ${item.id}`); return; }
    seen.add(item.id);
    const problem = check(item);
    if (problem) push(problem);
  });
}

/**
 * 파일 전체 검증.
 *
 * 한 건이라도 걸리면 부르는 쪽이 **아무것도 건드리지 않아야 한다.** 잘못된 값을 오늘
 * 날짜나 기본값으로 바꿔 넣지 않는다 — 그렇게 하면 사용자는 무엇이 달라졌는지 모른 채
 * 원본과 다른 데이터를 갖게 된다.
 *
 * (읽기 계층 `converters.ts` 가 방어적으로 채우는 것과 목적이 다르다. 그쪽은 이미
 * 저장된 문서를 화면에 띄우기 위한 것이고, 이쪽은 새로 들여올지 말지를 정하는 자리다.)
 */
export function validateBackup(data: BackupData): BackupProblem[] {
  const out: BackupProblem[] = [];
  scan('entries', data.entries, checkEntry, out);
  scan('accounts', data.accounts, checkAccount, out);
  scan('debts', data.debts, checkDebt, out);
  scan('pins', data.pins, checkPin, out);
  return out;
}

export function describeProblem(p: BackupProblem): string {
  const where = p.id ? `${p.collection}/${p.id}` : `${p.collection} ${p.at + 1}번째`;
  return `${where} — ${p.reason}`;
}

// ---------- 교체 계획 ----------

export interface DocRef {
  collection: string;
  id: string;
}

export interface ReplacePlan {
  /** 먼저 쓸 것. 백업 전체를 그대로 upsert 한다. */
  write: BackupData;
  /**
   * 쓰기가 **모두** 성공한 뒤에 지울 것 — 지금 있는데 백업에는 없는 문서.
   * "전체 교체" 이므로 네 컬렉션 모두를 대상으로 한다.
   */
  remove: DocRef[];
}

const COLLECTION_OF: Record<BackupCollection, string> = {
  entries: COL.entries,
  accounts: COL.accounts,
  debts: COL.debts,
  pins: COL.pins,
};

/**
 * 전체 교체 계획.
 *
 * 지우는 목록은 **지금 저장된 것**에서 뽑는다. 복원 도중 다른 탭에서 추가된 문서도
 * 여기에 잡히는데, 그것이 "전체 교체" 의 뜻이다 — 파일에 없는 것은 남기지 않는다.
 * 대신 지우기 직전에 다시 읽어서 목록을 만들어야 이미 사라진 문서를 지우려다
 * 실패로 세는 일이 없다.
 */
export function planReplace(current: BackupData, incoming: BackupData): ReplacePlan {
  const remove: DocRef[] = [];
  const keys: BackupCollection[] = ['entries', 'accounts', 'debts', 'pins'];
  for (const key of keys) {
    const keep = new Set(incoming[key].map((x) => x.id));
    for (const item of current[key]) {
      if (!keep.has(item.id)) remove.push({ collection: COLLECTION_OF[key], id: item.id });
    }
  }
  return { write: incoming, remove };
}

/**
 * 병합 계획 — 파일에만 있는 것을 더한다.
 * 같은 id 는 지금 것을 남긴다 (`mergeBackup` 과 같은 규칙).
 */
export function planMerge(current: BackupData, incoming: BackupData): BackupData {
  const only = <T extends { id: string }>(mine: readonly T[], theirs: readonly T[]): T[] => {
    const have = new Set(mine.map((x) => x.id));
    return theirs.filter((x) => !have.has(x.id));
  };
  return {
    entries: only(current.entries, incoming.entries),
    accounts: only(current.accounts, incoming.accounts),
    debts: only(current.debts, incoming.debts),
    pins: only(current.pins, incoming.pins),
    recovery: current.recovery ?? incoming.recovery,
  };
}

export function countDocs(d: BackupData): number {
  return d.entries.length + d.accounts.length + d.debts.length + d.pins.length;
}

// ---------- 실행 순서 ----------

/**
 * 저장 계층을 갈아끼울 수 있게 뽑아 둔 입구.
 *
 * 실패 주입을 위해서다. 실제 Firestore 로도, 일부러 실패하는 가짜로도 같은 순서를
 * 돌려 봐야 "쓰기가 실패하면 지우지 않는다" 를 시험할 수 있다.
 */
export interface RestoreIO {
  fetchAll: () => Promise<Omit<BackupData, 'recovery'>>;
  writeMany: (payload: Partial<BackupData>) => Promise<WriteManyResult>;
  deleteMany: (targets: readonly DocRef[]) => Promise<WriteManyResult>;
}

export const NO_WRITES: WriteManyResult = { written: 0, failed: [], allFailed: false };

export type RestoreOutcome =
  /** 파일이 규칙에 맞지 않는다. 저장소를 건드리지 않았다. */
  | { kind: 'invalid'; problems: BackupProblem[] }
  /** 쓰기에서 멈췄다. **아무것도 지우지 않았다.** */
  | { kind: 'write-failed'; written: WriteManyResult }
  /** 복원은 끝났고 지우기에서 일부가 남았다. */
  | { kind: 'remove-failed'; written: WriteManyResult; removed: WriteManyResult }
  | { kind: 'ok'; written: WriteManyResult; removed: WriteManyResult };

/**
 * 전체 교체.
 *
 *   1. 검증 — 걸리면 저장소를 건드리지 않는다
 *   2. 백업 전체를 쓴다 (파괴 없음)
 *   3. 한 건이라도 실패하면 **여기서 멈춘다**. 기존 데이터와 복원 데이터가 둘 다 남는다
 *   4. 지우기 직전에 다시 읽어 지금 상태에서 여분을 뽑고 지운다
 *
 * 중간에 끊겨도 잃는 것이 없다. 같은 파일로 다시 부르면 같은 자리로 수렴한다.
 */
export async function safeReplace(incoming: BackupData, io: RestoreIO): Promise<RestoreOutcome> {
  const problems = validateBackup(incoming);
  if (problems.length > 0) return { kind: 'invalid', problems };

  const written = await io.writeMany(incoming);
  if (written.failed.length > 0) return { kind: 'write-failed', written };

  // 지우기 직전에 다시 읽는다 — 복원 도중 다른 탭에서 바뀐 것까지 지금 상태로 판정하고,
  // 이미 사라진 문서를 지우려다 실패로 세지 않는다.
  const current = await io.fetchAll();
  const plan = planReplace({ ...current, recovery: incoming.recovery }, incoming);
  const removed = plan.remove.length > 0 ? await io.deleteMany(plan.remove) : NO_WRITES;

  if (removed.failed.length > 0) return { kind: 'remove-failed', written, removed };
  return { kind: 'ok', written, removed };
}

/**
 * 병합 — 파일에만 있는 것을 더한다. 지우는 단계가 아예 없다.
 * 쓰기 결과는 교체와 똑같이 확인한다.
 */
export async function safeMerge(
  incoming: BackupData, io: RestoreIO, keepRecovery: BackupData['recovery'],
): Promise<RestoreOutcome> {
  const problems = validateBackup(incoming);
  if (problems.length > 0) return { kind: 'invalid', problems };

  const current = await io.fetchAll();
  const toAdd = planMerge({ ...current, recovery: keepRecovery }, incoming);
  const written = await io.writeMany(toAdd);

  if (written.failed.length > 0) return { kind: 'write-failed', written };
  return { kind: 'ok', written, removed: NO_WRITES };
}
