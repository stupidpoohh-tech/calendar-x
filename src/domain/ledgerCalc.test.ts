/**
 * 예정과 실제 거래가 함께 있을 때의 계산 (L2).
 *
 * 기준: 같은 돈은 한 번만 센다. 확정한 회차는 실제 거래가 대신 서고, 실제 거래는 잔고에
 * 들어 있는지로 센다. 실제 거래가 없으면 지금까지와 숫자가 하나도 다르지 않다.
 */
import { describe, expect, it } from 'vitest';
import { budgetState, reservedOn, spendingIn } from './budget';
import { confirmationOf, confirmOccurrence, isConfirmed, pocketChoiceFor } from './confirm';
import { newEntry, newMoney } from './entry';
import { confirmedEntryId, ledgerClassOf } from './ledger';
import { expandEntry, materialize } from './recurrence';
import {
  calcScopeOf, entriesOn, headlineLimit, horizonOf, limitOn, netOf, settle,
  TideInputError, upcomingInHorizon,
} from './tide';
import type { Account, Budget, Entry, MoneyFields } from './types';

const TODAY = '2026-10-12';

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 3_000_000, currency: 'KRW',
  asOf: TODAY, checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [],
  order: 0, createdAt: '', updatedAt: '', ...over,
});

const plan = (id: string, startDate: string, m: Partial<MoneyFields> = {}, over: Partial<Entry> = {}): Entry =>
  newEntry('money', { id, title: id, startDate, money: newMoney({ amountMinor: 100_000, ...m }), ...over });

const monthly = (id: string, startDate: string, m: Partial<MoneyFields> = {}): Entry =>
  plan(id, startDate, m, { recurrence: { freq: 'monthly', interval: 1, until: null, count: null } });

const actual = (id: string, date: string, m: Partial<MoneyFields> = {}): Entry =>
  plan(id, date, { status: 'actual', ...m });

const confirm = (p: Entry, date: string, patch = {}): Entry => {
  const r = confirmOccurrence(p, date, patch);
  if (!r.ok) throw new Error(r.reason);
  return r.entry;
};

const salary = monthly('salary', '2026-01-25', { type: 'income', amountMinor: 3_000_000 });
const rent = monthly('rent', '2026-01-20', { amountMinor: 500_000 });

describe('기존 자료 — 숫자가 바뀌지 않는다', () => {
  // 원장 필드가 없던 시절의 메모리 모양. 읽기 계층을 거치지 않은 테스트 자료와 같다.
  const bare = (e: Entry): Entry => {
    const { status: _s, flow: _f, categoryId: _c, method: _m, accountId: _a, plannedRef: _p, ...money } = e.money!;
    return { ...e, money: money as MoneyFields };
  };
  const list = [salary, rent, plan('phone', '2026-10-15', { amountMinor: 80_000 }),
    plan('trip', '2026-10-20', { amountMinor: 300_000 }, { endDate: '2026-10-24' })];

  it('한도 · 머리 숫자 · 목록 · 정산이 원장 필드 유무와 무관하다', () => {
    const accts = [account({ asOf: '2026-10-08', checkedAt: '2026-10-08T09:00:00+09:00' })];
    const old = list.map(bare);
    for (const d of ['2026-10-12', '2026-10-19', '2026-10-24', '2026-11-30']) {
      expect(limitOn(accts, list, d, TODAY)).toBe(limitOn(accts, old, d, TODAY));
    }
    expect(headlineLimit(accts, list, TODAY)).toBe(headlineLimit(accts, old, TODAY));
    expect(netOf(upcomingInHorizon(accts, list, TODAY))).toBe(netOf(upcomingInHorizon(accts, old, TODAY)));
    const a = settle(accts, list, 2_900_000, TODAY);
    const b = settle(accts, old, 2_900_000, TODAY);
    expect([a.diff, a.complete, a.passed.length]).toEqual([b.diff, b.complete, b.passed.length]);
  });

  it('화면용 발생분은 여전히 거절한다', () => {
    const shown = materialize([rent], '2026-10-01', '2026-10-31');
    expect(() => limitOn([account()], shown, '2026-10-31', TODAY)).toThrow(TideInputError);
  });
});

