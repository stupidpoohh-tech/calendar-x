/**
 * Firestore 문서 ↔ 도메인 타입.
 *
 * 원격 문서는 언제든 필드가 빠져 있거나 예전 형태일 수 있으므로 읽기 쪽은 전부 방어적으로
 * 채운다. 화면이 흰색으로 죽는 것보다 기본값으로 뜨는 편이 낫다.
 */
import { DEFAULT_COLOR, DEFAULT_CURRENCY, MONEY_TYPE_BY_ID, STATUS_BY_ID } from '../domain/constants';
import { normalizeDate, todayISO, ymOf, ymRange } from '../domain/date';
import { MONEY_FLOWS, moneyFlowOf, moneyStatusOf } from '../domain/ledger';
import { clampSettleDay } from '../domain/period';
import { MONTH_NOS } from '../domain/annualBudget';
import type {
  AnnualBudget, MonthNo, Account, Budget, Category, CategoryBudget, ColorId, Debt, Entry, EntryKind, LedgerNote, LedgerSettings,
  MoneyFields, MoneyFlow, MoneyType, Pin, PlannedRef, Reserve, ReservePatch,
  RecoveryFields, RecoveryOption, RecoveryRule, RecoveryWindowId,
  Recurrence, RepeatFreq, TaskStatus,
} from '../domain/types';
import { COLOR_BY_ID } from '../domain/constants';
import { DEFAULT_RECOVERY_OPTIONS, defaultRecoveryRule, RECOVERY_WINDOWS } from '../domain/recovery';

type Raw = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const obj = (v: unknown): Raw | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);

const asKind = (v: unknown): EntryKind =>
  v === 'task' || v === 'idea' || v === 'money' ? v : 'task';

const asColor = (v: unknown): ColorId =>
  typeof v === 'string' && v in COLOR_BY_ID ? (v as ColorId) : DEFAULT_COLOR;

const asStatus = (v: unknown): TaskStatus =>
  typeof v === 'string' && v in STATUS_BY_ID ? (v as TaskStatus) : 'planned';

const asMoneyType = (v: unknown): MoneyType =>
  typeof v === 'string' && v in MONEY_TYPE_BY_ID ? (v as MoneyType) : 'expense';

/** 짧은 선택 문자열. 비었으면 null — 빈 문자열과 "없음" 을 두 가지로 두지 않는다. */
const optStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

const asFlow = (v: unknown): MoneyFlow =>
  typeof v === 'string' && (MONEY_FLOWS as readonly string[]).includes(v) ? (v as MoneyFlow) : 'normal';

/** 예정 회차 연결. 모양이 맞지 않으면 없는 것으로 본다 — 엉뚱한 회차를 숨기지 않는다. */
function asPlannedRef(v: unknown): PlannedRef | null {
  const r = obj(v);
  if (!r) return null;
  const entryId = optStr(r.entryId);
  const date = normalizeDate(str(r.date));
  return entryId && date ? { entryId, date } : null;
}

/**
 * 저장 형태의 판 번호. **원장 필드를 아는 앱만 이 값을 쓴다.**
 *
 * 원장 필드를 모르는 예전 앱이 열어 둔 탭에서 항목을 저장하면, 그 앱은 모르는 필드를
 * 읽지 않았으니 쓰지도 않는다 — 문서 전체를 덮어쓰므로(`setDoc`) 실제 거래 표시 ·
 * 분류 · 회차 연결이 조용히 사라진다. 규칙이 "원장 필드가 실린 문서에 이 값 없는
 * 쓰기" 를 거절해 그 길을 막는다 (`firestore.rules` 의 `keepsLedger`).
 *
 * `money` 안이 아니라 **문서 맨 위**에 둔다. 예전 앱이 가계부 항목을 할 일로 바꾸면
 * `money: null` 을 쓰는데, 표식이 `money` 안에 있으면 그 쓰기에서는 비교할 표식 자체가
 * 없어 막을 수 없다.
 */
export const LEDGER_SCHEMA = 2;

const asTime = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null;

function asRecurrence(v: unknown): Recurrence | null {
  const r = obj(v);
  if (!r) return null;
  const freq = r.freq;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly') return null;
  const until = normalizeDate(str(r.until));
  return {
    freq: freq as RepeatFreq,
    interval: Math.max(1, Math.trunc(num(r.interval, 1))),
    until: until || null,
    count: typeof r.count === 'number' && r.count > 0 ? Math.trunc(r.count) : null,
  };
}

