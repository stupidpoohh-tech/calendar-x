/**
 * Financial Core P4 — 신용카드 사용 · 청구 회차 · 납부 · 미결제.
 *
 * 카드를 쓴 날 소비가 생기고, 대금을 내는 날 현금이 나간다. 그 사이의 미결제는 가용 한도에서 미리 빠지되,
 * 같은 돈은 어느 시점에도 한 번만 빠진다 — 쓰기 전 · 쓴 뒤 · 예정 대금을 적은 뒤 · 실제 대금을 적은 뒤 ·
 * 잔고에 반영한 뒤가 모두 한 줄로 이어진다.
 */
import { describe, expect, it } from 'vitest';
import { entryFromDoc, entryToDoc } from '../data/converters';
import { newReserve, reserveRemaining, reserveUsageOf } from './budget';
import {
  cardProblem, cardState, cycleByKey, cycleOfUse, defaultPaymentCycle, describeCycle, newCard,
} from './card';
import { confirmOccurrence } from './confirm';
import { newEntry, newMoney } from './entry';
import { actualsIn, totalsOf } from './ledgerStats';
import {
  balanceViewOn, cardDueEstimates, cardHoldOn, confirmedBalance, limitOn, projectedBalanceOn,
  type Reservations,
} from './tide';
import type { Account, Card, Entry, MoneyFields, Reserve } from './types';

const TODAY = '2026-10-16';
const END = '2026-10-24';

/** 매월 말일 마감 · 다음 달 25일 결제. 9월 사용 → 10/25, 10월 사용 → 11/25. */
const life = newCard({ id: 'life', name: '생활 카드', closeDay: 31, payDay: 25, payMonthOffset: 1, accountId: 'a1' });
/** 13일 마감 · 다음 달 1일 결제. */
const early = newCard({ id: 'early', name: '1일 카드', closeDay: 13, payDay: 1, payMonthOffset: 1 });

const acct = (balanceMinor: number, p: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '', ...p,
});
const use = (id: string, amountMinor: number, date: string, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date,
  money: newMoney({ status: 'actual', type: 'expense', flow: 'cardSpend', cardId: 'life', amountMinor, ...m }),
});
const pay = (id: string, amountMinor: number, date: string, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date,
  money: newMoney({ status: 'actual', type: 'expense', flow: 'cardPayment', cardId: 'life', amountMinor, ...m }),
});
const planPay = (id: string, amountMinor: number, date: string, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date,
  money: newMoney({ type: 'expense', flow: 'cardPayment', cardId: 'life', amountMinor, ...m }),
});
const save = (id: string, amountMinor: number, p: Partial<Reserve> = {}) => newReserve({ id, name: id, amountMinor, ...p });

/** 계산이 받는 모양 그대로 — 계산 창 목록(`entries`)과 카드 거래 전량(`cardEntries`)이 같은 원본에서 온다. */
function calc(entries: Entry[], extra: Partial<Reservations> = {}, cards: Card[] = [life, early]): Reservations {
  const cardEntries = entries.filter((e) => !!e.money?.cardId);
  return { cards, cardEntries, reserves: [], reserveUsage: reserveUsageOf(entries), ...extra };
}
const limit = (accounts: Account[], entries: Entry[], extra: Partial<Reservations> = {}, d = END) =>
  limitOn(accounts, entries, d, TODAY, calc(entries, extra));
const spending = (entries: Entry[]) => totalsOf(actualsIn(entries, '2026-01-01', '2026-12-31')).spending;

