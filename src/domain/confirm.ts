/**
 * 예정 회차를 실제 거래로 확정한다.
 *
 * ── 무엇을 만들고 무엇을 건드리지 않는가 ───────────────────────
 *
 * 확정은 **실제 거래 한 건을 새로 만드는 것**이다. 예정 원본과 반복 규칙은 건드리지
 * 않는다 — 9월 월세를 확정해도 10월 · 11월 회차와 반복 규칙은 그대로다. 연결은 실제
 * 거래 쪽의 `plannedRef` 하나뿐이고, 계산과 화면은 그것을 보고 그 회차를 건너뛴다
 * (`ledger.confirmedSetOf`). 그래서 **확정 취소는 실제 거래를 지우는 것**이고, 지우는
 * 순간 회차가 예정으로 돌아온다. 되돌릴 상태가 따로 없다.
 *
 * 실제 거래의 id 는 회차로 정해진다 (`ledger.confirmedEntryId`). 같은 회차를 두 번
 * 확정해도, 두 기기에서 동시에 확정해도 문서는 하나다.
 *
 * ── 확정하지 않는 것 ──────────────────────────────────────────
 *
 *   span                  기간 예정. 하루 몫으로 쪼개 세는 흐름이라 "그 회차" 가 없다
 *   legacy-unconfirmable  legacy 생활비 · 저축 · 가용 — 현금 거래가 아니거나 주머니다
 *   legacy-needs-choice   legacy 상환 · 우선 — 원금인지 이자인지 일반 지출인지 저장된
 *                         값에 없다. 사용자가 종류와 흐름을 고르기 전에는 만들지 않는다
 *
 * 이 파일은 순수 함수만 담는다. 저장은 부르는 쪽이 평소 경로(`saveEntry`)로 한다.
 */
import { normalizeDate } from './date';
import { newEntry, newMoney, withDerived } from './entry';
import {
  confirmedEntryId, confirmedKey, confirmedSetOf, isActual, moneyFlowOf, OUTFLOW_ONLY_FLOWS,
} from './ledger';
import { expandEntry, isVirtualEntry } from './recurrence';
import type { Budget, DateISO, Entry, MoneyFlow, MoneyType } from './types';

export type ConfirmRefusal =
  | 'not-money'
  | 'virtual'
  | 'already-actual'
  | 'span'
  | 'legacy-unconfirmable'
  | 'legacy-needs-choice'
  | 'not-occurrence'
  | 'invalid-flow'
  | 'invalid-amount'
  | 'invalid-date';

/** 확정할 때 실제와 달라진 값. 비우면 예정 값을 그대로 쓴다. */
export interface ConfirmPatch {
  /** 실제로 돈이 움직인 날. 기본은 회차 날짜. */
  date?: DateISO;
  amountMinor?: number;
  /** legacy 상환 · 우선 항목은 반드시 고른다. */
  type?: 'income' | 'expense';
  /** legacy 상환 · 우선 항목은 반드시 고른다. */
  flow?: MoneyFlow;
  title?: string;
  note?: string;
  categoryId?: string | null;
  method?: string | null;
  accountId?: string | null;
  budgetId?: string | null;
  debtId?: string | null;
}

export type ConfirmResult =
  | { ok: true; entry: Entry }
  | { ok: false; reason: ConfirmRefusal };

const UNCONFIRMABLE: readonly MoneyType[] = ['living', 'save', 'free'];
const NEEDS_CHOICE: readonly MoneyType[] = ['repay', 'priority'];

/** 확정할 수 있는 예정 항목인가. 이유가 없으면 null. */
export function confirmBlockOf(plan: Entry): ConfirmRefusal | null {
  if (plan.kind !== 'money' || !plan.money) return 'not-money';
  if (isVirtualEntry(plan)) return 'virtual';
  if (isActual(plan)) return 'already-actual';
  const end = normalizeDate(plan.endDate);
  if (end && end > normalizeDate(plan.startDate)) return 'span';
  if (UNCONFIRMABLE.includes(plan.money.type)) return 'legacy-unconfirmable';
  return null;
}

/** 확정할 때 사용자가 종류 · 흐름을 직접 골라야 하는 legacy 항목인가. */
export function needsTypeChoice(plan: Entry): boolean {
  return !!plan.money && NEEDS_CHOICE.includes(plan.money.type);
}

/** `date` 가 이 예정의 회차인가. 반복은 실제로 전개해서 본다 — 말일 당김까지 같은 규칙이다. */
export function isOccurrenceOf(plan: Entry, date: DateISO): boolean {
  const d = normalizeDate(date);
  if (!d) return false;
  if (!plan.recurrence) return normalizeDate(plan.startDate) === d;
  return expandEntry(plan, d, d).some((o) => o.startDate === d);
}

