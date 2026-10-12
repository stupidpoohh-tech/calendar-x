/**
 * 가계부 상세 화면 — 내역 · 예산 · 월별 · 통계.
 *
 * 숫자 계산은 `ledgerStats.test` 가 본다. 여기서는 화면이 (1) 덜 받은 자료로 합계를 내지
 * 않는지, (2) 예산을 고칠 때 기간만 / 기본을 제대로 가르는지, (3) 정산 기간 이름과 범위가
 * 함께 보이는지, (4) 월평균의 정의가 화면에 적히는지 본다.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCategory, setDefaultBudget } from '../domain/category';
import { newEntry, newMoney } from '../domain/entry';
import type { CategoryBudget, Entry, LedgerTabId, MoneyFields } from '../domain/types';
import type { FeedState } from '../app/useStore';
import { LedgerScreen, type LedgerScreenProps } from './LedgerScreen';

afterEach(cleanup);

const LIVE: FeedState = { status: 'live', ready: true, empty: false, fromCache: false, pending: false };
const TODAY = '2026-10-12';
const cats = [newCategory('expense', '식비', 0, 'food'), newCategory('expense', '카페', 1, 'cafe'), newCategory('income', '급여', 0, 'salary')];
const tx = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}, over: Partial<Entry> = {}) =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ status: 'actual', amountMinor: amount, ...m }), ...over });

function mount(over: Partial<LedgerScreenProps> = {}) {
  const props: LedgerScreenProps = {
    todayISO: TODAY, settleDay: 25, tab: 'history', onTab: vi.fn(), periodKey: '2026-10', onPeriodKey: vi.fn(),
    year: 2026, onYear: vi.fn(), entries: [], feed: LIVE, categories: cats, categoryBudgets: [],
    categoriesReady: true, onSeedCategories: vi.fn(), onEntryClick: vi.fn(), onAdd: vi.fn(),
    onSaveCategoryBudget: vi.fn(), onSearchAll: vi.fn(async () => []),
    ...over,
  };
  render(<LedgerScreen {...props} />);
  return props;
}

describe('자료가 다 오기 전에는 합계를 내지 않는다', () => {
  const entries = [tx('a', '2026-10-01', 10_000)];
  it.each<[string, FeedState, RegExp]>([
    ['불러오는 중', { ...LIVE, status: 'loading', ready: false }, /불러오는 중/],
    ['실패', { ...LIVE, status: 'error', ready: false }, /불러오지 못했습니다/],
    ['캐시가 비어 있음', { ...LIVE, status: 'cache', fromCache: true, empty: true }, /가릴 수 없습니다/],
  ])('%s', (_name, feed, msg) => {
    mount({ entries, feed });
    expect(screen.getByRole('status')).toHaveTextContent(msg);
    expect(screen.queryByText('수입')).toBeNull();
  });

  it('캐시에서 온 값이면 숫자는 내되 한 줄을 덧붙인다', () => {
    mount({ entries, feed: { ...LIVE, status: 'cache', fromCache: true } });
    expect(screen.getByText(/이 기기에 저장된 자료 기준/)).toBeInTheDocument();
    expect(screen.getByText('지출')).toBeInTheDocument();
  });
});

describe('내역', () => {
  const entries = [
    tx('salary', '2026-09-25', 3_000_000, { type: 'income', categoryId: 'salary' }, { title: '' }),
    tx('lunch', '2026-10-01', 12_000, { categoryId: 'food', method: '신한카드' }, { title: '점심' }),
    tx('principal', '2026-10-02', 300_000, { flow: 'loanPrincipal' }, { title: '원금' }),
    tx('next', '2026-10-25', 99_000, {}, { title: '다음 기간' }),
    newEntry('money', { id: 'plan', title: '보험료', startDate: '2026-10-20', money: newMoney({ amountMinor: 50_000 }) }),
  ];

  it('기간 이름과 날짜 범위를 함께 적는다 — 25일 기준', () => {
    mount({ entries });
    expect(screen.getByText('2026년 10월')).toBeInTheDocument();
    expect(screen.getByText('9.25 – 10.24')).toBeInTheDocument();
  });

  it('합계는 실제 거래만, 원금은 지출에서 뺀다', () => {
    mount({ entries });
    const totals = document.querySelector('.led-totals')!;
    expect(totals.textContent).toContain('3,000,000');
    expect(within(totals as HTMLElement).getByText('12,000', { selector: 'b' })).toBeInTheDocument();
    expect(totals.textContent).toContain('대출 원금 · 이체 · 카드 대금 300,000');
  });

  it('예정은 "예정" 으로 구분해 보이고, 다음 기간 거래는 없다', () => {
    mount({ entries });
    const plan = screen.getByRole('button', { name: /보험료/ });
    expect(plan).toHaveClass('planned');
    expect(within(plan).getByText('예정')).toBeInTheDocument();
    expect(screen.queryByText('다음 기간')).toBeNull();
  });

  it('누르면 그 항목을 연다', () => {
    const p = mount({ entries });
    fireEvent.click(screen.getByRole('button', { name: /점심/ }));
    expect(p.onEntryClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'lunch' }));
  });

  it('검색 — 이 기간에서 결제수단으로 찾는다', () => {
    mount({ entries });
    fireEvent.change(screen.getByLabelText('거래 검색'), { target: { value: '신한' } });
    expect(screen.getByRole('button', { name: /점심/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /보험료/ })).toBeNull();
  });

  it('검색 범위를 해 · 전체로 넓힌다. 전체는 고른 순간 한 번 읽는다', async () => {
    const old = tx('old', '2024-03-01', 7_000, {}, { title: '옛날 점심' });
    const p = mount({ entries, onSearchAll: vi.fn(async () => [old]) });
    fireEvent.change(screen.getByLabelText('거래 검색'), { target: { value: '점심' } });
    fireEvent.click(screen.getByRole('radio', { name: '2026년' }));
    expect(screen.getByRole('button', { name: /점심/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '전체' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /옛날 점심/ })).toBeInTheDocument());
    expect(p.onSearchAll).toHaveBeenCalledTimes(1);
  });

  it('기간을 옮긴다. 이번 기간을 보고 있으면 "이번 기간" 버튼은 없다', () => {
    const p = mount({ entries });
    expect(screen.queryByRole('button', { name: '이번 기간' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '이전 기간' }));
    expect(p.onPeriodKey).toHaveBeenCalledWith('2026-09');
    cleanup();
    const q = mount({ entries, periodKey: '2026-08' });
    fireEvent.click(screen.getByRole('button', { name: '이번 기간' }));
    expect(q.onPeriodKey).toHaveBeenCalledWith('2026-10');
  });
});

describe('예산', () => {
  const budgets: CategoryBudget[] = [setDefaultBudget('food', '2026-01', 300_000)];
  const entries = [
    tx('a', '2026-09-26', 320_000, { categoryId: 'food' }),
    tx('b', '2026-09-27', 9_000, { categoryId: 'cafe' }),
    tx('c', '2026-08-30', 100_000, { categoryId: 'food' }),
  ];

  it('카테고리마다 실제 · 예산 · 초과 · 지난 기간을 적는다. 예산 없는 카테고리도 집계한다', () => {
    mount({ tab: 'budget', entries, categoryBudgets: budgets });
    const list = screen.getByRole('list', { name: '카테고리별 예산' });
    const food = within(list).getByRole('button', { name: /식비/ });
    expect(food.textContent).toContain('320,000');
    expect(food.textContent).toContain('/ 300,000');
    expect(food.textContent).toContain('초과 20,000');
    expect(food.textContent).toContain('지난 기간 100,000');
    const cafe = within(list).getByRole('button', { name: /카페/ });
    expect(cafe.textContent).toContain('예산 없음');
    expect(cafe.textContent).toContain('9,000');
  });

  it('진행 중인 기간 — "이 기간만" 과 "기본 예산(이번 기간부터)" 을 가른다', () => {
    const p = mount({ tab: 'budget', periodKey: '2026-10', entries, categoryBudgets: budgets });
    fireEvent.click(screen.getByRole('button', { name: /카페/ }));
    fireEvent.change(screen.getByLabelText('카페 예산'), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: /기본 예산으로/ }));
    expect(p.onSaveCategoryBudget).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cafe~default~2026-10', scope: 'default', period: '2026-10', amountMinor: 50_000,
    }));
  });

  it('지난 기간에서는 기본 예산을 바꾸지 못한다 — 소급되면 지난 결산이 바뀐다', () => {
    const p = mount({ tab: 'budget', periodKey: '2026-08', entries, categoryBudgets: budgets });
    fireEvent.click(screen.getByRole('button', { name: /식비/ }));
    expect(screen.getByRole('button', { name: /기본 예산으로/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('식비 예산'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '이 기간만' }));
    expect(p.onSaveCategoryBudget).toHaveBeenCalledWith(expect.objectContaining({
      id: 'food~period~2026-08', amountMinor: null,
    }));
  });

  it('카테고리가 없으면 기본 카테고리 만들기를 권한다', () => {
    const p = mount({ tab: 'budget', categories: [] });
    fireEvent.click(screen.getByRole('button', { name: '기본 카테고리 만들기' }));
    expect(p.onSeedCategories).toHaveBeenCalled();
  });
});

describe('월별', () => {
  it('열두 기간을 표로 적고 진행 중인 기간을 표시한다', () => {
    const p = mount({
      tab: 'monthly', periodKey: '2026-10',
      entries: [tx('a', '2026-09-26', 10_000), tx('s', '2026-05-25', 2_000_000, { type: 'income' })],
    });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(12);
    expect(rows[0]!.textContent).toContain('2026년 10월');
    expect(rows[0]!.textContent).toContain('진행 중');
    expect(screen.getByRole('img', { name: '정산 기간별 수입과 지출' })).toBeInTheDocument();
    fireEvent.click(within(rows[4]!).getByRole('button', { name: '2026년 6월' }));
    expect(p.onPeriodKey).toHaveBeenCalledWith('2026-06');
    expect(p.onTab).toHaveBeenCalledWith('history' satisfies LedgerTabId);
  });
});

describe('통계', () => {
  it('카테고리별 연간 합계 · 비중 · 월평균, 금융비용은 따로', () => {
    mount({
      tab: 'stats', year: 2026, settleDay: 1,
      entries: [
        tx('a', '2026-01-10', 100_000, { categoryId: 'food' }),
        tx('b', '2026-02-10', 200_000, { categoryId: 'food' }),
        tx('c', '2026-10-05', 300_000, { categoryId: 'food' }),
        tx('i', '2026-03-01', 20_000, { flow: 'loanInterest' }),
        tx('p', '2026-03-01', 500_000, { flow: 'loanPrincipal' }),
      ],
    });
    const list = screen.getByRole('list', { name: '카테고리별 연간 소비' });
    const food = within(list).getByText('식비').closest('li')!;
    expect(food.textContent).toContain('600,000');
    expect(food.textContent).toContain('소비의 100%');
    // 끝난 기간은 1~9월(9개). (100,000 + 200,000) / 9
    expect(food.textContent).toContain('월평균 33,333');
    expect(within(list).getByText('금융비용 (대출 이자)')).toBeInTheDocument();
    expect(screen.getByText(/끝난 기간 수\(9개\)/)).toBeInTheDocument();
    // 원금은 소비 합계에 없다.
    expect(document.querySelector('.led-totals')!.textContent).toContain('600,000');
  });
});
