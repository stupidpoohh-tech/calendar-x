/**
 * 카드 사용 → 생활비 (P1-D, P4 마감에서 연다).
 *
 * 쓴 날 생활비 사용 · 소비 통계에 들어가고, 현금은 카드 대금 날에 나간다. 그 사이 같은 돈을 지키는 자리는
 * **카드 미결제 하나**다. 생활비 주머니는 그 몫을 "이미 다른 곳에서 빠진 지출" 로 보고 예약에서 덜어 낸다
 * (잔고에 반영된 현금 지출을 덜어 내는 것과 같은 자리). 세이브와는 사용처가 하나라 겹치지 않는다.
 *
 * 불변식
 *   1. 생활비 안에서 카드로 써도 가용 한도는 그대로다 — 쓰기 전 · 쓴 뒤 · 대금 예정 · 대금 납부 · 잔고 반영 뒤가 같다
 *   2. 생활비의 실제 사용 · 남은 생활비 · 소비 통계는 쓴 날 바뀐다
 *   3. 확인 잔고 · 예상 잔고는 쓴 날 그대로이고, 대금 날(예상 · 실제)에 줄어든다
 *   4. 초과분만 한도를 더 깎는다 — 현금 · 카드 어느 쪽으로 넘겨도 같다
 *   5. 생활비 예약 + 카드 미결제 + 세이브 남은 금액이 같은 돈을 두 번 세지 않는다
 */
import { describe, expect, it } from 'vitest';
import { budgetState, inBudget, newBudget, newReserve, pocketEligible, reserveUsageOf } from './budget';
import { newCard } from './card';
import { confirmOccurrence } from './confirm';
import { newEntry, newMoney } from './entry';
import { actualsIn, totalsOf } from './ledgerStats';
import { limitOn, projectedBalanceOn, type Reservations } from './tide';
import type { Account, Budget, Entry, MoneyFields, Reserve } from './types';

const TODAY = '2026-10-16';
const END = '2026-10-24';
const life = newCard({ id: 'life', name: '생활 카드', closeDay: 31, payDay: 25, payMonthOffset: 1 });
const pocket = newBudget({ id: 'b1', name: '10월 생활비', startDate: '2026-10-01', endDate: '2026-10-31', amountMinor: 200_000 });

const acct = (balanceMinor: number, p: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '', ...p,
});
const tx = (id: string, amountMinor: number, m: Partial<MoneyFields>, date = TODAY): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor, ...m }),
});
const cardUse = (id: string, amount: number, m: Partial<MoneyFields> = {}, date = TODAY) =>
  tx(id, amount, { flow: 'cardSpend', cardId: 'life', budgetId: 'b1', ...m }, date);
const cash = (id: string, amount: number, m: Partial<MoneyFields> = {}, date = TODAY) =>
  tx(id, amount, { budgetId: 'b1', ...m }, date);
const pay = (id: string, amount: number, date = TODAY) =>
  tx(id, amount, { flow: 'cardPayment', cardId: 'life', cardCycle: '2026-11' }, date);

function res(entries: Entry[], budgets: Budget[] = [pocket], reserves: Reserve[] = []): Reservations {
  return {
    budgets, reserves, reserveUsage: reserveUsageOf(entries),
    cards: [life], cardEntries: entries.filter((e) => !!e.money?.cardId),
  };
}
const limit = (a: Account[], entries: Entry[], extra: Partial<Reservations> = {}, d = END, today = TODAY) =>
  limitOn(a, entries, d, today, { ...res(entries), ...extra });
const state = (entries: Entry[], a: Account[] = [acct(250_000)], today = TODAY) =>
  budgetState(pocket, entries, undefined, { accounts: a, today, unsettledAfter: '2026-10-15' });

