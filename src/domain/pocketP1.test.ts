/**
 * 생활비 관리 P1 — 주머니 선택 · 실제/예정 분리 · 조회일 기준 예약 · 카드(차단) · 겹침.
 *
 * 금액은 전부 손으로 셈한 값이다. 기준 시나리오: 10/10 잔고 250,000 · 생활비 10/10~14 200,000.
 */
import { describe, expect, it } from 'vitest';
import {
  budgetState, defaultPocketFor, movedToPocket, newBudget, pocketEligible, pocketPeriodImpact, pocketUseOf, reservedOn,
  unlinkedFromPocket, unlinkedSpendingFor,
} from './budget';
import { newEntry, newMoney } from './entry';
import { balanceViewOn, headlineDate, headlineLimit, limitOn } from './tide';
import type { Account, Budget, Entry, MoneyFields } from './types';

const acct = (balanceMinor: number, asOf = '2026-10-10', reflected: string[] = []): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW', asOf,
  checkedAt: `${asOf}T09:00:00+09:00`, reflectedEntryIds: reflected, order: 0, createdAt: '', updatedAt: '',
});
const pocket = (patch: Partial<Budget> = {}): Budget =>
  newBudget({ id: 'b1', name: '생활비', startDate: '2026-10-10', endDate: '2026-10-14', amountMinor: 200_000, ...patch });
const actual = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }),
});
const planned = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ type: 'expense', amountMinor: amount, ...m }),
});

// ---------- P1-A ----------

describe('P1-A 주머니에 걸 수 있는 지출', () => {
  it('일반 지출만 — 수입 · 대출 원금 · 이자 · 이체 · 카드 대금 · 카드 사용 · 대출 연결 · 반복 · 옛 종류는 아니다', () => {
    expect(pocketEligible(actual('x', '2026-10-11', 1))).toBe(true);
    expect(pocketEligible(actual('x', '2026-10-11', 1, { type: 'income' }))).toBe(false);
    for (const flow of ['loanPrincipal', 'loanInterest', 'transfer', 'cardPayment', 'cardSpend'] as const) {
      expect(pocketEligible(actual('x', '2026-10-11', 1, { flow }))).toBe(false);
    }
    expect(pocketEligible(actual('x', '2026-10-11', 1, { debtId: 'd1' }))).toBe(false);
    expect(pocketEligible(actual('x', '2026-10-11', 1, { type: 'living' }))).toBe(false);
    const rec = { ...planned('r', '2026-10-11', 1), recurrence: { freq: 'monthly' as const, interval: 1, until: null, count: null } };
    expect(pocketEligible(rec)).toBe(false);
  });
});

describe('P1-A 기본 주머니', () => {
  const e = actual('lunch', '2026-10-12', 12_000);

  it('그 날을 품는 주머니가 없으면 일반 지출', () => {
    expect(defaultPocketFor(e, [])).toBeNull();
    expect(defaultPocketFor(e, [pocket({ startDate: '2026-10-13' })])).toBeNull();
  });

  it('하나면 그것을 고른다', () => {
    expect(defaultPocketFor(e, [pocket()])).toBe('b1');
  });

  it('여럿이면 고르지 않는다 — 마지막 선택도 다시 쓰지 않는다', () => {
    expect(defaultPocketFor(e, [pocket(), pocket({ id: 'b2', startDate: '2026-10-01', endDate: '2026-10-31' })])).toBeNull();
  });

  it('"생활비 외" 로 명시한 것과 이미 고른 것은 덮지 않는다', () => {
    expect(defaultPocketFor(actual('o', '2026-10-12', 1, { outsidePocket: true }), [pocket()])).toBeNull();
    expect(defaultPocketFor(actual('k', '2026-10-12', 1, { budgetId: 'b9' }), [pocket()])).toBe('b9');
  });

  it('수입 · 카드 사용 · 예정은 자동으로 걸지 않는다', () => {
    expect(defaultPocketFor(actual('i', '2026-10-12', 1, { type: 'income' }), [pocket()])).toBeNull();
    expect(defaultPocketFor(actual('c', '2026-10-12', 1, { flow: 'cardSpend' }), [pocket()])).toBeNull();
    expect(defaultPocketFor(planned('p', '2026-10-12', 1), [pocket()])).toBeNull();
  });
});

