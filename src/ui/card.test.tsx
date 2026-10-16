/**
 * 신용카드 (P4) — 화면에서 사람이 누르는 순서대로.
 *
 * 계산(미결제 · 회차 · 한도)은 `domain/card.test.ts` 가 값으로 못박았다. 여기서는 그 값이 화면에서 만들어지는지 본다 —
 * 결제수단에서 카드를 고르면 무엇이 저장되는지, 대금이 어느 회차를 갚는지, 카드대금 창이 미결제 · 이번 결제를 적고
 * 대금 기록을 회차와 함께 넘기는지, 현금흐름 카드가 미결제를 확보로 · 적지 않은 대금을 예상으로 적는지.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { newReserve } from '../domain/budget';
import { newCard } from '../domain/card';
import { defaultCategories } from '../domain/category';
import { newEntry, newMoney } from '../domain/entry';
import type { Account, Budget, Entry, MoneyFields } from '../domain/types';
import { CardLine, CardSheet } from './CardSheet';
import { ConfirmSheet } from './ConfirmSheet';
import { DialogHost } from './Dialog';
import { EntryModal } from './EntryModal';
import { TideBar } from './TideBar';

const TODAY = '2026-10-16';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T12:00:00+09:00')); });
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
const life = newCard({ id: 'life', name: '생활 카드', closeDay: 31, payDay: 25, payMonthOffset: 1, accountId: 'a1' });
const old = newCard({ id: 'old', name: '옛 카드', archivedAt: '2026-09-01T00:00:00.000Z' });
const trip = newReserve({ id: 'trip', name: '여행', amountMinor: 300_000 });
const tx = (id: string, date: string, amount: number, m: Partial<MoneyFields>): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }),
});
const sep = tx('셔츠', '2026-09-20', 300_000, { flow: 'cardSpend', cardId: 'life' }); // 10/25 결제
const oct = tx('신발', '2026-10-05', 100_000, { flow: 'cardSpend', cardId: 'life' }); // 11/25 결제

function openModal(props: Partial<Parameters<typeof EntryModal>[0]> & { initial: Entry }) {
  const onSave = vi.fn();
  render(
    <EntryModal
      open mode="create" allTags={[]} linkableTasks={[]} budgets={[]} debts={[]}
      categories={categories} accounts={[account()]} cards={[life, old]} cardEntries={[sep, oct]} reserves={[trip]}
      onSave={onSave} onDelete={() => {}} onClose={() => {}}
      {...props}
    />,
  );
  return { onSave };
}
const saved = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0]![0] as Entry;

describe('결제수단 — 현금 · 계좌 / 카드', () => {
  it('카드를 고르면 카드 사용으로 저장된다 — 생활비는 풀리고, 결제일을 적는다', () => {
    const { onSave } = openModal({ initial: newEntry('money', { id: 'n', startDate: TODAY, money: newMoney({ status: 'actual' }) }), budgets: [pocket] });
    const method = screen.getByRole('radiogroup', { name: '결제수단' });
    expect(within(method).getAllByRole('radio').map((r) => r.textContent)).toEqual(['현금 · 계좌', '생활 카드']);
    expect(screen.getByRole('radio', { name: '10월 생활비' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '45,000' } });
    fireEvent.click(within(method).getByRole('radio', { name: '생활 카드' }));
    // 흐름은 그대로 '지출' 이다. 생활비 줄은 사라지고 이유를 적는다.
    expect(screen.getByRole('radio', { name: '지출' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radiogroup', { name: '사용처' })).toBeNull();
    expect(screen.getByRole('dialog').textContent).toContain('11월 25일');
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(onSave).money).toMatchObject({
      status: 'actual', type: 'expense', flow: 'cardSpend', cardId: 'life', amountMinor: 45_000, budgetId: null, categoryId: 'default-food',
    });
  });

  it('카드 사용도 세이브에 걸 수 있다 — 현금으로 되돌리면 일반 지출이다', () => {
    const { onSave } = openModal({ initial: newEntry('money', { id: 'n', startDate: TODAY, money: newMoney({ status: 'actual' }) }) });
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '200,000' } });
    fireEvent.click(screen.getByRole('radio', { name: '생활 카드' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '사용할 세이브' })).getByRole('radio', { name: '여행' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(onSave).money).toMatchObject({ flow: 'cardSpend', cardId: 'life', reserveId: 'trip' });
    cleanup();

    const again = openModal({ initial: oct, mode: 'edit' });
    fireEvent.click(screen.getByRole('radio', { name: '현금 · 계좌' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(again.onSave).money).toMatchObject({ flow: 'normal', cardId: null });
  });

  it('보관한 · 지워진 카드를 가리키는 거래는 그대로 보여 준다', () => {
    openModal({ initial: tx('x', TODAY, 1, { flow: 'cardSpend', cardId: 'old' }), mode: 'edit' });
    expect(screen.getByText('옛 카드 (보관)')).toBeInTheDocument();
    cleanup();
    openModal({ initial: tx('y', TODAY, 1, { flow: 'cardSpend', cardId: 'gone' }), mode: 'edit' });
    expect(screen.getByText('지워진 카드')).toBeInTheDocument();
  });
});

describe('카드 대금 — 어느 카드의 어느 회차', () => {
  const payment = tx('pay', TODAY, 300_000, { flow: 'cardPayment', cardId: 'life', cardCycle: '2026-10' });

  it('흐름 줄은 "카드 대금 · 생활 카드" 로 보이고, 카테고리 칸 없이 회차를 고른다', () => {
    const { onSave } = openModal({ initial: payment });
    expect(screen.getByText('카드 대금 · 생활 카드')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '식비' })).toBeNull();
    const cycle = screen.getByLabelText('청구 회차') as HTMLSelectElement;
    expect([...cycle.options].map((o) => o.textContent)).toEqual([
      '10/25 결제 (9/1~9/30) · 남음 300,000', '11/25 결제 (10/1~10/31) · 남음 100,000',
    ]);
    expect(screen.getByRole('dialog').textContent).toContain('소비는 쓴 날 이미 셌으므로');
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '100,000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(onSave).money).toMatchObject({ flow: 'cardPayment', cardId: 'life', cardCycle: '2026-10', amountMinor: 100_000 });
  });

  it('반복 예정 대금을 확정하면 그 회차의 달을 갚는 실제 대금이 된다', () => {
    const monthly = newEntry('money', {
      id: 'm', title: '카드값', startDate: '2026-08-25', recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
      money: newMoney({ type: 'expense', flow: 'cardPayment', cardId: 'life', amountMinor: 250_000 }),
    });
    const onSave = vi.fn();
    render(
      <ConfirmSheet
        plan={monthly} occurrenceDate="2026-10-25" categories={categories} categoriesReady
        accounts={[account()]} budgets={[]} cards={[life]} cardEntries={[sep]} debts={[]}
        onSave={onSave} onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '확정' }));
    expect(saved(onSave).money).toMatchObject({ status: 'actual', flow: 'cardPayment', cardId: 'life', cardCycle: '2026-10' });
  });
});

describe('카드대금 창', () => {
  function sheet(over: Partial<Parameters<typeof CardSheet>[0]> = {}) {
    const props = {
      onClose: vi.fn(), onSaveCard: vi.fn(), onDeleteCard: vi.fn(), onEntryClick: vi.fn(), onRecordPayment: vi.fn(),
    };
    render(<CardSheet cards={[life, old]} cardEntries={[sep, oct]} accounts={[account()]} todayISO={TODAY} {...props} {...over} />);
    return props;
  }

  it('카드마다 미결제 · 이번 결제 · 결제일, 펼치면 회차와 그 회차의 거래', () => {
    const p = sheet();
    const row = screen.getByRole('button', { name: /^생활 카드 미결제/ });
    expect(row.textContent).toContain('미결제 400,000원 · 이번 결제 300,000 (10월 25일)');
    expect(row.textContent).toContain('매월 말일 마감 · 다음 달 25일 결제 · 주계좌');
    const cycles = screen.getByRole('list', { name: '생활 카드 청구 회차' });
    const items = within(cycles).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('11/25 결제10/1~10/31 · 청구 100,000(예상) · 납부 0'),
      expect.stringContaining('10/25 결제9/1~9/30 · 청구 300,000 · 납부 0'),
    ]);
    fireEvent.click(items[1]!);
    fireEvent.click(within(screen.getByRole('list', { name: '10/25 결제 회차 거래' })).getByRole('button', { name: /셔츠/ }));
    expect(p.onEntryClick).toHaveBeenCalledWith(sep);
  });

  it('대금 기록 · 예정 대금 적기는 갚을 차례인 회차를 넘긴다', () => {
    const p = sheet();
    fireEvent.click(screen.getByRole('button', { name: '10/25 결제분 대금 기록' }));
    expect(p.onRecordPayment).toHaveBeenCalledWith(life, expect.objectContaining({ key: '2026-10', remainingMinor: 300_000 }), false);
    fireEvent.click(screen.getByRole('button', { name: '예정 대금 적기' }));
    expect(p.onRecordPayment).toHaveBeenLastCalledWith(life, expect.objectContaining({ key: '2026-10' }), true);
  });

  it('카드를 등록한다 — 이름 없이는 저장하지 않고, 그 달 결제는 결제일이 마감일보다 뒤여야 한다', () => {
    const p = sheet({ cards: [] });
    // 카드가 없으면 등록 칸이 열린 채로 시작한다.
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(p.onSaveCard).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('카드 이름을 적어 주세요');
    fireEvent.change(screen.getByLabelText('카드 이름'), { target: { value: '1일 카드' } });
    fireEvent.change(screen.getByLabelText('이용 마감일'), { target: { value: '13' } });
    fireEvent.change(screen.getByLabelText('결제일'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('결제하는 달'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(p.onSaveCard).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('결제하는 달'), { target: { value: '1' } });
    expect(screen.getByRole('dialog').textContent).toContain('매월 13일 마감 · 다음 달 1일 결제');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(p.onSaveCard).toHaveBeenCalledWith(expect.objectContaining({ name: '1일 카드', closeDay: 13, payDay: 1, payMonthOffset: 1, accountId: 'a1' }));
  });

  it('보관한 카드는 접힌 묶음에서 보관을 풀고, 남은 미결제를 적는다', () => {
    const p = sheet({ cardEntries: [sep, oct, tx('o', '2026-10-01', 50_000, { flow: 'cardSpend', cardId: 'old' })] });
    fireEvent.click(screen.getByRole('button', { name: '보관한 카드 1장' }));
    expect(screen.getByRole('dialog').textContent).toContain('미결제 50,000원 — 가용 한도에서 계속 빠집니다');
    fireEvent.click(screen.getByRole('button', { name: '보관 해제' }));
    expect(p.onSaveCard).toHaveBeenCalledWith(expect.objectContaining({ id: 'old', archivedAt: null }));
  });

  it('현금흐름 카드의 한 줄 — 미결제와 가장 가까운 결제', () => {
    const onOpen = vi.fn();
    render(<CardLine cards={[life]} cardEntries={[sep, oct]} todayISO={TODAY} onOpen={onOpen} />);
    expect(screen.getByRole('button', { name: '카드대금 열기' }).textContent).toContain('미결제 400,000 · 10/25 결제 300,000');
    cleanup();
    render(<CardLine cards={[]} cardEntries={[]} todayISO={TODAY} onOpen={onOpen} />);
    expect(screen.getByRole('button', { name: '카드대금 열기' }).textContent).toContain('카드 등록');
  });
});

describe('현금흐름 카드', () => {
  it('미결제를 확보로 적고, 구간 안의 적지 않은 대금을 예상으로 적는다', () => {
    const onOpenCards = vi.fn();
    render(
      <DialogHost>
        <TideBar
          todayISO={TODAY} accounts={[account(1_000_000)]} entries={[sep, oct]} cards={[life]} cardEntries={[sep, oct]}
          hasBalance onSaveAccount={vi.fn()} collapsed={false} onToggleCollapsed={vi.fn()} onOpenPockets={vi.fn()}
          onOpenCards={onOpenCards}
        />
      </DialogHost>,
    );
    // 다음 입금이 없어 끝점은 30일 뒤(11/15). 10/25 대금 300,000 은 구간 안이라 예상 잔고에서, 11/25 몫 100,000 은 확보에서.
    expect(document.body.textContent).toContain('생활비 · 세이브 · 카드 미결제로 확보');
    expect(screen.getByRole('button', { name: '카드 미결제 열기' }).textContent).toContain('100,000');
    expect(document.body.textContent).toContain('예상 잔고 700,000 − 확보 100,000 = 쓸 수 있는 돈 600,000');
    const est = screen.getByRole('button', { name: /생활 카드 대금 예상/ });
    expect(est.textContent).toContain('−300,000');
    fireEvent.click(est);
    expect(onOpenCards).toHaveBeenCalled();
  });
});
