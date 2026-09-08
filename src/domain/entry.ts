import {
  DEFAULT_COLOR, DEFAULT_CURRENCY, MONEY_TYPE_BY_ID, STATUS_BY_ID,
} from './constants';
import { normalizeDate, todayISO, ymRange } from './date';
import { formatAmount } from './money';
import type {
  ColorId, DateISO, Entry, EntryKind, MoneyType, Recurrence, TaskStatus,
} from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** 기간형 항목의 실제 종료일. endDate 가 없으면 시작일 하루짜리다. */
export function effectiveEndDate(e: Pick<Entry, 'startDate' | 'endDate'>): DateISO {
  const end = normalizeDate(e.endDate);
  const start = normalizeDate(e.startDate);
  if (!end || end < start) return start;
  return end;
}

export function isRanged(e: Pick<Entry, 'startDate' | 'endDate'>): boolean {
  return effectiveEndDate(e) > normalizeDate(e.startDate);
}

/**
 * 저장 직전에 파생 필드를 다시 계산한다.
 * ymSpan 과 isRecurring 은 조회 인덱스이므로 손으로 채우면 언젠가 어긋난다.
 */
export function withDerived(e: Entry, now = new Date().toISOString()): Entry {
  const startDate = normalizeDate(e.startDate) || todayISO();
  const endRaw = normalizeDate(e.endDate);
  const endDate = endRaw && endRaw >= startDate ? endRaw : null;
  return {
    ...e,
    startDate,
    endDate,
    ymSpan: ymRange(startDate, endDate ?? startDate),
    isRecurring: e.recurrence != null,
    updatedAt: now,
  };
}

export function newEntry(kind: EntryKind, patch: Partial<Entry> = {}): Entry {
  const now = new Date().toISOString();
  const start = normalizeDate(patch.startDate) || todayISO();

  const base: Entry = {
    id: patch.id || uid(),
    kind,
    title: '',
    note: '',
    color: defaultColorFor(kind, patch.money?.type),
    tags: [],
    location: '',
    startDate: start,
    startTime: null,
    endDate: null,
    endTime: null,
    ymSpan: [],
    isRecurring: false,
    recurrence: null,
    task: kind === 'task'
      ? { status: 'planned', important: false, urgent: false, order: Date.now() }
      : null,
    money: kind === 'money'
      ? { type: 'expense', amountMinor: 0, currency: DEFAULT_CURRENCY, linkedEntryId: null }
      : null,
    recovery: null,
    createdAt: now,
    updatedAt: now,
  };

  return withDerived({ ...base, ...patch, kind }, now);
}

function defaultColorFor(kind: EntryKind, moneyType?: MoneyType): ColorId {
  if (kind === 'money') return MONEY_TYPE_BY_ID[moneyType ?? 'expense'].defaultColor;
  if (kind === 'idea') return 'violet';
  return DEFAULT_COLOR;
}

/**
 * 축 간 전환. 아이디어를 할 일로 승격하거나 그 반대로 되돌린다.
 * 이전 구조에서는 탭이 곧 컬렉션 분기였기 때문에 불가능했던 동작이다.
 */
export function convertKind(e: Entry, to: EntryKind): Entry {
  if (e.kind === to) return e;
  const now = new Date().toISOString();
  const next: Entry = {
    ...e,
    kind: to,
    task: to === 'task'
      ? e.task ?? { status: 'planned', important: false, urgent: false, order: Date.now() }
      : null,
    money: to === 'money'
      ? e.money ?? { type: 'expense', amountMinor: 0, currency: DEFAULT_CURRENCY, linkedEntryId: null }
      : null,
    // 회복 표식은 할 일 위에만 얹힌다. 다른 축으로 옮기면 표식이 남을 자리가 없다.
    recovery: to === 'task' ? e.recovery : null,
  };
  // 아이디어는 기간도 반복도 갖지 않으므로 강등 시 접는다.
  if (to === 'idea') {
    next.endDate = null;
    next.startTime = null;
    next.endTime = null;
    next.recurrence = null;
  }
  return withDerived(next, now);
}

/** 목록·캘린더에 보일 제목. 가계부는 금액을 함께 보여 준다. */
export function displayTitle(e: Entry): string {
  if (e.kind !== 'money' || !e.money) return e.title.trim() || '(제목 없음)';
  const type = MONEY_TYPE_BY_ID[e.money.type];
  const amount = formatAmount(e.money.amountMinor, e.money.currency);
  const label = e.title.trim();
  return label ? `${label} · ${amount}` : `${type.label} ${amount}`;
}

/** 접근성 라벨. 화면에 안 보이는 맥락까지 담는다. */
export function ariaLabel(e: Entry): string {
  const parts = [displayTitle(e)];
  if (e.kind === 'task' && e.task) parts.push(STATUS_BY_ID[e.task.status].label);
  if (e.kind === 'money' && e.money) parts.push(MONEY_TYPE_BY_ID[e.money.type].label);
  return parts.join(', ');
}

export function isDone(e: Entry): boolean {
  return e.kind === 'task' && e.task?.status === 'done';
}

export function setStatus(e: Entry, status: TaskStatus): Entry {
  if (e.kind !== 'task' || !e.task) return e;
  return withDerived({ ...e, task: { ...e.task, status } });
}

export function setRecurrence(e: Entry, recurrence: Recurrence | null): Entry {
  return withDerived({ ...e, recurrence });
}

/** 지정한 날짜에 이 항목이 걸쳐 있는가. 반복 전개는 recurrence.ts 가 따로 처리한다. */
export function occursOn(e: Entry, iso: DateISO): boolean {
  const day = normalizeDate(iso);
  return day >= normalizeDate(e.startDate) && day <= effectiveEndDate(e);
}

/** 정렬용 키. 같은 날이면 시각이 이른 것이, 시각이 없으면 종일 항목이 앞에 온다. */
export function sortKey(e: Entry): string {
  return `${normalizeDate(e.startDate)}T${e.startTime ?? '00:00'}`;
}