export function confirmOccurrence(
  plan: Entry, occurrenceDate: DateISO, patch: ConfirmPatch = {},
  now = new Date().toISOString(),
): ConfirmResult {
  const block = confirmBlockOf(plan);
  if (block) return { ok: false, reason: block };
  const m = plan.money!;

  const occ = normalizeDate(occurrenceDate);
  if (!occ || !isOccurrenceOf(plan, occ)) return { ok: false, reason: 'not-occurrence' };

  // legacy 상환 · 우선은 추정하지 않는다. 종류와 흐름을 모두 받아야 만든다.
  if (needsTypeChoice(plan) && (patch.type === undefined || patch.flow === undefined)) {
    return { ok: false, reason: 'legacy-needs-choice' };
  }
  const type: 'income' | 'expense' = patch.type
    ?? (m.type === 'income' ? 'income' : 'expense');
  const flow = patch.flow ?? moneyFlowOf(m);
  if ((OUTFLOW_ONLY_FLOWS as readonly MoneyFlow[]).includes(flow) && type !== 'expense') {
    return { ok: false, reason: 'invalid-flow' };
  }

  const amount = patch.amountMinor ?? m.amountMinor;
  if (!Number.isSafeInteger(amount) || amount < 0) return { ok: false, reason: 'invalid-amount' };

  const date = patch.date === undefined ? occ : normalizeDate(patch.date);
  if (!date) return { ok: false, reason: 'invalid-date' };

  /*
    사용처는 한 번에 하나다. 입금은 주머니에서도 대출에서도 나가지 않고, 카드 사용은
    주머니에 걸지 않는다 (`budget.inBudget`).
  */
  let budgetId = patch.budgetId !== undefined ? patch.budgetId : m.budgetId ?? null;
  let debtId = patch.debtId !== undefined ? patch.debtId : m.debtId ?? null;
  if (patch.budgetId) debtId = null;
  else if (patch.debtId) budgetId = null;
  if (type === 'income') { budgetId = null; debtId = null; }
  if (flow === 'cardSpend') budgetId = null;

  const entry = newEntry('money', {
    id: confirmedEntryId(plan.id, occ),
    title: patch.title ?? plan.title,
    note: patch.note ?? plan.note,
    color: plan.color,
    tags: [...plan.tags],
    location: plan.location,
    startDate: date,
    startTime: plan.startTime,
    endDate: null,
    endTime: null,
    recurrence: null,
    money: newMoney({
      type,
      amountMinor: amount,
      currency: m.currency,
      linkedEntryId: m.linkedEntryId ?? null,
      budgetId,
      debtId,
      priority: false,
      status: 'actual',
      flow,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : m.categoryId ?? null,
      method: patch.method !== undefined ? patch.method : m.method ?? null,
      accountId: patch.accountId !== undefined ? patch.accountId : m.accountId ?? null,
      plannedRef: { entryId: plan.id, date: occ },
    }),
    createdAt: now,
  });
  return { ok: true, entry: withDerived(entry, now) };
}

/** 이 회차를 확정한 실제 거래. 없으면 null. 확정 취소는 이것을 지우는 것이다. */
export function confirmationOf(
  entries: readonly Entry[], planId: string, date: DateISO,
): Entry | null {
  const key = confirmedKey(planId, normalizeDate(date));
  return entries.find((e) => isActual(e)
    && e.money?.plannedRef
    && confirmedKey(e.money.plannedRef.entryId, normalizeDate(e.money.plannedRef.date)) === key) ?? null;
}

/** 이 회차가 이미 확정됐는가. */
export function isConfirmed(entries: readonly Entry[], planId: string, date: DateISO): boolean {
  return confirmedSetOf(entries).has(confirmedKey(planId, normalizeDate(date)));
}

/**
 * 실제 거래를 걸 생활비 주머니.
 *
 * 그 날을 품는 주머니가 하나면 그것을 기본으로 고른다. 여럿이면 고르지 않는다 —
 * 어느 주머니에서 나간 돈인지 넘겨짚으면 다른 주머니의 남은 금액이 틀린다. 없으면
 * 일반 지출이다. 무엇이 골라졌는지는 저장 전에 화면이 보여 준다.
 */
export interface PocketChoice {
  selected: Budget | null;
  candidates: Budget[];
}

export function pocketChoiceFor(date: DateISO, budgets: readonly Budget[]): PocketChoice {
  const d = normalizeDate(date);
  const candidates = budgets
    .filter((b) => b.startDate <= d && d <= b.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  return { selected: candidates.length === 1 ? candidates[0]! : null, candidates };
}
