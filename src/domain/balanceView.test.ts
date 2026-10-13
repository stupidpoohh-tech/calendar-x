/**
 * P0 — 확인 잔고 · 예상 잔고 · 남은 생활비 · 생활비 외 가용을 가른다.
 *
 * 생활비는 출금이 아니라 잔고 안의 배분이다. 만드는 것만으로 잔고도 예상 잔고도 줄지 않고,
 * 가용 한도만 준다. 쓰면 남은 생활비가 줄고, 그 돈이 현금으로 나가면 예상 잔고가 준다.
 * 잔고 반영 여부만 다른 두 상황(B · C)은 같은 경제 상황이라 예상 잔고 · 가용이 같아야 한다.
 */
import { describe, expect, it } from 'vitest';
import { budgetState, newBudget, newReserve } from './budget';
import { confirmOccurrence } from './confirm';
import { newEntry, newMoney } from './entry';
import { balanceViewOn, confirmedBalance, limitOn, projectedBalanceOn } from './tide';
import type { Account, Budget, Entry, MoneyFields, Reserve } from './types';

const TODAY = '2026-10-13';
const END = '2026-10-17'; // 생활비 마지막 날 · 조회 날짜

const acct = (balanceMinor: number, p: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '', ...p,
});
const pocket = (p: Partial<Budget> = {}): Budget => newBudget({
  id: 'b1', name: '생활비', startDate: TODAY, endDate: END, amountMinor: 200_000, ...p,
});
const actual = (id: string, amountMinor: number, m: Partial<MoneyFields> = {}, date = TODAY): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor, ...m }),
});
const planned = (id: string, amountMinor: number, date: string, m: Partial<MoneyFields> = {}, over: Partial<Entry> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ type: 'expense', amountMinor, ...m }), ...over });

/** 네 숫자 한 벌. */
function view(accounts: Account[], entries: Entry[], budgets: Budget[] = [], reserves: Reserve[] = [], date = END) {
  const v = balanceViewOn(accounts, entries, date, TODAY, { budgets, reserves });
  const pockets = budgets.map((b) => budgetState(b, entries, undefined, { accounts, today: TODAY }));
  return { confirmed: v.confirmed, projected: v.projected, available: v.available, pockets };
}

describe('필수 시나리오', () => {
  it('A — 생활비 확보: 잔고는 그대로, 가용만 준다', () => {
    const v = view([acct(250_000)], [], [pocket()]);
    expect(v).toMatchObject({ confirmed: 250_000, projected: 250_000, available: 50_000 });
    expect(v.pockets[0]).toMatchObject({ remainingMinor: 200_000, actualMinor: 0 });
  });

  it('B — 생활비 40,000 지출, 아직 잔고에 미반영', () => {
    const v = view([acct(250_000)], [actual('lunch', 40_000, { budgetId: 'b1' })], [pocket()]);
    expect(v).toMatchObject({ confirmed: 250_000, projected: 210_000, available: 50_000 });
    expect(v.pockets[0]).toMatchObject({ remainingMinor: 160_000, actualMinor: 40_000, unsettledMinor: 40_000, settledMinor: 0 });
  });

  it('C — 그 지출을 반영해 잔고를 210,000 으로 갱신 — B 와 같은 예상 잔고 · 가용', () => {
    const v = view([acct(210_000, { reflectedEntryIds: ['lunch'] })], [actual('lunch', 40_000, { budgetId: 'b1' })], [pocket()]);
    expect(v).toMatchObject({ confirmed: 210_000, projected: 210_000, available: 50_000 });
    expect(v.pockets[0]).toMatchObject({ remainingMinor: 160_000, settledMinor: 40_000, unsettledMinor: 0 });
  });

  it('D — 생활비 밖 지출 30,000 (반영): 남은 생활비는 그대로, 가용만 준다', () => {
    const v = view(
      [acct(180_000, { reflectedEntryIds: ['lunch', 'taxi'] })],
      [actual('lunch', 40_000, { budgetId: 'b1' }), actual('taxi', 30_000)],
      [pocket()],
    );
    expect(v).toMatchObject({ confirmed: 180_000, projected: 180_000, available: 20_000 });
    expect(v.pockets[0]!.remainingMinor).toBe(160_000);
  });

  it('E — 생활비가 끝나면 예약이 풀린다. 반영 안 된 출금은 계속 센다', () => {
    const ended = pocket({ startDate: '2026-10-06', endDate: '2026-10-10' });
    const spent = actual('lunch', 40_000, { budgetId: 'b1' }, '2026-10-08');
    // 반영됨: 잔고 210,000 → 가용 210,000
    const done = view([acct(210_000)], [spent], [ended]);
    expect(done).toMatchObject({ confirmed: 210_000, projected: 210_000, available: 210_000 });
    // 아직 반영 전(잔고를 10/7 에 250,000 으로 적어 둠): 출금은 여전히 빠진다
    const pending = view([acct(250_000, { asOf: '2026-10-07', checkedAt: '2026-10-07T09:00:00+09:00' })], [spent], [ended]);
    expect(pending).toMatchObject({ confirmed: 250_000, projected: 210_000, available: 210_000 });
  });

  it('F — 생활비 초과: 초과분을 두 번 빼지 않는다', () => {
    const v = view([acct(30_000, { reflectedEntryIds: ['big'] })], [actual('big', 220_000, { budgetId: 'b1' })], [pocket()]);
    expect(v).toMatchObject({ confirmed: 30_000, projected: 30_000, available: 30_000 });
    expect(v.pockets[0]).toMatchObject({ remainingMinor: 0, overspentMinor: 20_000 });
  });
});