/**
 * 회복 표식.
 *
 * options 의 label 은 생성 시점 스냅샷이라 Rule 쪽 옵션이 바뀌어도 그대로 읽는다.
 * 여기서 Rule 을 참조해 되살리려 들면, 옵션을 지운 순간 지난 회차의 뜻이 사라진다.
 */
function asRecoveryFields(v: unknown): RecoveryFields | null {
  const r = obj(v);
  if (!r) return null;
  const rawOptions = Array.isArray(r.options) ? r.options : [];
  return {
    options: rawOptions
      .filter((x): x is Raw => x !== null && typeof x === 'object' && !Array.isArray(x))
      .map((x) => ({ id: str(x.id), label: str(x.label) }))
      .filter((o) => o.id !== ''),
    repayment: bool(r.repayment),
    movedCount: Math.max(0, Math.trunc(num(r.movedCount))),
  };
}

const asRecoveryWindow = (v: unknown): RecoveryWindowId =>
  RECOVERY_WINDOWS.some((w) => w.id === v) ? (v as RecoveryWindowId) : 'evening';

function asRecoveryOptions(v: unknown): RecoveryOption[] {
  if (!Array.isArray(v)) return DEFAULT_RECOVERY_OPTIONS.map((o) => ({ ...o }));
  const out = v
    .filter((x): x is Raw => x !== null && typeof x === 'object' && !Array.isArray(x))
    .map((x, i) => ({ id: str(x.id), label: str(x.label), order: num(x.order, i) }))
    .filter((o) => o.id !== '' && o.label !== '');
  // 옵션을 전부 지운 상태도 사용자의 선택이다. 배열 자체가 없을 때만 기본값으로 돌린다.
  return out;
}

/**
 * 회복 규칙. `users/{uid}` 문서의 `recovery` 필드에서 읽는다.
 * 필드가 통째로 없으면 (= 아직 한 번도 켠 적이 없으면) 꺼진 기본값이다.
 */
export function recoveryRuleFromDoc(v: unknown): RecoveryRule {
  const base = defaultRecoveryRule();
  const r = obj(v);
  if (!r) return base;
  const options = asRecoveryOptions(r.options);
  const known = new Set(options.map((o) => o.id));
  return {
    enabled: bool(r.enabled),
    intervalDays: Math.max(1, Math.trunc(num(r.intervalDays, base.intervalDays))),
    window: asRecoveryWindow(r.window),
    generationHorizonDays: Math.max(0, Math.trunc(num(r.generationHorizonDays, base.generationHorizonDays))),
    lastCompletedAt: normalizeDate(str(r.lastCompletedAt)) || null,
    nextDueAt: normalizeDate(str(r.nextDueAt)) || null,
    activeEntryId: typeof r.activeEntryId === 'string' && r.activeEntryId ? r.activeEntryId : null,
    debtCount: Math.max(0, Math.trunc(num(r.debtCount))),
    // 되돌리기용 자리. 옛 문서에는 없고, 없으면 되돌릴 것도 없다.
    completedEntryId: typeof r.completedEntryId === 'string' && r.completedEntryId ? r.completedEntryId : null,
    prevCompletedAt: normalizeDate(str(r.prevCompletedAt)) || null,
    defaultMemo: str(r.defaultMemo),
    // 지워진 옵션이 기본 선택에 남아 있으면 새 회차가 빈 스냅샷을 안고 태어난다.
    defaultOptionIds: strArr(r.defaultOptionIds).filter((id) => known.has(id)),
    options,
  };
}

export function recoveryRuleToDoc(r: RecoveryRule): Raw {
  return {
    enabled: r.enabled,
    intervalDays: r.intervalDays,
    window: r.window,
    generationHorizonDays: r.generationHorizonDays,
    lastCompletedAt: r.lastCompletedAt,
    nextDueAt: r.nextDueAt,
    activeEntryId: r.activeEntryId,
    debtCount: r.debtCount,
    completedEntryId: r.completedEntryId,
    prevCompletedAt: r.prevCompletedAt,
    defaultMemo: r.defaultMemo,
    defaultOptionIds: r.defaultOptionIds,
    options: r.options.map((o) => ({ id: o.id, label: o.label, order: o.order })),
  };
}

