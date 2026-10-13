/**
 * 현금흐름에서 생활비 · 세이브를 관리한다.
 *
 *  - 달력의 생활비 막대는 `Budget` 에서 그린다. 누르면 거래 창이 아니라 그 Budget id 로 간다 —
 *    여러 주에 걸쳐 끊겨 그려져도 조각마다 같은 id 다. 예상 잔고 숫자는 그대로다
 *  - 카드의 확보 줄이 같은 창을 연다(생활비 · 세이브 하나, '+ 생활비' · '+ 세이브')
 *  - 창(`PocketSheet`)은 받은 대상을 펼쳐 연다 — 같은 `BudgetPanel` 이다
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { newBudget, newReserve } from '../domain/budget';
import { newEntry, newMoney } from '../domain/entry';
import type { Account, Entry } from '../domain/types';
import { DialogHost } from './Dialog';
import { MonthCalendar } from './MonthCalendar';
import { PocketSheet } from './PocketSheet';
import { TideBar } from './TideBar';

const TODAY = '2026-10-13';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00+09:00')); });
afterAll(() => { vi.useRealTimers(); });
afterEach(cleanup);

const acct = (balanceMinor: number): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '',
});
// 10/13(화) ~ 10/21(수) — 두 주에 걸친다(월요일 시작).
const pocket = newBudget({ id: 'b1', name: '10월 생활비', startDate: TODAY, endDate: '2026-10-21', amountMinor: 200_000 });
const lunch = newEntry('money', {
  id: 'lunch', title: '점심', startDate: '2026-10-15',
  money: newMoney({ type: 'expense', amountMinor: 12_000 }),
});

function calendar(over: { pockets?: typeof pocket[]; summary?: boolean } = {}) {
  const onPocketClick = vi.fn();
  const onEntryClick = vi.fn();
  render(
    <MonthCalendar
      cursor={new Date(2026, 9, 1)} onCursorChange={vi.fn()}
      entries={[lunch]} tideEntries={[lunch]} tideMonths={['2026-10', '2026-11']} accounts={[acct(250_000)]} hasBalance
      lens="money" weekStart="mon" todayISO={TODAY}
      onEntryClick={onEntryClick} onDayOpen={vi.fn()} onDayCreate={vi.fn()}
      ledgerSummary={over.summary === false ? undefined : { entries: [lunch], ready: true }}
      pockets={over.pockets ?? [pocket]} onPocketClick={onPocketClick}
    />,
  );
  return { onPocketClick, onEntryClick };
}

describe('달력의 생활비 막대 — Budget 에서', () => {
  it('여러 주에 걸친 막대의 조각마다 같은 생활비를 연다. 거래 창으로 가지 않는다', () => {
    const { onPocketClick, onEntryClick } = calendar();
    const bars = screen.getAllByRole('button', { name: '생활비 10월 생활비 200,000원 열기' });
    expect(bars).toHaveLength(2);
    for (const b of bars) fireEvent.click(b);
    expect(onPocketClick.mock.calls).toEqual([['b1'], ['b1']]);
    expect(onEntryClick).not.toHaveBeenCalled();
    expect(bars[0]!.className).toContain('pocket');
    expect(bars[0]!.textContent).toBe('10월 생활비 200,000');
  });

  it('예상 잔고 숫자는 생활비 막대와 무관하다 — 출금이 아니다', () => {
    calendar();
    const withPocket = screen.getByLabelText(/2026-10-16 예상 잔고/).textContent;
    cleanup();
    calendar({ pockets: [] });
    expect(screen.getByLabelText(/2026-10-16 예상 잔고/).textContent).toBe(withPocket);
    // 250,000 − 점심 12,000
    expect(withPocket).toBe('23.8만');
  });

  it('겹친 생활비는 각자 막대 하나씩, 맨 위 줄부터', () => {
    const { onPocketClick } = calendar({ pockets: [pocket, newBudget({ id: 'b2', name: '여행', startDate: '2026-10-15', endDate: '2026-10-16', amountMinor: 100_000 })] });
    fireEvent.click(screen.getByRole('button', { name: '생활비 여행 100,000원 열기' }));
    expect(onPocketClick).toHaveBeenCalledWith('b2');
    const travel = screen.getByRole('button', { name: '생활비 여행 100,000원 열기' });
    const main = screen.getAllByRole('button', { name: /10월 생활비/ })[0]!;
    expect(parseFloat(main.style.top)).toBe(0);
    expect(parseFloat(travel.style.top)).toBeGreaterThan(0);
  });

  it('지난 주머니는 그리지 않는다 — 지난 날은 요약 칸 자리다', () => {
    calendar({ pockets: [newBudget({ id: 'old', name: '9월', startDate: '2026-09-01', endDate: '2026-10-12', amountMinor: 1 })] });
    expect(screen.queryByRole('button', { name: /생활비 9월/ })).toBeNull();
  });
});

describe('카드의 확보 줄 — 생활비 · 세이브 창을 연다', () => {
  function card(over: { budgets?: typeof pocket[]; reserves?: ReturnType<typeof newReserve>[] } = {}) {
    const onOpenPockets = vi.fn();
    render(
      <DialogHost>
        <TideBar
          todayISO={TODAY} accounts={[acct(250_000)]} entries={[]} budgets={over.budgets ?? [pocket]}
          reserves={over.reserves ?? []} hasBalance onSaveAccount={vi.fn()} collapsed={false}
          onToggleCollapsed={vi.fn()} onOpenPockets={onOpenPockets}
        />
      </DialogHost>,
    );
    return onOpenPockets;
  }

  it('생활비 줄 · 세이브 줄 · 새로 만들기가 같은 창을 대상만 바꿔 연다', () => {
    const open = card({ reserves: [newReserve({ id: 'r1', name: '비상금', amountMinor: 30_000 })] });
    const list = screen.getByRole('list', { name: '생활비 · 세이브' });
    const row = within(list).getByRole('button', { name: '생활비 10월 생활비 열기' });
    expect(row.textContent).toContain('사용 0 · 남음 200,000');
    fireEvent.click(row);
    fireEvent.click(within(list).getByRole('button', { name: '세이브 비상금 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '+ 생활비' }));
    fireEvent.click(screen.getByRole('button', { name: '+ 세이브' }));
    expect(open.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'budget', id: 'b1' }, { kind: 'reserve', id: 'r1' }, { kind: 'newBudget' }, { kind: 'newReserve' },
    ]);
  });

  it('생활비 · 세이브가 없으면 만들기 두 개만 얇게', () => {
    const open = card({ budgets: [] });
    expect(screen.queryByRole('list', { name: '생활비 · 세이브' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ 생활비' }));
    expect(open).toHaveBeenCalledWith({ kind: 'newBudget' });
  });

  it('큰 숫자(가용)는 그대로다 — 관리 자리를 옮겼을 뿐이다', () => {
    card();
    expect(screen.getByLabelText(/^생활비 외 가용/)).toHaveTextContent('50,000');
  });
});

describe('생활비 · 세이브 창', () => {
  const spent: Entry = newEntry('money', {
    id: 'm1', title: '마트', startDate: TODAY,
    money: newMoney({ status: 'actual', type: 'expense', amountMinor: 40_000, budgetId: 'b1' }),
  });
  function sheet(focus: Parameters<typeof PocketSheet>[0]['focus']) {
    const props = {
      onClose: vi.fn(), onSaveBudget: vi.fn(), onDeleteBudget: vi.fn(), onSaveReserve: vi.fn(), onDeleteReserve: vi.fn(),
    };
    render(
      <PocketSheet
        focus={focus} budgets={[pocket]} reserves={[newReserve({ id: 'r1', name: '비상금', amountMinor: 30_000 })]}
        entries={[spent]} accounts={[acct(250_000)]} todayISO={TODAY} {...props}
      />,
    );
    return props;
  }

  it('막대 · 줄에서 연 생활비는 펼쳐진 채로 — 실제 사용 · 남음 · 연결 거래 · 고치기 · 삭제', () => {
    const p = sheet({ kind: 'budget', id: 'b1' });
    const dlg = screen.getByRole('dialog', { name: '생활비 · 세이브' });
    expect(within(dlg).getByRole('list', { name: '10월 생활비 연결 거래' }).textContent).toContain('마트');
    expect(dlg.textContent).toContain('실제 사용 40,000');
    expect(dlg.textContent).toContain('남은 생활비 160,000');
    fireEvent.click(within(dlg).getByRole('button', { name: '10월 생활비 삭제' }));
    expect(p.onDeleteBudget).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
    fireEvent.click(within(dlg).getByRole('button', { name: '10월 생활비 고치기' }));
    fireEvent.change(within(dlg).getByDisplayValue('10월 생활비'), { target: { value: '10월 식비' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    expect(p.onSaveBudget).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', name: '10월 식비', amountMinor: 200_000 }));
  });

  it('+ 생활비 · + 세이브 · 세이브 줄은 그 입력을 연 채로', () => {
    sheet({ kind: 'newBudget' });
    expect(screen.getByDisplayValue('생활비')).toBeInTheDocument();
    cleanup();
    const p = sheet({ kind: 'reserve', id: 'r1' });
    fireEvent.change(screen.getByDisplayValue('비상금'), { target: { value: '여행 적립' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(p.onSaveReserve).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', name: '여행 적립', amountMinor: 30_000 }));
  });

  it('Esc 와 닫기로 닫는다', () => {
    const p = sheet({ kind: 'list' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
