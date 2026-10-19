/**
 * 실제 거래 입력 · 예정 확정 · 확정 취소 — 화면에서 사람이 누르는 순서대로.
 *
 * 도메인 함수(`confirmOccurrence` · `balanceInclusion`)는 따로 시험했다. 여기서는 그 값이
 * 화면에서 실제로 만들어지는지 본다 — 빠른 입력이 정말 짧은지, 기본 주머니가 저장 전에
 * 보이는지, 확정이 결정적 id 로 나가는지.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCategories } from '../domain/category';
import { newEntry, newMoney } from '../domain/entry';
import { materialize } from '../domain/recurrence';
import type { Account, Budget, Entry } from '../domain/types';
import { BudgetPanel } from './BudgetPanel';
import { ConfirmSheet } from './ConfirmSheet';
import { EntryModal } from './EntryModal';

afterEach(cleanup);

const TODAY = '2026-10-12';
const categories = defaultCategories('');
const budget = (over: Partial<Budget> = {}): Budget => ({
  id: 'b1', name: '10월 생활비', startDate: '2026-10-01', endDate: '2026-10-31',
  amountMinor: 700_000, currency: 'KRW', createdAt: '', updatedAt: '', ...over,
});
const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '', ...over,
});

function openModal(props: Partial<Parameters<typeof EntryModal>[0]> & { initial: Entry }) {
  const onSave = vi.fn();
  render(
    <EntryModal
      open mode="create" allTags={[]} linkableTasks={[]} budgets={[]} debts={[]}
      categories={categories} accounts={[account()]}
      onSave={onSave} onDelete={() => {}} onClose={() => {}}
      {...props}
    />,
  );
  return { onSave };
}

const actualDraft = (over: Partial<Entry> = {}) => newEntry('money', {
  id: 'n1', startDate: TODAY, money: newMoney({ status: 'actual' }), ...over,
});

describe('실제 거래 빠른 입력', () => {
  it('금액과 카테고리만 고르면 실제 지출로 저장된다 — 유형을 고르게 하지 않는다', () => {
    const { onSave } = openModal({ initial: actualDraft() });
    expect(screen.getByRole('radio', { name: '실제 거래' })).toHaveAttribute('aria-checked', 'true');
    // 반복은 실제 거래에 없다. 거래 유형은 접혀 있다.
    expect(screen.queryByLabelText('반복')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: '거래 유형' })).toBeNull();

    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '12,000' } });
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    const saved = onSave.mock.calls[0]![0] as Entry;
    expect(saved.money).toMatchObject({
      status: 'actual', type: 'expense', flow: 'normal', amountMinor: 12_000, categoryId: 'default-food',
    });
    expect(saved.recurrence).toBeNull();
  });

  it('수입으로 바꾸면 수입 카테고리만 보인다', () => {
    openModal({ initial: actualDraft() });
    fireEvent.click(screen.getByRole('radio', { name: '수입' }));
    expect(screen.getByRole('button', { name: '급여' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '식비' })).toBeNull();
  });

  it('흐름은 수입 · 지출 · 대출 셋 — 거래 유형 칸은 없고, 결제수단은 현금 · 계좌가 기본이다', () => {
    openModal({ initial: actualDraft() });
    const flows = within(screen.getByRole('radiogroup', { name: '흐름' })).getAllByRole('radio');
    expect(flows.map((r) => r.textContent)).toEqual(['수입', '지출', '대출']);
    expect(screen.getByRole('radio', { name: '지출' })).toHaveAttribute('aria-checked', 'true');
    // 카드가 없어도 결제수단 줄은 보인다(현금 · 계좌 하나뿐). 고르지 않아도 일반 지출로 저장된다.
    expect(screen.getByRole('radio', { name: '현금 · 계좌' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radiogroup', { name: '거래 유형' })).toBeNull();
    expect(screen.queryByRole('button', { name: /상세/ })).toBeNull();
  });

  it('대출을 고르면 대출 원금으로 저장한다 — 생활비 · 카테고리를 풀고 대출 연결만 묻는다', () => {
    const debt = { id: 'd1', name: '전세대출' } as never;
    const { onSave } = openModal({ initial: actualDraft(), budgets: [budget()], debts: [debt] });
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    expect(screen.getByRole('radio', { name: '10월 생활비' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '대출' }));
    expect(screen.queryByRole('radiogroup', { name: '사용처' })).toBeNull();
    expect(screen.queryByRole('button', { name: '식비' })).toBeNull();
    fireEvent.change(screen.getByLabelText('대출 연결'), { target: { value: 'd1' } });
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '1200000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((onSave.mock.calls[0]![0] as Entry).money).toMatchObject({
      type: 'expense', flow: 'loanPrincipal', budgetId: null, categoryId: null, debtId: 'd1', amountMinor: 1_200_000,
    });
  });

  it("'대출' 카테고리는 고르는 자리에서 빠진다 — 이미 붙은 거래에는 보이고 무엇인지 말한다", () => {
    const withLoan = [...categories, { id: 'imp-loan', kind: 'expense' as const, name: '대출', order: 99, archived: false, createdAt: '', updatedAt: '' }];
    openModal({ initial: actualDraft(), categories: withLoan });
    expect(screen.queryByRole('button', { name: '대출' })).toBeNull();
    cleanup();
    openModal({
      initial: actualDraft({ money: newMoney({ status: 'actual', amountMinor: 500_000, categoryId: 'imp-loan' }) }),
      categories: withLoan, mode: 'edit',
    });
    expect(screen.getByText('대출', { selector: '.chip.on' })).toBeInTheDocument();
    expect(screen.getByText(/예전에 '대출' 카테고리로 적은 거래입니다/)).toBeInTheDocument();
  });

  it('예전 유형 · 결제수단은 지우지 않는다 — 보여만 주고, 다른 칸을 고쳐 저장해도 그대로다', () => {
    const card = actualDraft({ money: newMoney({ status: 'actual', amountMinor: 30_000, flow: 'cardSpend', method: '신한카드' }) });
    const { onSave } = openModal({ initial: card, mode: 'edit' });
    for (const r of within(screen.getByRole('radiogroup', { name: '흐름' })).getAllByRole('radio')) {
      expect(r).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByText('카드 사용 (예전)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '31000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((onSave.mock.calls[0]![0] as Entry).money).toMatchObject({ flow: 'cardSpend', method: '신한카드', amountMinor: 31_000 });
  });

  it('생활비 주머니가 여럿이면 고르지 않고 고르라고 말한다 — 아무것도 고르지 않은 미결정', () => {
    const { onSave } = openModal({ initial: actualDraft(), budgets: [budget(), budget({ id: 'b2', name: '여행 경비' })] });
    const group = screen.getByRole('radiogroup', { name: '사용처' });
    for (const r of within(group).getAllByRole('radio')) expect(r).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/생활비가 여럿입니다/)).toBeInTheDocument();
    // 고르지 않아도 일반 지출로 저장된다.
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const m = (onSave.mock.calls[0]![0] as Entry).money!;
    expect(m.budgetId).toBeNull();
    expect(m.outsidePocket ?? false).toBe(false);
  });

  it('생활비 외 지출을 고르면 그 뜻이 저장되고, 날짜를 바꿔도 자동 선택이 덮지 않는다', () => {
    const { onSave } = openModal({ initial: actualDraft(), budgets: [budget()] });
    fireEvent.click(screen.getByRole('radio', { name: '생활비 외 지출' }));
    fireEvent.change(screen.getByLabelText(/날짜/), { target: { value: '2026-10-20' } });
    expect(screen.getByRole('radio', { name: '생활비 외 지출' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '650000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((onSave.mock.calls[0]![0] as Entry).money).toMatchObject({ budgetId: null, outsidePocket: true });
  });

  it('주머니가 없으면 사용처를 묻지 않고 일반 지출로 저장한다', () => {
    openModal({ initial: actualDraft(), budgets: [] });
    expect(screen.queryByRole('radiogroup', { name: '사용처' })).toBeNull();
  });

  it('수입 · 대출은 주머니에 걸지 않는다', () => {
    openModal({ initial: actualDraft(), budgets: [budget()] });
    expect(screen.getByRole('radiogroup', { name: '사용처' })).toBeInTheDocument();
    for (const flow of ['대출', '수입']) {
      fireEvent.click(screen.getByRole('radio', { name: flow }));
      expect(screen.queryByRole('radiogroup', { name: '사용처' })).toBeNull();
    }
    fireEvent.click(screen.getByRole('radio', { name: '지출' }));
    expect(screen.getByRole('radio', { name: '10월 생활비' })).toHaveAttribute('aria-checked', 'true');
  });

  it('예정도 같은 흐름 셋 — 대출 예정은 사용처 대신 대출 연결', () => {
    const debt = { id: 'd1', name: '전세대출' } as never;
    const { onSave } = openModal({ initial: newEntry('money', { id: 'p1', startDate: '2026-10-24', money: newMoney({}) }), debts: [debt], budgets: [budget()] });
    fireEvent.click(screen.getByRole('radio', { name: '대출' }));
    expect(screen.queryByText('생활비에서 사용')).toBeNull();
    expect(screen.getByLabelText('대출 연결')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '1200000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((onSave.mock.calls[0]![0] as Entry).money).toMatchObject({ status: 'planned', type: 'expense', flow: 'loanPrincipal' });
  });

  it('예정으로 바꾸면 반복을 고를 수 있다', () => {
    openModal({ initial: actualDraft() });
    fireEvent.click(screen.getByRole('radio', { name: '예정' }));
    expect(screen.getByLabelText('반복')).toBeInTheDocument();
  });

  it('계좌가 여럿이고 판정이 갈리면 계좌를 정하라고 말한다', () => {
    openModal({
      initial: actualDraft({ startDate: '2026-10-05' }),
      accounts: [account({ id: 'a', asOf: '2026-10-01' }), account({ id: 'b', name: '부계좌', asOf: '2026-10-10' })],
    });
    expect(screen.getByText(/계좌를 정해 주세요/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('계좌'), { target: { value: 'b' } });
    expect(screen.queryByText(/계좌를 정해 주세요/)).toBeNull();
  });

  it('기존 할 일 입력은 그대로다', () => {
    const { onSave } = openModal({ initial: newEntry('task', { id: 't1', startDate: TODAY }) });
    expect(screen.queryByRole('radio', { name: '실제 거래' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '치과' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((onSave.mock.calls[0]![0] as Entry).kind).toBe('task');
  });
});

describe('예정 확정 · 확정 취소', () => {
  const rent = newEntry('money', {
    id: 'rent', title: '월세', startDate: '2026-01-25',
    recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
    money: newMoney({ amountMinor: 500_000, categoryId: 'default-housing' }),
  });

  it('예정을 편집하면 누른 회차를 확정하는 버튼이 있다', () => {
    const onConfirm = vi.fn();
    openModal({ initial: rent, mode: 'edit', occurrenceDate: '2026-10-25', onConfirm });
    fireEvent.click(screen.getByRole('button', { name: /실제 지출로 확정/ }));
    expect(onConfirm).toHaveBeenCalledWith(rent, '2026-10-25');
  });

  it('기간형 · legacy 생활비 예정에는 확정 버튼이 없다', () => {
    const living = newEntry('money', {
      id: 'l', startDate: '2026-10-01', endDate: '2026-10-31', money: newMoney({ type: 'living' }),
    });
    openModal({ initial: living, mode: 'edit', onConfirm: vi.fn() });
    expect(screen.queryByRole('button', { name: /로 확정/ })).toBeNull();
  });

  it('확정 창은 예정 금액 · 날짜로 시작하고, 고친 값으로 결정적 id 의 실제 거래를 만든다', () => {
    const onSave = vi.fn();
    render(
      <ConfirmSheet
        plan={rent} occurrenceDate="2026-10-25" categories={categories} categoriesReady
        accounts={[account()]} budgets={[]} debts={[]}
        onSave={onSave} onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText('실제 금액')).toHaveValue('500000');
    expect(screen.getByLabelText('실제 날짜')).toHaveValue('2026-10-25');
    fireEvent.change(screen.getByLabelText('실제 금액'), { target: { value: '520000' } });
    fireEvent.change(screen.getByLabelText('실제 날짜'), { target: { value: '2026-11-02' } });
    fireEvent.click(screen.getByRole('button', { name: '확정' }));
    const actual = onSave.mock.calls[0]![0] as Entry;
    expect(actual.id).toBe('rent~2026-10-25');
    expect(actual.startDate).toBe('2026-11-02');
    expect(actual.ymSpan).toEqual(['2026-10', '2026-11']);
    expect(actual.money).toMatchObject({
      status: 'actual', amountMinor: 520_000, categoryId: 'default-housing',
      plannedRef: { entryId: 'rent', date: '2026-10-25' },
    });
    // 확정한 회차는 화면에서 빠지고 다른 회차는 남는다.
    const shown = materialize([rent, actual], '2026-10-01', '2026-11-30');
    expect(shown.filter((e) => e.virtual).map((e) => e.startDate)).toEqual(['2026-11-25']);
  });

  it('legacy 상환은 수입 · 지출과 유형을 고르기 전에는 확정하지 않는다', () => {
    const onSave = vi.fn();
    const repay = newEntry('money', { id: 'loan', startDate: '2026-10-15', money: newMoney({ type: 'repay', amountMinor: 300_000 }) });
    render(
      <ConfirmSheet
        plan={repay} occurrenceDate="2026-10-15" categories={categories} categoriesReady
        accounts={[]} budgets={[]} debts={[]}
        onSave={onSave} onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '확정' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('골라 주세요');
    // 예전 유형은 아무것도 고르지 않은 채로 시작한다. 대출 하나로 흐름과 유형이 함께 정해진다.
    for (const r of within(screen.getByRole('radiogroup', { name: '흐름' })).getAllByRole('radio')) {
      expect(r).toHaveAttribute('aria-checked', 'false');
    }
    fireEvent.click(screen.getByRole('radio', { name: '대출' }));
    fireEvent.click(screen.getByRole('button', { name: '확정' }));
    expect((onSave.mock.calls[0]![0] as Entry).money).toMatchObject({ type: 'expense', flow: 'loanPrincipal' });
  });

  it('확정한 실제 거래를 열면 확정 취소가 있다', () => {
    const onUnconfirm = vi.fn();
    const actual = newEntry('money', {
      id: 'rent~2026-10-25', startDate: '2026-10-25',
      money: newMoney({ status: 'actual', amountMinor: 500_000, plannedRef: { entryId: 'rent', date: '2026-10-25' } }),
    });
    openModal({ initial: actual, mode: 'edit', onUnconfirm });
    expect(screen.getByText(/확정한 거래입니다/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확정 취소' }));
    expect(onUnconfirm).toHaveBeenCalledWith(actual);
  });

  it('실제 거래를 고쳐 저장해도 회차 연결이 남는다', () => {
    const actual = newEntry('money', {
      id: 'rent~2026-10-25', startDate: '2026-10-25',
      money: newMoney({ status: 'actual', amountMinor: 500_000, plannedRef: { entryId: 'rent', date: '2026-10-25' } }),
    });
    const { onSave } = openModal({ initial: actual, mode: 'edit' });
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '510000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((onSave.mock.calls[0]![0] as Entry).money?.plannedRef).toEqual({ entryId: 'rent', date: '2026-10-25' });
  });
});

describe('생활비 — 연결되지 않은 실제 지출', () => {
  it('기간 안의 실제 지출 중 연결 안 된 것을 보여 주고 연결할 수 있다', () => {
    const onLink = vi.fn();
    const loose = newEntry('money', {
      id: 'x', title: '마트', startDate: '2026-10-05', money: newMoney({ status: 'actual', amountMinor: 30_000 }),
    });
    const card = newEntry('money', {
      id: 'y', title: '카드', startDate: '2026-10-05', money: newMoney({ status: 'actual', flow: 'cardSpend', amountMinor: 30_000 }),
    });
    render(
      <BudgetPanel
        budgets={[budget()]} reserves={[]} entries={[loose, card]} collapsed={false}
        onToggleCollapsed={() => {}} onSaveBudget={() => {}} onDeleteBudget={() => {}}
        onSaveReserve={() => {}} onDeleteReserve={() => {}} onLinkEntries={onLink}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /사용처를 정하지 않은 지출 1건/ }));
    // 고르면 연결 전에 바뀌는 금액을 먼저 보여 준다.
    fireEvent.click(screen.getByRole('checkbox', { name: /마트/ }));
    expect(screen.getByRole('group', { name: '연결 미리보기' }).textContent).toContain('1건 · 30,000원');
    fireEvent.click(screen.getByRole('button', { name: '1건 연결' }));
    expect(onLink).toHaveBeenCalledWith([loose], expect.objectContaining({ id: 'b1' }));
  });

  it('생활비 외로 명시한 지출은 미결정 목록에 없다', () => {
    const outside = newEntry('money', {
      id: 'z', title: '월세', startDate: '2026-10-05',
      money: newMoney({ status: 'actual', amountMinor: 650_000, outsidePocket: true }),
    });
    const undecided = newEntry('money', {
      id: 'u', title: '마트', startDate: '2026-10-06', money: newMoney({ status: 'actual', amountMinor: 30_000 }),
    });
    const onOutside = vi.fn();
    render(
      <BudgetPanel
        budgets={[budget()]} reserves={[]} entries={[outside, undecided]} collapsed={false}
        onToggleCollapsed={() => {}} onSaveBudget={() => {}} onDeleteBudget={() => {}}
        onSaveReserve={() => {}} onDeleteReserve={() => {}} onMarkOutside={onOutside}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /사용처를 정하지 않은 지출 1건/ }));
    const list = screen.getByRole('list', { name: '사용처를 정하지 않은 지출' });
    expect(within(list).queryByText('월세')).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: '생활비 외' }));
    expect(onOutside).toHaveBeenCalledWith(undecided);
  });
});
