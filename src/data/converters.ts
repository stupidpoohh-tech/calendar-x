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
  Recurrence, RepeatFreq, TaskStatus,
} from '../domain/types';
import { COLOR_BY_ID } from '../domain/constants';

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