describe('생활비는 잔고를 건드리지 않는다', () => {
  it('설정 전후 확인 잔고 · 예상 잔고 불변', () => {
    const accounts = [acct(250_000)];
    const entries = [planned('rent', 100_000, '2026-10-15')];
    const before = view(accounts, entries);
    const after = view(accounts, entries, [pocket()], [newReserve({ id: 'r1', amountMinor: 30_000 })]);
    expect(after.confirmed).toBe(before.confirmed);
    expect(after.projected).toBe(before.projected);
    expect(before.available - after.available).toBe(230_000);
    expect(confirmedBalance(accounts)).toBe(250_000);
  });

  it('실제 지출 전후 남은 생활비 · 예정은 쓴 돈이 아니다', () => {
    const p = planned('groceries', 30_000, '2026-10-15', { budgetId: 'b1' });
    const s = budgetState(pocket(), [actual('lunch', 40_000, { budgetId: 'b1' }), p]);
    expect(s).toMatchObject({ actualMinor: 40_000, plannedMinor: 30_000, remainingMinor: 160_000, plannedOverMinor: 0 });
    // 예정 30,000 은 15일에 현금으로 빠진다 — 그 날 이후 예상 잔고에 들어간다.
    expect(projectedBalanceOn([acct(250_000)], [p], '2026-10-14', TODAY)).toBe(250_000);
    expect(projectedBalanceOn([acct(250_000)], [p], END, TODAY)).toBe(220_000);
    // 가용은 생활비 몫 안에서 세므로 그대로 50,000.
    expect(limitOn([acct(250_000)], [p], END, TODAY, { budgets: [pocket()] })).toBe(50_000);
  });

  it('시작 전 · 진행 중 · 끝난 뒤', () => {
    const later = pocket({ startDate: '2026-10-20', endDate: '2026-10-25' });
    const a = [acct(250_000)];
    expect(limitOn(a, [], END, TODAY, { budgets: [later] })).toBe(250_000); // 시작 전 날짜에는 잡지 않는다
    expect(limitOn(a, [], '2026-10-22', TODAY, { budgets: [later] })).toBe(50_000);
    expect(projectedBalanceOn(a, [], '2026-10-22', TODAY)).toBe(250_000);
    const ended = pocket({ startDate: '2026-10-01', endDate: '2026-10-12' });
    expect(limitOn(a, [], END, TODAY, { budgets: [ended] })).toBe(250_000);
  });

  it('기간 중 금액을 고치면 가용만 바뀐다', () => {
    const e = [actual('lunch', 40_000, { budgetId: 'b1' })];
    const a = [acct(250_000)];
    const v1 = view(a, e, [pocket()]);
    const v2 = view(a, e, [pocket({ amountMinor: 300_000 })]);
    expect(v2.projected).toBe(v1.projected);
    expect(v1.available - v2.available).toBe(100_000);
    expect(v2.pockets[0]!.remainingMinor).toBe(260_000);
  });

  it('생활비를 지워도 거래는 남고, 그 지출은 일반 지출로 돌아간다', () => {
    const e = [actual('lunch', 40_000, { budgetId: 'b1' })];
    const v = view([acct(250_000)], e, []);
    expect(e[0]!.money?.budgetId).toBe('b1');
    expect(v).toMatchObject({ projected: 210_000, available: 210_000 });
  });

  it('생활비 여러 개가 겹쳐도 각자 자기 몫만 잡는다', () => {
    const v = view([acct(250_000)], [actual('x', 10_000, { budgetId: 'b2' })], [
      pocket({ amountMinor: 100_000 }),
      pocket({ id: 'b2', name: '외식', amountMinor: 100_000 }),
    ]);
    expect(v).toMatchObject({ projected: 240_000, available: 50_000 });
    expect(v.pockets.map((p) => p.remainingMinor)).toEqual([100_000, 90_000]);
  });

  it('세이브와 생활비를 함께 두어도 잔고는 그대로', () => {
    const v = view([acct(250_000)], [], [pocket()], [newReserve({ id: 'r1', amountMinor: 30_000 })]);
    expect(v).toMatchObject({ confirmed: 250_000, projected: 250_000, available: 20_000 });
  });
});

