/**
 * Financial Core P2 — 연간 카테고리 예산.
 *
 * 연간 예산 · 월별 배분은 계획이다. 실제 사용은 원장의 소비 기준으로 세고, 잔고 · 예상 잔고 · 가용 한도 ·
 * 생활비 · 세이브 계산에는 들어가지 않는다.
 */
import { describe, expect, it } from 'vitest';
import {
  allocatedTotal, annualBudgetFor, annualBudgetProblem, annualCategoryIds, annualRows, annualSummary,
  canChangeCycle, monthRange, newAnnualBudget, unallocatedOf, withoutAnnual, yearOfPeriod, yearRange,
} from './annualBudget';
import { newBudget, newReserve, reservedOn } from './budget';
import { defaultCategories, setDefaultBudget, setPeriodBudget } from './category';
import { confirmOccurrence } from './confirm';
import { newEntry, newMoney, setRecurrence } from './entry';
import { actualsIn, budgetRows, budgetSummary } from './ledgerStats';
import { periodByKey } from './period';
import { balanceViewOn, confirmedBalance, headlineLimit, projectedBalanceOn } from './tide';
import type { Account, Entry, MoneyFields } from './types';

const BEAUTY = 'beauty';
const TRAVEL = 'travel';
const CATS = [
  ...defaultCategories(''),
  { id: BEAUTY, kind: 'expense' as const, name: '미용비', order: 20, archived: false, createdAt: '', updatedAt: '' },
  { id: TRAVEL, kind: 'expense' as const, name: '여행비', order: 21, archived: false, createdAt: '', updatedAt: '' },
];

const spend = (id: string, date: string, amountMinor: number, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date,
  money: newMoney({ status: 'actual', type: 'expense', amountMinor, categoryId: BEAUTY, ...m }),
});
const plan = (id: string, date: string, amountMinor: number, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ type: 'expense', amountMinor, categoryId: BEAUTY, ...m }),
});

describe('B · C — 연간 예산과 월별 배분', () => {
  it('B — 600,000 · 4월 400,000 · 10월 200,000: 합 600,000, 나머지 달은 배분 없음', () => {
    const b = newAnnualBudget(BEAUTY, 2027, 600_000, { '04': 400_000, '10': 200_000 });
    expect(b.id).toBe('beauty~2027');
    expect(allocatedTotal(b)).toBe(600_000);
    expect(unallocatedOf(b)).toBe(0);
    expect(annualBudgetProblem(b)).toBeNull();
    const row = annualRows(CATS, [b], [], 2027)[0]!;
    expect(row.months.filter((m) => m.allocation !== null).map((m) => [m.month, m.allocation]))
      .toEqual([['04', 400_000], ['10', 200_000]]);
    expect(row.months.filter((m) => m.allocation === null)).toHaveLength(10);
  });

  it('B — 예산을 만드는 것만으로 거래가 생기지 않는다', () => {
    const entries: Entry[] = [];
    const b = newAnnualBudget(BEAUTY, 2027, 600_000, { '04': 400_000, '10': 200_000 });
    const row = annualRows(CATS, [b], entries, 2027)[0]!;
    expect(entries).toEqual([]);
    expect(row).toMatchObject({ actual: 0, planned: 0, remaining: 600_000 });
  });

  it('C — 일부 배분: 연간 600,000 · 배분 400,000 · 미배분 200,000', () => {
    const b = newAnnualBudget(BEAUTY, 2027, 600_000, { '04': 400_000 });
    const row = annualRows(CATS, [b], [], 2027)[0]!;
    expect(row).toMatchObject({ allocated: 400_000, unallocated: 200_000 });
  });

  it('배분이 없어도 연간 예산만으로 저장할 수 있다 — 미배분이 전부다', () => {
    const b = newAnnualBudget(BEAUTY, 2027, 600_000);
    expect(annualBudgetProblem(b)).toBeNull();
    expect(unallocatedOf(b)).toBe(600_000);
  });

  it('배분 합이 연간 예산을 넘거나, 배분 · 금액 · 연도가 틀리면 저장하지 않는다', () => {
    expect(annualBudgetProblem(newAnnualBudget(BEAUTY, 2027, 600_000, { '04': 400_000, '10': 300_000 }))).toBe('over-allocated');
    expect(annualBudgetProblem({ year: 2027, amountMinor: -1, monthAllocations: {} })).toBe('amount');
    expect(annualBudgetProblem({ year: 2027, amountMinor: 1.5, monthAllocations: {} })).toBe('amount');
    expect(annualBudgetProblem({ year: 2027, amountMinor: 100, monthAllocations: { '04': 1.5 } })).toBe('allocation');
    expect(annualBudgetProblem({ year: 2027, amountMinor: 100, monthAllocations: { '13': 1 } as never })).toBe('allocation');
    expect(annualBudgetProblem({ year: 1999, amountMinor: 100, monthAllocations: {} })).toBe('year');
  });

  it('배분의 0 · 빈 칸은 "배분 없음" 으로 치운다', () => {
    expect(newAnnualBudget(BEAUTY, 2027, 600_000, { '04': 0, '05': 100 }).monthAllocations).toEqual({ '05': 100 });
  });
});

