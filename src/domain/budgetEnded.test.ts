/**
 * 끝난 생활비 주머니 — 남은 잔액의 예약은 풀고, 아직 잔고 밖인 지출은 계속 센다.
 *
 * 재현: 9월 주머니 700,000 · 500,000 을 쓰고 잔고에 모두 반영한 뒤 10월이 되어도 남은
 * 200,000 이 한도에서 계속 빠져 있었다.
 */
import { describe, expect, it } from 'vitest';
import { budgetEnded, newBudget, reservedOn } from './budget';
import { newEntry, newMoney } from './entry';
import { headlineLimit } from './tide';
import type { Account, Entry, MoneyFields } from './types';

const sep = newBudget({ id: 'sep', name: '9월 생활비', startDate: '2026-09-01', endDate: '2026-09-30', amountMinor: 700_000 });
const account = (asOf: string, balance = 2_000_000): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: balance, currency: 'KRW', asOf,
  checkedAt: `${asOf}T21:00:00.000Z`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '',
});
const spend = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, budgetId: 'sep', ...m }) });

describe('끝났는가', () => {
  it('종료일 당일까지는 진행 중, 그 다음 날부터 끝', () => {
    expect(budgetEnded(sep, '2026-09-30')).toBe(false);
    expect(budgetEnded(sep, '2026-10-01')).toBe(true);
  });
});

describe('예약', () => {
  const spent = [spend('a', '2026-09-10', 300_000), spend('b', '2026-09-20', 200_000)];

  it('끝났고 쓴 돈이 모두 잔고에 반영됐으면 예약하지 않는다 (예전: 남은 200,000)', () => {
    const acc = [account('2026-10-01')];
    expect(reservedOn([sep], [], spent, '2026-10-31', '2026-10-01', acc)).toBe(200_000); // 오늘을 모르면 예전 그대로
    expect(reservedOn([sep], [], spent, '2026-10-31', '2026-10-01', acc, '2026-10-13')).toBe(0);
  });

  it('진행 중에는 그대로 — 남은 잔액까지 떼어 둔다', () => {
    const acc = [account('2026-09-25')];
    expect(reservedOn([sep], [], spent, '2026-10-31', '2026-09-25', acc, '2026-09-25')).toBe(200_000);
  });

  it('끝났어도 아직 잔고에 안 들어간 실제 지출은 센다 — 남은 잔액만 풀린다', () => {
    const late = spend('late', '2026-09-30', 150_000); // 기준일(9/29) 뒤
    const acc = [account('2026-09-29')];
    expect(reservedOn([sep], [], [...spent, late], '2026-10-31', '2026-09-29', acc, '2026-10-13')).toBe(150_000);
  });

  it('끝났어도 아직 잔고 밖인 예정 지출은 센다', () => {
    const planned = newEntry('money', {
      id: 'p', title: '장보기 예정', startDate: '2026-09-30',
      money: newMoney({ type: 'expense', amountMinor: 80_000, budgetId: 'sep' }),
    });
    const acc = [account('2026-09-29')];
    expect(reservedOn([sep], [], [...spent, planned], '2026-10-31', '2026-09-29', acc, '2026-10-13')).toBe(80_000);
  });

  it('초과해서 쓴 주머니도 끝나면 잔고 밖인 몫만 남는다', () => {
    const over = [spend('a', '2026-09-10', 600_000), spend('b', '2026-09-30', 300_000)];
    const acc = [account('2026-09-29')];
    expect(reservedOn([sep], [], over, '2026-10-31', '2026-09-29', acc, '2026-09-30')).toBe(900_000 - 600_000);
    expect(reservedOn([sep], [], over, '2026-10-31', '2026-09-29', acc, '2026-10-13')).toBe(300_000);
  });

  it('잔고 기준일 당일 지출은 반영 목록으로 가른다', () => {
    const today = spend('t', '2026-09-30', 50_000);
    const out = account('2026-09-30');
    const inBal = { ...out, reflectedEntryIds: ['t'] };
    expect(reservedOn([sep], [], [today], '2026-10-31', '2026-09-30', [out], '2026-10-13')).toBe(50_000);
    expect(reservedOn([sep], [], [today], '2026-10-31', '2026-09-30', [inBal], '2026-10-13')).toBe(0);
  });

  it('아직 시작 안 한 주머니는 예약하지 않는다 (그대로)', () => {
    const nov = newBudget({ id: 'nov', startDate: '2026-11-01', endDate: '2026-11-30', amountMinor: 500_000 });
    expect(reservedOn([nov], [], [], '2026-10-31', '2026-10-01', [account('2026-10-01')], '2026-10-13')).toBe(0);
  });
});

describe('한도 — 전후 예시', () => {
  it('잔고 2,000,000 (10/1 기준) · 9월 주머니 700,000 중 500,000 사용(반영) · 오늘 10/13', () => {
    const spent = [spend('a', '2026-09-10', 300_000), spend('b', '2026-09-20', 200_000)];
    // 예전에는 남은 200,000 이 계속 빠져 1,800,000 이었다.
    expect(headlineLimit([account('2026-10-01')], spent, '2026-10-13', { budgets: [sep] })).toBe(2_000_000);
    // 9/30(진행 중 마지막 날)에는 남은 200,000 을 떼어 둔다.
    expect(headlineLimit([account('2026-09-30')], spent, '2026-09-30', { budgets: [sep] })).toBe(1_800_000);
  });
});