describe('반복 회차 확정', () => {
  it('확정한 회차는 한 번만 센다 — 예정 대신 실제 거래가 선다', () => {
    const accts = [account({ asOf: '2026-10-12' })];
    const p = monthly('rent', '2026-01-20', { amountMinor: 500_000 });
    const before = limitOn(accts, [p], '2026-10-31', TODAY);
    const paid = confirm(p, '2026-10-20');
    expect(limitOn(accts, [p, paid], '2026-10-31', TODAY)).toBe(before);
  });

  it('실제 금액이 다르면 실제 금액을 센다', () => {
    const accts = [account()];
    const p = monthly('rent', '2026-01-20', { amountMinor: 500_000 });
    const paid = confirm(p, '2026-10-20', { amountMinor: 520_000 });
    expect(limitOn(accts, [p, paid], '2026-10-31', TODAY))
      .toBe(limitOn(accts, [p], '2026-10-31', TODAY) - 20_000);
  });

  it('다른 회차와 원본 규칙은 그대로다', () => {
    const p = monthly('rent', '2026-01-20', { amountMinor: 500_000 });
    const snapshot = JSON.stringify(p);
    const paid = confirm(p, '2026-10-20');
    expect(JSON.stringify(p)).toBe(snapshot);
    const accts = [account()];
    // 11월 회차는 여전히 예정으로 센다.
    expect(limitOn(accts, [p, paid], '2026-11-30', TODAY) - limitOn(accts, [p, paid], '2026-10-31', TODAY))
      .toBe(-500_000);
    const shown = materialize([p, paid], '2026-10-01', '2026-11-30');
    expect(shown.filter((e) => e.virtual).map((e) => e.startDate)).toEqual(['2026-11-20']);
    expect(shown.some((e) => e.id === paid.id)).toBe(true);
  });

  it('확정을 취소하면(실제 거래를 지우면) 예정으로 돌아온다', () => {
    const p = monthly('rent', '2026-01-20', { amountMinor: 500_000 });
    const paid = confirm(p, '2026-10-20');
    const accts = [account()];
    expect(isConfirmed([p, paid], 'rent', '2026-10-20')).toBe(true);
    expect(confirmationOf([p, paid], 'rent', '2026-10-20')?.id).toBe(paid.id);
    expect(isConfirmed([p], 'rent', '2026-10-20')).toBe(false);
    expect(limitOn(accts, [p], '2026-10-31', TODAY)).toBe(3_000_000 - 500_000);
    expect(materialize([p], '2026-10-01', '2026-10-31').map((e) => e.startDate)).toEqual(['2026-10-20']);
  });

  it('같은 회차는 언제나 같은 id 로 확정된다 — 두 번 눌러도 한 건이다', () => {
    const p = monthly('rent', '2026-01-20');
    expect(confirm(p, '2026-10-20').id).toBe(confirm(p, '2026-10-20', { amountMinor: 1 }).id);
    expect(confirm(p, '2026-10-20').id).toBe(confirmedEntryId('rent', '2026-10-20'));
  });

  it('회차의 달과 실제로 낸 달이 달라도 연결이 끊기지 않는다', () => {
    const p = monthly('rent', '2026-01-25', { amountMinor: 500_000 });
    // 9/25 회차를 10/2 에 냈다.
    const paid = confirm(p, '2026-09-25', { date: '2026-10-02' });
    expect(paid.ymSpan).toEqual(['2026-09', '2026-10']);
    const shown = materialize([p, paid], '2026-09-01', '2026-09-30');
    expect(shown.filter((e) => e.virtual)).toEqual([]);
    // 잔고 기준일 9/20 → 9/25 회차는 예정으로 세지 않고, 10/2 실제 거래를 센다.
    const accts = [account({ asOf: '2026-09-20', checkedAt: '2026-09-20T09:00:00+09:00' })];
    const withPaid = limitOn(accts, [p, paid], '2026-10-24', TODAY);
    const planOnly = limitOn(accts, [p], '2026-10-24', TODAY);
    expect(withPaid).toBe(planOnly);
  });

  it('반복 전개와 같은 날짜 규칙을 쓴다 — 말일 당김', () => {
    const p = monthly('card', '2026-01-31', { amountMinor: 10_000 });
    const feb = expandEntry(p, '2026-02-01', '2026-02-28')[0]!.startDate;
    expect(feb).toBe('2026-02-28');
    expect(confirmOccurrence(p, '2026-02-28').ok).toBe(true);
    expect(confirmOccurrence(p, '2026-02-27')).toEqual({ ok: false, reason: 'not-occurrence' });
  });
});