describe('현금 흐름 규칙은 그대로', () => {
  it('예정 확정 · 취소 — 같은 금액이면 예상 잔고가 같다', () => {
    const plan = planned('rent', 100_000, '2026-10-15');
    const a = [acct(250_000)];
    expect(projectedBalanceOn(a, [plan], END, TODAY)).toBe(150_000);
    const r = confirmOccurrence(plan, '2026-10-15', { date: '2026-10-14' });
    if (!r.ok) throw new Error(r.reason);
    expect(projectedBalanceOn(a, [plan, r.entry], END, TODAY)).toBe(150_000); // 확정
    expect(projectedBalanceOn(a, [plan], END, TODAY)).toBe(150_000); // 취소 = 실제 거래 삭제
  });

  it('반복 회차를 확정하면 한 번만 센다 — 예정 달과 실제 달이 달라도', () => {
    const rent = planned('rent', 100_000, '2026-09-30', {}, {
      recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
    });
    const a = [acct(500_000, { asOf: '2026-10-13' })];
    // 10/30 회차를 10/13(오늘) 에 냈다.
    const r = confirmOccurrence(rent, '2026-10-30', { date: TODAY });
    if (!r.ok) throw new Error(r.reason);
    expect(projectedBalanceOn(a, [rent], '2026-10-31', TODAY)).toBe(400_000);
    expect(projectedBalanceOn(a, [rent, r.entry], '2026-10-31', TODAY)).toBe(400_000);
  });

  it('카드 사용은 출금이 아니고, 카드 대금이 출금이다', () => {
    const a = [acct(250_000)];
    const e = [actual('tv', 200_000, { flow: 'cardSpend' }), planned('card', 200_000, '2026-10-16', { flow: 'cardPayment' })];
    expect(projectedBalanceOn(a, e, '2026-10-15', TODAY)).toBe(250_000);
    expect(projectedBalanceOn(a, e, END, TODAY)).toBe(50_000);
  });

  it('카드 사용은 생활비에 걸어도 주머니가 세지 않는다 — 대금과 이중으로 빠지지 않게', () => {
    const e = [actual('tv', 50_000, { flow: 'cardSpend', budgetId: 'b1' })];
    const v = view([acct(250_000)], e, [pocket()]);
    expect(v.pockets[0]!.actualMinor).toBe(0);
    expect(v).toMatchObject({ projected: 250_000, available: 50_000 });
  });

  it('여러 계좌의 잔고를 합치고, 반영 여부는 계좌별로 본다', () => {
    const a = [
      acct(100_000),
      acct(150_000, { id: 'a2', name: '부계좌', reflectedEntryIds: ['x'] }),
    ];
    const e = [actual('x', 20_000, { accountId: 'a2' }), actual('y', 10_000, { accountId: 'a1' })];
    expect(confirmedBalance(a)).toBe(250_000);
    // x 는 a2 에 이미 반영, y 는 아직 — y 만 빠진다.
    expect(projectedBalanceOn(a, e, END, TODAY)).toBe(240_000);
  });

  it('조회 날짜와 오늘이 다르면 그 날까지의 예정만 더한다', () => {
    const a = [acct(250_000)];
    const e = [planned('pay', 1_000_000, '2026-10-20', { type: 'income' }), planned('rent', 100_000, '2026-10-25')];
    expect(projectedBalanceOn(a, e, TODAY, TODAY)).toBe(250_000);
    expect(projectedBalanceOn(a, e, '2026-10-21', TODAY)).toBe(1_250_000);
    expect(projectedBalanceOn(a, e, '2026-10-31', TODAY)).toBe(1_150_000);
  });

  it('지난 기준일이면 그 사이의 예정도 아직 잔고 밖으로 센다 — 한도와 같은 경계', () => {
    const a = [acct(250_000, { asOf: '2026-10-10', checkedAt: '2026-10-10T09:00:00+09:00' })];
    const e = [planned('gas', 50_000, '2026-10-11')];
    expect(projectedBalanceOn(a, e, TODAY, TODAY)).toBe(200_000);
    expect(limitOn(a, e, TODAY, TODAY)).toBe(200_000);
  });
});
