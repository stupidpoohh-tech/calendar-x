import { describe, expect, it } from 'vitest';
import { newBudget, newReserve } from './budget';
import { newEntry, newMoney, withDerived } from './entry';
import {
  CALENDAR_AMOUNTS, calendarAmountCaption, calendarAmountOn, LEGACY_LAYOUT, layoutFrom, lensVisible,
  NEW_USER_LAYOUT, type CalendarAmount,
} from './layout';
import { limitOn, projectedBalanceOn } from './tide';
import type { Account, Entry } from './types';

describe('내 캘린더 구성', () => {
  it('필드가 없으면 지금까지 보던 그대로 — 네 렌즈 · 스위처 · 예상 잔고', () => {
    expect(layoutFrom(undefined)).toEqual({ ledger: true, notes: true, sharedSwitcher: true, calendarAmount: 'projected' });
    expect(layoutFrom(null)).toEqual(LEGACY_LAYOUT);
  });

  it('일부만 있으면 나머지를 메우고, 모르는 값은 버린다', () => {
    expect(layoutFrom({ ledger: false })).toEqual({ ...LEGACY_LAYOUT, ledger: false });
    expect(layoutFrom({ notes: 'no', calendarAmount: 'weird' })).toEqual(LEGACY_LAYOUT);
    expect(layoutFrom({ calendarAmount: 'pocket' }).calendarAmount).toBe('pocket');
  });

  it('새 사용자는 가용 잔액이 기본', () => {
    expect(NEW_USER_LAYOUT.calendarAmount).toBe('available');
    expect(layoutFrom(NEW_USER_LAYOUT)).toEqual(NEW_USER_LAYOUT);
  });

  it('전체 · 캘린더는 늘 보이고, 가계부 · 노트는 구성을 따른다', () => {
    const off = { ...LEGACY_LAYOUT, ledger: false, notes: false };
    expect(['all', 'task', 'idea', 'money'].map((l) => lensVisible(l as never, off))).toEqual([true, true, false, false]);
    expect(['all', 'task', 'idea', 'money'].every((l) => lensVisible(l as never, LEGACY_LAYOUT))).toBe(true);
  });
});

describe('달력 칸의 금액 — 이미 있는 계산 그대로 고른다', () => {
  const TODAY = '2026-10-14';
  const accounts: Account[] = [{
    id: 'a1', name: '주계좌', balanceMinor: 250_000, currency: 'KRW',
    asOf: TODAY, checkedAt: `${TODAY}T09:00:00.000Z`, order: 0, createdAt: '', updatedAt: '',
  }];
  const pocket = newBudget({ id: 'b1', name: '10월 생활비', startDate: '2026-10-10', endDate: '2026-10-20', amountMinor: 200_000 });
  const reserve = newReserve({ id: 'r1', amountMinor: 30_000 });
  const entries: Entry[] = [
    // 생활비에서 실제로 쓴 40,000 — 기준일 앞이라 이미 잔고에 들어 있다.
    newEntry('money', { id: 'm1', title: '장보기', startDate: '2026-10-12', money: newMoney({ type: 'expense', amountMinor: 40_000, status: 'actual', budgetId: 'b1' }) }),
    newEntry('money', { id: 'm2', title: '보험', startDate: '2026-10-16', money: newMoney({ type: 'expense', amountMinor: 50_000 }) }),
    newEntry('money', { id: 'm3', title: '급여', startDate: '2026-10-25', money: newMoney({ type: 'income', amountMinor: 1_000_000 }) }),
  ].map((e) => withDerived(e));
  const res = { budgets: [pocket], reserves: [reserve] };
  const on = (mode: CalendarAmount, d: string) => calendarAmountOn(mode, accounts, entries, d, TODAY, res);

  it('전체 보유액은 날짜가 없는 값이라 오늘 칸에만 적는다', () => {
    expect(on('balance', TODAY)).toBe(250_000);
    expect(on('balance', '2026-10-16')).toBe(null);
  });

  it('예상 잔고는 projectedBalanceOn 그대로 — 생활비 · 세이브를 빼지 않는다', () => {
    expect(on('projected', TODAY)).toBe(250_000);
    expect(on('projected', '2026-10-16')).toBe(200_000);
    expect(on('projected', '2026-10-16')).toBe(projectedBalanceOn(accounts, entries, '2026-10-16', TODAY));
  });

  it('가용 잔액은 limitOn 그대로 — 남은 생활비 · 세이브를 뺀다. 끝난 생활비는 풀린다', () => {
    expect(on('available', TODAY)).toBe(60_000); // 250,000 − 160,000 − 30,000
    expect(on('available', '2026-10-16')).toBe(10_000);
    expect(on('available', '2026-10-21')).toBe(170_000);
    for (const d of [TODAY, '2026-10-16', '2026-10-21', '2026-10-26']) {
      expect(on('available', d)).toBe(limitOn(accounts, entries, d, TODAY, res));
    }
  });

  it('생활비 잔여는 그 날을 품는 주머니의 남은 금액(실제 기준). 품는 주머니가 없으면 비운다', () => {
    expect(on('pocket', TODAY)).toBe(160_000);
    expect(on('pocket', '2026-10-20')).toBe(160_000);
    expect(on('pocket', '2026-10-21')).toBe(null);
  });

  it('달력 위 한 줄도 기준을 따라 바뀐다', () => {
    expect(CALENDAR_AMOUNTS.map((a) => calendarAmountCaption(a.id))).toHaveLength(4);
    expect(calendarAmountCaption('available')).toContain('가용 잔액');
    expect(calendarAmountCaption('projected')).toContain('예상 잔고');
  });
});