describe('청구 회차', () => {
  it('말일 마감 · 다음 달 25일 — 쓴 날에 따라 결제일이 정해진다', () => {
    expect(cycleOfUse(life, '2026-09-30')).toMatchObject({ key: '2026-10', start: '2026-09-01', close: '2026-09-30', payDate: '2026-10-25' });
    expect(cycleOfUse(life, '2026-10-01')).toMatchObject({ key: '2026-11', close: '2026-10-31', payDate: '2026-11-25' });
    expect(cycleOfUse(life, '2027-01-31')).toMatchObject({ key: '2027-02', payDate: '2027-02-25' });
    // 2월은 28일이 말일이다.
    expect(cycleOfUse(life, '2027-02-28')).toMatchObject({ key: '2027-03', close: '2027-02-28' });
  });

  it('13일 마감 · 다음 달 1일 — 13일까지 쓴 것과 14일부터 쓴 것이 다른 회차다 (F)', () => {
    expect(cycleOfUse(early, '2026-10-13')).toMatchObject({ key: '2026-11', start: '2026-09-14', close: '2026-10-13', payDate: '2026-11-01' });
    expect(cycleOfUse(early, '2026-10-14')).toMatchObject({ key: '2026-12', start: '2026-10-14', payDate: '2026-12-01' });
    expect(cycleByKey(early, '2026-12')).toEqual(cycleOfUse(early, '2026-10-14'));
  });

  it('그 달 결제는 결제일이 마감일보다 뒤일 때만 — 아니면 다음 달로 본다', () => {
    const same = newCard({ id: 's', name: 's', closeDay: 5, payDay: 20, payMonthOffset: 0 });
    expect(cycleOfUse(same, '2026-10-03')).toMatchObject({ key: '2026-10', payDate: '2026-10-20' });
    expect(cardProblem({ ...same, payDay: 5 })).toMatch(/결제일이 마감일보다 뒤/);
    expect(cardProblem({ ...same, name: ' ' })).toMatch(/이름/);
    expect(cardProblem(life)).toBeNull();
    expect(describeCycle(life)).toBe('매월 말일 마감 · 다음 달 25일 결제');
  });
});

describe('A · 카드 사용 — 소비는 늘고 현금은 그대로, 미결제가 는다', () => {
  const a = [acct(1_000_000)];
  const shoe = use('shoe', 100_000, '2026-10-10');

  it('잔고 · 예상 잔고 그대로, 소비 +100,000, 미결제 +100,000, 가용 −100,000', () => {
    expect(confirmedBalance(a)).toBe(1_000_000);
    expect(projectedBalanceOn(a, [shoe], TODAY, TODAY, calc([shoe]))).toBe(1_000_000);
    expect(spending([shoe])).toBe(100_000);
    const st = cardState(life, [shoe], TODAY);
    expect(st.outstandingMinor).toBe(100_000);
    expect(st.cycles.map((c) => [c.key, c.billedMinor, c.closed])).toEqual([['2026-11', 100_000, false]]);
    expect(limit(a, [])).toBe(1_000_000);
    expect(limit(a, [shoe])).toBe(900_000);
  });

  it('예상 잔고는 결제일(11/25)에 대금을 뺀다 — 예상임을 따로 내놓는다', () => {
    expect(projectedBalanceOn(a, [shoe], '2026-11-24', TODAY, calc([shoe]))).toBe(1_000_000);
    expect(projectedBalanceOn(a, [shoe], '2026-11-25', TODAY, calc([shoe]))).toBe(900_000);
    expect(cardDueEstimates(a, [shoe], TODAY, calc([shoe]))).toEqual([
      { cardId: 'life', cycle: '2026-11', date: '2026-11-25', amountMinor: 100_000 },
    ]);
  });

  it('카드 정보를 주지 않은 계산(P4 이전)은 예전과 같은 숫자다', () => {
    expect(limitOn(a, [shoe], END, TODAY)).toBe(1_000_000);
  });

  it('카드가 정해지지 않은 예전 카드 사용 · 예정 카드 사용은 미결제가 아니다', () => {
    const legacy = use('old', 50_000, '2026-10-10', { cardId: null });
    const later = { ...use('plan', 70_000, '2026-10-20'), money: { ...use('plan', 70_000, '2026-10-20').money!, status: 'planned' as const } };
    expect(cardState(life, [legacy, later], TODAY).outstandingMinor).toBe(0);
    expect(limit(a, [legacy, later])).toBe(1_000_000);
  });
});

describe('B · 카드 대금 — 미결제는 줄고 현금이 나간다, 소비는 늘지 않는다', () => {
  const a = [acct(1_000_000)];
  const shoe = use('shoe', 100_000, '2026-10-10');
  const paid = pay('paid', 100_000, TODAY, { cardCycle: '2026-11' });

  it('미결제 0, 현금 −100,000(잔고 밖 실제 거래), 소비 그대로 100,000', () => {
    const list = [shoe, paid];
    expect(cardState(life, list, TODAY).outstandingMinor).toBe(0);
    expect(projectedBalanceOn(a, list, TODAY, TODAY, calc(list))).toBe(900_000);
    expect(spending(list)).toBe(100_000);
    expect(totalsOf(actualsIn(list, '2026-01-01', '2026-12-31')).cardPayment).toBe(100_000);
    expect(limit(a, list)).toBe(900_000);
    expect(cardDueEstimates(a, list, TODAY, calc(list))).toEqual([]);
  });
});