describe('확정하지 않는 것', () => {
  it('기간 예정 · legacy 생활비 · 저축 · 가용은 확정하지 않는다', () => {
    expect(confirmOccurrence(plan('s', '2026-10-01', {}, { endDate: '2026-10-31' }), '2026-10-01'))
      .toEqual({ ok: false, reason: 'span' });
    for (const type of ['living', 'save', 'free'] as const) {
      expect(confirmOccurrence(plan('l', '2026-10-01', { type }), '2026-10-01'))
        .toEqual({ ok: false, reason: 'legacy-unconfirmable' });
    }
  });

  it('legacy 상환 · 우선은 사용자가 종류와 흐름을 고르기 전에는 만들지 않는다', () => {
    const p = plan('loan', '2026-10-15', { type: 'repay' });
    expect(confirmOccurrence(p, '2026-10-15')).toEqual({ ok: false, reason: 'legacy-needs-choice' });
    expect(confirmOccurrence(p, '2026-10-15', { type: 'expense' }).ok).toBe(false);
    const r = confirmOccurrence(p, '2026-10-15', { type: 'expense', flow: 'loanPrincipal' });
    expect(r.ok && r.entry.money).toMatchObject({ type: 'expense', flow: 'loanPrincipal', status: 'actual' });
  });

  it('화면용 발생분 · 이미 실제인 거래 · 회차가 아닌 날 · 맞지 않는 흐름', () => {
    const p = monthly('rent', '2026-01-20');
    const occ = materialize([p], '2026-10-01', '2026-10-31')[0]!;
    expect(confirmOccurrence(occ, '2026-10-20')).toEqual({ ok: false, reason: 'virtual' });
    expect(confirmOccurrence(actual('x', '2026-10-01'), '2026-10-01')).toEqual({ ok: false, reason: 'already-actual' });
    expect(confirmOccurrence(p, '2026-10-21')).toEqual({ ok: false, reason: 'not-occurrence' });
    expect(confirmOccurrence(salary, '2026-10-25', { flow: 'cardSpend' })).toEqual({ ok: false, reason: 'invalid-flow' });
    expect(confirmOccurrence(newEntry('task'), '2026-10-01')).toEqual({ ok: false, reason: 'not-money' });
    expect(confirmOccurrence(p, '2026-10-20', { amountMinor: 1.5 })).toEqual({ ok: false, reason: 'invalid-amount' });
  });

  it('실제 거래는 반복 · 기간 없이 만들어진다', () => {
    const e = confirm(monthly('rent', '2026-01-20'), '2026-10-20');
    expect(e.recurrence).toBeNull();
    expect(e.endDate).toBeNull();
    expect(e.money?.plannedRef).toEqual({ entryId: 'rent', date: '2026-10-20' });
  });
});

