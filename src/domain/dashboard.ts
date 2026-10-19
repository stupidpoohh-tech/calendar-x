import { addDaysISO, endOfMonth, monthGrid, toISO } from './date';
import { effectiveEndDate } from './entry';
import { materialize } from './recurrence';
import { actualsIn, budgetRows, budgetSummary, totalsOf } from './ledgerStats';
import { annualCategoryIds, withoutAnnual, yearOfPeriod } from './annualBudget';
import { periodByKey } from './period';
import type { StoreState } from '../app/useStore';
import type { Entry, WeekStart } from './types';
import { cashSignOf } from './ledger';
import { occurrences } from './tide';

export function dashboardEntries(entries: readonly Entry[], cursor: Date, weekStart: WeekStart) {
  const grid = monthGrid(cursor, weekStart);
  const from = toISO(grid[0]!);
  const to = toISO(grid[41]!);
  const expanded = materialize(entries, from, to);
  const tasks = expanded.filter(e => e.kind === 'task' && e.startDate <= to && effectiveEndDate(e) >= from)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.id.localeCompare(b.id));
  const month = toISO(cursor).slice(0, 7);
  const notes = expanded.filter(e => e.kind === 'idea' && e.startDate >= month + '-01' && e.startDate <= toISO(endOfMonth(cursor)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.startDate.localeCompare(a.startDate));
  const calendarEntries = expanded.filter(e => (e.kind === 'task' || e.kind === 'idea') && e.startDate <= to && effectiveEndDate(e) >= from)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return { tasks, notes, calendarEntries };
}

export interface DashboardCashDay {
  income: number; outflow: number; plannedIncome: number; plannedOutflow: number; supported: boolean;
}

/** Aggregate originals with the ledger's existing cash/confirmation/proration rules. */
export function dashboardCashDays(entries: readonly Entry[], from: string, through: string) {
  const originals = [...new Map(entries.map(e => [e.id, e])).values()];
  const days: Record<string, DashboardCashDay> = {};
  const add = (e: Entry, date: string, amount: number, planned: boolean) => {
    const sign = cashSignOf(e);
    if (!sign || !amount) return;
    const day = days[date] ??= { income: 0, outflow: 0, plannedIncome: 0, plannedOutflow: 0, supported: true };
    if (e.money?.currency && e.money.currency !== 'KRW') { day.supported = false; return; }
    const key = planned ? sign > 0 ? 'plannedIncome' : 'plannedOutflow' : sign > 0 ? 'income' : 'outflow';
    day[key] += Math.abs(amount);
  };
  actualsIn(originals, from, through).forEach(e => add(e, e.startDate, e.money?.amountMinor ?? 0, false));
  occurrences(originals, addDaysISO(from, -1), through).forEach(o => add(o.entry, o.date, o.amountMinor, true));
  return days;
}

/** Keep the ledger's settlement boundary and expense classification; no projected occurrences. */
export function dashboardSpending(store: Pick<StoreState, 'entries' | 'ledger' | 'categories' | 'categoryBudgets' | 'annualBudgets'>, month: string) {
  const period = periodByKey(month, store.ledger.settleDay)!;
  const actuals = actualsIn(store.entries, period.start, period.end);
  const supported = actuals.every(e => !e.money?.currency || e.money.currency === 'KRW')
    && store.categoryBudgets.every(b => b.currency === 'KRW');
  const rows = withoutAnnual(budgetRows(store.categories, store.categoryBudgets, actuals, period.key, 'expense'),
    annualCategoryIds(store.annualBudgets, yearOfPeriod(period.key)));
  return { period, supported, spending: totalsOf(actuals).spending, budget: budgetSummary(rows) };
}