describe('C · 미결제 보호 — 세이브와 겹치지 않는다', () => {
  it('잔고 1,000,000 · 보호 세이브 200,000 · 미결제 300,000 → 가용 500,000', () => {
    const list = [use('x', 300_000, '2026-10-05')];
    expect(limit([acct(1_000_000)], list, { reserves: [save('s', 200_000)] })).toBe(500_000);
  });

  it('잔고 보기: 예상 잔고 − 확보(세이브 + 카드 미결제) = 가용', () => {
    const list = [use('x', 300_000, '2026-10-05')];
    const res = calc(list, { reserves: [save('s', 200_000)] });
    const v = balanceViewOn([acct(1_000_000)], list, END, TODAY, res);
    expect(v).toMatchObject({ projected: 1_000_000, available: 500_000, held: 500_000 });
    expect(cardHoldOn([acct(1_000_000)], list, END, TODAY, res)).toBe(300_000);
  });
});

describe('D · 납부 전후 · 잔고 갱신 전후 — 같은 돈은 한 번만 빠진다', () => {
  const shoe = use('shoe', 300_000, '2026-09-20'); // 9월 사용 → 10/25 결제
  const day = '2026-10-31';

  it('대금을 적기 전 · 예정으로 적은 뒤 · 실제로 낸 뒤 · 잔고에 반영한 뒤가 모두 같다', () => {
    const before = limit([acct(1_000_000)], [shoe], {}, day);
    const planned = planPay('p', 300_000, '2026-10-25', { cardCycle: '2026-10' });
    const withPlan = limit([acct(1_000_000)], [shoe, planned], {}, day);
    const paid = pay('paid', 300_000, '2026-10-25', { cardCycle: '2026-10' });
    // 실제로 낸 뒤(아직 잔고 밖). 예정은 지웠다 — 실제 거래가 대신한다.
    const afterPaid = limit([acct(1_000_000)], [shoe, paid], {}, day);
    // 10/26 에 잔고를 다시 적음 — 대금이 이미 빠진 700,000. 10/25 대금은 기준일 앞이라 잔고 안이다.
    const later = [acct(700_000, { asOf: '2026-10-26', checkedAt: '2026-10-26T09:00:00+09:00' })];
    const reflected = limitOn(later, [shoe, paid], day, '2026-10-26', calc([shoe, paid]));
    expect([before, withPlan, afterPaid, reflected]).toEqual([700_000, 700_000, 700_000, 700_000]);
  });

  it('예정 대금이 남은 금액보다 크면 예정을, 작으면 실제 빚을 따른다 — max(R, P)', () => {
    const big = planPay('p', 400_000, '2026-10-25', { cardCycle: '2026-10' });
    const small = planPay('q', 100_000, '2026-10-25', { cardCycle: '2026-10' });
    expect(limit([acct(1_000_000)], [shoe, big], {}, day)).toBe(600_000);
    expect(limit([acct(1_000_000)], [shoe, small], {}, day)).toBe(700_000);
    // 예상 잔고: 작은 예정이면 예정 100,000 + 나머지 예상 200,000 이 10/25 에 함께 빠진다.
    expect(projectedBalanceOn([acct(1_000_000)], [shoe, small], day, TODAY, calc([shoe, small]))).toBe(700_000);
    expect(cardDueEstimates([acct(1_000_000)], [shoe, small], TODAY, calc([shoe, small])))
      .toEqual([{ cardId: 'life', cycle: '2026-10', date: '2026-10-25', amountMinor: 200_000 }]);
  });

  it('결제일 전날까지의 가용도 미결제를 이미 뺀다 — 결제일 뒤로 미루어 늘지 않는다', () => {
    expect(limit([acct(1_000_000)], [shoe], {}, '2026-10-20')).toBe(700_000);
    expect(limit([acct(1_000_000)], [shoe], {}, '2026-11-30')).toBe(700_000);
  });

  it('매월 반복 예정 대금을 카드에 걸면 회차마다 그 달을 갚는 예정으로 센다', () => {
    const monthly = newEntry('money', {
      id: 'm', title: '카드값', startDate: '2026-08-25',
      recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
      money: newMoney({ type: 'expense', flow: 'cardPayment', cardId: 'life', amountMinor: 250_000 }),
    });
    // 10/25 예정 250,000 이 흐름에 잡히고, 남은 50,000 만 보호로 남는다 → 합 300,000.
    expect(limit([acct(1_000_000)], [shoe, monthly], {}, day)).toBe(700_000);
    // 예정을 확정하면 그 회차를 갚는 실제 대금이 된다.
    const r = confirmOccurrence(monthly, '2026-10-25', { amountMinor: 300_000 });
    expect(r.ok && r.entry.money).toMatchObject({ flow: 'cardPayment', cardId: 'life', cardCycle: '2026-10', status: 'actual' });
    if (r.ok) expect(cardState(life, [shoe, r.entry], TODAY).outstandingMinor).toBe(0);
  });

  it('결제일이 지났는데 대금을 적지 않았으면 빚으로 남고, 예상은 오늘에 둔다', () => {
    const st = cardState(life, [shoe], '2026-10-27');
    expect(st.overdue.map((c) => c.key)).toEqual(['2026-10']);
    const later = [acct(1_000_000, { asOf: '2026-10-27', checkedAt: '2026-10-27T09:00:00+09:00' })];
    expect(cardDueEstimates(later, [shoe], '2026-10-27', calc([shoe]))[0]).toMatchObject({ date: '2026-10-27' });
  });
});

