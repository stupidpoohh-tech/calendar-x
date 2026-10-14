import { describe, expect, it } from 'vitest';
import { newCategory } from './category';
import { newEntry, newMoney } from './entry';
import { cashSignOf, ledgerClassOf } from './ledger';
import { actualsIn, totalsOf } from './ledgerStats';
import { scanLoanCategoryEntries, toLoanFlow, toNormalFlow } from './loanCategory';
import { limitOn } from './tide';
import type { Account, Entry, MoneyFields } from './types';

const cats = [newCategory('expense', '대출', 0, 'loan'), newCategory('expense', '식비', 1, 'food')];
const tx = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ status: 'actual', amountMinor: amount, categoryId: 'loan', ...m }) });

const entries = [
  tx('a', '2026-10-02', 500_000),
  tx('b', '2026-09-02', 500_000),
  newEntry('money', { id: 'p', title: 'p', startDate: '2026-10-25', money: newMoney({ amountMinor: 500_000, categoryId: 'loan' }) }),
  tx('pocket', '2026-10-03', 30_000, { budgetId: 'b1' }),
  tx('card', '2026-10-04', 40_000, { flow: 'cardSpend' }),
  tx('imp', '2026-08-02', 500_000, { flow: 'loanPrincipal' }),
  tx('food', '2026-10-05', 12_000, { categoryId: 'food' }),
  tx('in', '2026-10-06', 1, { type: 'income' }),
];

describe('예전 대출 카테고리 정리', () => {
  const scan = scanLoanCategoryEntries(entries, cats);

  it('지출 · 일반 유형 · 생활비 없음만 옮긴다 — 실제 · 예정 모두', () => {
    expect(scan.convert.map((e) => e.id)).toEqual(['p', 'a', 'b']);
    expect(scan.pocketLinked.map((e) => e.id)).toEqual(['pocket']);
    expect(scan.other.map((e) => e.id).sort()).toEqual(['card', 'in']);
    expect(scan.alreadyLoan).toBe(1);
  });

  it('흐름 한 칸만 바뀐다 — 현금 부호 · 카테고리 그대로, 소비에서 대금으로', () => {
    const a = entries[0]!;
    const moved = toLoanFlow(a, 'now');
    expect(moved.money).toMatchObject({ flow: 'loanPrincipal', categoryId: 'loan', amountMinor: 500_000, status: 'actual' });
    expect(cashSignOf(moved)).toBe(cashSignOf(a));
    expect(ledgerClassOf(a)).toBe('consumption');
    expect(ledgerClassOf(moved)).toBe('principal');
    const before = totalsOf(actualsIn([a], '2026-10-01', '2026-10-31'));
    const after = totalsOf(actualsIn([moved], '2026-10-01', '2026-10-31'));
    expect([before.consumption, after.consumption]).toEqual([500_000, 0]);
    expect(toNormalFlow(moved, 'later').money!.flow).toBe('normal');
  });

  it('한도는 그대로다', () => {
    const acct: Account = {
      id: 'x', name: 'x', balanceMinor: 2_000_000, currency: 'KRW', asOf: '2026-10-01',
      checkedAt: '2026-10-01T00:00:00Z', reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '',
    };
    const moved = entries.map((e) => (scan.convert.some((c) => c.id === e.id) ? toLoanFlow(e, 'now') : e));
    expect(limitOn([acct], moved, '2026-10-10', '2026-10-30')).toBe(limitOn([acct], entries, '2026-10-10', '2026-10-30'));
  });
});