describe('잔고 기준일과 같은 날의 실제 거래', () => {
  const coffee = actual('coffee', TODAY, { amountMinor: 5_000 });

  it('고르지 않았으면 아직 잔고 밖이다 — 한도에서 뺀다', () => {
    const accts = [account()];
    expect(limitOn(accts, [coffee], TODAY, TODAY)).toBe(3_000_000 - 5_000);
  });

  it('잔고에 들어 있다고 골랐으면 또 빼지 않는다', () => {
    const accts = [account({ reflectedEntryIds: ['coffee'] })];
    expect(limitOn(accts, [coffee], TODAY, TODAY)).toBe(3_000_000);
  });

  it('기준일 앞의 실제 거래는 날짜만으로 잔고에 들어 있다', () => {
    const accts = [account()];
    expect(limitOn(accts, [actual('old', '2026-10-11', { amountMinor: 5_000 })], TODAY, TODAY)).toBe(3_000_000);
  });

  it('머리 숫자와 남은 목록이 같은 실제 거래를 센다', () => {
    const accts = [account()];
    const list = [salary, coffee];
    const h = horizonOf(list, TODAY);
    const head = headlineLimit(accts, list, TODAY);
    expect(head).toBe(3_000_000 + netOf(upcomingInHorizon(accts, list, TODAY, h)));
    expect(upcomingInHorizon(accts, list, TODAY, h).some((o) => o.entry.id === 'coffee')).toBe(true);
  });
});

describe('정산 — 잔고를 다시 적을 때', () => {
  it('앞 잔고 밖이던 실제 거래가 새 잔고에 들어간다 — 차액에 섞이지 않는다', () => {
    const accts = [account({ asOf: '2026-10-08', checkedAt: '2026-10-08T09:00:00+09:00' })];
    const spent = actual('dinner', '2026-10-10', { amountMinor: 40_000 });
    const r = settle(accts, [spent], 3_000_000 - 40_000, TODAY);
    expect(r.complete).toBe(true);
    expect(r.diff).toBe(0);
    expect(r.passed.map((o) => o.entry.id)).toEqual(['dinner']);
  });

  it('확정된 예정은 정산에서도 한 번만 센다', () => {
    const accts = [account({ asOf: '2026-10-08', checkedAt: '2026-10-08T09:00:00+09:00' })];
    const p = plan('fee', '2026-10-10', { amountMinor: 30_000 });
    const paid = confirm(p, '2026-10-10', { amountMinor: 32_000 });
    const r = settle(accts, [p, paid], 3_000_000 - 32_000, TODAY);
    expect(r.diff).toBe(0);
    expect(r.passed.map((o) => o.entry.id)).toEqual([paid.id]);
  });

  it('오늘 거래는 새 잔고에 들어 있다고 고른 것만 흡수한다', () => {
    const accts = [account({ asOf: '2026-10-08', checkedAt: '2026-10-08T09:00:00+09:00' })];
    const coffee = actual('coffee', TODAY, { amountMinor: 5_000 });
    const notYet = settle(accts, [coffee], 3_000_000, TODAY);
    expect(notYet.diff).toBe(0);
    const next = [account({ reflectedEntryIds: ['coffee'] })];
    const included = settle(accts, [coffee], 2_995_000, TODAY, null, next);
    expect(included.diff).toBe(0);
    // 정산 뒤에도 한도가 흔들리지 않는다.
    expect(limitOn(next.map((a) => ({ ...a, balanceMinor: 2_995_000 })), [coffee], TODAY, TODAY))
      .toBe(limitOn(accts.map((a) => ({ ...a, asOf: TODAY })), [coffee], TODAY, TODAY));
  });
});

describe('카드 사용과 카드 대금', () => {
  it('카드 사용은 한도를 움직이지 않고, 대금이 한 번 뺀다', () => {
    const accts = [account()];
    const use = actual('use', '2026-10-13', { amountMinor: 70_000, flow: 'cardSpend' });
    const pay = plan('pay', '2026-10-14', { amountMinor: 70_000, flow: 'cardPayment' });
    expect(limitOn(accts, [use], '2026-10-31', TODAY)).toBe(3_000_000);
    expect(limitOn(accts, [use, pay], '2026-10-31', TODAY)).toBe(3_000_000 - 70_000);
    expect(ledgerClassOf(use)).toBe('consumption');
    expect(ledgerClassOf(pay)).toBe('cardPayment');
  });

  it('카드 사용은 생활비 주머니에 걸리지 않는다 — 대금에서 또 빠지지 않게', () => {
    const b: Budget = { id: 'b1', name: '10월 생활비', startDate: '2026-10-01', endDate: '2026-10-31', amountMinor: 700_000, currency: 'KRW', createdAt: '', updatedAt: '' };
    const use = actual('use', '2026-10-13', { amountMinor: 70_000, flow: 'cardSpend', budgetId: 'b1' });
    expect(spendingIn(b, [use])).toEqual([]);
    const accts = [account()];
    expect(limitOn(accts, [use], '2026-10-31', TODAY, { budgets: [b] })).toBe(3_000_000 - 700_000);
  });

  it('확정할 때 카드 사용이면 주머니 연결을 떼어 낸다', () => {
    const p = plan('lunch', '2026-10-13', { amountMinor: 12_000, budgetId: 'b1' });
    expect(confirm(p, '2026-10-13', { flow: 'cardSpend' }).money?.budgetId).toBeNull();
  });
});

