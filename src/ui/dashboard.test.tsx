import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDemoStore } from '../app/useDemoStore';
import { FEED_ERROR, FEED_LOADING } from '../app/useStore';
import { newEntry, newMoney, setRecurrence } from '../domain/entry';
import { materialize } from '../domain/recurrence';
import { Dashboard } from './Dashboard';
import { dashboardEntries } from '../domain/dashboard';

afterEach(cleanup);
const TODAY = '2026-10-30';
describe('대시보드 일정 범위', () => {
  it('월말에서 다음 달 반복과 여러 날 일정을 포함하며 범위 밖 일정을 제외한다', () => {
    const recurring = setRecurrence(newEntry('task', { id: 'repeat', startDate: '2026-01-01' }), { freq: 'daily', interval: 1, until: null, count: null });
    const span = newEntry('task', { id: 'span', startDate: '2026-10-28', endDate: '2026-11-02' });
    const old = newEntry('task', { id: 'old', startDate: '2026-10-29' });
    const later = newEntry('task', { id: 'later', startDate: '2026-11-06' });
    const result = dashboardEntries([recurring, span, old, later], TODAY);
    expect(result.tasks).toHaveLength(8);
    expect(result.tasks.some(e => e.startDate === '2026-11-05')).toBe(true);
    expect(result.tasks.some(e => e.id === 'old' || e.id === 'later')).toBe(false);
  });
  it('노트는 이번 달 기록만 최근 수정 순으로 낸다', () => {
    const a = newEntry('idea', { id: 'a', startDate: '2026-10-01', updatedAt: '2026-10-10T01:00:00Z' });
    const b = newEntry('idea', { id: 'b', startDate: '2026-10-02', updatedAt: '2026-10-11T01:00:00Z' });
    const old = newEntry('idea', { id: 'old', startDate: '2026-09-30' });
    expect(dashboardEntries([a, b, old], TODAY).notes.map(e => e.id)).toEqual(['b', 'a']);
  });
});

function setup() {
  const { result } = renderHook(useDemoStore);
  return { today: TODAY, store: result.current, showMoney: true, showNotes: true, demo: false,
    onNavigate: vi.fn(), onEntry: vi.fn(), onStatus: vi.fn(), onPromote: vi.fn(), onCreate: vi.fn() };
}
describe('대시보드 표시와 연결', () => {
  it.each([FEED_LOADING, FEED_ERROR, { ...FEED_LOADING, ready: true, empty: true, fromCache: true }])('자료 미확인 상태를 빈 일정이나 0원으로 표시하지 않는다', feed => {
    const props = setup();
    render(<Dashboard {...props} store={{ ...props.store, display: feed, calc: feed }} />);
    expect(screen.queryByText('비워 둔 하루입니다')).not.toBeInTheDocument();
    expect(screen.queryByText('0개 중 0개 완료')).not.toBeInTheDocument();
    expect(document.querySelector('.dash-amount')).toBeNull();
  });
  it('숨긴 노트·가계부를 제외하고 날짜 선택·완료·상세·이동 액션을 연결한다', () => {
    const props = setup();
    const entry = newEntry('task', { id: 't', title: '월말 점검', startDate: '2026-11-01' });
    render(<Dashboard {...props} showMoney={false} showNotes={false} store={{ ...props.store, entries: [entry] }} />);
    expect(screen.queryByRole('region', { name: '현금흐름 요약' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '이번 달 최근 노트' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '01일 (일)' }));
    fireEvent.click(screen.getByRole('button', { name: '월말 점검 완료로 표시' }));
    expect(props.onStatus).toHaveBeenCalledWith(entry, 'done');
    fireEvent.click(screen.getByRole('button', { name: '종일 월말 점검' }));
    expect(props.onEntry).toHaveBeenCalledWith(entry);
    fireEvent.click(screen.getByRole('button', { name: '선택한 날짜에 일정 추가' }));
    expect(props.onCreate).toHaveBeenCalledWith('task', '2026-11-01');
    fireEvent.click(screen.getByRole('button', { name: '캘린더' }));
    expect(props.onNavigate).toHaveBeenCalledWith('task');
  });
  it('자정 이후 선택일이 범위 밖이면 새 오늘로 돌아간다', () => {
    const props = setup(); const { rerender } = render(<Dashboard {...props} />);
    rerender(<Dashboard {...props} today="2026-10-31" />);
    expect(screen.getByRole('button', { name: '31일 (토) 오늘' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('반복 구독이 미완료면 월 자료가 있어도 일정 수를 확정하지 않는다', () => {
    const props = setup();
    render(<Dashboard {...props} store={{ ...props.store, dashboardFeed: FEED_LOADING }} />);
    expect(screen.getByRole('status')).toHaveTextContent('일정을 불러오는 중');
    expect(screen.queryByText('비워 둔 하루입니다')).not.toBeInTheDocument();
  });
  it('화면용 반복 발생분 대신 금융 원본으로 한도를 계산한다', () => {
    const props = setup();
    const account = { ...props.store.accounts[0]!, balanceMinor: 100000, asOf: TODAY, currency: 'KRW' };
    const plan = setRecurrence(newEntry('money', { startDate: '2026-10-31', money: newMoney({ amountMinor: 1000, type: 'expense', status: 'planned' }) }), { freq: 'daily', interval: 1, until: null, count: 3 });
    const store = { ...props.store, accounts: [account], tideEntries: [plan], entries: materialize([plan], TODAY, '2026-11-05'), budgets: [], reserves: [], cards: [], cardLinked: [], reserveUsage: new Map<string, number>() };
    render(<Dashboard {...props} store={store} />);
    expect(document.querySelector('.dash-amount')).toHaveTextContent('97,000원');
  });
});
