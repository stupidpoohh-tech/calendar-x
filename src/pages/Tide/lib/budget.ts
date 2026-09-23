import type { ISODate } from './date';
import type { Budget, Entry, State } from './types';

/** 예산 밖·반복·입금·삭제된 예산 참조는 일반 흐름으로 계산한다. */
export function inBudget(entry: Entry, budget: Budget): boolean {
  return entry.kind === 'expense' && entry.budgetId === budget.id
    && entry.schedule.type === 'once'
    && entry.schedule.date >= budget.start && entry.schedule.date <= budget.end;
}

export function inAnyBudget(entry: Entry, budgets: readonly Budget[]): boolean {
  return budgets.some((b) => inBudget(entry, b));
}

export function spendingIn(budget: Budget, entries: readonly Entry[]): Entry[] {
  return entries.filter((e) => inBudget(e, budget));
}

export function budgetState(budget: Budget, entries: readonly Entry[]) {
  const spent = spendingIn(budget, entries).reduce((sum, e) => sum + e.amount, 0);
  return { spent, remaining: Math.max(0, budget.amount - spent), overspent: Math.max(0, spent - budget.amount) };
}

/** 본앱과 같은 규칙. 예약 총액에서 잔고가 이미 흡수한 지출만 뺀다. */
export function reservedOn(state: State, date: ISODate, settledThrough: ISODate) {
  let budgets = 0;
  for (const b of state.budgets ?? []) {
    if (b.start > date) continue;
    const linked = spendingIn(b, state.entries);
    const spent = linked.reduce((sum, e) => sum + e.amount, 0);
    const settled = linked.reduce((sum, e) =>
      sum + (e.schedule.type === 'once' && e.schedule.date <= settledThrough ? e.amount : 0), 0);
    budgets += Math.max(b.amount, spent) - settled;
  }
  const reserves = (state.reserves ?? []).reduce((sum, r) => sum + r.amount, 0);
  return { budgets, reserves, total: budgets + reserves };
}
