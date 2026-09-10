/**
 * 백업 복원 — 검증과 실행 순서.
 *
 * ## 전체 교체는 지금 꺼져 있다
 *
 * 앞선 수정은 "먼저 쓰고 나중에 지운다" 순서로 바꾸면 안전하다고 봤다. **틀렸다.**
 * 백업은 기존 id 위에 그대로 쓴다(upsert). 문서 A 를 파일 내용으로 덮어쓴 뒤 문서 B
 * 쓰기가 실패하면, 삭제를 한 번도 부르지 않았어도 **A 의 원래 내용은 이미 사라졌다.**
 * 따라서 "파괴 없음" · "최악이 합집합" · "중간에 끊겨도 잃는 것이 없다" 는 성립하지 않는다.
 *
 * 여러 배치는 원자적이지 않고, 클라이언트 SDK 에는 컬렉션을 가로지르는 트랜잭션이
 * 없다. 메모리에 들고 있던 원본으로 되돌리는 것도 안전장치가 못 된다 — 탭이 닫히면
 * 그 원본도 사라진다. 그래서 지금 구조에서는 안전한 교체를 보장할 수 없다.
 *
 * **불완전한 파괴적 기능을 남기지 않는다.** 교체는 `REPLACE_DISABLED` 로 막아 두고,
 * 부르더라도 쓰기도 삭제도 일어나지 않는다. 안전한 교체(별도 스냅샷 컬렉션에 원본을
 * 먼저 굳히고, 그것이 확인된 뒤에만 교체하는 방식)는 후속 작업으로 남긴다.
 *
 * ## 병합은 유지한다
 *
 * 병합은 지우지 않고 **없는 것만 만든다.** 다만 `fetchAll` 로 고른 뒤 `setDoc` 으로 쓰면
 * 그 사이 다른 탭이 같은 id 를 만들었을 때 덮어쓴다. 그래서 실제 쓰기도 트랜잭션 안에서
 * 존재를 확인한다 (`createManyIfAbsent`). 이미 있는 문서는 충돌로 남기고 건드리지 않는다.
 */
import { isValidDate, normalizeDate } from '../domain/date';
import type { Account, BackupCollection, Debt, Entry, Pin } from '../domain/types';
import type { BackupData } from './backup';
import type { CreateManyResult } from './repo';

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
 * 돌려 봐야 "무엇이 보존되는가" 를 시험할 수 있다.
 */
export interface RestoreIO {
  fetchAll: () => Promise<Omit<BackupData, 'recovery'>>;
  /** 없는 것만 만든다. 이미 있으면 충돌로 남기고 건드리지 않는다. */
  createIfAbsent: (payload: Partial<BackupData>) => Promise<CreateManyResult>;
}

export const NO_CREATES: CreateManyResult = { created: 0, conflicts: [], failed: [], allFailed: false };

/**
 * 전체 교체가 꺼져 있는 이유. 화면에도 이 문장을 그대로 보여 준다.
 */
export const REPLACE_DISABLED_REASON =
  '전체 교체는 지금 꺼져 있습니다. 복원 도중 끊기면 파일로 덮어쓴 기존 항목의 원래 내용을 '
  + '되돌릴 방법이 없기 때문입니다. 안전한 교체 방식을 갖출 때까지 막아 둡니다. '
  + '그때까지는 “기존 데이터에 더하기”를 쓰거나, 지울 항목을 직접 지운 뒤 더해 주세요.';

/**
 * 파일의 몇 건이 어떻게 됐는지.
 *
 * 건수가 파일 총계와 맞아떨어져야 사용자가 읽고 다음 행동을 정할 수 있다.
 *   파일 총계 = created + skippedExisting + conflicts + failed
 */
export interface MergeCounts {
  created: CreateManyResult;
  /**
   * 조회 시점에 이미 있어서 후보에서 빠진 것.
   * 쓰기를 시도하지도 않았으므로 기존 내용이 그대로다.
   */
  skippedExisting: number;
}

export type RestoreOutcome =
  /** 파일이 규칙에 맞지 않는다. 저장소를 건드리지 않았다. */
  | { kind: 'invalid'; problems: BackupProblem[] }
  /** 전체 교체는 막혀 있다. 쓰기도 삭제도 일어나지 않았다. */
  | { kind: 'replace-disabled'; reason: string }
  /** 쓰려던 것이 한 건도 들어가지 않았다. 기존 문서는 그대로다. */
  | ({ kind: 'all-failed' } & MergeCounts)
  /** 일부만 들어갔다. 못 들어간 것과 이미 있던 것을 구분해 알린다. */
  | ({ kind: 'partial' } & MergeCounts)
  | ({ kind: 'ok' } & MergeCounts);

/**
 * 전체 교체 — **꺼져 있다.**
 *
 * 부르더라도 저장소를 한 번도 건드리지 않는다. `RestoreIO` 를 아예 쓰지 않으므로
 * 실수로 쓰기·삭제가 새어 나갈 자리가 없다.
 */
export function safeReplace(): RestoreOutcome {
  return { kind: 'replace-disabled', reason: REPLACE_DISABLED_REASON };
}

/**
 * 병합 — 파일에만 있는 것을 더한다. 지우는 단계가 없다.
 *
 * `fetchAll` 로 후보를 좁히는 것은 읽기·쓰기를 줄이기 위한 것일 뿐이고, "이미 있으면
 * 건드리지 않는다" 는 약속은 실제 쓰기 시점(`createIfAbsent`)에서 지켜진다.
 */
export type MergeOutcome = Exclude<RestoreOutcome, { kind: 'replace-disabled' }>;

export async function safeMerge(incoming: BackupData, io: RestoreIO): Promise<MergeOutcome> {
  const problems = validateBackup(incoming);
  if (problems.length > 0) return { kind: 'invalid', problems };

  const current = await io.fetchAll();
  const candidates = planMerge({ ...current, recovery: null }, incoming);
  const skippedExisting = countDocs(incoming) - countDocs(candidates);

  if (countDocs(candidates) === 0) return { kind: 'ok', created: NO_CREATES, skippedExisting };

  const created = await io.createIfAbsent(candidates);
  if (created.allFailed) return { kind: 'all-failed', created, skippedExisting };
  if (created.failed.length > 0 || created.conflicts.length > 0) {
    return { kind: 'partial', created, skippedExisting };
  }
  return { kind: 'ok', created, skippedExisting };
}
