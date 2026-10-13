/**
 * 결산 집계 — 무엇을 소비로 세는가, 예산 대비, 기간 추이, 월평균, 내역.
 */
import { describe, expect, it } from 'vitest';
import { newCategory, setDefaultBudget, setPeriodBudget } from './category';
import { confirmOccurrence } from './confirm';
import { newEntry, newMoney } from './entry';
import {
  actualsIn, averagedPeriods, budgetRows, budgetSummary, byCategory, categoryTrends, groupByDay, historyItems,
  matchesQuery, periodSeries, totalsOf, UNCATEGORIZED,
} from './ledgerStats';
import { periodByKey, periodsOfYear } from './period';
import type { Entry, MoneyFields } from './types';

const tx = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}, over: Partial<Entry> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ status: 'actual', amountMinor: amount, ...m }), ...over });
const plan = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}, over: Partial<Entry> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ amountMinor: amount, ...m }), ...over });

const cats = [
  newCategory('expense', '식비', 0, 'food'),
  newCategory('expense', '카페', 1, 'cafe'),
  { ...newCategory('expense', '옛 취미', 2, 'old'), archived: true },
  newCategory('income', '급여', 0, 'salary'),
];

describe('무엇을 소비로 세는가', () => {
  const list = [
    tx('salary', '2026-09-25', 3_000_000, { type: 'income', categoryId: 'salary' }),
    tx('lunch', '2026-09-26', 12_000, { categoryId: 'food' }),
    tx('card', '2026-09-27', 50_000, { flow: 'cardSpend', categoryId: 'food' }),
    tx('cardpay', '2026-10-10', 50_000, { flow: 'cardPayment' }),
    tx('principal', '2026-10-01', 300_000, { flow: 'loanPrincipal' }),
    tx('interest', '2026-10-01', 20_000, { flow: 'loanInterest' }),
    tx('save', '2026-10-02', 100_000, { flow: 'transfer' }),
    tx('refund-in', '2026-10-03', 40_000, { type: 'income', flow: 'transfer' }),
  ];

  it('카드 사용은 쓴 날 소비, 카드 대금은 소비가 아니다', () => {
    const t = totalsOf(list);
    expect(t.consumption).toBe(62_000);
    expect(t.cardPayment).toBe(50_000);
  });

  it('대출 원금 · 이체는 소비도 수입도 아니고, 이자는 금융비용으로 따로 센다', () => {
    const t = totalsOf(list);
    expect(t.principal).toBe(300_000);
    expect(t.transferOut).toBe(100_000);
    expect(t.transferIn).toBe(40_000);
    expect(t.financeCost).toBe(20_000);
    expect(t.income).toBe(3_000_000);
    expect(t.spending).toBe(82_000);
    expect(t.repayment).toBe(300_000);
    expect(t.net).toBe(3_000_000 - 82_000 - 300_000);
  });

  it('수지 = 수입 − 지출 − 대금. 카드 대금 · 이체는 빼지 않는다(카드는 쓴 날 이미 지출)', () => {
    const t = totalsOf(list);
    expect(t.net).toBe(t.income - t.spending - t.repayment);
    expect(t.net).toBe(2_618_000);
  });

  it('예정은 세지 않는다 — 확정하지 않은 지난 예정도', () => {
    expect(totalsOf(actualsIn([...list, plan('p', '2026-09-28', 999_000)], '2026-09-01', '2026-10-31')).spending).toBe(82_000);
  });

  it('같은 문서가 두 조회에 함께 들어와도 한 번만 센다', () => {
    const one = tx('dup', '2026-09-30', 10_000);
    expect(actualsIn([one, one], '2026-09-01', '2026-09-30')).toHaveLength(1);
  });

  it('카테고리별 합계 — 지출 쪽은 소비 + 금융비용, 미분류는 따로', () => {
    const m = byCategory(list, 'expense');
    expect(m.get('food')).toBe(62_000);
    expect(m.get(UNCATEGORIZED)).toBe(20_000);
    expect(byCategory(list, 'income').get('salary')).toBe(3_000_000);
  });
});

describe('예산 대비', () => {
  // 25일 기준 '2026-10' 은 9/25 ~ 10/24 다 (날이 더 많이 든 달이 이름).
  const sep = periodByKey('2026-10', 25)!;
  const budgets = [
    setDefaultBudget('food', '2026-01', 300_000),
    setDefaultBudget('cafe', '2026-01', 50_000),
    setPeriodBudget('cafe', '2026-10', 30_000),
  ];
  const list = [
    tx('a', '2026-09-26', 120_000, { categoryId: 'food' }),
    tx('b', '2026-10-01', 45_000, { categoryId: 'cafe' }),
    tx('c', '2026-10-02', 7_000, {}),
    tx('d', '2026-10-03', 9_000, { categoryId: 'old' }),
    tx('e', '2026-10-30', 1_000_000, { categoryId: 'food' }), // 다음 기간
  ];
  const rows = budgetRows(cats, budgets, actualsIn(list, sep.start, sep.end), sep.key, 'expense');

  it('카테고리마다 예산 · 실제 · 잔여 · 초과', () => {
    const food = rows.find((r) => r.categoryId === 'food')!;
    expect(food).toMatchObject({ actual: 120_000, remaining: 180_000, over: false });
    const cafe = rows.find((r) => r.categoryId === 'cafe')!;
    expect(cafe.budget).toMatchObject({ source: 'period', amountMinor: 30_000 });
    expect(cafe).toMatchObject({ actual: 45_000, remaining: -15_000, over: true });
  });

  it('예산 없는 카테고리 · 미분류 · 보관한 카테고리의 지출도 빠지지 않는다', () => {
    expect(rows.find((r) => r.categoryId === UNCATEGORIZED)?.actual).toBe(7_000);
    expect(rows.find((r) => r.categoryId === 'old')).toMatchObject({ actual: 9_000, archived: true });
    const s = budgetSummary(rows);
    expect(s.actual).toBe(120_000 + 45_000 + 7_000 + 9_000);
    expect(s.budgeted).toBe(330_000);
    expect(s.overCount).toBe(1);
  });

  it('보관했고 이 기간에 쓴 것도 예산도 없으면 줄을 세우지 않는다', () => {
    const quiet = budgetRows(cats, [], [], sep.key, 'expense');
    expect(quiet.some((r) => r.categoryId === 'old')).toBe(false);
  });

  it('수입 카테고리 결산', () => {
    const inc = budgetRows(cats, [], [tx('s', '2026-09-25', 3_000_000, { type: 'income', categoryId: 'salary' })], sep.key, 'income');
    expect(inc.find((r) => r.categoryId === 'salary')?.actual).toBe(3_000_000);
  });
});