describe('P1-E 사용처 세 상태', () => {
  it('연결 · 생활비 외 · 미결정', () => {
    expect(pocketUseOf(actual('a', '2026-10-12', 1, { budgetId: 'b1' }))).toBe('linked');
    expect(pocketUseOf(actual('a', '2026-10-12', 1, { outsidePocket: true }))).toBe('outside');
    expect(pocketUseOf(actual('a', '2026-10-12', 1))).toBe('undecided');
  });

  it('미결정 경고는 생활비 외로 정한 것을 빼고 보여 준다', () => {
    const list = [
      actual('u', '2026-10-11', 10_000),
      actual('o', '2026-10-12', 20_000, { outsidePocket: true }),
      actual('l', '2026-10-12', 30_000, { budgetId: 'b1' }),
      actual('late', '2026-10-15', 40_000),
    ];
    expect(unlinkedSpendingFor(pocket(), list).map((e) => e.id)).toEqual(['u']);
  });

  it('생활비 외 지출은 일반 지출로 한도에서 빠진다 — 어디에도 안 세어지는 돈은 없다', () => {
    const out = actual('trip', '2026-10-12', 30_000, { outsidePocket: true });
    // 250,000 − 생활비 200,000 − 일반 30,000
    expect(limitOn([acct(250_000)], [out], '2026-10-12', '2026-10-10', { budgets: [pocket()] })).toBe(20_000);
  });
});

// ---------- P1-B ----------

describe('P1-B 실제 · 예정 분리', () => {
  const b = pocket();
  const lunch = actual('lunch', '2026-10-11', 40_000, { budgetId: 'b1' });
  const shop = planned('shop', '2026-10-13', 30_000, { budgetId: 'b1' });

  it('200,000 · 실제 40,000 · 예정 30,000 → 실제 잔여 160,000 · 예정 반영 130,000', () => {
    const s = budgetState(b, [lunch, shop]);
    expect([s.actualMinor, s.plannedMinor, s.remainingMinor, s.remainingWithPlannedMinor, s.overspentMinor, s.plannedOverMinor])
      .toEqual([40_000, 30_000, 160_000, 130_000, 0, 0]);
  });

  it('예정을 확정하면 실제로 바뀌고 두 번 세지 않는다 — 금액이 달라도 실제 금액을 쓴다', () => {
    const paid = actual('shop~2026-10-13', '2026-10-13', 35_000, { budgetId: 'b1', plannedRef: { entryId: 'shop', date: '2026-10-13' } });
    const s = budgetState(b, [lunch, shop, paid]);
    expect([s.actualMinor, s.plannedMinor, s.remainingMinor, s.remainingWithPlannedMinor]).toEqual([75_000, 0, 125_000, 125_000]);
  });

  it('확정을 취소하면 예정으로 돌아온다', () => {
    const s = budgetState(b, [lunch, shop]);
    expect(s.plannedMinor).toBe(30_000);
  });

  it('예정 금액을 고치면 예정 반영 잔여만 바뀐다', () => {
    const s = budgetState(b, [lunch, { ...shop, money: { ...shop.money!, amountMinor: 50_000 } }]);
    expect([s.remainingMinor, s.remainingWithPlannedMinor]).toEqual([160_000, 110_000]);
  });

  it('초과 — 실제 기준과 예정 반영 기준을 따로 적는다', () => {
    const s = budgetState(b, [actual('big', '2026-10-11', 180_000, { budgetId: 'b1' }), planned('p', '2026-10-13', 50_000, { budgetId: 'b1' })]);
    expect([s.remainingMinor, s.overspentMinor, s.remainingWithPlannedMinor, s.plannedOverMinor]).toEqual([20_000, 0, 0, 30_000]);
  });
});

