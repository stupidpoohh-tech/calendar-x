/**
 * P0 — 카드는 가용 한도와 확인 잔고를 가른다. 큰 숫자(가용)는 고치는 자리가 아니고,
 * 잔고를 고치는 자리는 확인 잔고 줄 하나다. 생활비를 만들어도 확인 잔고 · 예상 잔고는 그대로다.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { newBudget } from '../domain/budget';
import { newEntry, newMoney } from '../domain/entry';
import type { Account } from '../domain/types';
import { DialogHost } from './Dialog';
import { TideBar } from './TideBar';

const TODAY = '2026-10-13';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00+09:00')); });
afterAll(() => { vi.useRealTimers(); });
afterEach(cleanup);

const acct = (balanceMinor: number): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '',
});
const pocket = newBudget({ id: 'b1', name: '생활비', startDate: TODAY, endDate: '2026-10-17', amountMinor: 200_000 });

function mount(entries = [] as ReturnType<typeof newEntry>[]) {
  render(
    <DialogHost>
      <TideBar
        todayISO={TODAY} accounts={[acct(250_000)]} entries={entries} budgets={[pocket]}
        hasBalance onSaveAccount={vi.fn()} collapsed={false} onToggleCollapsed={vi.fn()}
      />
    </DialogHost>,
  );
  return screen.getByLabelText('며칠 버티나');
}

describe('카드 — 가용 한도와 확인 잔고', () => {
  it('A — 큰 숫자는 생활비 외 가용 50,000, 확인 잔고는 250,000 그대로', () => {
    const card = mount();
    expect(within(card).getByLabelText(/^생활비 외 가용/)).toHaveTextContent('50,000');
    expect(within(card).getByLabelText(/^확인 잔고/)).toHaveTextContent('250,000');
    expect(within(card).queryByLabelText(/^오늘 예상 잔고/)).toBeNull();
    expect(card.textContent).toContain('생활비 · 세이브로 확보');
  });

  it('큰 숫자를 눌러도 잔고 편집이 열리지 않는다 — 고치는 자리는 확인 잔고 줄', () => {
    const card = mount();
    fireEvent.click(within(card).getByLabelText(/^생활비 외 가용/));
    expect(within(card).queryByLabelText('잔고 금액')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /^잔고 고치기/ }));
    expect(within(card).getByLabelText('잔고 금액')).toBeInTheDocument();
  });

  it('B — 잔고 밖 생활비 지출 40,000: 확인 250,000 · 오늘 예상 210,000 · 가용 50,000', () => {
    const card = mount([newEntry('money', {
      id: 'lunch', title: '점심', startDate: TODAY,
      money: newMoney({ status: 'actual', type: 'expense', amountMinor: 40_000, budgetId: 'b1' }),
    })]);
    expect(within(card).getByLabelText(/^생활비 외 가용/)).toHaveTextContent('50,000');
    expect(within(card).getByLabelText(/^확인 잔고/)).toHaveTextContent('250,000');
    expect(within(card).getByLabelText(/^오늘 예상 잔고/)).toHaveTextContent('210,000');
  });
});
