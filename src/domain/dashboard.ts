import { addDaysISO, endOfMonth, parseDate, toISO } from './date';
import { effectiveEndDate } from './entry';
import { materialize } from './recurrence';
import type { Entry } from './types';

/** Expand the entire dashboard window, including next-month occurrences. */
export function dashboardEntries(entries: readonly Entry[], today: string) {
  const end = addDaysISO(today, 6);
  const expanded = materialize(entries, today, end);
  const tasks = expanded.filter(e => e.kind === 'task' && e.startDate <= end && effectiveEndDate(e) >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '00:00').localeCompare(b.startTime ?? '00:00') || a.id.localeCompare(b.id));
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = toISO(endOfMonth(parseDate(today)!));
  const notes = materialize(entries.filter(e => e.kind === 'idea'), monthStart, monthEnd)
    .filter(e => e.startDate >= monthStart && e.startDate <= monthEnd)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.startDate.localeCompare(a.startDate));
  return { tasks, notes };
}

