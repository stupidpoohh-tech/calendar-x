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
  /** 결제수단 — 지출 줄에서 고른 신용카드(P4). null 이면 현금 · 계좌. 수입 · 대출 줄에는 걸지 않는다. */
  cardId: string | null;
}

let seq = 0;
export const blankRow = (date: string, pick: FlowPick = 'expense'): BatchRow => ({
  key: `r${++seq}`, date, pick, amount: '', title: '', categoryId: null, cardId: null,
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

/**
 * 흐름을 바꾼 줄. 카테고리는 흐름마다 따로이고(지출 카테고리를 단 채 수입이 되면 결산이 엉뚱한 쪽에 선다),
 * 카드는 지출에만 건다 — 수입 · 대출로 바꾸면 둘 다 뗀다.
 */
export function withPick(r: BatchRow, pick: FlowPick): BatchRow {
  if (pick === r.pick) return r;
  return { ...r, pick, categoryId: null, cardId: pick === 'expense' ? r.cardId : null };
}

/**
 * 채운 줄을 거래로. 오늘까지는 실제 거래, 앞날은 예정.
 *
 * 카드를 고른 지출은 카드 사용(`cardSpend` + `cardId`)이고, 고르지 않은 지출은 지금까지와 같은 일반 지출이다.
 * 예정 카드 사용은 확정해야 미결제가 된다 — 거래 창과 같다.
 */
export function rowsToEntries(rows: readonly BatchRow[], todayISO: string): Entry[] {
  return rows.filter(filled).map((r) => {
    const card = r.pick === 'expense' ? r.cardId : null;
    const flow = card ? { ...flowPickPatch('expense'), flow: 'cardSpend' as const, cardId: card } : flowPickPatch(r.pick);
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