// ---------- P1-C ----------

describe('P1-C 조회일 기준 예약', () => {
  const today = '2026-10-10';
  const view = (d: string, budgets = [pocket()], entries: Entry[] = [], t = today) =>
    balanceViewOn([acct(250_000)], entries, d, t, { budgets });

  it('명세 표 — 10/10 · 10/12 는 예상 250,000 · 확보 200,000 · 가용 50,000, 10/15 는 가용 250,000', () => {
    for (const d of ['2026-10-10', '2026-10-12']) {
      expect(view(d)).toMatchObject({ projected: 250_000, held: 200_000, available: 50_000 });
    }
    expect(view('2026-10-15')).toMatchObject({ projected: 250_000, held: 0, available: 250_000 });
  });

  it('시작 전날은 예약하지 않고 시작일부터 예약한다', () => {
    const later = [pocket({ startDate: '2026-10-12' })];
    expect(view('2026-10-11', later).available).toBe(250_000);
    expect(view('2026-10-12', later).available).toBe(50_000);
  });

  it('종료일 당일은 예약, 다음 날 해제', () => {
    expect(view('2026-10-14').available).toBe(50_000);
    expect(view('2026-10-15').available).toBe(250_000);
  });

  it('월말 · 연말 경계', () => {
    const oct = [pocket({ startDate: '2026-10-25', endDate: '2026-10-31' })];
    expect(view('2026-10-31', oct).available).toBe(50_000);
    expect(view('2026-11-01', oct).available).toBe(250_000);
    const dec = [pocket({ startDate: '2026-12-25', endDate: '2026-12-31' })];
    expect(view('2026-12-31', dec).available).toBe(50_000);
    expect(view('2027-01-01', dec).available).toBe(250_000);
  });

  it('기간을 늘리면 늘어난 날까지, 줄이면 줄어든 날 다음부터 풀린다', () => {
    expect(view('2026-10-15', [pocket({ endDate: '2026-10-16' })]).available).toBe(50_000);
    expect(view('2026-10-13', [pocket({ endDate: '2026-10-12' })]).available).toBe(250_000);
  });

  it('조회일이 오늘과 달라도 조회일로 판정한다 — 오늘은 기간 안이어도 10/15 는 풀려 있다', () => {
    expect(view('2026-10-15', [pocket()], [], '2026-10-12').available).toBe(250_000);
  });

  it('겹친 주머니는 각자 예약하고, 음수 가용을 0 으로 감추지 않는다', () => {
    const both = [pocket(), pocket({ id: 'b2', name: '여행', startDate: '2026-10-12', endDate: '2026-10-20', amountMinor: 100_000 })];
    expect(view('2026-10-11', both).available).toBe(50_000);
    expect(view('2026-10-12', both).available).toBe(-50_000);
    expect(view('2026-10-15', both).available).toBe(150_000);
    expect(view('2026-10-21', both).available).toBe(250_000);
  });

  it('주머니 안 예정 · 실제 지출 — 해제는 거래 취소가 아니다', () => {
    const entries = [
      actual('lunch', '2026-10-11', 40_000, { budgetId: 'b1' }),
      planned('shop', '2026-10-13', 30_000, { budgetId: 'b1' }),
    ];
    // 기간 안: 예상 210,000 (실제 40,000 이 아직 잔고 밖) · 확보 max(200,000, 70,000) = 200,000 · 가용 50,000
    expect(view('2026-10-12', [pocket()], entries)).toMatchObject({ projected: 210_000, available: 50_000, held: 160_000 });
    // 해제 뒤: 남은 130,000 만 풀리고, 잔고 밖 지출 70,000 은 그대로 빠진다 → 예상 180,000 · 가용 180,000
    expect(view('2026-10-15', [pocket()], entries)).toMatchObject({ projected: 180_000, available: 180_000, held: 0 });
  });

  it('잔고에 이미 반영된 지출은 해제 뒤에도 다시 빠지지 않는다', () => {
    const lunch = actual('lunch', '2026-10-10', 40_000, { budgetId: 'b1' });
    const v = balanceViewOn([acct(210_000, '2026-10-10', ['lunch'])], [lunch], '2026-10-15', today, { budgets: [pocket()] });
    expect(v).toMatchObject({ projected: 210_000, available: 210_000 });
  });

  it('reservedOn — 조회일이 종료일 뒤면 남은 잔액은 풀리고 잔고 밖 지출만 남는다', () => {
    const lunch = actual('lunch', '2026-10-11', 40_000, { budgetId: 'b1' });
    expect(reservedOn([pocket()], [], [lunch], '2026-10-14', '2026-10-10', [acct(250_000)], today)).toBe(200_000);
    expect(reservedOn([pocket()], [], [lunch], '2026-10-15', '2026-10-10', [acct(250_000)], today)).toBe(40_000);
  });
});

