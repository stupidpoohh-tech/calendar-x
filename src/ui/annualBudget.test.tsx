/**
 * 예산 보기의 연간 예산 (Financial Core P2) — 화면.
 *
 * 숫자는 `domain/annualBudget.test` 가 본다. 여기서는 (1) 월간 ↔ 연간 주기를 고르는 자리, (2) 월별 배분이 접혀
 * 있다가 펼쳐지는지, (3) 연간 카테고리가 월간 줄 · 요약에서 빠지는지, (4) 배분 초과를 막는지, (5) 지난 해의 주기를
 * 바꾸지 못하는지, (6) 월간으로 되돌릴 때 무엇이 남는지를 말하는지 본다.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedState } from '../app/useStore';
import { newAnnualBudget } from '../domain/annualBudget';
import { newCategory, setDefaultBudget } from '../domain/category';
import { newEntry, newMoney } from '../domain/entry';
import type { AnnualBudget, Entry, MoneyFields } from '../domain/types';
import { LedgerScreen, type LedgerScreenProps } from './LedgerScreen';

afterEach(cleanup);

const LIVE: FeedState = { status: 'live', ready: true, empty: false, fromCache: false, pending: false };
const TODAY = '2026-10-12';
const cats = [newCategory('expense', '식비', 0, 'food'), newCategory('expense', '미용비', 1, 'beauty')];
const tx = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ status: 'actual', amountMinor: amount, ...m }) });

function mount(over: Partial<LedgerScreenProps> = {}) {
  const props: LedgerScreenProps = {
    todayISO: TODAY, settleDay: 1, tab: 'budget', onTab: vi.fn(), periodKey: '2026-10', onPeriodKey: vi.fn(),
    entries: [], feed: LIVE, categories: cats, categoryBudgets: [setDefaultBudget('food', '2026-01', 400_000), setDefaultBudget('beauty', '2026-01', 50_000)],
    ledgerNotes: [], notesFeed: LIVE, onSaveLedgerNote: vi.fn(),
    categoriesReady: true, onSeedCategories: vi.fn(), onEntryClick: vi.fn(),
    onSaveCategoryBudget: vi.fn(), subscribeAll: vi.fn(() => () => undefined),
    annualBudgets: [], onSaveAnnualBudget: vi.fn(), onDeleteAnnualBudget: vi.fn(),
    ...over,
  };
  render(<LedgerScreen {...props} />);
  return props;
}

const openEditor = (name: RegExp) => {
  fireEvent.click(within(screen.getByRole('list', { name: '카테고리별 예산' })).getByRole('button', { name }));
  fireEvent.click(screen.getByRole('button', { name: /^예산 (고치기|정하기)$/ }));
};

describe('예산 주기 — 월간 · 연간', () => {
  it('편집은 월간에서 시작하고 기존 월간 입력 그대로다', () => {
    mount();
    openEditor(/미용비/);
    expect(screen.getByRole('radio', { name: '월간' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('미용비 예산')).toHaveValue('50000');
    expect(screen.getByRole('button', { name: '이 기간만' })).toBeInTheDocument();
  });

  it('연간을 고르면 연간 예산 한 칸이 기본이고, 월별 배분은 눌러야 펼쳐진다 — 배분 없이도 저장한다', () => {
    const p = mount();
    openEditor(/미용비/);
    fireEvent.click(screen.getByRole('radio', { name: '연간' }));
    expect(screen.getByText(/대상 연도/).textContent).toContain('2026년');
    expect(screen.queryByLabelText('4월 배분')).toBeNull();
    fireEvent.change(screen.getByLabelText('미용비 2026년 연간 예산'), { target: { value: '600,000' } });
    expect(screen.getByText(/월별 배분 0 · 미배분 600,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '연간 예산 저장' }));
    expect(p.onSaveAnnualBudget).toHaveBeenCalledWith(expect.objectContaining({
      id: 'beauty~2026', categoryId: 'beauty', year: 2026, amountMinor: 600_000, monthAllocations: {},
    }));
    // 월간 문서는 건드리지 않는다.
    expect(p.onSaveCategoryBudget).not.toHaveBeenCalled();
  });

  it('월별 배분 — 4월 400,000 · 10월 200,000 을 넣으면 합 · 미배분을 그 자리에서 보이고 그대로 저장한다', () => {
    const p = mount();
    openEditor(/미용비/);
    fireEvent.click(screen.getByRole('radio', { name: '연간' }));
    fireEvent.change(screen.getByLabelText('미용비 2026년 연간 예산'), { target: { value: '600000' } });
    fireEvent.click(screen.getByRole('button', { name: /월별 배분 설정/ }));
    fireEvent.change(screen.getByLabelText('4월 배분'), { target: { value: '400000' } });
    expect(screen.getByText(/월별 배분 400,000 · 미배분 200,000/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('10월 배분'), { target: { value: '200000' } });
    fireEvent.click(screen.getByRole('button', { name: '연간 예산 저장' }));
    expect(p.onSaveAnnualBudget).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: 600_000, monthAllocations: { '04': 400_000, '10': 200_000 },
    }));
  });

  it('배분 합이 연간 예산을 넘으면 저장을 막고 그 이유를 적는다', () => {
    const p = mount();
    openEditor(/미용비/);
    fireEvent.click(screen.getByRole('radio', { name: '연간' }));
    fireEvent.change(screen.getByLabelText('미용비 2026년 연간 예산'), { target: { value: '600000' } });
    fireEvent.click(screen.getByRole('button', { name: /월별 배분 설정/ }));
    fireEvent.change(screen.getByLabelText('4월 배분'), { target: { value: '700000' } });
    expect(screen.getByText(/연간 예산보다 100,000 많습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '연간 예산 저장' })).toBeDisabled();
    expect(p.onSaveAnnualBudget).not.toHaveBeenCalled();
  });

  it('지난 해는 주기를 바꾸지 못한다', () => {
    mount({ periodKey: '2025-10' });
    openEditor(/미용비/);
    expect(screen.getByRole('radio', { name: '연간' })).toBeDisabled();
    expect(screen.getByText(/지난 해\(2025년\)는 예산 주기를 바꾸지 않습니다/)).toBeInTheDocument();
  });
});

describe('연간 예산 묶음 — 이중 집계 없음', () => {
  const annual: AnnualBudget[] = [newAnnualBudget('beauty', 2026, 600_000, { '04': 400_000, '10': 200_000 })];
  const entries = [
    tx('cut', '2026-04-10', 300_000, { categoryId: 'beauty' }),
    tx('dye', '2026-10-05', 80_000, { categoryId: 'beauty' }),
    tx('lunch', '2026-10-06', 100_000, { categoryId: 'food' }),
    tx('loan', '2026-10-07', 90_000, { categoryId: 'beauty', flow: 'loanPrincipal' }),
  ];

  it('연간 카테고리는 월간 줄 · 요약에서 빠지고, 연간 묶음에서 연간 예산 · 사용 · 남음 · 사용률로 견준다', () => {
    mount({ entries, annualBudgets: annual });
    const monthly = screen.getByRole('list', { name: '카테고리별 예산' });
    expect(within(monthly).queryByRole('button', { name: /미용비/ })).toBeNull();
    const sum = screen.getByRole('group', { name: '예산 요약' });
    // 월간 요약은 식비만 — 미용비 월 예산 50,000 은 넣지 않는다.
    expect(sum.textContent).toContain('총 예산400,000');
    expect(sum.textContent).toContain('연간으로 관리하는 카테고리 1개(미용비)');

    const year = screen.getByRole('list', { name: '2026년 연간 예산' });
    const beauty = within(year).getByRole('button', { name: /미용비/ });
    expect(within(beauty).getByLabelText('연간 예산 600,000')).toBeInTheDocument();
    // 대출 원금은 소비가 아니라 빠진다.
    expect(within(beauty).getByLabelText('사용 380,000')).toBeInTheDocument();
    expect(within(beauty).getByLabelText('남음 220,000')).toBeInTheDocument();
    expect(within(beauty).getByRole('img', { name: '사용률 63%' })).toBeInTheDocument();
  });

  it('펼치면 배분 · 미배분 · 달별 계획 대비 사용 · 그 해 거래가 보인다', () => {
    mount({ entries, annualBudgets: annual });
    fireEvent.click(within(screen.getByRole('list', { name: '2026년 연간 예산' })).getByRole('button', { name: /미용비/ }));
    expect(screen.getByText(/월별 배분 600,000 · 미배분 0/)).toBeInTheDocument();
    const months = screen.getByRole('list', { name: '미용비 달별 계획과 사용' });
    expect(months.textContent).toContain('4월계획 400,000 · 사용 300,000 · 남음 100,000');
    expect(months.textContent).toContain('10월계획 200,000 · 사용 80,000 · 남음 120,000');
    expect(screen.getByRole('region', { name: '미용비 2026년 거래' }).textContent).toContain('2026년 2건');
  });

  it('월간으로 바꾸기는 무엇이 남는지 먼저 말하고, 확인해야 지운다', () => {
    const p = mount({ entries, annualBudgets: annual });
    fireEvent.click(within(screen.getByRole('list', { name: '2026년 연간 예산' })).getByRole('button', { name: /미용비/ }));
    fireEvent.click(screen.getByRole('button', { name: '월간으로 바꾸기' }));
    expect(screen.getByText(/실제 거래와 월간 예산 기록은\s*그대로/)).toBeInTheDocument();
    expect(p.onDeleteAnnualBudget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '연간 예산 지우고 월간으로' }));
    expect(p.onDeleteAnnualBudget).toHaveBeenCalledWith(annual[0]);
  });

  it('연간 예산 고치기 — 배분은 처음엔 접혀 있고 기존 값이 들어 있다', () => {
    const p = mount({ entries, annualBudgets: annual });
    fireEvent.click(within(screen.getByRole('list', { name: '2026년 연간 예산' })).getByRole('button', { name: /미용비/ }));
    fireEvent.click(screen.getByRole('button', { name: '연간 예산 고치기' }));
    expect(screen.getByLabelText('미용비 2026년 연간 예산')).toHaveValue('600000');
    expect(screen.queryByLabelText('4월 배분')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /월별 배분 설정 \(선택\) · 배분 600,000/ }));
    expect(screen.getByLabelText('4월 배분')).toHaveValue('400000');
    fireEvent.change(screen.getByLabelText('미용비 2026년 연간 예산'), { target: { value: '900000' } });
    fireEvent.click(screen.getByRole('button', { name: '연간 예산 저장' }));
    expect(p.onSaveAnnualBudget).toHaveBeenCalledWith(expect.objectContaining({
      id: 'beauty~2026', amountMinor: 900_000, monthAllocations: { '04': 400_000, '10': 200_000 },
    }));
  });

  it('다른 해의 정산 기간에서는 그 해의 연간 예산만 보인다 — 2027년에는 미용비가 다시 월간이다', () => {
    mount({ entries, annualBudgets: annual, periodKey: '2027-01' });
    expect(screen.queryByRole('list', { name: /연간 예산/ })).toBeNull();
    expect(within(screen.getByRole('list', { name: '카테고리별 예산' })).getByRole('button', { name: /미용비/ })).toBeInTheDocument();
  });

  it('초과하면 남음 자리에 초과를 적고 사용률 막대가 초과 단계로 바뀐다', () => {
    mount({ entries: [tx('big', '2026-05-01', 700_000, { categoryId: 'beauty' })], annualBudgets: annual });
    const beauty = within(screen.getByRole('list', { name: '2026년 연간 예산' })).getByRole('button', { name: /미용비/ });
    expect(within(beauty).getByLabelText('초과 100,000')).toBeInTheDocument();
    expect(within(beauty).getByRole('img', { name: '사용률 117% (초과)' })).toBeInTheDocument();
  });
});