export function entryFromDoc(id: string, raw: Raw): Entry {
  const kind = asKind(raw.kind);
  const taskRaw = obj(raw.task);
  const moneyRaw = obj(raw.money);
  /*
    실제 거래는 한 날짜의 사실이다 — 반복도 기간도 없다. 규칙이 그런 쓰기를 거절하므로
    정상 경로로는 들어올 수 없지만, 들어오면 반복을 펼쳐 같은 거래를 여러 번 세게 된다.
  */
  const actual = kind === 'money' && moneyRaw?.status === 'actual';

  const startDate = normalizeDate(str(raw.startDate)) || todayISO();
  const endRaw = actual ? '' : normalizeDate(str(raw.endDate));
  const endDate = endRaw && endRaw >= startDate ? endRaw : null;
  const recurrence = actual ? null : asRecurrence(raw.recurrence);
  // 회차 연결은 실제 거래에만 뜻이 있다. 예정에 붙어 있으면 버린다 — 규칙도 그렇게 본다.
  const plannedRef = actual ? asPlannedRef(moneyRaw?.plannedRef) : null;

  const storedSpan = strArr(raw.ymSpan);

  return {
    id,
    kind,
    title: str(raw.title),
    note: str(raw.note),
    color: asColor(raw.color),
    tags: strArr(raw.tags),
    location: str(raw.location),
    startDate,
    startTime: asTime(raw.startTime),
    endDate,
    endTime: asTime(raw.endTime),
    // 저장된 인덱스가 비어 있거나 어긋나 있으면 실제 날짜에서 다시 만든다.
    ymSpan: storedSpan.length > 0 ? storedSpan : spanFallback(startDate, endDate, plannedRef),
    isRecurring: recurrence != null,
    recurrence,
    task: kind === 'task'
      ? {
          status: asStatus(taskRaw?.status),
          important: bool(taskRaw?.important),
          urgent: bool(taskRaw?.urgent),
          order: num(taskRaw?.order, 0),
        }
      : null,
    money: kind === 'money'
      ? {
          type: asMoneyType(moneyRaw?.type),
          amountMinor: Math.trunc(num(moneyRaw?.amountMinor)),
          currency: str(moneyRaw?.currency, DEFAULT_CURRENCY),
          linkedEntryId: typeof moneyRaw?.linkedEntryId === 'string' ? moneyRaw.linkedEntryId : null,
          // 아래 셋은 나중에 생긴 필드다. 예전 문서에는 없으므로 기본값으로 채운다.
          budgetId: typeof moneyRaw?.budgetId === 'string' ? moneyRaw.budgetId : null,
          debtId: typeof moneyRaw?.debtId === 'string' ? moneyRaw.debtId : null,
          // legacy `priority` 유형은 그 자체가 우선 표시였다. 뜻을 잃지 않게 옮겨 읽는다.
          priority: moneyRaw?.priority === true || moneyRaw?.type === 'priority',
          // 원장 필드. 없던 시절의 문서는 전부 예정 · 일반이다.
          status: actual ? 'actual' : 'planned',
          flow: asFlow(moneyRaw?.flow),
          categoryId: optStr(moneyRaw?.categoryId),
          method: optStr(moneyRaw?.method),
          accountId: optStr(moneyRaw?.accountId),
          plannedRef,
          highlight: moneyRaw?.highlight === true,
          outsidePocket: moneyRaw?.outsidePocket === true,
        }
      : null,
    // 회복 표식은 할 일 위에만 얹힌다.
    recovery: kind === 'task' ? asRecoveryFields(raw.recovery) : null,
    /*
      같이 보기에 올리지 않는 항목. **기본은 공유**라, 값이 없으면 false 다.
      옛 문서에는 이 필드가 없고 그것이 정상이다 — 없으면 올라간다.
    */
    keepPrivate: bool(raw.keepPrivate),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

/** 저장 형태. id 는 문서 ID 로 들어가므로 본문에서 뺀다. */
export function entryToDoc(e: Entry): Raw {
  return {
    kind: e.kind,
    title: e.title,
    note: e.note,
    color: e.color,
    tags: e.tags,
    location: e.location,
    startDate: e.startDate,
    startTime: e.startTime,
    endDate: e.endDate,
    endTime: e.endTime,
    ymSpan: e.ymSpan,
    isRecurring: e.isRecurring,
    recurrence: e.recurrence,
    task: e.task,
    money: e.money ? moneyToDoc(e.money) : null,
    recovery: e.recovery,
    schema: LEDGER_SCHEMA,
    // undefined 는 Firestore 가 받지 않는다. 늘 참/거짓으로 굳혀 쓴다.
    keepPrivate: e.keepPrivate === true,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

/** 저장된 `ymSpan` 이 없을 때 다시 만든다. `withDerived` 와 같은 규칙이다. */
function spanFallback(start: string, end: string | null, ref: PlannedRef | null): string[] {
  const own = ymRange(start, end ?? start);
  if (!ref) return own;
  const m = ymOf(ref.date);
  return own.includes(m) ? own : [...own, m].sort();
}

/**
 * 가계부 필드 저장 형태. 원장 필드를 **늘 채워서** 쓴다.
 *
 * 메모리의 객체는 그 필드가 없을 수 있다(예전 자료 · 테스트 자료). Firestore 는
 * `undefined` 를 받지 않으므로 빈 자리를 기본값으로 굳힌다.
 */
function moneyToDoc(m: MoneyFields): Raw {
  return {
    ...m,
    status: moneyStatusOf(m),
    flow: moneyFlowOf(m),
    categoryId: m.categoryId ?? null,
    method: m.method ?? null,
    accountId: m.accountId ?? null,
    plannedRef: m.plannedRef && moneyStatusOf(m) === 'actual'
      ? { entryId: m.plannedRef.entryId, date: m.plannedRef.date }
      : null,
    highlight: m.highlight === true,
    // 주머니에 걸렸으면 "생활비 외" 는 뜻이 없다. 둘이 함께 남지 않게 굳힌다.
    outsidePocket: m.outsidePocket === true && !m.budgetId,
  };
}

export function accountFromDoc(id: string, raw: Raw): Account {
  const asOf = normalizeDate(str(raw.asOf)) || todayISO();
  const rawChecked = str(raw.checkedAt);
  // 예전 데이터는 checkedAt 이 없다. asOf 자정으로 채운다 —
  // 정산은 "그 날 이후" 를 세므로 자정으로 두면 그 날 예정분이 포함된다.
  const checkedAt = /^\d{4}-\d{2}-\d{2}T/.test(rawChecked)
    ? rawChecked
    : `${asOf}T00:00:00.000Z`;
  return {
    id,
    name: str(raw.name, '주계좌'),
    balanceMinor: Math.trunc(num(raw.balanceMinor)),
    currency: str(raw.currency, DEFAULT_CURRENCY),
    asOf,
    checkedAt,
    reflectedEntryIds: strArr(raw.reflectedEntryIds),
    order: num(raw.order, 0),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function accountToDoc(a: Account): Raw {
  return {
    name: a.name, balanceMinor: a.balanceMinor, currency: a.currency,
    asOf: a.asOf, checkedAt: a.checkedAt, order: a.order,
    // 같은 날 실제 거래 중 이 잔고에 들어 있는 것. 예전 앱은 이 값을 모르므로 같은
    // 이유로 판 번호를 붙인다 — 예전 앱이 잔고를 다시 적으면서 이 목록을 지우지 못하게.
    reflectedEntryIds: a.reflectedEntryIds ?? [],
    schema: LEDGER_SCHEMA,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

export function debtFromDoc(id: string, raw: Raw): Debt {
  return {
    id,
    name: str(raw.name),
    balanceMinor: Math.trunc(num(raw.balanceMinor)),
    monthlyMinor: Math.trunc(num(raw.monthlyMinor)),
    rate: typeof raw.rate === 'number' && Number.isFinite(raw.rate) ? raw.rate : null,
    currentRound: Math.trunc(num(raw.currentRound)),
    totalRounds: Math.trunc(num(raw.totalRounds)),
    order: num(raw.order, 0),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function debtToDoc(d: Debt): Raw {
  return {
    name: d.name, balanceMinor: d.balanceMinor, monthlyMinor: d.monthlyMinor,
    rate: d.rate, currentRound: d.currentRound, totalRounds: d.totalRounds,
    order: d.order, createdAt: d.createdAt, updatedAt: d.updatedAt,
  };
}

export function pinFromDoc(id: string, raw: Raw): Pin {
  const lens = raw.lens;
  return {
    id,
    lens: lens === 'task' || lens === 'idea' || lens === 'money' ? lens : 'task',
    text: str(raw.text),
    order: num(raw.order, 0),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function pinToDoc(p: Pin): Raw {
  return { lens: p.lens, text: p.text, order: p.order, createdAt: p.createdAt, updatedAt: p.updatedAt };
}

/**
 * 생활비 예산.
 *
 * 기간이 뒤집혀 있으면 종료일을 시작일로 맞춘다 — 하루짜리 예산이 된다. 읽기 계층이
 * 던지면 문서 하나 때문에 화면 전체가 비어 버린다.
 */
export function budgetFromDoc(id: string, raw: Raw): Budget {
  const startDate = normalizeDate(str(raw.startDate)) || todayISO();
  const endRaw = normalizeDate(str(raw.endDate));
  return {
    id,
    name: str(raw.name),
    startDate,
    endDate: endRaw && endRaw >= startDate ? endRaw : startDate,
    amountMinor: Math.trunc(num(raw.amountMinor)),
    currency: str(raw.currency, DEFAULT_CURRENCY),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function budgetToDoc(b: Budget): Raw {
  return {
    name: b.name,
    startDate: b.startDate,
    endDate: b.endDate,
    amountMinor: b.amountMinor,
    currency: b.currency,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/** 세이브. 날짜가 없다 — 특정 날의 사건이 아니라 지금 묶여 있는 상태다. */
export function reserveFromDoc(id: string, raw: Raw): Reserve {
  return {
    id,
    name: str(raw.name),
    amountMinor: Math.trunc(num(raw.amountMinor)),
    currency: str(raw.currency, DEFAULT_CURRENCY),
    // P1 필드. 예전 문서에는 없다 — 보호는 켜진 것(예전 그대로 한도에서 빠진다), 나머지는 없음.
    protected: raw.protected !== false,
    targetAmountMinor: asTargetAmount(raw.targetAmountMinor),
    targetDate: normalizeDate(str(raw.targetDate)) || null,
    archivedAt: optStr(raw.archivedAt),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

/** 목표 금액. 0 이상의 안전한 정수만 — 그 밖은 "목표 없음" 으로 읽는다(표시용 값이다). */
function asTargetAmount(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/**
 * 저장 형태. P1 필드를 **늘 채워서** 쓰고 판 번호(`schema`)를 붙인다.
 *
 * 그 필드를 모르는 예전 앱은 세이브를 고칠 때 문서 전체를 덮어써(`setDoc`) 보호 해제 · 목표 ·
 * 보관을 지운다 — 보호가 없으면 "켜짐" 으로 읽으므로 꺼 둔 세이브가 조용히 다시 한도에서
 * 빠진다. 규칙이 "P1 값이 실린 문서에 판 번호 없는 쓰기" 를 거절한다 (`keepsReserve`).
 */
export function reserveToDoc(r: Reserve): Raw {
  return {
    name: r.name,
    amountMinor: r.amountMinor,
    currency: r.currency,
    ...reservePatchToDoc({
      protected: r.protected !== false,
      targetAmountMinor: r.targetAmountMinor ?? null,
      targetDate: r.targetDate ?? null,
      archivedAt: r.archivedAt ?? null,
    }),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * 부분 쓰기의 본문 — 담긴 칸과 판 번호만. merge 로 쓰므로 담지 않은 칸은 서버 값이 남는다.
 * `undefined` 는 Firestore 가 받지 않으므로 담지 않은 칸은 아예 빠진다.
 */
export function reservePatchToDoc(p: ReservePatch): Raw {
  const out: Raw = { schema: LEDGER_SCHEMA };
  if (p.name !== undefined) out.name = p.name;
  if (p.amountMinor !== undefined) out.amountMinor = p.amountMinor;
  if (p.protected !== undefined) out.protected = p.protected !== false;
  if (p.targetAmountMinor !== undefined) out.targetAmountMinor = p.targetAmountMinor ?? null;
  if (p.targetDate !== undefined) out.targetDate = p.targetDate ?? null;
  if (p.archivedAt !== undefined) out.archivedAt = p.archivedAt ?? null;
  return out;
}

// ---------- 가계부 결산 ----------

export function categoryFromDoc(id: string, raw: Raw): Category {
  return {
    id,
    kind: raw.kind === 'income' ? 'income' : 'expense',
    name: str(raw.name),
    order: Math.trunc(num(raw.order, 0)),
    archived: bool(raw.archived),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function categoryToDoc(c: Category): Raw {
  return {
    kind: c.kind, name: c.name, order: c.order, archived: c.archived,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

const isPeriodKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** 기간 열쇠가 깨진 줄은 어느 기간에도 걸리지 않게 아주 먼 미래로 둔다 — 지난 결산을 바꾸지 않는다. */
export function categoryBudgetFromDoc(id: string, raw: Raw): CategoryBudget {
  const amount = raw.amountMinor;
  return {
    id,
    categoryId: str(raw.categoryId),
    scope: raw.scope === 'period' ? 'period' : 'default',
    period: isPeriodKey(raw.period) ? raw.period : '9999-12',
    amountMinor: typeof amount === 'number' && Number.isFinite(amount) ? Math.trunc(amount) : null,
    currency: str(raw.currency, DEFAULT_CURRENCY),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function categoryBudgetToDoc(b: CategoryBudget): Raw {
  return {
    categoryId: b.categoryId, scope: b.scope, period: b.period,
    amountMinor: b.amountMinor, currency: b.currency,
    createdAt: b.createdAt, updatedAt: b.updatedAt,
  };
}

/**
 * 연간 카테고리 예산. 읽기는 방어적이다 — 배분에서 모르는 달 · 0 이하 · 정수가 아닌 값은 버린다(그 달은
 * "배분 없음"). 금액이 깨졌으면 0. 쓰기는 담긴 값을 그대로 — 저장 전 검사는 `annualBudgetProblem` 과 규칙이 한다.
 */
export function annualBudgetFromDoc(id: string, raw: Raw): AnnualBudget {
  const months = obj(raw.monthAllocations) ?? {};
  const monthAllocations: Partial<Record<MonthNo, number>> = {};
  for (const k of MONTH_NOS) {
    const v = months[k];
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) monthAllocations[k] = v;
  }
  const amount = raw.amountMinor;
  const year = raw.year;
  return {
    id,
    categoryId: str(raw.categoryId),
    year: typeof year === 'number' && Number.isSafeInteger(year) ? year : 0,
    amountMinor: typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0 ? amount : 0,
    monthAllocations,
    currency: str(raw.currency, DEFAULT_CURRENCY),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function annualBudgetToDoc(b: AnnualBudget): Raw {
  return {
    categoryId: b.categoryId, year: b.year, amountMinor: b.amountMinor,
    monthAllocations: { ...b.monthAllocations }, currency: b.currency,
    createdAt: b.createdAt, updatedAt: b.updatedAt,
  };
}

/** 메모 글자 수 상한. 규칙과 같은 값이다. */
export const LEDGER_NOTE_MAX = 5000;

/** 기간 열쇠는 문서 id 를 믿는다 — 규칙이 `id == period` 를 강제하므로 둘은 같다. */
export function ledgerNoteFromDoc(id: string, raw: Raw): LedgerNote {
  const period = isPeriodKey(id) ? id : isPeriodKey(raw.period) ? raw.period : '9999-12';
  return {
    id, period,
    text: str(raw.text).slice(0, LEDGER_NOTE_MAX),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function ledgerNoteToDoc(n: LedgerNote): Raw {
  return { period: n.period, text: n.text, createdAt: n.createdAt, updatedAt: n.updatedAt };
}

/** `users/{uid}` 문서의 `ledger` 필드. 없으면 1일 정산이다. */
export function ledgerSettingsFromDoc(raw: unknown): LedgerSettings {
  const o = obj(raw);
  return { settleDay: clampSettleDay(o?.settleDay) };
}

export function ledgerSettingsToDoc(s: LedgerSettings): Raw {
  return { settleDay: clampSettleDay(s.settleDay) };
}