describe('P1-C 머리 숫자는 구간 안 가용의 최솟값', () => {
  it('입금이 없어 끝점이 30일 뒤여도 생활비 기간의 가용 50,000 을 적는다', () => {
    const accounts = [acct(250_000)];
    expect(limitOn(accounts, [], '2026-11-09', '2026-10-10', { budgets: [pocket()] })).toBe(250_000);
    expect(headlineLimit(accounts, [], '2026-10-10', { budgets: [pocket()] })).toBe(50_000);
    expect(headlineDate(accounts, [], '2026-10-10', { budgets: [pocket()] })).toBe('2026-10-14');
  });

  it('생활비가 없으면 지금처럼 끝점의 값', () => {
    const pay = planned('pay', '2026-10-25', 1_000_000, { type: 'income' });
    const rent = planned('rent', '2026-10-20', 500_000);
    expect(headlineLimit([acct(800_000)], [pay, rent], '2026-10-10')).toBe(300_000);
    expect(headlineDate([acct(800_000)], [pay, rent], '2026-10-10')).toBe('2026-10-24');
  });

  it('생활비가 끝난 뒤 큰 지출이 있으면 끝점이 더 작다', () => {
    const rent = planned('rent', '2026-10-20', 240_000);
    // 10/14: 250,000 − 200,000 = 50,000 · 끝점(11/9): 250,000 − 240,000 = 10,000
    expect(headlineLimit([acct(250_000)], [rent], '2026-10-10', { budgets: [pocket()] })).toBe(10_000);
  });

  it('겹친 주머니로 음수면 음수 그대로', () => {
    const both = [pocket(), pocket({ id: 'b2', startDate: '2026-10-12', endDate: '2026-10-20', amountMinor: 100_000 })];
    expect(headlineLimit([acct(250_000)], [], '2026-10-10', { budgets: both })).toBe(-50_000);
  });
});

// ---------- P1-E ----------