describe('대출 원금과 이자', () => {
  it('둘 다 현금이 나가고, 통계 자리는 다르다', () => {
    const accts = [account()];
    const principal = actual('p', '2026-10-13', { amountMinor: 300_000, flow: 'loanPrincipal' });
    const interest = actual('i', '2026-10-13', { amountMinor: 20_000, flow: 'loanInterest' });
    expect(limitOn(accts, [principal, interest], '2026-10-31', TODAY)).toBe(3_000_000 - 320_000);
    expect(ledgerClassOf(principal)).toBe('principal');
    expect(ledgerClassOf(interest)).toBe('financeCost');
  });

  it('입금 쪽 대출 흐름은 확정되지 않는다', () => {
    expect(confirmOccurrence(salary, '2026-10-25', { flow: 'loanInterest' }))
      .toEqual({ ok: false, reason: 'invalid-flow' });
  });
});

describe('생활비 주머니', () => {
  const b: Budget = {
    id: 'b1', name: '10월 생활비', startDate: '2026-10-01', endDate: '2026-10-31',
    amountMinor: 700_000, currency: 'KRW', createdAt: '', updatedAt: '',
  };

  it('확정한 예정과 실제 거래를 두 번 세지 않는다', () => {
    const p = plan('lunch', '2026-10-13', { amountMinor: 12_000, budgetId: 'b1' });
    const paid = confirm(p, '2026-10-13', { amountMinor: 15_000 });
    expect(spendingIn(b, [p, paid]).map((e) => e.id)).toEqual([paid.id]);
    expect(budgetState(b, [p, paid]).spentMinor).toBe(15_000);
  });

  it('주머니 안에서 쓰는 한 한도는 움직이지 않는다 — 실제 거래도 같다', () => {
    const accts = [account()];
    const base = limitOn(accts, [], '2026-10-31', TODAY, { budgets: [b] });
    const spent = actual('lunch', '2026-10-13', { amountMinor: 12_000, budgetId: 'b1' });
    expect(limitOn(accts, [spent], '2026-10-31', TODAY, { budgets: [b] })).toBe(base);
  });

  it('잔고에 이미 들어간 실제 거래는 주머니 몫에서 뺀다 — 이중 예약 방지', () => {
    const spent = actual('lunch', TODAY, { amountMinor: 12_000, budgetId: 'b1' });
    const out = [account()];
    const inBal = [account({ reflectedEntryIds: ['lunch'], balanceMinor: 3_000_000 - 12_000 })];
    expect(reservedOn([b], [], [spent], '2026-10-31', '2026-10-11', out)).toBe(700_000);
    expect(reservedOn([b], [], [spent], '2026-10-31', '2026-10-11', inBal)).toBe(688_000);
    expect(limitOn(out, [spent], '2026-10-31', TODAY, { budgets: [b] }))
      .toBe(limitOn(inBal, [spent], '2026-10-31', TODAY, { budgets: [b] }));
  });

  it('그 날을 품는 주머니가 하나면 기본으로 고르고, 여럿이면 고르지 않는다', () => {
    expect(pocketChoiceFor('2026-10-13', [b]).selected?.id).toBe('b1');
    const b2 = { ...b, id: 'b2', name: '여행' };
    const two = pocketChoiceFor('2026-10-13', [b, b2]);
    expect(two.selected).toBeNull();
    expect(two.candidates.map((x) => x.id)).toEqual(['b1', 'b2']);
    expect(pocketChoiceFor('2026-11-01', [b]).selected).toBeNull();
  });

  it('입금으로 확정하면 주머니 · 대출 연결을 지운다', () => {
    const p = plan('refund', '2026-10-13', { budgetId: 'b1', debtId: 'd1' });
    expect(confirm(p, '2026-10-13', { type: 'income' }).money).toMatchObject({ budgetId: null, debtId: null });
  });
});

