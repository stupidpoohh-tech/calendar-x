/**
 * Financial Core P1 — 세이브 보호 · 목표 · 보관.
 *
 * 세이브는 처음부터 잔고를 건드리지 않았다. P1 이 바꾸는 것은 "가용 한도에서 빠지는가" 하나다.
 *   보호 켬(기본 · 예전 세이브)  한도에서 뺀다
 *   보호 끔                      한도에 포함 — 세이브와 금액은 그대로
 *   보관                         한도에 포함 · 일반 목록에서 빠짐 — 금액은 그대로
 * 목표 금액 · 목표 날짜는 어떤 계산에도 들어가지 않는다.
 */
import { describe, expect, it } from 'vitest';
import {
  activeReserves, applyReservePatch, archivedReserves, newBudget, newReserve, protectedReserveTotal,
  reservedOn, reservedTotal, reservePatchOf, reserveProtects,
} from './budget';
import { newEntry, newMoney } from './entry';
import { calendarAmountOn } from './layout';
import {
  balanceViewOn, calcScopeOf, confirmedBalance, headlineLimit, limitOn, projectedBalanceOn,
} from './tide';
import type { Account, Entry, Reserve } from './types';

const TODAY = '2026-10-14';
const LATER = '2026-10-20';

const acct = (balanceMinor: number, p: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '', ...p,
});
/** 예전 세이브 — P1 필드가 하나도 없다(옛 문서 · 옛 백업의 모양). */
const legacySave = (amountMinor = 300_000, p: Partial<Reserve> = {}): Reserve => ({
  id: 's1', name: '비상금', amountMinor, currency: 'KRW', createdAt: '', updatedAt: '', ...p,
});
const planned = (id: string, amountMinor: number, date: string, type: 'income' | 'expense' = 'expense'): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ type, amountMinor }) });

const BAL = [acct(1_000_000)];
const FLOWS = [planned('rent', 200_000, '2026-10-18'), planned('pay', 2_500_000, '2026-10-25', 'income')];

/** 잔고 셋과 가용 — 보호 전환이 무엇을 바꾸고 무엇을 안 바꾸는지 한 번에 본다. */
function numbers(reserves: Reserve[], date = LATER) {
  const res = { reserves };
  return {
    confirmed: confirmedBalance(BAL),
    projected: projectedBalanceOn(BAL, FLOWS, date, TODAY),
    available: limitOn(BAL, FLOWS, date, TODAY, res),
    headline: headlineLimit(BAL, FLOWS, TODAY, res),
    view: balanceViewOn(BAL, FLOWS, date, TODAY, res),
  };
}

describe('세이브 보호 — 완료 기준 수치', () => {
  const none = numbers([]);

  it('기존 세이브 30만 원(필드 없음)은 보호 켬으로 계산된다 — 가용 −300,000', () => {
    const n = numbers([legacySave()]);
    expect(reserveProtects(legacySave())).toBe(true);
    expect(n.available).toBe(none.available - 300_000);
    expect(n.headline).toBe(none.headline - 300_000);
    // 1,000,000 − 200,000(10/18 월세) − 300,000
    expect(n.available).toBe(500_000);
  });

  it('보호를 끄면 가용이 300,000 늘고, 다시 켜면 원래 가용으로 돌아온다', () => {
    const on = numbers([legacySave()]);
    const off = numbers([{ ...legacySave(), protected: false }]);
    const back = numbers([{ ...legacySave(), protected: true }]);
    expect(off.available - on.available).toBe(300_000);
    expect(off.headline - on.headline).toBe(300_000);
    expect(back.available).toBe(on.available);
    expect(back.headline).toBe(on.headline);
  });

  it('보호 전환은 확인 잔고 · 예상 잔고를 바꾸지 않는다', () => {
    const states = [[], [legacySave()], [{ ...legacySave(), protected: false }], [{ ...legacySave(), archivedAt: 'x' }]];
    for (const r of states) {
      const n = numbers(r);
      expect(n.confirmed).toBe(1_000_000);
      expect(n.projected).toBe(800_000);
      expect(n.view.confirmed).toBe(1_000_000);
      expect(n.view.projected).toBe(800_000);
    }
  });

  it('목표 금액 · 목표 날짜는 어떤 계산에도 들어가지 않는다', () => {
    const base = numbers([legacySave()]);
    const withTarget = numbers([{ ...legacySave(), targetAmountMinor: 5_000_000, targetDate: '2026-10-19' }]);
    expect(withTarget).toEqual(base);
    const offTarget = numbers([{ ...legacySave(), protected: false, targetAmountMinor: 1, targetDate: '2026-10-15' }]);
    expect(offTarget).toEqual(numbers([{ ...legacySave(), protected: false }]));
  });

  it('보관하면 보호가 풀리고 금액은 그대로, 보관을 풀면 금액 · 보호가 함께 돌아온다', () => {
    const save = legacySave();
    const archived = applyReservePatch(save, { archivedAt: '2026-10-14T01:00:00.000Z' }, 't1');
    expect(archived.amountMinor).toBe(300_000);
    expect(reserveProtects(archived)).toBe(false);
    expect(numbers([archived]).available).toBe(none.available);
    expect(activeReserves([archived])).toEqual([]);
    expect(archivedReserves([archived])).toEqual([archived]);

    const restored = applyReservePatch(archived, { archivedAt: null }, 't2');
    expect(restored.amountMinor).toBe(300_000);
    expect(reserveProtects(restored)).toBe(true);
    expect(numbers([restored]).available).toBe(numbers([save]).available);
  });

  it('보호를 끈 채 보관했다가 풀면 끈 상태로 돌아온다', () => {
    const off = { ...legacySave(), protected: false };
    const restored = applyReservePatch(applyReservePatch(off, { archivedAt: 'x' }, 't1'), { archivedAt: null }, 't2');
    expect(restored.protected).toBe(false);
    expect(numbers([restored]).available).toBe(none.available);
  });

  it('필드가 없는 세이브와 P1 기본값을 채운 세이브는 같은 숫자를 낸다', () => {
    const filled = { ...legacySave(), protected: true, targetAmountMinor: null, targetDate: null, archivedAt: null };
    expect(numbers([filled])).toEqual(numbers([legacySave()]));
    // 생활비가 함께 있어도 같다.
    const budgets = [newBudget({ id: 'b1', startDate: TODAY, endDate: LATER, amountMinor: 150_000 })];
    expect(reservedOn(budgets, [filled], FLOWS, LATER, '2026-10-13', BAL, TODAY))
      .toBe(reservedOn(budgets, [legacySave()], FLOWS, LATER, '2026-10-13', BAL, TODAY));
    expect(reservedOn(budgets, [legacySave()], FLOWS, LATER, '2026-10-13', BAL, TODAY)).toBe(450_000);
  });

  it('세이브 총액(`reservedTotal`)은 뜻을 바꾸지 않는다 — 보호와 무관한 확보액의 합', () => {
    const list = [legacySave(), { ...legacySave(200_000), id: 's2', protected: false }, { ...legacySave(50_000), id: 's3', archivedAt: 'x' }];
    expect(reservedTotal(list)).toBe(550_000);
    expect(protectedReserveTotal(list)).toBe(300_000);
  });

  it('새로 만든 세이브는 보호가 켜져 있다', () => {
    expect(reserveProtects(newReserve())).toBe(true);
  });
});

