import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDemoStore } from '../app/useDemoStore';
import { FEED_ERROR, FEED_LOADING } from '../app/useStore';
import { newEntry, newMoney, setRecurrence } from '../domain/entry';
import { Dashboard } from './Dashboard';
import { dashboardCashDays, dashboardEntries, dashboardSpending } from '../domain/dashboard';

afterEach(cleanup);
const TODAY = '2026-10-30';
const CURSOR = new Date(2026, 9, 30);
function setup() {
  const { result } = renderHook(useDemoStore);
  return { today: TODAY, cursor: CURSOR, weekStart: 'mon' as const, query: '', onCursorChange: vi.fn(),
    store: result.current, showMoney: true, showNotes: true, demo: false,
    onNavigate: vi.fn(), onEntry: vi.fn(), onStatus: vi.fn(), onCreate: vi.fn() };
}
describe('참고 화면 대시보드', () => {
  it('월간 42칸의 반복과 여러 날 일정을 포함하며 범위 밖 일정은 제외한다', () => {
    const recurring = setRecurrence(newEntry('task', { id: 'repeat', startDate: '2026-01-01' }), { freq: 'daily', interval: 1, until: null, count: null });
    const span = newEntry('task', { id: 'span', startDate: '2026-09-27', endDate: '2026-09-29' });
    const old = newEntry('task', { id: 'old', startDate: '2026-09-27' });
    const later = newEntry('task', { id: 'later', startDate: '2026-11-09' });
    const result = dashboardEntries([recurring, span, old, later], CURSOR, 'mon');
    expect(result.tasks).toHaveLength(43);
    expect(result.tasks.some(e => e.startDate === '2026-11-08')).toBe(true);
    expect(result.tasks.some(e => e.id === 'old' || e.id === 'later')).toBe(false);
  });
  it('노트는 표시한 달의 기록만 최근 수정 순으로 낸다', () => {
    const a = newEntry('idea', { id: 'a', startDate: '2026-10-01', updatedAt: '2026-10-10T01:00:00Z' });
    const b = newEntry('idea', { id: 'b', startDate: '2026-10-02', updatedAt: '2026-10-11T01:00:00Z' });
    const old = newEntry('idea', { id: 'old', startDate: '2026-09-30' });
    expect(dashboardEntries([a, b, old], CURSOR, 'mon').notes.map(e => e.id)).toEqual(['b', 'a']);
  });
  it.each([FEED_LOADING, FEED_ERROR, { ...FEED_LOADING, ready: true, empty: true, fromCache: true }])('미확인 자료를 빈 일정이나 0원으로 표시하지 않는다', feed => {
    const props = setup();
    render(<Dashboard {...props} store={{ ...props.store, display: feed, dashboardFeed: feed, ledgerMeta: feed }} />);
    expect(screen.queryByText('등록된 일정이 없습니다.')).not.toBeInTheDocument();
    expect(document.querySelector('.ref-expense-amount')).toBeNull();
  });
  it('날짜 선택·할 일 완료·상세·추가를 연결하고 숨긴 기능은 제외한다', () => {
    const props = setup();
    const entry = newEntry('task', { id: 't', title: '월말 점검', startDate: '2026-10-31' });
    render(<Dashboard {...props} showMoney={false} showNotes={false} store={{ ...props.store, entries: [entry] }} />);
    expect(screen.queryByRole('region', { name: '월 지출 요약' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '이번 달 노트' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2026-10-31 상세 보기' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '월말 점검 완료' }));
    expect(props.onStatus).toHaveBeenCalledWith(entry, 'done');
    fireEvent.click(within(screen.getByRole('region', { name: '선택한 날 할 일' })).getByRole('button', { name: '월말 점검' }));
    expect(props.onEntry).toHaveBeenCalledWith(entry);
    fireEvent.click(screen.getByRole('button', { name: '선택한 날짜에 일정 추가' }));
    expect(props.onCreate).toHaveBeenCalledWith('task', '2026-10-31');
    fireEvent.click(within(screen.getByRole('navigation', { name: '대시보드 메뉴' })).getByRole('button', { name: '캘린더' }));
    expect(props.onNavigate).toHaveBeenCalledWith('task');
  });
  it('시간 있는 일정과 종일 할 일을 구분하고 검색을 두 패널에 적용한다', () => {
    const props = setup();
    const entries = [newEntry('task', { id: 'meeting', title: '고객 회의', startDate: TODAY, startTime: '10:00' }),
      newEntry('task', { id: 'todo', title: '제안서 초안', startDate: TODAY })];
    const { rerender } = render(<Dashboard {...props} store={{ ...props.store, entries }} />);
    expect(within(screen.getByRole('region', { name: '선택한 날 일정' })).getByText('고객 회의')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '선택한 날 할 일' })).queryByText('고객 회의')).toBeNull();
    rerender(<Dashboard {...props} query="제안서" store={{ ...props.store, entries }} />);
    expect(screen.queryByText('고객 회의')).toBeNull();
    expect(screen.getByRole('checkbox', { name: '제안서 초안 완료' })).toBeInTheDocument();
  });
  it('월 이동은 구독 커서를 바꾸고 일·주·목록 전환이 실제 내용을 바꾼다', () => {
    const props = setup();
    render(<Dashboard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '다음 기간' }));
    expect(props.onCursorChange).toHaveBeenCalledWith(new Date(2026, 10, 1));
    fireEvent.click(screen.getByRole('button', { name: '일' }));
    expect(document.querySelectorAll('.ref-date-list section')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '주' }));
    expect(document.querySelectorAll('.ref-date-list section')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: '다음 기간' }));
    expect(props.onCursorChange).toHaveBeenLastCalledWith(new Date(2026, 10, 6));
    fireEvent.click(screen.getByRole('button', { name: '목록' }));
    expect(document.querySelector('.ref-view-list')).toBeInTheDocument();
  });
  it('지출은 실제 거래만 포함하고 이체·카드대금·원금·예정을 제외한다', () => {
    const props = setup();
    const entry = (id: string, amount: number, flow: 'normal' | 'cardSpend' | 'cardPayment' | 'transfer' | 'loanPrincipal' | 'loanInterest', status: 'actual' | 'planned' = 'actual') =>
      newEntry('money', { id, startDate: '2026-10-10', money: newMoney({ type: 'expense', flow, status, amountMinor: amount }) });
    const store = { ...props.store, ledger: { ...props.store.ledger, settleDay: 1 },
      entries: [entry('expense', 1000, 'normal'), entry('card', 2000, 'cardSpend'), entry('interest', 300, 'loanInterest'),
        entry('payment', 2000, 'cardPayment'), entry('transfer', 5000, 'transfer'), entry('loan', 3000, 'loanPrincipal'), entry('plan', 8000, 'normal', 'planned')] };
    expect(dashboardSpending(store, '2026-10').spending).toBe(3300);
  });
  it('정산 시작일과 통화 제한을 존중한다', () => {
    const props = setup();
    const entry = newEntry('money', { startDate: '2026-09-25', money: newMoney({ type: 'expense', status: 'actual', amountMinor: 1000 }) });
    const store = { ...props.store, ledger: { ...props.store.ledger, settleDay: 25 }, entries: [entry], categoryBudgets: [] };
    const result = dashboardSpending(store, '2026-10');
    expect(result.period.start).toBe('2026-09-25');
    expect(result.period.end).toBe('2026-10-24');
    expect(result.spending).toBe(1000);
    expect(dashboardSpending({ ...store, entries: [{ ...entry, money: { ...entry.money!, currency: 'USD' } }] }, '2026-10').supported).toBe(false);
  });
  it('메뉴 네 개를 각각 연결하고 오늘·할 일 메뉴는 제거한다', () => {
    const props = setup();
    render(<Dashboard {...props} />);
    const nav = within(screen.getByRole('navigation', { name: '대시보드 메뉴' }));
    expect(nav.getAllByRole('button').map(b => b.textContent)).toEqual(['대시보드', '캘린더', '노트', '가계부']);
    for (const [name, lens] of [['대시보드', 'all'], ['캘린더', 'task'], ['노트', 'idea'], ['가계부', 'money']]) {
      fireEvent.click(nav.getByRole('button', { name }));
      expect(props.onNavigate).toHaveBeenLastCalledWith(lens);
    }
  });
  it('일정과 모든 노트를 달력에 표시하고 금융 상세 대신 날짜별 합계를 낸다', () => {
    const props = setup();
    const notes = Array.from({ length: 7 }, (_, i) => newEntry('idea', { id: 'n' + i, title: '기록 ' + i, startDate: TODAY }));
    const expense = newEntry('money', { id: 'm', title: '숨길 상세 거래명', startDate: TODAY, money: newMoney({ type: 'expense', status: 'actual', amountMinor: 12000 }) });
    const task = newEntry('task', { id: 't', title: '회의', startDate: TODAY });
    render(<Dashboard {...props} store={{ ...props.store, entries: [...notes, task, expense] }} />);
    const day = within(screen.getByRole('region', { name: TODAY }));
    expect(day.getByText('회의')).toBeInTheDocument();
    notes.forEach(n => expect(day.getByText(n.title)).toBeInTheDocument());
    expect(day.getByText('출금 −12,000')).toBeInTheDocument();
    expect(screen.queryByText('숨길 상세 거래명')).not.toBeInTheDocument();
    const panel = within(screen.getByRole('region', { name: '이번 달 노트' }));
    notes.forEach(n => expect(panel.getByText(n.title)).toBeInTheDocument());
    fireEvent.click(day.getByText('기록 6'));
    expect(props.onEntry).toHaveBeenCalledWith(notes[6]);
  });
  it('현금 합계는 실제·예정을 구분하며 중복과 카드 사용을 제외한다', () => {
    const actual = newEntry('money', { id: 'a', startDate: TODAY, money: newMoney({ type: 'income', status: 'actual', amountMinor: 30000 }) });
    const plan = newEntry('money', { id: 'p', startDate: TODAY, money: newMoney({ type: 'expense', status: 'planned', amountMinor: 9000 }) });
    const card = newEntry('money', { id: 'c', startDate: TODAY, money: newMoney({ type: 'expense', flow: 'cardSpend', status: 'actual', amountMinor: 5000 }) });
    expect(dashboardCashDays([actual, actual, plan, card], TODAY, TODAY)[TODAY]).toEqual({ income: 30000, outflow: 0, plannedIncome: 0, plannedOutflow: 9000, supported: true });
    expect(dashboardCashDays([{ ...actual, money: { ...actual.money!, currency: 'USD' } }], TODAY, TODAY)[TODAY]?.supported).toBe(false);
  });
  it('기간 예정은 일할 배분하고 실제 기간 거래는 거래일에만 합산한다', () => {
    const span = newEntry('money', { id: 'span', startDate: '2026-10-01', endDate: '2026-10-03', money: newMoney({ type: 'expense', status: 'planned', amountMinor: 1000 }) });
    const actual = { ...span, id: 'actual', money: { ...span.money!, status: 'actual' as const } };
    const days = dashboardCashDays([span, actual], '2026-10-01', '2026-10-03');
    expect(Object.values(days).reduce((n, d) => n + d.plannedOutflow, 0)).toBe(1000);
    expect(days['2026-10-01']?.outflow).toBe(1000);
    expect(days['2026-10-02']?.outflow).toBe(0);
  });
  it('확정된 반복 회차를 예정 합계에 중복 표시하지 않는다', () => {
    const plan = setRecurrence(newEntry('money', { id: 'plan', startDate: '2026-10-01', money: newMoney({ type: 'expense', status: 'planned', amountMinor: 1000 }) }), { freq: 'daily', interval: 1, until: null, count: null });
    const actual = newEntry('money', { id: 'actual', startDate: '2026-10-02', money: newMoney({ type: 'expense', status: 'actual', amountMinor: 900, plannedRef: { entryId: 'plan', date: '2026-10-02' } }) });
    const days = dashboardCashDays([plan, actual], '2026-10-01', '2026-10-03');
    expect(days['2026-10-02']).toMatchObject({ outflow: 900, plannedOutflow: 0 });
    expect(days['2026-10-03']?.plannedOutflow).toBe(1000);
  });
});
