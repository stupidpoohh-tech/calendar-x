import { describe, expect, it } from 'vitest';
import { budgetState, inAnyBudget, reservedOn } from './budget';
import { headlineLimit, limitOn, settle, totalIn, totalOut, unsettledAfter, upcomingInHorizon, horizonOf } from './calc';
import { type Entry, type State } from './types';
import { limitOn as mainLimit, settle as mainSettle } from '../../../domain/tide';
import type { Account, Budget as MainBudget, Entry as MainEntry, Reserve as MainReserve } from '../../../domain/types';
import { newEntry } from '../../../domain/entry';

const today = '2026-09-23';
const budget = { id: 'b', name: '생활비', amount: 700_000, start: '2026-09-01', end: '2026-09-30' };
const spend = (amount: number, date = today): Entry => ({
  id: 'e', name: '점심', amount, kind: 'expense', schedule: { type: 'once', date }, budgetId: 'b',
});
const make = (entries: Entry[] = []): State => ({
  balance: { amount: 3_000_000, checkedAt: '2026-09-23T00:00:00Z' },
  entries, budgets: [budget], reserves: [],
});

describe('/tide 생활비·세이브', () => {
  it.each([0, 12_000, 700_000, 720_000])('사용액 %i: 예산 안은 한도 유지, 초과만 추가 차감', (spent) => {
    const s = make(spent ? [spend(spent)] : []);
    expect(headlineLimit(s, today)).toBe(3_000_000 - Math.max(700_000, spent));
    expect(budgetState(budget, s.entries).remaining).toBe(Math.max(0, 700_000 - spent));
  });
  it('세이브는 잔고를 바꾸지 않고 카드·오늘·미래 셀 한도를 함께 낮춘다', () => {
    const s = { ...make([spend(12_000)]), reserves: [{ id: 'r', name: '비상금', amount: 200_000 }] };
    expect(headlineLimit(s, today)).toBe(2_100_000);
    expect(limitOn(s, today, today)).toBe(2_100_000);
    expect(limitOn(s, '2026-10-10', today)).toBe(2_100_000);
    expect(s.balance.amount).toBe(3_000_000);
  });
  it('지난 사용분을 잔고에 반영해도 한도가 유지된다', () => {
    const before = make([spend(12_000, '2026-09-22')]);
    before.balance.checkedAt = '2026-09-21T00:00:00Z';
    const result = settle(before, 2_988_000, new Date('2026-09-23T00:00:00Z'));
    expect(result.diff).toBe(0);
    const after = { ...before, balance: { amount: 2_988_000, checkedAt: '2026-09-23T00:00:00Z' } };
    expect(headlineLimit(after, today)).toBe(headlineLimit(before, today));
  });
  it('한도 구성 합계가 카드와 맞으며, 연결 지출은 일반 예정에 중복 표시하지 않는다', () => {
    const s = make([spend(12_000), { ...spend(50_000), id: 'other', budgetId: undefined }]);
    const upcoming = upcomingInHorizon(s, today);
    const reserved = reservedOn(s, horizonOf(s.entries, today).end, unsettledAfter(s, today));
    expect(s.balance.amount + totalIn(upcoming) - totalOut(upcoming) - reserved.total).toBe(headlineLimit(s, today));
    expect(upcoming.map((o) => o.entry.id)).toEqual(['other']);
  });
  it('예산 삭제 후 지출은 남아서 일반 지출로 계산된다', () => {
    const s = { ...make([spend(12_000)]), budgets: [] };
    expect(headlineLimit(s, today)).toBe(2_988_000);
    expect(s.entries).toHaveLength(1);
  });
  it('예산 기간·금액을 수정하면 연결 여부와 한도가 다시 계산된다', () => {
    const s = make([spend(12_000)]);
    expect(headlineLimit({ ...s, budgets: [{ ...budget, amount: 10_000 }] }, today)).toBe(2_988_000);
    expect(headlineLimit({ ...s, budgets: [{ ...budget, start: '2026-09-24' }] }, today)).toBe(2_288_000);
  });
  it('기간 밖·반복·입금은 예산으로 숨기지 않는다', () => {
    for (const e of [
      spend(10_000, '2026-10-01'),
      { ...spend(10_000), schedule: { type: 'every' as const, days: 7, anchor: today } },
      { ...spend(10_000), kind: 'income' as const },
    ]) expect(inAnyBudget(e, [budget])).toBe(false);
  });
  it('기존 기간 지출은 자동으로 새 예산이 되지 않는다', () => {
    const s = { ...make(), budgets: [], entries: [{ ...spend(100_000), budgetId: undefined, schedule: { type: 'span' as const, start: today, end: '2026-09-24' } }] };
    expect(headlineLimit(s, today)).toBe(2_900_000);
  });
  it.each([0, 12_000, 700_000, 720_000])('본앱과 같은 입력의 한도·정산이 같다: %i', (amount) => {
    const s = make(amount ? [spend(amount)] : []);
    const accounts = [{ id: 'a', balanceMinor: s.balance.amount, asOf: today, checkedAt: s.balance.checkedAt, currency: 'KRW' }] as Account[];
    const entries = s.entries.map((e) => newEntry('money', { id: e.id, startDate: today, money: { type: 'expense', amountMinor: e.amount, currency: 'KRW', budgetId: 'b', linkedEntryId: null, debtId: null, priority: false } })) as MainEntry[];
    const budgets = [{ id: 'b', name: budget.name, amountMinor: budget.amount, startDate: budget.start, endDate: budget.end, currency: 'KRW' }] as MainBudget[];
    const reserves: MainReserve[] = [];
    expect(limitOn(s, '2026-09-30', today)).toBe(mainLimit(accounts, entries, '2026-09-30', today, { budgets, reserves }));
    expect(settle(s, 3_000_000, new Date('2026-09-23T00:00:00Z')).diff).toBe(mainSettle(accounts, entries, 3_000_000, today).diff);
  });
});