describe('E · 세이브로 카드 결제 — 지키는 자리가 옮겨 갈 뿐 두 번 빠지지 않는다', () => {
  const trip = save('trip', 300_000);
  const hotel = use('hotel', 200_000, '2026-10-12', { reserveId: 'trip', outsidePocket: true });

  it('소비 200,000 · 미결제 200,000 · 세이브 사용 200,000(남음 100,000) · 가용은 쓰기 전과 같다', () => {
    const a = [acct(1_000_000)];
    const before = limit(a, [], { reserves: [trip] });
    const after = limit(a, [hotel], { reserves: [trip] });
    expect(before).toBe(700_000);
    expect(after).toBe(700_000);
    expect(spending([hotel])).toBe(200_000);
    expect(cardState(life, [hotel], TODAY).outstandingMinor).toBe(200_000);
    const usage = reserveUsageOf([hotel]);
    expect(reserveRemaining(trip, usage)).toBe(100_000);
  });

  it('대금을 내도 세이브 사용 · 소비가 다시 늘지 않는다', () => {
    const paid = pay('paid', 200_000, '2026-10-16', { cardCycle: '2026-11' });
    const list = [hotel, paid];
    expect(reserveUsageOf(list).get('trip')).toBe(200_000);
    expect(spending(list)).toBe(200_000);
    expect(limit([acct(1_000_000)], list, { reserves: [trip] })).toBe(700_000);
  });

  it('카드를 정하지 않은 카드 사용은 세이브에 걸리지 않는다 — 저장할 때 연결을 걷는다', () => {
    const loose = use('loose', 50_000, TODAY, { cardId: null, reserveId: 'trip' });
    expect(reserveUsageOf([loose]).size).toBe(0);
    expect(entryFromDoc('loose', entryToDoc(loose)).money?.reserveId).toBeNull();
    expect(entryFromDoc('hotel', entryToDoc(hotel)).money).toMatchObject({ reserveId: 'trip', cardId: 'life' });
  });
});