describe('등록 카드의 카드 사용을 생활비에 건다', () => {
  it('걸 수 있는 것: 등록 카드의 실제 · 예정 카드 사용. 카드가 정해지지 않은 카드 사용은 지금처럼 안 된다', () => {
    expect(inBudget(cardUse('x', 1), pocket)).toBe(true);
    expect(pocketEligible(cardUse('x', 1))).toBe(true);
    expect(inBudget(cardUse('y', 1, { cardId: null }), pocket)).toBe(false);
    expect(pocketEligible(cardUse('y', 1, { cardId: null }))).toBe(false);
  });

  it('명세 P1-D: 잔고 250,000 · 생활비 200,000 · 카드 30,000 → 실제 30,000 · 남음 170,000 · 미결제 30,000 · 가용 50,000', () => {
    const a = [acct(250_000)];
    const shoe = cardUse('shoe', 30_000);
    expect(limit(a, [])).toBe(50_000);
    const st = state([shoe]);
    expect([st.actualMinor, st.remainingMinor, st.cardMinor, st.unsettledMinor]).toEqual([30_000, 170_000, 30_000, 0]);
    expect(limit(a, [shoe])).toBe(50_000);
    // 소비 통계는 쓴 날 +30,000, 확인 · 예상 잔고는 그대로.
    expect(totalsOf(actualsIn([shoe], '2026-10-01', '2026-10-31')).spending).toBe(30_000);
    expect(projectedBalanceOn(a, [shoe], TODAY, TODAY, res([shoe]))).toBe(250_000);
  });

  it('대금 예정 · 대금 납부(잔고 밖) · 잔고 반영 뒤에도 가용이 같다 — 대금 날에 현금이 나간다', () => {
    const shoe = cardUse('shoe', 30_000);
    const planned = { ...pay('p', 30_000, '2026-11-25'), money: { ...pay('p', 30_000).money!, status: 'planned' as const } };
    const d = '2026-11-30';
    const before = limit([acct(250_000)], [shoe], {}, d);
    const withPlan = limit([acct(250_000)], [shoe, planned], {}, d);
    const paid = pay('paid', 30_000);
    const afterPay = limit([acct(250_000)], [shoe, paid], {}, d);
    const later = [acct(220_000, { asOf: '2026-10-17', checkedAt: '2026-10-17T09:00:00+09:00' })];
    const reflected = limitOn(later, [shoe, paid], d, '2026-10-17', res([shoe, paid]));
    // 11/30 에는 10월 생활비가 끝나 남은 예약(170,000)이 풀린다 — 250,000 − 카드 30,000 = 220,000. 네 시점이 같다.
    expect([before, withPlan, afterPay, reflected]).toEqual([220_000, 220_000, 220_000, 220_000]);
    // 생활비 기간 안(10/31)에서도 같다 — 예약 170,000 + 미결제 30,000.
    expect(limit([acct(250_000)], [shoe], {}, '2026-10-31')).toBe(50_000);
    expect(limit([acct(250_000)], [shoe, paid], {}, '2026-10-31')).toBe(50_000);
    // 예상 잔고: 대금 날(11/25)에 30,000 이 빠진다 — 예상이든 예정이든 한 번만.
    expect(projectedBalanceOn([acct(250_000)], [shoe], '2026-11-25', TODAY, res([shoe]))).toBe(220_000);
    expect(projectedBalanceOn([acct(250_000)], [shoe, planned], '2026-11-25', TODAY, res([shoe, planned]))).toBe(220_000);
    // 생활비 쪽 숫자는 대금과 무관하다.
    expect(state([shoe, paid]).remainingMinor).toBe(170_000);
  });

  it('잔고 기준일 앞에 쓴 카드 사용도 두 번 덜어 내지 않는다 — 현금은 아직 안 나갔다', () => {
    const old = cardUse('old', 30_000, {}, '2026-10-05');
    expect(limit([acct(250_000)], [old])).toBe(50_000);
    expect(state([old]).settledMinor).toBe(0);
  });

  it('현금과 카드를 섞어도 초과분만 한도를 더 깎는다', () => {
    const a = [acct(1_000_000)];
    const list = [cash('c', 150_000), cardUse('k', 100_000)];
    // 쓴 돈 250,000 > 예산 200,000 → 초과 50,000 만큼 가용이 준다.
    expect(limit(a, [])).toBe(800_000);
    expect(limit(a, list)).toBe(750_000);
    const allCash = [cash('c', 150_000), cash('k', 100_000)];
    expect(limit(a, allCash)).toBe(750_000);
    expect(state(list, a)).toMatchObject({ actualMinor: 250_000, overspentMinor: 50_000, cardMinor: 100_000, unsettledMinor: 150_000 });
  });

  it('끝난 생활비: 남은 예약은 풀리고, 카드 사용은 미결제로만 남는다', () => {
    const shoe = cardUse('shoe', 30_000, {}, '2026-10-20');
    const after = '2026-11-02';
    const a = [acct(250_000, { asOf: after, checkedAt: `${after}T09:00:00+09:00` })];
    // 생활비 끝 → 예약 0. 미결제 30,000 만 빠진다.
    expect(limitOn(a, [shoe], '2026-11-10', after, res([shoe]))).toBe(220_000);
  });

  it('생활비 · 세이브 · 카드 미결제가 함께 있어도 같은 돈은 한 번 — 쓰기 전과 쓴 뒤의 가용이 같다', () => {
    const trip = newReserve({ id: 'trip', name: '여행', amountMinor: 100_000 });
    const a = [acct(1_000_000)];
    const extra = (entries: Entry[]) => res(entries, [pocket], [trip]);
    const before = limitOn(a, [], END, TODAY, extra([]));
    const list = [
      cardUse('lunch', 30_000),
      tx('hotel', 40_000, { flow: 'cardSpend', cardId: 'life', reserveId: 'trip', outsidePocket: true }),
      cash('market', 20_000),
    ];
    expect(before).toBe(700_000);
    expect(limitOn(a, list, END, TODAY, extra(list))).toBe(700_000);
  });

  it('예정 카드 사용은 생활비 예정으로 남고, 확정하면 같은 주머니의 실제 사용이 된다', () => {
    const plan = newEntry('money', {
      id: 'plan', title: '장보기', startDate: '2026-10-20',
      money: newMoney({ type: 'expense', flow: 'cardSpend', cardId: 'life', budgetId: 'b1', amountMinor: 40_000 }),
    });
    expect(state([plan])).toMatchObject({ plannedMinor: 40_000, actualMinor: 0 });
    expect(limit([acct(250_000)], [plan])).toBe(50_000);
    const r = confirmOccurrence(plan, '2026-10-20', {});
    expect(r.ok && r.entry.money).toMatchObject({ flow: 'cardSpend', cardId: 'life', budgetId: 'b1', status: 'actual' });
    if (r.ok) {
      expect(state([plan, r.entry])).toMatchObject({ plannedMinor: 0, actualMinor: 40_000, cardMinor: 40_000 });
      expect(limit([acct(250_000)], [plan, r.entry])).toBe(50_000);
    }
  });
});

