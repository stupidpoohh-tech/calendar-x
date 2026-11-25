/**
 * P0 — 카드는 가용 한도와 확인 잔고를 가른다. 큰 숫자(가용)는 고치는 자리가 아니고,
 * 잔고를 고치는 자리는 확인 잔고 줄 하나다. 생활비를 만들어도 확인 잔고 · 예상 잔고는 그대로다.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { newBudget } from '../domain/budget';
import { newEntry, newMoney } from '../domain/entry';
import type { CalendarAmount } from '../domain/layout';
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

function mount(entries = [] as ReturnType<typeof newEntry>[], headlineAmount?: CalendarAmount, budgets = [pocket]) {
  render(
    <DialogHost>
      <TideBar
        todayISO={TODAY} accounts={[acct(250_000)]} entries={entries} budgets={budgets} headlineAmount={headlineAmount}
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

describe('카드 큰 숫자 — 설정에서 고른 기준(달력 칸과 같은 네 기준)', () => {
  // 잔고 250,000 · 생활비 200,000(10/13~17) · 잔고 밖 생활비 지출 40,000 · 10/20 예정 지출 30,000.
  // 가용은 구간 최솟값 50,000(생활비가 끝나는 10/17), 30일 뒤 예상 잔고 180,000, 생활비 남음 160,000.
  const flows = () => [
    newEntry('money', {
      id: 'lunch', title: '점심', startDate: TODAY,
      money: newMoney({ status: 'actual', type: 'expense', amountMinor: 40_000, budgetId: 'b1' }),
    }),
    newEntry('money', {
      id: 'gas', title: '가스비', startDate: '2026-10-20',
      money: newMoney({ status: 'planned', type: 'expense', amountMinor: 30_000 }),
    }),
  ];

  it('기본(고르지 않음)은 가용 잔액 — 지금까지와 같다', () => {
    const card = mount(flows());
    expect(within(card).getByLabelText(/^생활비 외 가용/)).toHaveTextContent('50,000');
    expect(card.textContent).toContain('생활비 · 세이브 빼고 쓸 수 있는 돈');
    expect(card.textContent).toContain('이 돈으로');
  });

  it('전체 보유액 — 큰 숫자는 확인 잔고, 가용 · 버틸 날은 아래 줄에 남는다', () => {
    const card = mount(flows(), 'balance');
    expect(within(card).getByLabelText(/^전체 보유액/)).toHaveTextContent('250,000');
    expect(within(card).getByLabelText(/^생활비 외 가용/)).toHaveTextContent('50,000');
    expect(card.textContent).toContain('그 돈으로');
  });

  it('예상 잔고 — 다음 입금 전날(입금이 없으면 30일 뒤)의 예상 잔고. 생활비는 빼지 않는다', () => {
    const card = mount(flows(), 'projected');
    expect(within(card).getByLabelText(/^예상 잔고/)).toHaveTextContent('180,000');
    expect(card.textContent).toContain('30일 뒤 예상 잔고');
  });

  it('생활비 잔여 — 오늘을 품는 생활비의 남은 금액(실제 기준). 없으면 숫자를 지어내지 않는다', () => {
    expect(within(mount(flows(), 'pocket')).getByLabelText(/^생활비 잔여/)).toHaveTextContent('160,000');
    cleanup();
    const card = mount(flows(), 'pocket', []);
    expect(within(card).getByLabelText('생활비 잔여 없음')).toHaveTextContent('—');
    expect(card.textContent).toContain('오늘을 품는 생활비가 없습니다');
  });
});
