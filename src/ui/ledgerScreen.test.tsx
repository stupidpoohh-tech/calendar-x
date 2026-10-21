/**
 * 가계부 화면 — 내역 · 현금흐름 · 예산 · 분석.
 *
 * 숫자 계산은 `ledgerStats.test` 가 본다. 여기서는 화면이 (1) 덜 받은 자료로 합계를 내지
 * 않는지, (2) 예산을 고칠 때 기간만 / 기본을 제대로 가르는지, (3) 정산 기간 이름과 범위가
 * 함께 보이는지, (4) 월평균의 정의가 화면에 적히는지 본다.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCategory, setDefaultBudget } from '../domain/category';
import { newEntry, newMoney } from '../domain/entry';
import type { CategoryBudget, Entry, LedgerTabId, MoneyFields } from '../domain/types';
import type { FeedState } from '../app/useStore';
import { pieSlices } from '../domain/ledgerStats';
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
    entries: [], feed: LIVE, categories: cats, categoryBudgets: [],
    ledgerNotes: [], notesFeed: LIVE, onSaveLedgerNote: vi.fn(),
    categoriesReady: true, onSeedCategories: vi.fn(), onEntryClick: vi.fn(),
    onSaveCategoryBudget: vi.fn(), subscribeAll: vi.fn(() => () => undefined),
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
    expect(within(document.querySelector('.led-totals') as HTMLElement).getByText('지출')).toBeInTheDocument();
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

  it('입력 리스트 — 내역의 하위 보기. 적던 줄은 목록을 다녀와도 남는다', () => {
    mount({ entries, onSaveMany: vi.fn(() => Promise.resolve({ ok: 0, failed: 0 })) });
    fireEvent.click(screen.getByRole('radio', { name: /입력 리스트/ }));
    expect(screen.getByRole('region', { name: '입력 리스트' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('1번째 줄 금액'), { target: { value: '7000' } });
    fireEvent.click(screen.getByRole('radio', { name: '목록' }));
    expect(screen.getByLabelText('적던 줄 있음')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /입력 리스트/ }));
    expect(screen.getByLabelText('1번째 줄 금액')).toHaveValue('7000');
  });

  it('날짜순(일자로 묶음)과 큰 금액순(묶지 않고 날짜를 줄에) 사이를 바꾼다', () => {
    mount({ entries });
    expect(screen.getByRole('radio', { name: '날짜순' })).toHaveAttribute('aria-checked', 'true');
    expect(document.querySelectorAll('.led-day').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('radio', { name: '큰 금액순' }));
    const flat = screen.getByRole('list', { name: '큰 금액순 거래' });
    const rows = within(flat).getAllByRole('button');
    expect(rows.map((r) => r.querySelector('.led-row-a')!.textContent)).toEqual(['+3,000,000', '−300,000', '−50,000', '−12,000']);
    expect(rows[3]!.textContent).toContain('10월 1일');
    expect(document.querySelectorAll('.led-day')).toHaveLength(0);
  });

  it('보기 — 전체 · 수입 · 지출로 목록을 거르고, 위의 합계는 그대로다', () => {
    mount({ entries });
    const amounts = () => [...document.querySelectorAll('.led-row-a')].map((n) => n.textContent);
    const totals = () => document.querySelector('.led-totals')!.textContent;
    const before = totals();
    expect(within(screen.getByRole('radiogroup', { name: '보기' })).getByRole('radio', { name: '전체' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '보기' })).getByRole('radio', { name: '수입' }));
    expect(amounts()).toEqual(['+3,000,000']);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '보기' })).getByRole('radio', { name: '지출' }));
    expect(amounts().sort()).toEqual(['−12,000', '−300,000', '−50,000'].sort());
    // 큰 금액순과 함께 쓴다.
    fireEvent.click(screen.getByRole('radio', { name: '큰 금액순' }));
    expect(amounts()).toEqual(['−300,000', '−50,000', '−12,000']);
    expect(totals()).toBe(before);
  });

  it('합계는 실제 거래만, 원금은 지출이 아니라 대금 — 수지 = 수입 − 지출 − 대금', () => {
    mount({ entries });
    const totals = document.querySelector('.led-totals')! as HTMLElement;
    const cell = (label: string) => within(totals).getByText(label, { selector: 'span' }).nextElementSibling!.textContent;
    expect(cell('수입')).toBe('3,000,000');
    expect(cell('지출')).toBe('12,000');
    expect(cell('대금')).toBe('300,000');
    expect(cell('수지')).toBe('+2,688,000');
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

  it('검색 범위를 정산 연도 · 전체로 넓힌다. 전체는 켜 둔 동안 구독하고, 끄면 끊는다', async () => {
    const old = tx('old', '2024-03-01', 7_000, {}, { title: '옛날 점심' });
    let push: ((items: Entry[]) => void) | null = null;
    const stop = vi.fn();
    const p = mount({ entries, subscribeAll: vi.fn((cb) => { push = cb; return stop; }) });
    fireEvent.change(screen.getByLabelText('거래 검색'), { target: { value: '점심' } });
    fireEvent.click(screen.getByRole('radio', { name: '2026년' }));
    expect(screen.getByRole('button', { name: /점심/ })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '검색 범위' })).getByRole('radio', { name: '전체' }));
    expect(p.subscribeAll).toHaveBeenCalledTimes(1);
    act(() => push!([old]));
    await waitFor(() => expect(screen.getByRole('button', { name: /옛날 점심/ })).toBeInTheDocument());
    // 결과에서 고친 것이 곧바로 반영된다 — 다시 읽지 않아도.
    act(() => push!([{ ...old, title: '옛날 저녁 점심' }]));
    expect(screen.getByRole('button', { name: /옛날 저녁 점심/ })).toBeInTheDocument();
    act(() => push!([]));
    expect(screen.queryByRole('button', { name: /옛날/ })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '이 기간' }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('연초 기간의 연도 검색은 정산 연도다 — 25일 기준 2026년 1월에서 2026년을 찾는다', () => {
    const dec = tx('dec', '2025-12-26', 5_000, {}, { title: '연말 점심' });   // 2026년 정산 연도의 첫 기간
    const early = tx('early', '2025-12-20', 5_000, {}, { title: '이른 점심' }); // 2025년 정산 연도
    const late = tx('late', '2026-12-24', 5_000, {}, { title: '마지막 점심' }); // 2026년의 마지막 날
    mount({ entries: [dec, early, late], periodKey: '2026-01' });
    expect(screen.getByRole('radio', { name: '2026년' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '2026년' }));
    expect(screen.getByText(/2026년 정산 연도 · 2025\.12\.25 – 2026\.12\.24/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /연말 점심/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /마지막 점심/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /이른 점심/ })).toBeNull();
  });

  it('추가(+) · 더보기(···)는 보기마다 기간 도구 옆에 — 따로 세운 거래 추가 단추는 없다', () => {
    const actions = <span data-testid="acts">+ ···</span>;
    for (const tab of ['history', 'budget', 'stats'] as const) {
      mount({ entries, tab, actions });
      const acts = screen.getByTestId('acts');
      expect(acts.closest('.led-toolbar')!.querySelector('.led-period')).not.toBeNull();
      expect(screen.queryByRole('button', { name: /거래 추가/ })).toBeNull();
      cleanup();
    }
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

  it('카테고리마다 예산 · 사용 · 남음(초과) · 사용률을 적는다. 지난 기간 결산은 없다', () => {
    mount({ tab: 'budget', entries, categoryBudgets: budgets });
    const list = screen.getByRole('list', { name: '카테고리별 예산' });
    const food = within(list).getByRole('button', { name: /식비/ });
    expect(within(food).getByLabelText('예산 300,000')).toBeInTheDocument();
    expect(within(food).getByLabelText('사용 320,000')).toBeInTheDocument();
    expect(within(food).getByLabelText('초과 20,000')).toBeInTheDocument();
    // 사용률은 줄 맨 오른쪽의 짧은 막대 — 숫자를 함께 적는다.
    expect(within(food).getByRole('img', { name: '사용률 107% (초과)' }).textContent).toBe('107%');
    expect(food.textContent).not.toContain('지난 기간');
    const cafe = within(list).getByRole('button', { name: /카페/ });
    expect(within(cafe).getByLabelText('예산 없음')).toBeInTheDocument();
    expect(within(cafe).getByLabelText('사용 9,000')).toBeInTheDocument();
    // 예산을 정한 카테고리가 먼저.
    expect(within(list).getAllByRole('button').map((b) => b.textContent?.slice(0, 2))).toEqual(['식비', '카페']);
  });

  it('줄을 누르면 이 기간의 그 카테고리 거래 카드가 펼쳐지고, 예산 고치기는 그 안에 있다', () => {
    const p = mount({ tab: 'budget', entries: [...entries, tx('d', '2026-10-01', 15_000, { categoryId: 'food' }, { title: '장보기' })], categoryBudgets: budgets });
    const food = screen.getByRole('button', { name: /식비/ });
    expect(food).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(food);
    const card = screen.getByRole('region', { name: '식비 거래' });
    expect(card.textContent).toContain('이 기간 2건');
    expect(card.textContent).toContain('합계 335,000');
    fireEvent.click(within(card).getByRole('button', { name: /장보기/ }));
    expect(p.onEntryClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'd' }));
    expect(screen.queryByLabelText('식비 예산')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: '예산 고치기' }));
    expect(screen.getByLabelText('식비 예산')).toHaveValue('300000');
    // 다른 줄을 펼치면 앞 카드는 접힌다.
    fireEvent.click(screen.getByRole('button', { name: /카페/ }));
    expect(screen.queryByRole('region', { name: '식비 거래' })).toBeNull();
    expect(screen.queryByLabelText('식비 예산')).toBeNull();
  });

  it('사용률 단계 — 100% 까지 · 100% 초과 · 200% 초과를 다르게 그린다', () => {
    const b = [setDefaultBudget('food', '2026-01', 100_000), setDefaultBudget('cafe', '2026-01', 10_000), setDefaultBudget('salary', '2026-01', 1)];
    mount({ tab: 'budget', entries: [tx('f', '2026-10-01', 80_000, { categoryId: 'food' }), tx('c', '2026-10-01', 25_000, { categoryId: 'cafe' })], categoryBudgets: b });
    const food = screen.getByRole('img', { name: '사용률 80%' });
    expect(food.className).toContain('ub-ok');
    expect((food.querySelector('.ub-f') as HTMLElement).style.width).toBe('80%');
    const cafe = screen.getByRole('img', { name: '사용률 250% (두 배 초과)' });
    expect(cafe.className).toContain('ub-over2');
    cleanup();
    mount({ tab: 'budget', entries: [tx('f', '2026-10-01', 150_000, { categoryId: 'food' })], categoryBudgets: b });
    const over = screen.getByRole('img', { name: '사용률 150% (초과)' });
    expect(over.className).toContain('ub-over');
    // 넘은 몫(50%)을 진하게 겹친다.
    expect((over.querySelector('.ub-x') as HTMLElement).style.width).toBe('50%');
  });

  it('요약은 예산을 정한 카테고리만 견주고, 예산 밖 지출을 따로 적는다', () => {
    mount({ tab: 'budget', entries, categoryBudgets: budgets });
    const sum = screen.getByRole('group', { name: '예산 요약' });
    const cell = (label: string) => within(sum).getByText(label, { selector: 'span' }).nextElementSibling!.textContent;
    expect(cell('총 예산')).toBe('300,000');
    expect(cell('실제 사용')).toBe('320,000');
    expect(cell('초과')).toBe('20,000');
    expect(sum.textContent).toContain('사용률 107%');
    expect(sum.textContent).toContain('초과 1개');
    expect(sum.textContent).toContain('예산 밖 지출 9,000 (카페) — 남은 예산에는 넣지 않습니다');
  });

  it('남으면 "남은 예산" 으로, 예산이 하나도 없으면 정하라고 적는다', () => {
    mount({ tab: 'budget', entries: entries.slice(1), categoryBudgets: budgets });
    const sum = screen.getByRole('group', { name: '예산 요약' });
    expect(within(sum).getByText('남은 예산', { selector: 'span' }).nextElementSibling!.textContent).toBe('300,000');
    cleanup();
    mount({ tab: 'budget', entries });
    const none = screen.getByRole('group', { name: '예산 요약' });
    expect(none.textContent).toContain('아직 정한 예산이 없습니다');
    expect(none.textContent).toContain('예산 밖 지출 329,000');
  });

  it('수입 결산과 기간 메모는 예산 보기에 없다 — 분석으로 옮겼다', () => {
    mount({ tab: 'budget', entries: [...entries, tx('s', '2026-09-25', 3_000_000, { type: 'income', categoryId: 'salary' })], categoryBudgets: budgets });
    expect(screen.queryByText('수입 결산')).toBeNull();
    expect(screen.queryByText('급여')).toBeNull();
    expect(screen.queryByRole('heading', { name: /돌아보기/ })).toBeNull();
  });

  it('진행 중인 기간 — "이 기간만" 과 "기본 예산(이번 기간부터)" 을 가른다', () => {
    const p = mount({ tab: 'budget', periodKey: '2026-10', entries, categoryBudgets: budgets });
    fireEvent.click(screen.getByRole('button', { name: /카페/ }));
    fireEvent.click(screen.getByRole('button', { name: '예산 정하기' }));
    fireEvent.change(screen.getByLabelText('카페 예산'), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: /기본 예산으로/ }));
    expect(p.onSaveCategoryBudget).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cafe~default~2026-10', scope: 'default', period: '2026-10', amountMinor: 50_000,
    }));
  });

  it('지난 기간에서는 기본 예산을 바꾸지 못한다 — 소급되면 지난 결산이 바뀐다', () => {
    const p = mount({ tab: 'budget', periodKey: '2026-08', entries, categoryBudgets: budgets });
    fireEvent.click(screen.getByRole('button', { name: /식비/ }));
    fireEvent.click(screen.getByRole('button', { name: '예산 고치기' }));
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

describe('보기 전환', () => {
  it('렌즈 바로 아래 네 보기 — 고른 보기의 본문 하나만 그린다', () => {
    const p = mount({ cashflow: <div>현금흐름 본문</div> });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['내역', '현금흐름', '예산', '분석']);
    expect(screen.queryByText('현금흐름 본문')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '현금흐름' }));
    expect(p.onTab).toHaveBeenCalledWith('cashflow' satisfies LedgerTabId);
  });

  it('현금흐름은 결산 구독과 무관하게 그린다 — 자기 계산 상태를 따른다', () => {
    mount({ tab: 'cashflow', feed: { ...LIVE, status: 'loading', ready: false }, cashflow: <div>현금흐름 본문</div> });
    expect(screen.getByText('현금흐름 본문')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('예산 보기는 카테고리 예산만 — 생활비 · 세이브는 현금흐름으로 옮겼다', () => {
    mount({ tab: 'budget' });
    expect(screen.getByRole('heading', { name: '카테고리 예산' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /생활비 주머니/ })).toBeNull();
    expect(screen.queryByText(/생활비 만들기|세이브 추가/)).toBeNull();
    expect(document.querySelector('.led-body')!.textContent).not.toContain('한도');
  });
});

describe('분석 · 월별 추이', () => {
  it('열두 기간을 표로 적고 진행 중인 기간을 표시한다', () => {
    const p = mount({
      tab: 'stats', periodKey: '2026-10',
      entries: [tx('a', '2026-09-26', 10_000), tx('s', '2026-05-25', 2_000_000, { type: 'income' })],
    });
    expect(screen.getByRole('radio', { name: '월별 추이' })).toHaveAttribute('aria-checked', 'true');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(12);
    expect(rows[0]!.textContent).toContain('2026년 10월');
    expect(rows[0]!.textContent).toContain('진행 중');
    expect(screen.getByRole('img', { name: '정산 기간별 수입, 지출과 대금' })).toBeInTheDocument();
    fireEvent.click(within(rows[4]!).getByRole('button', { name: '2026년 6월' }));
    expect(p.onPeriodKey).toHaveBeenCalledWith('2026-06');
    expect(p.onTab).toHaveBeenCalledWith('history' satisfies LedgerTabId);
  });
});

describe('분석 · 카테고리 — 정산 기간 하나', () => {
  const open = (over: Partial<LedgerScreenProps>) => {
    mount({ tab: 'stats', settleDay: 1, ...over });
    fireEvent.click(screen.getByRole('radio', { name: '카테고리' }));
  };

  it('고른 기간의 카테고리 금액 · 비중, 월평균은 열두 기간 중 끝난 기간으로', () => {
    open({
      entries: [
        tx('a', '2026-01-10', 100_000, { categoryId: 'food' }),
        tx('b', '2026-02-10', 200_000, { categoryId: 'food' }),
        tx('c', '2026-10-05', 300_000, { categoryId: 'food' }),
        tx('d', '2026-10-06', 100_000, { categoryId: 'cafe' }),
        tx('i', '2026-03-01', 20_000, { flow: 'loanInterest' }),
        tx('p', '2026-10-01', 500_000, { flow: 'loanPrincipal' }),
      ],
    });
    expect(screen.getByText('2026년 10월')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: '카테고리별 소비' });
    const food = within(list).getByText('식비').closest('li')!;
    // 큰 숫자는 이 기간 금액.
    expect(food.querySelector('.led-stat-h > .num')!.textContent).toBe('300,000');
    expect(food.textContent).toContain('소비의 75%');
    // 2025-11 ~ 2026-09 끝난 기간 11개. (100,000 + 200,000) / 11
    expect(food.textContent).toContain('월평균 27,273');
    expect(screen.getByText(/끝난 기간 수\(11개\)/)).toBeInTheDocument();
    // 이자는 3월이라 이 기간 금융비용 줄이 없다. 원금은 소비가 아니다.
    expect(within(list).queryByText('금융비용 (대출 이자)')).toBeNull();
    expect(document.querySelector('.led-totals')!.textContent).toContain('400,000');
    // 원형 차트와 범례.
    expect(screen.getByRole('img', { name: '카테고리별 소비 비중' })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: '소비 비중' });
    expect(legend.textContent).toContain('식비75%');
    expect(legend.textContent).toContain('카페25%');
  });

  it('카테고리 줄을 누르면 이 기간의 그 카테고리 거래가 아래 카드로 펼쳐진다 — 하나만, 다시 누르면 접힌다', () => {
    const p = mount({
      tab: 'stats', settleDay: 1,
      entries: [
        tx('c', '2026-10-05', 300_000, { categoryId: 'food' }, { title: '장보기' }),
        tx('e', '2026-10-07', 20_000, { categoryId: 'food' }, { title: '점심' }),
        tx('old', '2026-09-07', 9_000, { categoryId: 'food' }, { title: '지난달 점심' }),
        tx('d', '2026-10-06', 100_000, { categoryId: 'cafe' }, { title: '원두' }),
      ],
    });
    fireEvent.click(screen.getByRole('radio', { name: '카테고리' }));
    const food = screen.getByRole('button', { name: '식비 거래 보기' });
    expect(food).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(food);
    const card = screen.getByRole('region', { name: '식비 거래' });
    expect(card.textContent).toContain('이 기간 2건');
    expect(card.textContent).toContain('합계 320,000');
    const rows = within(card).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['10월 7일 (수)점심20,000', '10월 5일 (월)장보기300,000']);
    fireEvent.click(rows[1]!);
    expect(p.onEntryClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }));
    // 다른 줄을 펼치면 앞 카드는 접힌다.
    fireEvent.click(screen.getByRole('button', { name: '카페 거래 보기' }));
    expect(screen.queryByRole('region', { name: '식비 거래' })).toBeNull();
    expect(screen.getByRole('region', { name: '카페 거래' }).textContent).toContain('원두');
    fireEvent.click(screen.getByRole('button', { name: '카페 거래 접기' }));
    expect(screen.queryByRole('region', { name: '카페 거래' })).toBeNull();
  });

  it('최근 1년 — 열두 기간의 합계 · 월평균을 토글로, 원형 · 줄 · 카드가 같은 범위를 본다', () => {
    const p = mount({
      tab: 'stats', settleDay: 1,
      entries: [
        tx('a', '2026-01-10', 100_000, { categoryId: 'food' }),
        tx('b', '2026-02-10', 200_000, { categoryId: 'food' }),
        tx('c', '2026-10-05', 300_000, { categoryId: 'food' }),
        tx('d', '2026-10-06', 100_000, { categoryId: 'cafe' }),
        tx('old', '2025-09-10', 999_000, { categoryId: 'food' }), // 창 밖
      ],
    });
    fireEvent.click(screen.getByRole('radio', { name: '카테고리' }));
    expect(screen.queryByRole('radiogroup', { name: '1년 금액' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '최근 1년' }));
    expect(screen.getByRole('radio', { name: '합계' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('2025년 11월 – 2026년 10월', { selector: '.led-span .led-note' })).toBeInTheDocument();
    const totals = () => document.querySelector('.led-totals > div')!.textContent;
    expect(totals()).toBe('소비 · 1년 합계700,000');
    const legend = screen.getByRole('list', { name: '소비 비중' });
    expect(legend.textContent).toContain('식비85.7%');
    const list = screen.getByRole('list', { name: '카테고리별 소비' });
    const food = within(list).getByText('식비').closest('li')!;
    expect(food.querySelector('.led-stat-h > .num')!.textContent).toBe('600,000');
    expect(food.textContent).not.toContain('직전');
    // 카드도 1년 범위다.
    fireEvent.click(screen.getByRole('button', { name: '식비 거래 보기' }));
    const card = screen.getByRole('region', { name: '식비 거래' });
    expect(card.textContent).toContain('최근 1년 3건');
    expect(card.textContent).toContain('합계 600,000');
    expect(card.textContent).toContain('1월 10일 (토)');
    fireEvent.click(within(card).getAllByRole('button')[0]!);
    expect(p.onEntryClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }));

    // 월평균 — 끝난 기간 11개로 나눈다. 진행 중인 10월은 넣지 않는다.
    fireEvent.click(screen.getByRole('radio', { name: '월평균' }));
    expect(totals()).toBe('소비 · 월평균27,273');
    const food2 = within(screen.getByRole('list', { name: '카테고리별 소비' })).getByText('식비').closest('li')!;
    expect(food2.querySelector('.led-stat-h > .num')!.textContent).toBe('27,273');
    expect(food2.textContent).toContain('1년 합계 600,000');
    // 끝난 기간에 쓰지 않은 카페는 월평균 0이라 원형에서 빠진다.
    expect(screen.getByRole('list', { name: '소비 비중' }).textContent).not.toContain('카페');

    fireEvent.click(screen.getByRole('radio', { name: '이 기간' }));
    expect(totals()).toContain('400,000');
  });

  it('기간을 옮기면 그 기간을 본다', () => {
    const p = mount({ tab: 'stats', settleDay: 1 });
    fireEvent.click(screen.getByRole('radio', { name: '카테고리' }));
    fireEvent.click(screen.getByRole('button', { name: '이전 기간' }));
    expect(p.onPeriodKey).toHaveBeenCalledWith('2026-09');
  });

  it('소비 기록이 없으면 그렇다고 적는다', () => {
    open({ entries: [tx('s', '2026-10-02', 1_000_000, { type: 'income' })] });
    expect(screen.getByText('2026년 10월에 기록한 소비가 없습니다.')).toBeInTheDocument();
  });
});

describe('원형 차트 조각', () => {
  it('큰 순서로 여섯까지 제 색, 나머지는 하나로 접는다. 0원은 조각이 없다', () => {
    const items = [10, 80, 30, 70, 0, 50, 60, 20, 40].map((v, i) => ({ key: `k${i}`, name: `c${i}`, value: v }));
    const out = pieSlices(items);
    expect(out.map((x) => x.value)).toEqual([80, 70, 60, 50, 40, 30, 30]);
    expect(out.map((x) => x.slot)).toEqual([1, 2, 3, 4, 5, 6, null]);
    expect(out[6]!.name).toBe('그 밖 2개');
    expect(pieSlices(items.slice(0, 3)).every((x) => x.slot !== null)).toBe(true);
  });
});

describe('분석 · 기간 돌아보기', () => {
  it('적은 글을 보여 주고, 고쳐 저장하면 그 기간 열쇠로 한 장을 쓴다', () => {
    const note = { id: '2026-10', period: '2026-10', text: '배달 줄이기', createdAt: 'c', updatedAt: 'u' };
    const p = mount({ tab: 'stats', ledgerNotes: [note] });
    expect(screen.getByRole('heading', { name: /^기간 돌아보기 2026년 10월/ })).toBeInTheDocument();
    expect(screen.getByText('배달 줄이기')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '고치기' }));
    fireEvent.change(screen.getByLabelText('2026년 10월 메모'), { target: { value: '배달 줄이기\n외식 주 1회  ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(p.onSaveLedgerNote).toHaveBeenCalledWith(expect.objectContaining({
      id: '2026-10', period: '2026-10', text: '배달 줄이기\n외식 주 1회', createdAt: 'c',
    }));
  });

  it('바꾸지 않고 저장하면 쓰지 않는다', () => {
    const p = mount({ tab: 'stats' });
    fireEvent.click(screen.getByRole('button', { name: '적기' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(p.onSaveLedgerNote).not.toHaveBeenCalled();
  });

  it('메모를 아직 못 받았으면 고칠 수 없다 — 빈 칸으로 저장해 서버의 글을 덮지 않는다', () => {
    mount({ tab: 'stats', notesFeed: { ...LIVE, status: 'loading', ready: false } });
    expect(screen.queryByRole('button', { name: '적기' })).toBeNull();
    expect(screen.getByText('메모를 불러오는 중입니다.')).toBeInTheDocument();
    cleanup();
    mount({ tab: 'stats', notesFeed: { ...LIVE, status: 'cache', empty: true, fromCache: true } });
    expect(screen.queryByRole('button', { name: '적기' })).toBeNull();
  });

  it('월별 추이와 카테고리가 같은 기간을 보고, 돌아보기는 한 번만 그린다', () => {
    const note = { id: '2026-09', period: '2026-09', text: '9월 메모', createdAt: 'c', updatedAt: 'u' };
    mount({ tab: 'stats', periodKey: '2026-09', ledgerNotes: [note] });
    expect(screen.getAllByRole('heading', { name: /기간 돌아보기/ })).toHaveLength(1);
    expect(screen.getByText('9월 메모')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '카테고리' }));
    expect(screen.getAllByRole('heading', { name: /기간 돌아보기/ })).toHaveLength(1);
    expect(screen.getByText('9월 메모')).toBeInTheDocument();
    // 기간 도구는 하위 보기보다 위에 하나 — 두 하위 보기가 같은 것을 쓴다.
    expect(screen.getAllByRole('button', { name: '이전 기간' })).toHaveLength(1);
  });
});

describe('분석 · 직전 대비 · 쓰지 않은 카테고리 · 수입원', () => {
  const entries = [
    tx('f9', '2026-09-10', 200_000, { categoryId: 'food' }),
    tx('c9', '2026-09-11', 30_000, { categoryId: 'cafe' }),
    tx('f10', '2026-10-05', 260_000, { categoryId: 'food' }),
    tx('s9', '2026-09-01', 3_000_000, { type: 'income', categoryId: 'salary' }),
    tx('s10', '2026-10-01', 3_000_000, { type: 'income', categoryId: 'salary' }),
    tx('x10', '2026-10-02', 500_000, { type: 'income' }, { title: '과외비' }),
  ];
  const open = () => {
    mount({ tab: 'stats', settleDay: 1, entries });
    fireEvent.click(screen.getByRole('radio', { name: '카테고리' }));
  };

  it('합계와 줄에 직전 기간 대비를 적는다 — 이미 받은 열두 기간에서 센다', () => {
    open();
    const totals = document.querySelector('.led-totals')!;
    expect(totals.textContent).toContain('직전 +30,000');   // 소비 260,000 vs 230,000
    expect(totals.textContent).toContain('직전 +500,000');  // 수입
    const food = within(screen.getByRole('list', { name: '카테고리별 소비' })).getByText('식비').closest('li')!;
    expect(food.textContent).toContain('직전 +60,000');
  });

  it('이번 기간에 0원인 카테고리는 접은 묶음에 남는다', () => {
    open();
    const idle = screen.getByRole('list', { name: '이번 기간에 쓰지 않은 카테고리' });
    expect(idle.textContent).toContain('카페');
    expect(idle.textContent).toContain('직전 −30,000');
    expect(screen.getByText(/이번 기간 0원 · 1개 카테고리/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: '카테고리별 소비' })).queryByText('카페')).toBeNull();
  });

  it('수입원별 금액과 비중 — 미분류도 빠뜨리지 않는다', () => {
    open();
    const income = screen.getByRole('list', { name: '수입원별 금액' });
    const rows = within(income).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.led-stat-n')!.textContent)).toEqual(['급여', '미분류']);
    expect(rows[0]!.textContent).toContain('3,000,000');
    expect(rows[0]!.textContent).toContain('수입의 85.7%');
    expect(rows[1]!.textContent).toContain('500,000');
  });

  it('수입이 없으면 그렇다고 적는다', () => {
    mount({ tab: 'stats', settleDay: 1, entries: entries.slice(0, 3) });
    fireEvent.click(screen.getByRole('radio', { name: '카테고리' }));
    expect(screen.getByText('2026년 10월에 기록한 수입이 없습니다.')).toBeInTheDocument();
  });
});
