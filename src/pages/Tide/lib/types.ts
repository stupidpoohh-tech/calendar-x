import { type ISODate, formatShortDate } from './date';

export type EntryKind = 'income' | 'expense';

/**
 * 반복 규칙. 네 가지다.
 * - once:    특정 일자 한 번.
 * - monthly: 매달 며칠. 그 달에 없는 날짜면 말일로 당겨진다.
 * - every:   anchor부터 N일마다. 1주는 7, 열흘은 10.
 * - span:    기간 예산(생활비). 총액을 기간 전체로 잡는다.
 *            표시는 총액 한 줄이지만, 계산은 하루 단위로 나눠 반영된다 —
 *            그래야 기간 중간에 잔고를 다시 적어도 정산이 어긋나지 않고,
 *            마지막 날이 지나면 정확히 총액만큼 빠진다.
 */
export type Schedule =
  | { type: 'once'; date: ISODate }
  | { type: 'monthly'; day: number }
  | { type: 'every'; days: number; anchor: ISODate }
  | { type: 'span'; start: ISODate; end: ISODate };

/** 기간 막대에 쓰는 색. 여러 기간을 눈으로 구분하려고 사용자가 고른다. */
export const SPAN_COLORS = ['rose', 'amber', 'violet', 'teal', 'slate'] as const;
export type SpanColor = (typeof SPAN_COLORS)[number];

export const SPAN_COLOR_LABEL: Record<SpanColor, string> = {
  rose: '빨강',
  amber: '주황',
  violet: '보라',
  teal: '청록',
  slate: '회색',
};

/** 예정된 입금 또는 출금 한 건. */
export type Entry = {
  id: string;
  name: string;
  /** 항상 양수. 방향은 kind가 정한다. */
  amount: number;
  kind: EntryKind;
  schedule: Schedule;
  /** 기간(span)에서만 쓴다. 없으면 기본색. */
  color?: SpanColor;
  /** 기간 안의 한 번짜리 지출만 예산에서 사용한다. */
  budgetId?: string;
};

export type Budget = { id: string; name: string; amount: number; start: ISODate; end: ISODate };
export type Reserve = { id: string; name: string; amount: number };

export type Balance = {
  amount: number;
  /** 잔고를 옮겨 적은 시각. ISO datetime. */
  checkedAt: string;
};

/**
 * 급여일 필드는 없다. 급여도 그냥 예정 입금이고,
 * 주기는 "다음 예정 입금 전날까지"로 계산된다.
 */
export type State = {
  balance: Balance;
  entries: Entry[];
  /** v1~v4 호출부도 계산 가능. v5 저장·백업에는 두 배열을 반드시 기록한다. */
  budgets?: Budget[];
  reserves?: Reserve[];
};

/** 입금은 +, 출금은 −. 계산은 전부 이 부호를 통해서만 한다. */
export function signedAmount(entry: Entry): number {
  return entry.kind === 'income' ? entry.amount : -entry.amount;
}

export function makeInitialState(amount: number, entries: Entry[] = [], now = new Date()): State {
  return {
    balance: { amount, checkedAt: now.toISOString() },
    entries,
    budgets: [],
    reserves: [],
  };
}

/** 알 수 없는 값이 State 모양인지 확인한다. 백업 링크·저장소 복구 경로에서 쓴다. */
export function isState(value: unknown): value is State {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;

  const balance = s.balance as Record<string, unknown> | undefined;
  if (typeof balance !== 'object' || balance === null) return false;
  if (!isMoney(balance.amount, true)) return false;
  if (!isInstant(balance.checkedAt)) {
    return false;
  }

  if (!validList(s.entries, isEntry)) return false;
  if (s.budgets !== undefined && !validList(s.budgets, isBudget)) return false;
  if (s.reserves !== undefined && !validList(s.reserves, isReserve)) return false;
  return true;
}

function validList(value: unknown, check: (v: unknown) => boolean): boolean {
  if (!Array.isArray(value) || !value.every(check)) return false;
  return new Set(value.map((v: { id: string }) => v.id)).size === value.length;
}

export function isMoney(value: unknown, signed = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (signed || value >= 0);
}

export function isInstant(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && isISODate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

export function isBudget(value: unknown): value is Budget {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return isId(b.id) && typeof b.name === 'string' && b.name.trim().length > 0
    && isMoney(b.amount) && isISODate(b.start) && isISODate(b.end) && b.start <= b.end;
}

export function isReserve(value: unknown): value is Reserve {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return isId(r.id) && typeof r.name === 'string' && r.name.trim().length > 0 && isMoney(r.amount);
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    isId(e.id) &&
    typeof e.name === 'string' &&
    isMoney(e.amount) &&
    (e.kind === 'income' || e.kind === 'expense') &&
    isSchedule(e.schedule) &&
    (e.color === undefined || SPAN_COLORS.includes(e.color as SpanColor)) &&
    (e.budgetId === undefined || isId(e.budgetId))
  );
}

function isSchedule(value: unknown): value is Schedule {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s.type === 'monthly') return isDay(s.day);
  if (s.type === 'once') return isISODate(s.date);
  if (s.type === 'every') {
    return (
      typeof s.days === 'number' &&
      Number.isInteger(s.days) &&
      s.days >= 1 &&
      s.days <= 365 &&
      isISODate(s.anchor)
    );
  }
  if (s.type === 'span') {
    return isISODate(s.start) && isISODate(s.end) && s.start <= s.end;
  }
  return false;
}

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return d <= ([31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0);
}

function isDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 기간 막대에 실제로 쓸 색. 안 골랐으면 방향에 맞는 기본색. */
export function spanColorOf(entry: Entry): SpanColor {
  return entry.color ?? (entry.kind === 'income' ? 'teal' : 'rose');
}

export function describeSchedule(schedule: Schedule): string {
  if (schedule.type === 'monthly') return `매달 ${schedule.day}일`;
  if (schedule.type === 'every') return `${schedule.days}일마다`;
  if (schedule.type === 'span') {
    return `${formatShortDate(schedule.start)}~${formatShortDate(schedule.end)} 기간`;
  }
  return formatShortDate(schedule.date);
}