describe('운영 중인 P1 자료 그대로 — P4 계산이 같은 숫자를 낸다', () => {
  it('세이브 연결 · 카드가 없는 P1 문서는 카드 · 세이브 사용을 넘겨도 한도가 같다', async () => {
    const { entryFromDoc } = await import('../data/converters');
    // P1 앱이 쓴 모양: schema 2, reserveId · cardId · cardCycle 칸이 없다. 예전 카드 사용 · 대금은 카드가 정해지지 않았다.
    const p1 = (id: string, money: Record<string, unknown>, date = TODAY) => entryFromDoc(id, {
      kind: 'money', title: id, note: '', color: 'blue', tags: [], startDate: date, endDate: null, startTime: null, endTime: null,
      ymSpan: [date.slice(0, 7)], isRecurring: false, recurrence: null, task: null, schema: 2,
      money: { type: 'expense', currency: 'KRW', linkedEntryId: null, budgetId: null, debtId: null, priority: false,
        status: 'actual', flow: 'normal', categoryId: null, method: null, accountId: null, plannedRef: null, highlight: false,
        outsidePocket: false, ...money },
      createdAt: '', updatedAt: '',
    });
    const list = [
      p1('lunch', { amountMinor: 12_000, budgetId: 'b1' }),
      p1('oldcard', { amountMinor: 50_000, flow: 'cardSpend', budgetId: 'b1' }),   // P1 에서도 주머니 밖이었다
      p1('oldpay', { amountMinor: 80_000, flow: 'cardPayment' }),
      p1('rent', { amountMinor: 500_000, status: 'planned' }, '2026-10-20'),
    ];
    const save = newReserve({ id: 's', name: '비상금', amountMinor: 100_000 });
    const a = [acct(2_000_000)];
    const p1Limit = limitOn(a, list, END, TODAY, { budgets: [pocket], reserves: [save] });
    const p4Limit = limitOn(a, list, END, TODAY, {
      budgets: [pocket], reserves: [save], reserveUsage: reserveUsageOf(list), cards: [life], cardEntries: list.filter((e) => !!e.money?.cardId),
    });
    expect(p4Limit).toBe(p1Limit);
    // 2,000,000 − 대금 80,000 − 월세 500,000 − 생활비 200,000 − 비상금 100,000 (주머니 안 점심 12,000 은 예약 안)
    expect(p4Limit).toBe(1_120_000);
    expect(state(list).actualMinor).toBe(12_000);
  });
});