describe('기간 추이 · 월평균', () => {
  const periods = periodsOfYear(2026, 1);
  const list = [
    tx('j1', '2026-01-10', 100_000, { categoryId: 'food' }),
    tx('f1', '2026-02-10', 200_000, { categoryId: 'food' }),
    tx('m1', '2026-03-10', 60_000, { categoryId: 'food' }),
  ];

  it('기간마다 합계와 상태(지남 · 진행 중 · 앞으로)', () => {
    const s = periodSeries(list, periods, '2026-03-15');
    expect(s[0]!.totals.spending).toBe(100_000);
    expect(s.map((x) => x.phase).slice(0, 4)).toEqual(['past', 'past', 'current', 'future']);
  });

  it('월평균은 끝난 기간만으로 낸다 — 진행 중인 달이 평균을 끌어내리지 않는다', () => {
    const t = categoryTrends(list, periods, cats, 'expense', '2026-03-15');
    const food = t.find((x) => x.categoryId === 'food')!;
    expect(food.total).toBe(360_000);
    expect(food.averagedOver).toBe(2);
    expect(food.average).toBe(150_000);
  });

  it('끝난 기간 수는 거래가 있었는지와 무관하다 — 기록이 없는 끝난 기간은 0원으로 센다', () => {
    const moved = [
      tx('a4', '2026-04-10', 500_000, { categoryId: 'food' }),
      tx('a5', '2026-05-10', 300_000, { categoryId: 'food' }),
    ];
    const t = categoryTrends(moved, periods, cats, 'expense', '2026-07-15');
    const food = t.find((x) => x.categoryId === 'food')!;
    expect(food.averagedOver).toBe(6); // 1~6월
    expect(food.average).toBe(Math.round(800_000 / 6));
    expect(averagedPeriods(periods, '2026-07-15').filter(Boolean)).toHaveLength(6);
    expect(averagedPeriods(periods, '2026-01-15').filter(Boolean)).toHaveLength(0);
  });

  it('끝난 기간이 없으면 평균을 내지 않는다', () => {
    const t = categoryTrends(list, periods, cats, 'expense', '2026-01-15');
    expect(t.find((x) => x.categoryId === 'food')!.average).toBeNull();
  });

  it('정산 시작일을 바꾸면 같은 거래가 다른 기간에 묶인다 — 거래는 그대로다', () => {
    const on25 = periodSeries(list, periodsOfYear(2026, 25), '2026-12-31');
    expect(on25[0]!.period.start).toBe('2025-12-25');
    expect(on25[0]!.totals.spending).toBe(100_000); // 12/25~1/24: j1
    expect(on25[1]!.totals.spending).toBe(200_000); // 1/25~2/24: f1
  });
});

describe('내역', () => {
  const rent = plan('rent', '2026-01-25', 500_000, {}, {
    recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
  });
  const r = confirmOccurrence(rent, '2026-09-25', { amountMinor: 510_000 });
  const paid = r.ok ? r.entry : rent;

  it('실제 거래와 예정을 함께 담고, 확정한 회차는 예정에서 빠진다', () => {
    const items = historyItems([rent, paid, tx('x', '2026-10-01', 5_000)], '2026-09-25', '2026-10-24');
    expect(items.filter((i) => i.planned)).toHaveLength(0);
    expect(items.map((i) => i.entry.id)).toEqual(['x', 'rent~2026-09-25']);
  });

  it('확정하지 않은 회차는 예정으로 남고 하루 합계에 넣지 않는다', () => {
    const items = historyItems([rent, tx('x', '2026-10-25', 5_000)], '2026-10-25', '2026-11-24');
    expect(items.find((i) => i.planned)?.date).toBe('2026-10-25');
    const day = groupByDay(items)[0]!;
    expect(day.spending).toBe(5_000);
    expect(day.items).toHaveLength(2);
  });

  it('검색 — 내역 · 메모 · 결제수단 · 카테고리 이름 · 금액', () => {
    const e = tx('q', '2026-10-01', 12_000, { method: '신한카드', categoryId: 'food' }, { title: '점심', note: '팀 회식' });
    expect(matchesQuery(e, '점심', cats)).toBe(true);
    expect(matchesQuery(e, '회식', cats)).toBe(true);
    expect(matchesQuery(e, '신한', cats)).toBe(true);
    expect(matchesQuery(e, '식비', cats)).toBe(true);
    expect(matchesQuery(e, '12,000', cats)).toBe(true);
    expect(matchesQuery(e, '커피', cats)).toBe(false);
  });
});