describe('P1-E 생활비 기간 변경', () => {
  const b = pocket();
  const linked = [
    actual('d11', '2026-10-11', 10_000, { budgetId: 'b1' }),
    actual('d13', '2026-10-13', 20_000, { budgetId: 'b1' }),
    planned('p14', '2026-10-14', 30_000, { budgetId: 'b1' }),
    actual('d16', '2026-10-16', 40_000, { budgetId: 'b1' }), // 지금은 기간 밖 — 일반 지출로 세어진다
  ];

  it('금액만 바꾸면 영향이 없다', () => {
    const r = pocketPeriodImpact(b, { ...b, amountMinor: 300_000 }, linked, [b]);
    expect([r.leaving.length, r.entering.length, r.targets]).toEqual([0, 0, null]);
  });

  it('줄이면 새 기간 밖 거래(실제 · 예정)를, 늘리면 다시 들어오는 거래를 알려 준다', () => {
    const shorter = pocketPeriodImpact(b, { ...b, endDate: '2026-10-12' }, linked, [b]);
    expect(shorter.leaving.map((e) => e.id)).toEqual(['d13', 'p14']);
    expect(shorter.entering).toEqual([]);
    const longer = pocketPeriodImpact(b, { ...b, endDate: '2026-10-16' }, linked, [b]);
    expect(longer.leaving).toEqual([]);
    expect(longer.entering.map((e) => e.id)).toEqual(['d16']);
  });

  it('옮길 곳은 거래마다 다른 주머니가 정확히 하나일 때만', () => {
    const after = { ...b, endDate: '2026-10-12' };
    const next = pocket({ id: 'b2', name: '다음 생활비', startDate: '2026-10-13', endDate: '2026-10-31' });
    expect([...pocketPeriodImpact(b, after, linked, [after, next]).targets!]).toEqual([['d13', 'b2'], ['p14', 'b2']]);
    // 10/13 을 품는 다른 주머니가 둘 → 제안하지 않는다
    const third = pocket({ id: 'b3', startDate: '2026-10-01', endDate: '2026-10-13' });
    expect(pocketPeriodImpact(b, after, linked, [after, next, third]).targets).toBeNull();
    // 하나도 없음
    expect(pocketPeriodImpact(b, after, linked, [after]).targets).toBeNull();
  });

  it('유지 · 해제 · 옮기기 — 어느 쪽이든 그 돈은 한 번만 센다', () => {
    const after = { ...b, endDate: '2026-10-12' };
    const next = pocket({ id: 'b2', startDate: '2026-10-13', endDate: '2026-10-31', amountMinor: 0 });
    const acc = [acct(250_000)];
    const at = (es: Entry[], budgets: Budget[]) => projectedAndLimit(acc, es, budgets);
    const leavingIds = new Set(['d13', 'p14']);
    const keep = at(linked, [after]);
    const unlink = at(linked.map((e) => (leavingIds.has(e.id) ? unlinkedFromPocket(e, '') : e)), [after]);
    const move = at(linked.map((e) => (leavingIds.has(e.id) ? movedToPocket(e, 'b2', '') : e)), [after, next]);
    // 10/20 기준: 생활비는 끝나 쓴 10,000 만 남고, 나머지 90,000 은 일반 지출 또는 다른 주머니(초과)로 한 번씩.
    expect(keep).toEqual({ projected: 150_000, available: 150_000 });
    expect(unlink).toEqual(keep);
    expect(move).toEqual(keep);
    // 해제한 거래는 미결정이고, "생활비 외" 로 바뀌지 않는다
    expect(unlinkedFromPocket(linked[1]!, '').money).toMatchObject({ budgetId: null });
    expect(unlinkedFromPocket(linked[1]!, '').money?.outsidePocket).toBeFalsy();
  });
});

function projectedAndLimit(accounts: Account[], entries: Entry[], budgets: Budget[]) {
  const v = balanceViewOn(accounts, entries, '2026-10-20', '2026-10-10', { budgets });
  return { projected: v.projected, available: v.available };
}

// ---------- P1-D ----------

describe('P1-D 카드 사용 — 대금 연결 정보가 없어 주머니에 넣지 않는다 (차단 유지)', () => {
  it('카드 30,000 을 주머니에 걸어도 주머니 사용으로 세지 않고, 가용은 50,000', () => {
    const card = actual('card', '2026-10-11', 30_000, { flow: 'cardSpend', budgetId: 'b1' });
    const s = budgetState(pocket(), [card]);
    // 명세가 바라는 값(주머니 실제 30,000 · 남음 170,000)은 대금 연결 설계 전에는 내지 않는다.
    expect([s.actualMinor, s.remainingMinor]).toEqual([0, 200_000]);
    const v = balanceViewOn([acct(250_000)], [card], '2026-10-12', '2026-10-10', { budgets: [pocket()] });
    expect(v).toMatchObject({ confirmed: 250_000, projected: 250_000, available: 50_000 });
  });
});