describe('G · 일부 납부 · 여러 번 납부 · 더 낸 몫', () => {
  const big = use('big', 300_000, '2026-09-10');

  it('300,000 중 100,000 납부 → 남은 200,000, 이어서 200,000 → 0', () => {
    // 오늘 낸 대금 — 잔고(오늘 기준) 밖이라 실제 거래로 빠진다.
    const p1 = pay('p1', 100_000, TODAY, { cardCycle: '2026-10' });
    expect(cardState(life, [big, p1], TODAY).outstandingMinor).toBe(200_000);
    expect(limit([acct(1_000_000)], [big, p1])).toBe(700_000);
    // 잔고 기준일 앞에 낸 대금은 이미 잔고 안이다 — 잔고 1,000,000 이 그 돈이 빠진 뒤의 값이다.
    expect(limit([acct(1_000_000)], [big, { ...p1, startDate: '2026-10-10' }])).toBe(800_000);
    const p2 = pay('p2', 200_000, '2026-10-15', { cardCycle: '2026-10' });
    const st = cardState(life, [big, p1, p2], TODAY);
    expect(st.outstandingMinor).toBe(0);
    expect(st.cycles[0]!.payments.map((e) => e.id)).toEqual(['p1', 'p2']);
  });

  it('청구보다 더 내면 더 낸 몫으로 적고 다른 회차의 빚을 지우지 않는다 — 음수 빚(자산)을 만들지 않는다', () => {
    const oct = use('oct', 80_000, '2026-10-02'); // 11월 회차
    const over = pay('over', 350_000, '2026-10-10', { cardCycle: '2026-10' });
    const st = cardState(life, [big, oct, over], TODAY);
    expect(st.cycles.map((c) => [c.key, c.remainingMinor, c.overpaidMinor])).toEqual([
      ['2026-10', 0, 50_000], ['2026-11', 80_000, 0],
    ]);
    expect(st.outstandingMinor).toBe(80_000);
  });

  it('카드를 등록하기 전 사용을 갚는 대금은 그 회차에서 멈춘다 — 등록 뒤 사용을 지우지 않는다', () => {
    const before = pay('before', 500_000, '2026-10-25', { cardCycle: '2026-10' });
    const after = use('after', 120_000, '2026-10-12');
    expect(cardState(life, [before, after], TODAY).outstandingMinor).toBe(120_000);
  });

  it('새 대금의 기본 회차는 남은 금액이 있는 가장 이른 회차', () => {
    const st = cardState(life, [big, use('oct', 80_000, '2026-10-02')], TODAY);
    expect(defaultPaymentCycle(st, TODAY)).toBe('2026-10');
    expect(st.next?.key).toBe('2026-10');
    expect(defaultPaymentCycle(cardState(life, [], TODAY), TODAY)).toBe('2026-10');
  });
});

describe('H · 수정 · 삭제 · 납부 취소', () => {
  const a = [acct(1_000_000)];

  it('사용 금액을 고치면 청구 · 미결제 · 가용이 따라간다, 지우면 사라진다', () => {
    const shoe = use('shoe', 100_000, '2026-10-10');
    const edited = { ...shoe, money: { ...shoe.money!, amountMinor: 80_000 } };
    expect(cardState(life, [edited], TODAY).outstandingMinor).toBe(80_000);
    expect(limit(a, [edited])).toBe(920_000);
    expect(limit(a, [])).toBe(1_000_000);
  });

  it('대금을 지우면(납부 취소) 빚이 돌아온다 — 같은 문서를 두 번 받아도 한 번만 센다', () => {
    const shoe = use('shoe', 100_000, '2026-10-10');
    const paid = pay('paid', 100_000, TODAY, { cardCycle: '2026-11' });
    expect(cardState(life, [shoe, paid, paid], TODAY).outstandingMinor).toBe(0);
    expect(cardState(life, [shoe, shoe], TODAY).outstandingMinor).toBe(100_000);
  });

  it('사용 날짜를 다른 회차로 옮기면 그 회차의 청구로 간다', () => {
    const shoe = use('shoe', 100_000, '2026-09-30');
    expect(cardState(life, [shoe], TODAY).cycles[0]!.key).toBe('2026-10');
    expect(cardState(life, [{ ...shoe, startDate: '2026-10-01' }], TODAY).cycles[0]!.key).toBe('2026-11');
  });
});

describe('저장 형태', () => {
  it('카드 · 회차는 카드 사용 · 카드 대금에만 남는다', () => {
    const p = pay('p', 1, TODAY, { cardCycle: '2026-11' });
    expect(entryFromDoc('p', entryToDoc(p)).money).toMatchObject({ cardId: 'life', cardCycle: '2026-11' });
    const s = use('s', 1, TODAY, { cardCycle: '2026-11' });
    expect(entryFromDoc('s', entryToDoc(s)).money).toMatchObject({ cardId: 'life', cardCycle: null });
    const normal = use('n', 1, TODAY, { flow: 'normal' });
    expect(entryFromDoc('n', entryToDoc(normal)).money).toMatchObject({ cardId: null, cardCycle: null });
    const bad = pay('b', 1, TODAY, { cardCycle: '2026-13' });
    expect(entryFromDoc('b', entryToDoc(bad)).money?.cardCycle).toBeNull();
    const recurring = { ...planPay('r', 1, TODAY, { cardCycle: '2026-11' }), recurrence: { freq: 'monthly' as const, interval: 1, until: null, count: null } };
    expect(entryFromDoc('r', entryToDoc(recurring)).money).toMatchObject({ cardId: 'life', cardCycle: null });
  });
});