describe('D — 실제 지출', () => {
  const b = newAnnualBudget(BEAUTY, 2027, 600_000, { '04': 400_000, '10': 200_000 });

  it('실제 380,000 → 남음 220,000 · 사용률 약 63% · 4월 계획 대비 20,000 남음', () => {
    const entries = [spend('cut', '2027-04-10', 300_000), spend('dye', '2027-04-20', 80_000)];
    const row = annualRows(CATS, [b], entries, 2027)[0]!;
    expect(row).toMatchObject({ actual: 380_000, remaining: 220_000, over: false });
    expect(Math.round((row.actual / row.budget.amountMinor) * 100)).toBe(63);
    const apr = row.months.find((m) => m.month === '04')!;
    expect(apr).toMatchObject({ allocation: 400_000, actual: 380_000 });
    expect(apr.allocation! - apr.actual).toBe(20_000);
  });

  it('소비 기준만 센다 — 카드 사용은 넣고, 대출 원금 · 이체 · 카드 대금 · 다른 카테고리 · 수입은 빼고', () => {
    const entries = [
      spend('cut', '2027-04-10', 100_000),
      spend('card', '2027-04-11', 50_000, { flow: 'cardSpend' }),
      spend('loan', '2027-04-12', 70_000, { flow: 'loanPrincipal' }),
      spend('xfer', '2027-04-13', 30_000, { flow: 'transfer' }),
      spend('cardpay', '2027-04-14', 90_000, { flow: 'cardPayment' }),
      spend('other', '2027-04-15', 40_000, { categoryId: TRAVEL }),
      spend('refund', '2027-04-16', 10_000, { type: 'income' }),
    ];
    expect(annualRows(CATS, [b], entries, 2027)[0]!.actual).toBe(150_000);
  });

  it('예정은 실제와 따로 — 반복 예정은 그 해 안으로 펼치고, 확정한 회차는 실제가 대신 센다', () => {
    const monthly = setRecurrence(plan('salon', '2027-10-05', 50_000), { freq: 'monthly', interval: 1, until: null, count: null });
    const once = plan('wedding', '2027-11-20', 100_000);
    const confirmed = confirmOccurrence(monthly, '2027-10-05', { date: '2027-10-06', amountMinor: 55_000 });
    if (!confirmed.ok) throw new Error('confirm failed');
    const entries = [monthly, once, confirmed.entry];
    const row = annualRows(CATS, [b], entries, 2027)[0]!;
    // 10월은 확정(55,000 실제), 11 · 12월 예정 50,000 씩 + 11/20 100,000
    expect(row.actual).toBe(55_000);
    expect(row.planned).toBe(200_000);
    expect(row.months.find((m) => m.month === '10')).toMatchObject({ actual: 55_000, planned: 0 });
    expect(row.months.find((m) => m.month === '11')).toMatchObject({ actual: 0, planned: 150_000 });
  });

  it('초과하면 over · 남음이 음수다', () => {
    const row = annualRows(CATS, [b], [spend('big', '2027-04-10', 700_000)], 2027)[0]!;
    expect(row).toMatchObject({ remaining: -100_000, over: true });
    expect(annualSummary([row])).toMatchObject({ budgeted: 600_000, actual: 700_000, overCount: 1 });
  });

  it('같은 거래가 두 번 들어와도 한 번만 센다', () => {
    const e = spend('cut', '2027-04-10', 100_000);
    expect(annualRows(CATS, [b], [e, e], 2027)[0]!.actual).toBe(100_000);
  });
});

