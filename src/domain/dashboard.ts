import { endOfMonth, monthGrid, toISO } from './date';
import { effectiveEndDate } from './entry';
import { materialize } from './recurrence';
import { actualsIn, budgetRows, budgetSummary, totalsOf } from './ledgerStats';
import { annualCategoryIds, withoutAnnual, yearOfPeriod } from './annualBudget';
import { periodByKey } from './period';
import type { StoreState } from '../app/useStore';
import type { Entry, WeekStart } from './types';

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
  return { tasks, notes };
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

