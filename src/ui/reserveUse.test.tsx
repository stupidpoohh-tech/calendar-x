/**
 * 세이브 지출 연결 (P3) — 화면에서 사람이 누르는 순서대로.
 *
 * 계산(남은 금액 · 한도)은 `domain/reserveUse.test.ts` 가 값으로 못박았다. 여기서는 그 값이 화면에서
 * 실제로 만들어지는지 본다 — 입력 창에서 세이브를 고르면 무엇이 저장되는지, 확정이 연결을 넘기는지,
 * 세이브 상세가 확보 · 사용 · 남음과 연결 거래를 보이는지, 카드가 남은 금액을 적는지.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { newReserve, reserveUsageOf } from '../domain/budget';
import { defaultCategories } from '../domain/category';
import { newEntry, newMoney } from '../domain/entry';
import type { Account, Budget, Entry, Reserve } from '../domain/types';
import { ConfirmSheet } from './ConfirmSheet';
import { DialogHost } from './Dialog';
import { EntryModal } from './EntryModal';
import { PocketSheet } from './PocketSheet';
import { TideBar } from './TideBar';

const TODAY = '2026-10-13';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00+09:00')); });
afterAll(() => { vi.useRealTimers(); });
afterEach(cleanup);

const categories = defaultCategories('');
const account = (balanceMinor = 1_000_000): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '',
});
const pocket: Budget = {
  id: 'b1', name: '10월 생활비', startDate: '2026-10-01', endDate: '2026-10-31',
  amountMinor: 700_000, currency: 'KRW', createdAt: '', updatedAt: '',
};
const trip = newReserve({ id: 'r1', name: '여행', amountMinor: 300_000 });
const gift = newReserve({ id: 'r2', name: '선물', amountMinor: 100_000 });
const old = newReserve({ id: 'r3', name: '지난 적립', amountMinor: 50_000, archivedAt: '2026-10-01T00:00:00.000Z' });

const spend = (id: string, amountMinor: number, over: Partial<Entry['money'] & object> = {}, date = TODAY) => newEntry('money', {
  id, title: id, startDate: date,
  money: newMoney({ status: 'actual', type: 'expense', amountMinor, ...over }),
});

function openModal(props: Partial<Parameters<typeof EntryModal>[0]> & { initial: Entry }) {
  const onSave = vi.fn();
  render(
    <EntryModal
      open mode="create" allTags={[]} linkableTasks={[]} budgets={[]} debts={[]}
      categories={categories} accounts={[account()]} reserves={[trip, gift, old]}
      onSave={onSave} onDelete={() => {}} onClose={() => {}}
      {...props}
    />,
  );
  return { onSave };
}
const saved = (onSave: ReturnType<typeof vi.fn>) => onSave.mock.calls[0]![0] as Entry;

describe('입력 창의 세이브 칸', () => {
  it('일반 지출에 보관하지 않은 세이브가 보이고, 고르면 연결이 저장된다 — 생활비 기본 선택은 풀린다', () => {
    const { onSave } = openModal({ initial: spend('n1', 0), budgets: [pocket] });
    const group = screen.getByRole('radiogroup', { name: '사용할 세이브' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['사용 안 함', '여행', '선물']);
    // 주머니가 하나라 미리 걸려 있다.
    expect(screen.getByRole('radio', { name: '10월 생활비' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '120,000' } });
    fireEvent.click(within(group).getByRole('radio', { name: '여행' }));
    expect(screen.getByRole('radio', { name: '10월 생활비' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('dialog').textContent).toContain('잔고 · 예상 잔고는 바뀌지 않습니다');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(saved(onSave).money).toMatchObject({
      status: 'actual', type: 'expense', amountMinor: 120_000, reserveId: 'r1', budgetId: null,
    });
  });

  it('생활비를 다시 고르면 세이브 연결이 풀린다 — 사용처는 하나다', () => {
    const { onSave } = openModal({ initial: spend('n1', 0), budgets: [pocket] });
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '10,000' } });
    fireEvent.click(screen.getByRole('radio', { name: '여행' }));
    fireEvent.click(screen.getByRole('radio', { name: '10월 생활비' }));
    expect(screen.getByRole('radio', { name: '사용 안 함' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(onSave).money).toMatchObject({ budgetId: 'b1', reserveId: null });
  });

  it('수입 · 대출에는 세이브 칸이 없다', () => {
    openModal({ initial: spend('n1', 0) });
    fireEvent.click(screen.getByRole('radio', { name: '수입' }));
    expect(screen.queryByRole('radiogroup', { name: '사용할 세이브' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '대출' }));
    expect(screen.queryByRole('radiogroup', { name: '사용할 세이브' })).toBeNull();
  });

  it('예정에도 걸 수 있다 — 확정하면 그때 사용으로 센다고 적는다. 반복 예정에는 칸이 없다', () => {
    const plan = newEntry('money', { id: 'p1', startDate: '2026-10-20', money: newMoney({ amountMinor: 80_000 }) });
    const { onSave } = openModal({ initial: plan });
    fireEvent.click(screen.getByRole('radio', { name: '선물' }));
    expect(screen.getByRole('dialog').textContent).toContain('확정해 실제 거래가 되면 그때 이 세이브의 사용으로 셉니다');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(onSave).money).toMatchObject({ status: 'planned', reserveId: 'r2' });
    cleanup();

    const monthly = newEntry('money', {
      id: 'p2', startDate: '2026-10-20', recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
      money: newMoney({ amountMinor: 80_000 }),
    });
    openModal({ initial: monthly, mode: 'edit' });
    expect(screen.queryByRole('radiogroup', { name: '사용할 세이브' })).toBeNull();
  });

  it('지워진 · 보관한 세이브를 가리키면 그대로 보여 주고, 다른 것을 고를 수 있다', () => {
    openModal({ initial: spend('x', 10_000, { reserveId: 'gone' }), mode: 'edit' });
    expect(screen.getByText('지워진 세이브')).toBeInTheDocument();
    expect(screen.getByRole('dialog').textContent).toContain('가용 한도에는 영향이 없습니다');
    cleanup();
    openModal({ initial: spend('y', 10_000, { reserveId: 'r3' }), mode: 'edit' });
    expect(screen.getByText('지난 적립 (보관)')).toBeInTheDocument();
  });
});

describe('확정은 세이브 연결을 넘긴다', () => {
  it('예정에 걸어 둔 세이브가 기본값이고, 확정한 실제 거래에 그대로 실린다', () => {
    const plan = newEntry('money', {
      id: 'gift', title: '생일 선물', startDate: '2026-10-20',
      money: newMoney({ amountMinor: 80_000, reserveId: 'r2', outsidePocket: true }),
    });
    const onSave = vi.fn();
    render(
      <ConfirmSheet
        plan={plan} occurrenceDate="2026-10-20" categories={categories} categoriesReady
        accounts={[account()]} budgets={[pocket]} reserves={[trip, gift]} debts={[]}
        onSave={onSave} onClose={() => {}}
      />,
    );
    expect(screen.getByRole('radio', { name: '선물' })).toHaveAttribute('aria-checked', 'true');
    // 그 날을 품는 생활비가 하나여도 세이브를 덮어 미리 고르지 않는다.
    expect(screen.getByRole('radio', { name: '10월 생활비' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: '확정' }));
    const actual = saved(onSave);
    expect(actual.money).toMatchObject({
      status: 'actual', reserveId: 'r2', budgetId: null, plannedRef: { entryId: 'gift', date: '2026-10-20' },
    });
    expect(reserveUsageOf([actual]).get('r2')).toBe(80_000);
  });
});

describe('세이브 상세 — 확보 · 사용 · 남음 · 연결 거래', () => {
  function sheet(reserves: Reserve[], linked: Entry[]) {
    const onEntryClick = vi.fn();
    render(
      <PocketSheet
        focus={{ kind: 'reserve', id: 'r1' }} budgets={[]} reserves={reserves} entries={[]}
        accounts={[account()]} todayISO={TODAY}
        reserveLinked={linked} reserveUsage={reserveUsageOf(linked)}
        onClose={vi.fn()} onSaveBudget={vi.fn()} onDeleteBudget={vi.fn()} onSaveReserve={vi.fn()} onDeleteReserve={vi.fn()}
        onEntryClick={onEntryClick}
      />,
    );
    return { onEntryClick };
  }

  it('목록에는 남은 금액, 펼치면 확보 · 사용 · 남음과 연결 거래 — 예정은 사용에 넣지 않는다', () => {
    const air = spend('항공권', 120_000, { reserveId: 'r1' }, '2026-10-05');
    const hotel = newEntry('money', {
      id: 'hotel', title: '숙소', startDate: '2026-11-02', money: newMoney({ amountMinor: 90_000, reserveId: 'r1' }),
    });
    const { onEntryClick } = sheet([trip], [air, hotel]);

    const row = screen.getByRole('button', { name: /^여행 남음/ });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(row.textContent).toContain('남음 180,000원 · 가용 한도에서 제외');
    const stats = screen.getByLabelText('여행 확보 · 사용 · 남음');
    expect(stats.textContent).toBe('확보 300,000사용 120,000남음 180,000');

    const list = screen.getByRole('list', { name: '여행 연결 거래' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('예정숙소'), expect.stringContaining('실제항공권'),
    ]);
    expect(screen.getByRole('dialog').textContent).toContain('확정하면 사용으로 셉니다');
    fireEvent.click(within(list).getByRole('button', { name: /항공권/ }));
    expect(onEntryClick).toHaveBeenCalledWith(air);
  });

  it('초과하면 남음 0 · 초과를 적고, 한도를 늘려 주지 않는다고 말한다', () => {
    sheet([trip], [spend('a', 250_000, { reserveId: 'r1' }), spend('b', 100_000, { reserveId: 'r1' })]);
    expect(screen.getByRole('button', { name: /^여행 남음|^여행 초과/ }).textContent).toContain('초과 50,000원');
    expect(screen.getByLabelText('여행 확보 · 사용 · 남음').textContent).toContain('남음 0 · 초과 50,000');
    expect(screen.getByRole('dialog').textContent).toContain('가용 한도를 늘려 주지 않습니다');
  });

  it('쓴 거래가 없으면 비어 있다고 적고, 고치기는 톱니와 상세 안의 단추 둘 다로 연다', () => {
    sheet([trip], []);
    expect(screen.getByRole('dialog').textContent).toContain('아직 이 세이브에서 쓴 거래가 없습니다');
    fireEvent.click(screen.getByRole('button', { name: '확보액 · 목표 고치기' }));
    expect(screen.getByDisplayValue('여행')).toBeInTheDocument();
  });
});

describe('카드의 확보 줄', () => {
  it('세이브에서 쓴 만큼 남은 금액을 적고, 한도는 남은 금액만 뺀다', () => {
    const air = spend('항공권', 100_000, { reserveId: 'r1' });
    render(
      <DialogHost>
        <TideBar
          todayISO={TODAY} accounts={[account(1_000_000)]} entries={[air]} budgets={[]}
          reserves={[trip]} reserveUsage={reserveUsageOf([air])}
          hasBalance onSaveAccount={vi.fn()} collapsed={false} onToggleCollapsed={vi.fn()} onOpenPockets={vi.fn()}
        />
      </DialogHost>,
    );
    expect(screen.getByRole('button', { name: '세이브 여행 열기' }).textContent).toContain('남음 200,000');
    // 1,000,000 − 지출 100,000 − 남은 세이브 200,000. 연결하지 않았으면 600,000 이다.
    expect(document.body.textContent).toContain('확보 200,000 = 쓸 수 있는 돈 700,000');
  });
});