describe('E — 연도 경계', () => {
  const y26 = newAnnualBudget(BEAUTY, 2026, 300_000);
  const y27 = newAnnualBudget(BEAUTY, 2027, 600_000);
  const entries = [spend('dec31', '2026-12-31', 10_000), spend('jan1', '2027-01-01', 20_000)];

  it('12/31 은 2026년, 1/1 은 2027년 — 두 해의 예산은 따로다', () => {
    expect(annualRows(CATS, [y26, y27], entries, 2026).map((r) => [r.budget.year, r.actual])).toEqual([[2026, 10_000]]);
    expect(annualRows(CATS, [y26, y27], entries, 2027).map((r) => [r.budget.year, r.actual])).toEqual([[2027, 20_000]]);
  });

  it('2027년 예산을 고쳐도 2026년 예산 · 실제는 그대로다', () => {
    const before = annualRows(CATS, [y26, y27], entries, 2026);
    const edited = { ...y27, amountMinor: 900_000, monthAllocations: { '04': 500_000 } };
    expect(annualRows(CATS, [y26, edited], entries, 2026)).toEqual(before);
  });

  it('달 범위는 달력 월이다 — 2월 말일 · 12월', () => {
    expect(yearRange(2027)).toEqual({ start: '2027-01-01', end: '2027-12-31' });
    expect(monthRange(2028, '02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(monthRange(2027, '12')).toEqual({ start: '2027-12-01', end: '2027-12-31' });
  });

  it('정산 기간(시작일 25일)과 경계가 다르다 — 정산 기간 이름의 연도로 고르고, 숫자는 달력 연도로 센다', () => {
    // 25일 기준 '2027-01' = 2026/12/25 ~ 2027/1/24. 이름이 2027년이라 2027년 연간 예산을 본다.
    const p = periodByKey('2027-01', 25)!;
    expect([p.start, p.end]).toEqual(['2026-12-25', '2027-01-24']);
    expect(yearOfPeriod(p.key)).toBe(2027);
    expect(annualCategoryIds([y27], yearOfPeriod(p.key)).has(BEAUTY)).toBe(true);
    // 그 정산 기간에 든 12/31 지출은 2026년 연간 예산에서 센다 — 2027년 연간 사용에 넣지 않는다.
    expect(actualsIn(entries, p.start, p.end).map((e) => e.id)).toEqual(['dec31', 'jan1']);
    expect(annualRows(CATS, [y27], entries, 2027)[0]!.actual).toBe(20_000);
  });

  it('주기를 바꾸는 것은 올해와 앞날만', () => {
    expect(canChangeCycle(2026, '2026-10-14')).toBe(true);
    expect(canChangeCycle(2027, '2026-10-14')).toBe(true);
    expect(canChangeCycle(2025, '2026-10-14')).toBe(false);
  });
});

describe('A · 7 — 월간 예산 호환 · 이중 집계 없음', () => {
  const monthly = [
    setDefaultBudget('default-food', '2026-01', 400_000),
    setDefaultBudget(BEAUTY, '2026-01', 50_000),
    setPeriodBudget(BEAUTY, '2027-04', 80_000),
  ];
  const entries = [
    spend('lunch', '2027-04-05', 100_000, { categoryId: 'default-food' }),
    spend('cut', '2027-04-10', 380_000),
  ];
  const period = periodByKey('2027-04', 1)!;
  const rowsOf = () => budgetRows(CATS, monthly, actualsIn(entries, period.start, period.end), period.key, 'expense');

  it('연간 예산이 없으면 월간 줄 · 요약이 예전과 같다', () => {
    const rows = rowsOf();
    expect(withoutAnnual(rows, annualCategoryIds([], 2027))).toEqual(rows);
    expect(budgetSummary(rows)).toMatchObject({ budgeted: 480_000, actualInBudgeted: 480_000 });
  });

  it('그 해 연간으로 관리하면 월간 줄 · 요약에서 빠진다 — 월간 문서는 그대로 남는다', () => {
    const annual = [newAnnualBudget(BEAUTY, 2027, 600_000)];
    const monthlyRows = withoutAnnual(rowsOf(), annualCategoryIds(annual, 2027));
    expect(monthlyRows.map((r) => r.categoryId)).not.toContain(BEAUTY);
    expect(budgetSummary(monthlyRows)).toMatchObject({ budgeted: 400_000, actualInBudgeted: 100_000 });
    expect(monthly).toHaveLength(3);
    // 연간 쪽에서만 센다.
    expect(annualSummary(annualRows(CATS, annual, entries, 2027))).toMatchObject({ budgeted: 600_000, actual: 380_000 });
  });

  it('다른 해의 연간 예산은 이 해의 월간 줄에 닿지 않는다', () => {
    const annual = [newAnnualBudget(BEAUTY, 2028, 600_000)];
    expect(withoutAnnual(rowsOf(), annualCategoryIds(annual, 2027))).toEqual(rowsOf());
  });

  it('연간 예산을 지우면(월간으로 되돌리면) 그 해 월간 예산이 그대로 다시 보인다', () => {
    expect(withoutAnnual(rowsOf(), annualCategoryIds([], 2027)).find((r) => r.categoryId === BEAUTY)?.budget.amountMinor).toBe(80_000);
  });

  it('찾기 — 그 해 그 카테고리 한 장', () => {
    const a = [newAnnualBudget(BEAUTY, 2027, 1), newAnnualBudget(BEAUTY, 2028, 2)];
    expect(annualBudgetFor(a, BEAUTY, 2028)?.amountMinor).toBe(2);
    expect(annualBudgetFor(a, TRAVEL, 2028)).toBeNull();
  });
});

describe('G — 계산 회귀: 연간 예산은 금액 계산에 들어가지 않는다', () => {
  const TODAY = '2027-04-01';
  const acct: Account = {
    id: 'a1', name: '주계좌', balanceMinor: 2_000_000, currency: 'KRW', asOf: TODAY,
    checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '',
  };
  const entries = [plan('rent', '2027-04-25', 500_000, { categoryId: null }), plan('salon', '2027-04-10', 100_000)];
  const budgets = [newBudget({ id: 'p1', startDate: TODAY, endDate: '2027-04-30', amountMinor: 300_000 })];
  const reserves = [newReserve({ id: 's1', amountMinor: 200_000 })];
  const res = { budgets, reserves };
  const snapshot = () => ({
    confirmed: confirmedBalance([acct]),
    projected: projectedBalanceOn([acct], entries, '2027-04-30', TODAY),
    view: balanceViewOn([acct], entries, '2027-04-30', TODAY, res),
    headline: headlineLimit([acct], entries, TODAY, res),
    reserved: reservedOn(budgets, reserves, entries, '2027-04-30', '2027-03-31', [acct], TODAY),
  });

  it('연간 예산 · 배분을 계산해도 잔고 · 예상 잔고 · 가용 · 생활비 · 세이브가 그대로이고 거래도 그대로다', () => {
    const before = snapshot();
    const copy = structuredClone(entries);
    annualRows(CATS, [newAnnualBudget(BEAUTY, 2027, 600_000, { '04': 400_000 })], entries, 2027);
    expect(entries).toEqual(copy);
    expect(snapshot()).toEqual(before);
    // 1,000,000 이 아니라 2,000,000 − 월세 500,000 − 미용 예정 100,000 = 1,400,000. 연간 600,000 은 빠지지 않는다.
    expect(before.projected).toBe(1_400_000);
  });
});
