/**
 * 데모 숫자 검산. 손으로 셈한 값과 계산이 같아야 한다 — 처음 온 사람이 처음 보는 숫자다.
 *
 * 오늘 2026-10-20 (정산 시작일 1일)
 *   잔고 850,000 (오늘 기준) · 다음 입금 10/25 → 끝점 10/24
 *   전기요금 10/23  −65,000
 *   생활비 620,000 (10/12 ~ 11/9): 쓴 돈 79,500, 이미 잔고 안 67,500 → 예약 552,500
 *   세이브 100,000
 *   → 한도 850,000 − 65,000 − 552,500 − 100,000 = 132,500
 *
 * 10월 결산: 소비 = 9,000 + 4,500 + 54,000 + 30,000 + 39,000(카드 사용) + 12,000 = 148,500
 *            금융비용 45,000 · 지출 193,500 · 카드 대금 120,000 은 지출 아님 · 수입 0
 *            대금(대출 원금) 200,000 · 수지 0 − 193,500 − 200,000 = −393,500
 * 9월 결산:  수입 3,000,000 · 지출 150,000 + 61,000 + 28,000 = 239,000
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actualsIn, budgetRows, totalsOf } from '../domain/ledgerStats';
import { periodByKey } from '../domain/period';
import { headlineLimit } from '../domain/tide';
import { useDemoStore } from './useDemoStore';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T12:00:00+09:00')); });
afterEach(() => { vi.useRealTimers(); });

describe('데모 숫자', () => {
  it('며칠 버티나 — 132,500', () => {
    const { result } = renderHook(() => useDemoStore());
    const s = result.current;
    expect(headlineLimit(s.accounts, s.tideEntries, '2026-10-20', { budgets: s.budgets, reserves: s.reserves })).toBe(132_500);
  });

  it('10월 · 9월 결산', () => {
    const { result } = renderHook(() => useDemoStore());
    const oct = periodByKey('2026-10', 1)!;
    const sep = periodByKey('2026-09', 1)!;
    const o = totalsOf(actualsIn(result.current.entries, oct.start, oct.end));
    expect(o).toMatchObject({
      consumption: 148_500, financeCost: 45_000, spending: 193_500, cardPayment: 120_000, income: 0,
      repayment: 200_000, net: -393_500,
    });
    const p = totalsOf(actualsIn(result.current.entries, sep.start, sep.end));
    expect(p).toMatchObject({ income: 3_000_000, spending: 239_000 });
  });

  it('카테고리 예산 — 식비 75,000 / 400,000, 카페 4,500 / 50,000', () => {
    const { result } = renderHook(() => useDemoStore());
    const oct = periodByKey('2026-10', 1)!;
    const rows = budgetRows(result.current.categories, result.current.categoryBudgets,
      actualsIn(result.current.entries, oct.start, oct.end), oct.key, 'expense');
    expect(rows.find((r) => r.categoryId === 'default-food')).toMatchObject({ actual: 75_000, remaining: 325_000 });
    expect(rows.find((r) => r.categoryId === 'default-cafe')).toMatchObject({ actual: 4_500, remaining: 45_500 });
  });

  it('서버에 닿지 않는다 — 데모는 메모리 값이고 저장소 함수를 부르지 않는다', async () => {
    const repo = await import('../data/repo');
    const spies = (['createManyIfAbsent', 'fetchAll', 'saveEntry'] as const)
      .filter((k) => typeof repo[k] === 'function')
      .map((k) => vi.spyOn(repo, k));
    renderHook(() => useDemoStore());
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
