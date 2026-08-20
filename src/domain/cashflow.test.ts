import { describe, expect, it } from 'vitest';
import { allocateOverDays, debtTotal, monthlyDebtTotal, projectCashflow } from './cashflow';
import { newEntry, setRecurrence } from './entry';
import { materialize } from './recurrence';
import type { Account, Entry, MoneyType } from './types';

const account = (p: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-08-01', order: 0, createdAt: '', updatedAt: '', ...p,
});

const money = (type: MoneyType, amountMinor: number, startDate: string, endDate?: string): Entry =>
  newEntry('money', {
    startDate,
    endDate: endDate ?? null,
    money: { type, amountMinor, currency: 'KRW', linkedEntryId: null },
  });

describe('allocateOverDays', () => {
  it('합계가 원금과 정확히 일치한다', () => {
    const parts = allocateOverDays(100_000, 7);
    expect(parts).toHaveLength(7);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000);
  });
  it('나머지를 마지막 날에 몰아 준다', () => {
    expect(allocateOverDays(10, 3)).toEqual([3, 3, 4]);
  });
  it('하루짜리는 그대로 둔다', () => {
    expect(allocateOverDays(500, 1)).toEqual([500]);
  });
});

describe('projectCashflow', () => {
  it('잔고에 예정 입출금을 누적한다', () => {
    const r = projectCashflow(
      [account()],
      [money('expense', 300_000, '2026-08-10'), money('income', 500_000, '2026-08-20')],
      '2026-08-01', '2026-08-31',
    );
    expect(r.openingMinor).toBe(1_000_000);
    expect(r.points).toHaveLength(31);
    expect(r.points.find((p) => p.date === '2026-08-09')?.balanceMinor).toBe(1_000_000);
    expect(r.points.find((p) => p.date === '2026-08-10')?.balanceMinor).toBe(700_000);
    expect(r.points.find((p) => p.date === '2026-08-20')?.balanceMinor).toBe(1_200_000);
    expect(r.closingMinor).toBe(1_200_000);
    expect(r.totalInMinor).toBe(500_000);
    expect(r.totalOutMinor).toBe(300_000);
  });

  it('언제 잔고가 바닥나는지 알려 준다 — 이 앱이 답하려는 질문', () => {
    const r = projectCashflow(
      [account({ balanceMinor: 500_000 })],
      [money('expense', 300_000, '2026-08-10'), money('repay', 400_000, '2026-08-15')],
      '2026-08-01', '2026-08-31',
    );
    expect(r.firstShortfall?.date).toBe('2026-08-15');
    expect(r.firstShortfall?.balanceMinor).toBe(-200_000);
    expect(r.low?.date).toBe('2026-08-15');
  });

  it('마이너스로 떨어지지 않으면 firstShortfall 이 없다', () => {
    const r = projectCashflow([account()], [money('expense', 10_000, '2026-08-10')], '2026-08-01', '2026-08-31');
    expect(r.firstShortfall).toBeNull();
    expect(r.low?.balanceMinor).toBe(990_000);
  });

  it('기간형(생활비)을 날짜에 고르게 나눈다', () => {
    const r = projectCashflow(
      [account()],
      [money('living', 310_000, '2026-08-01', '2026-08-31')],
      '2026-08-01', '2026-08-31',
    );
    expect(r.totalOutMinor).toBe(310_000);
    expect(r.closingMinor).toBe(690_000);
    expect(r.points[0]?.deltaMinor).toBe(-10_000);
  });

  it('세이브는 잔고를 줄이지 않고 따로 쌓인다', () => {
    const r = projectCashflow([account()], [money('save', 200_000, '2026-08-05')], '2026-08-01', '2026-08-31');
    expect(r.closingMinor).toBe(1_000_000);
    expect(r.totalReservedMinor).toBe(200_000);
    expect(r.totalOutMinor).toBe(0);
  });

  it('가용은 참고용이라 잔고에도 세이브에도 반영하지 않는다', () => {
    const r = projectCashflow([account()], [money('free', 200_000, '2026-08-05', '2026-08-09')], '2026-08-01', '2026-08-31');
    expect(r.closingMinor).toBe(1_000_000);
    expect(r.totalReservedMinor).toBe(0);
  });

  it('잔고 기준일이 구간보다 앞이면 그 사이 항목을 먼저 반영한다', () => {
    // 8/1 기준 100만원이고 8/5 에 30만원이 나갔다면, 9월 구간의 시작 잔고는 70만원이어야 한다.
    const r = projectCashflow(
      [account({ asOf: '2026-08-01' })],
      [money('expense', 300_000, '2026-08-05')],
      '2026-09-01', '2026-09-30',
    );
    expect(r.openingMinor).toBe(700_000);
    expect(r.closingMinor).toBe(700_000);
  });

  it('계좌 여러 개의 잔고를 합산한다', () => {
    const r = projectCashflow(
      [account({ id: 'a1', balanceMinor: 600_000 }), account({ id: 'a2', name: '비상금', balanceMinor: 400_000 })],
      [], '2026-08-01', '2026-08-31',
    );
    expect(r.openingMinor).toBe(1_000_000);
  });

  it('다른 통화 항목은 섞지 않는다', () => {
    const usd = newEntry('money', {
      startDate: '2026-08-10',
      money: { type: 'expense', amountMinor: 100, currency: 'USD', linkedEntryId: null },
    });
    const r = projectCashflow([account()], [usd, money('expense', 50_000, '2026-08-10')], '2026-08-01', '2026-08-31');
    expect(r.closingMinor).toBe(950_000);
  });

  it('가계부가 아닌 항목은 무시한다', () => {
    const r = projectCashflow([account()], [newEntry('task', { startDate: '2026-08-10' })], '2026-08-01', '2026-08-31');
    expect(r.closingMinor).toBe(1_000_000);
  });

  it('반복 지출을 펼쳐 넣으면 매달 반영된다', () => {
    const rent = setRecurrence(money('expense', 700_000, '2026-08-05'), {
      freq: 'monthly', interval: 1, until: null, count: null,
    });
    const expanded = materialize([rent], '2026-08-01', '2026-10-31');
    const r = projectCashflow([account({ balanceMinor: 3_000_000 })], expanded, '2026-08-01', '2026-10-31');
    expect(r.totalOutMinor).toBe(2_100_000);
    expect(r.closingMinor).toBe(900_000);
  });

  it('구간이 뒤집혀 있으면 빈 결과를 낸다', () => {
    const r = projectCashflow([account()], [], '2026-08-31', '2026-08-01');
    expect(r.points).toEqual([]);
    expect(r.low).toBeNull();
  });

  it('잔고가 없으면 0에서 시작한다', () => {
    const r = projectCashflow([], [money('expense', 50_000, '2026-08-10')], '2026-08-01', '2026-08-31');
    expect(r.openingMinor).toBe(0);
    expect(r.closingMinor).toBe(-50_000);
  });
});

describe('대출 합계', () => {
  const debts = [
    { balanceMinor: 5_000_000, monthlyMinor: 300_000 },
    { balanceMinor: 2_000_000, monthlyMinor: 150_000 },
  ];
  it('잔액을 더한다', () => expect(debtTotal(debts)).toBe(7_000_000));
  it('월 상환을 더한다', () => expect(monthlyDebtTotal(debts)).toBe(450_000));
});
