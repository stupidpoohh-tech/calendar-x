/** 입력 리스트(`LedgerBatchInput`)의 줄 — 모양 · 검사 · 거래로 바꾸기. */
import { isValidDate } from '../domain/date';
import { newEntry, newMoney, withDerived } from '../domain/entry';
import { parseAmountToMinor } from '../domain/money';
import type { Entry } from '../domain/types';
import { flowPickPatch, type FlowPick } from './ledgerFlows';

export interface BatchRow {
  key: string;
  date: string;
  pick: FlowPick;
  amount: string;
  title: string;
  categoryId: string | null;
}

let seq = 0;
export const blankRow = (date: string, pick: FlowPick = 'expense'): BatchRow => ({
  key: `r${++seq}`, date, pick, amount: '', title: '', categoryId: null,
});

export const filled = (r: BatchRow) => r.amount.trim() !== '' || r.title.trim() !== '';
export const amountOf = (r: BatchRow) => {
  const v = parseAmountToMinor(r.amount);
  return v !== null && v > 0 ? v : null;
};
export const problemOf = (r: BatchRow): string | null => {
  if (!filled(r)) return null;
  if (!isValidDate(r.date)) return '날짜';
  if (amountOf(r) === null) return '금액';
  return null;
};

/** 채운 줄을 거래로. 오늘까지는 실제 거래, 앞날은 예정. */
export function rowsToEntries(rows: readonly BatchRow[], todayISO: string): Entry[] {
  return rows.filter(filled).map((r) => {
    const flow = flowPickPatch(r.pick);
    return withDerived(newEntry('money', {
      startDate: r.date,
      title: r.title.trim(),
      money: newMoney({
        ...flow,
        status: r.date <= todayISO ? 'actual' : 'planned',
        amountMinor: amountOf(r) ?? 0,
        categoryId: r.pick === 'loan' ? null : r.categoryId,
      }),
    }));
  });
}