describe('부분 쓰기 — 바꾼 칸만', () => {
  const before = { ...legacySave(), protected: true, targetAmountMinor: null, targetDate: null, archivedAt: null };

  it('바꾼 것이 없으면 쓸 것이 없다 — 예전 세이브(필드 없음)를 그대로 저장해도 같다', () => {
    expect(reservePatchOf(before, { ...before })).toBeNull();
    expect(reservePatchOf(legacySave(), { ...legacySave(), protected: true, targetAmountMinor: null })).toBeNull();
  });

  it('바꾼 칸만 담는다 — 금액만 고치면 보호 칸은 담지 않는다', () => {
    expect(reservePatchOf(before, { ...before, amountMinor: 310_000 })).toEqual({ amountMinor: 310_000 });
    expect(reservePatchOf(before, { ...before, protected: false })).toEqual({ protected: false });
    expect(reservePatchOf(before, { ...before, targetAmountMinor: 1_000_000, targetDate: '2027-03-01' }))
      .toEqual({ targetAmountMinor: 1_000_000, targetDate: '2027-03-01' });
    expect(reservePatchOf({ ...before, targetDate: '2027-03-01' }, before)).toEqual({ targetDate: null });
  });
});

describe('통화 — 환율 없이 더하지 않는다', () => {
  it('보호 중인 세이브의 통화가 계좌와 다르면 계산을 멈춘다', () => {
    const usd = { ...legacySave(), currency: 'USD' };
    const scope = calcScopeOf(BAL, FLOWS, { reserves: [usd] });
    expect(scope).toEqual({ ok: false, reason: 'currency', currencies: ['KRW', 'USD'] });
  });

  it('생활비의 통화가 다르면 계산을 멈춘다', () => {
    const b = newBudget({ id: 'b1', startDate: TODAY, endDate: LATER, amountMinor: 1000, currency: 'USD' });
    expect(calcScopeOf(BAL, FLOWS, { budgets: [b] }).ok).toBe(false);
  });

  it('한도에 들어가지 않는 세이브(보호 끔 · 보관)는 통화를 따지지 않는다', () => {
    const off = { ...legacySave(), currency: 'USD', protected: false };
    const archived = { ...legacySave(), id: 's2', currency: 'USD', archivedAt: 'x' };
    expect(calcScopeOf(BAL, FLOWS, { reserves: [off, archived] })).toEqual({ ok: true, currency: 'KRW' });
  });

  it('같은 통화면 그대로 계산한다', () => {
    expect(calcScopeOf(BAL, FLOWS, { reserves: [legacySave()] })).toEqual({ ok: true, currency: 'KRW' });
  });
});

describe('캘린더 금액 네 기준 — 보호 전환은 가용 잔액에만', () => {
  const pocket = newBudget({ id: 'b1', startDate: TODAY, endDate: LATER, amountMinor: 150_000 });
  const at = (mode: Parameters<typeof calendarAmountOn>[0], reserves: Reserve[], date = LATER) =>
    calendarAmountOn(mode, BAL, FLOWS, date, TODAY, { budgets: [pocket], reserves });

  it('전체 보유액 · 예상 잔고 · 생활비 잔여는 보호와 무관하다', () => {
    for (const r of [[legacySave()], [{ ...legacySave(), protected: false }], [{ ...legacySave(), archivedAt: 'x' }]]) {
      expect(at('balance', r, TODAY)).toBe(1_000_000);
      expect(at('balance', r, LATER)).toBeNull();
      expect(at('projected', r)).toBe(800_000);
      expect(at('pocket', r)).toBe(150_000);
    }
  });

  it('가용 잔액만 보호를 따라 300,000 움직인다', () => {
    const on = at('available', [legacySave()]);
    const off = at('available', [{ ...legacySave(), protected: false }]);
    // 1,000,000 − 200,000 − 생활비 150,000 − 세이브 300,000
    expect(on).toBe(350_000);
    expect(off).toBe(650_000);
    expect(at('available', [{ ...legacySave(), archivedAt: 'x' }])).toBe(650_000);
  });
});
