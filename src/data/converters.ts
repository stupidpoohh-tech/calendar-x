/**
 * Firestore 문서 ↔ 도메인 타입.
 *
 * 원격 문서는 언제든 필드가 빠져 있거나 예전 형태일 수 있으므로 읽기 쪽은 전부 방어적으로
 * 채운다. 화면이 흰색으로 죽는 것보다 기본값으로 뜨는 편이 낫다.
 */
import { DEFAULT_COLOR, DEFAULT_CURRENCY, MONEY_TYPE_BY_ID, STATUS_BY_ID } from '../domain/constants';
import { normalizeDate, todayISO, ymRange } from '../domain/date';
import type {
  Account, ColorId, Debt, Entry, EntryKind, MoneyType, Pin,
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
    defaultMemo: r.defaultMemo,
    defaultOptionIds: r.defaultOptionIds,
    options: r.options.map((o) => ({ id: o.id, label: o.label, order: o.order })),
  };
}

export function entryFromDoc(id: string, raw: Raw): Entry {
  const kind = asKind(raw.kind);
  const startDate = normalizeDate(str(raw.startDate)) || todayISO();
  const endRaw = normalizeDate(str(raw.endDate));
  const endDate = endRaw && endRaw >= startDate ? endRaw : null;
  const recurrence = asRecurrence(raw.recurrence);

  const taskRaw = obj(raw.task);
  const moneyRaw = obj(raw.money);

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
    ymSpan: storedSpan.length > 0 ? storedSpan : ymRange(startDate, endDate ?? startDate),
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
        }
      : null,
    // 회복 표식은 할 일 위에만 얹힌다.
    recovery: kind === 'task' ? asRecoveryFields(raw.recovery) : null,
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
    money: e.money,
    recovery: e.recovery,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
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
    order: num(raw.order, 0),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function accountToDoc(a: Account): Raw {
  return {
    name: a.name, balanceMinor: a.balanceMinor, currency: a.currency,
    asOf: a.asOf, checkedAt: a.checkedAt, order: a.order,
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