describe('다음 입금', () => {
  it('일찍 들어온 급여를 확정하면 다음 입금은 그 다음 회차다', () => {
    expect(horizonOf([salary], TODAY).nextIncome).toBe('2026-10-25');
    const early = confirm(salary, '2026-10-25', { date: '2026-10-23' });
    expect(horizonOf([salary, early], TODAY).nextIncome).toBe('2026-11-25');
  });
});

describe('계좌가 여럿일 때', () => {
  const a = account({ id: 'a', asOf: '2026-10-01', checkedAt: '2026-10-01T09:00:00+09:00', balanceMinor: 1_000_000 });
  const b = account({ id: 'b', asOf: '2026-10-10', checkedAt: '2026-10-10T09:00:00+09:00', balanceMinor: 2_000_000 });

  it('계좌를 모르는 거래가 기준일 사이에 있으면 금액을 내지 않는다', () => {
    const tx = actual('tx', '2026-10-05', { amountMinor: 50_000 });
    const scope = calcScopeOf([a, b], [tx]);
    expect(scope.ok).toBe(false);
    expect(!scope.ok && scope.reason).toBe('unassigned');
  });

  it('계좌를 적으면 그 계좌의 기준일로 가른다', () => {
    const toA = actual('tx', '2026-10-05', { amountMinor: 50_000, accountId: 'a' });
    const toB = actual('tx', '2026-10-05', { amountMinor: 50_000, accountId: 'b' });
    expect(calcScopeOf([a, b], [toA]).ok).toBe(true);
    expect(limitOn([a, b], [toA], TODAY, TODAY)).toBe(3_000_000 - 50_000);
    expect(limitOn([a, b], [toB], TODAY, TODAY)).toBe(3_000_000);
  });

  it('정산도 판정할 수 없는 거래가 있으면 차액을 확정하지 않는다', () => {
    const same = [{ ...a, asOf: '2026-10-01' }, { ...b, asOf: '2026-10-01', checkedAt: '2026-10-01T10:00:00+09:00' }];
    const tx = actual('tx', '2026-10-05', { amountMinor: 50_000 });
    // 한 계좌만 오늘로 다시 적으면, 그 뒤 모양에서는 9/5 거래의 계좌를 가를 수 없다.
    const next = [{ ...same[0]!, asOf: TODAY }, same[1]!];
    const r = settle(same, [tx], 2_950_000, TODAY, null, next);
    expect(r.complete).toBe(false);
    expect(r.reason).toBe('unassigned');
    expect(r.detail).toEqual(['tx']);
  });

  it('카드 사용처럼 현금이 움직이지 않는 거래는 막지 않는다', () => {
    const use = actual('use', '2026-10-05', { amountMinor: 50_000, flow: 'cardSpend' });
    expect(calcScopeOf([a, b], [use]).ok).toBe(true);
  });
});

describe('하루 순변동', () => {
  it('확정된 회차 대신 그 날의 실제 거래를 담는다', () => {
    const p = plan('fee', '2026-10-13', { amountMinor: 30_000 });
    const paid = confirm(p, '2026-10-13', { amountMinor: 32_000 });
    expect(netOf(entriesOn([p], '2026-10-13'))).toBe(-30_000);
    expect(netOf(entriesOn([p, paid], '2026-10-13'))).toBe(-32_000);
  });
});
