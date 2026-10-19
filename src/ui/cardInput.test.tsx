/**
 * 결제수단 입력 — 카드가 없는 사람도 지출을 막힘없이 적고, 적던 창에서 카드를 등록하고, 입력 리스트에서도 카드
 * 사용을 적는다.
 *
 * 카드 사용 · 생활비 · 세이브 연결(P1-D)과 미결제 · 한도 계산은 `card.test.tsx` · `domain/card.test.ts` ·
 * `domain/cardPocket.test.ts` 가 못박았다. 여기서는 입력 화면이 그 모양을 만드는지 본다.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { newCard } from '../domain/card';
import { defaultCategories, newCategory } from '../domain/category';
import { newEntry, newMoney } from '../domain/entry';
import type { Account, Card, Entry, MoneyFields } from '../domain/types';
import { blankRow, rowsToEntries, withPick, type BatchRow } from './batchRows';
import { ConfirmSheet } from './ConfirmSheet';
import { EntryModal } from './EntryModal';
import { LedgerBatchInput } from './LedgerBatchInput';

const TODAY = '2026-10-16';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T12:00:00+09:00')); });
afterAll(() => { vi.useRealTimers(); });
afterEach(cleanup);

const categories = defaultCategories('');
const account: Account = {
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '',
};
const life = newCard({ id: 'life', name: '생활 카드', closeDay: 31, payDay: 25, payMonthOffset: 1, accountId: 'a1' });
const biz = newCard({ id: 'biz', name: '업무 카드', closeDay: 15, payDay: 1, payMonthOffset: 1, accountId: 'a1' });
const tx = (id: string, m: Partial<MoneyFields>): Entry => newEntry('money', {
  id, title: id, startDate: TODAY, money: newMoney({ status: 'actual', type: 'expense', amountMinor: 30_000, ...m }),
});
const draft = () => newEntry('money', { id: 'n', startDate: TODAY, money: newMoney({ status: 'actual' }) });

function modal(props: Partial<Parameters<typeof EntryModal>[0]> & { initial: Entry }) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <EntryModal
      open mode="create" allTags={[]} linkableTasks={[]} budgets={[]} debts={[]}
      categories={categories} accounts={[account]}
      onSave={onSave} onDelete={() => {}} onClose={onClose}
      {...props}
    />,
  );
  return { onSave, onClose };
}
const saved = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0]![0] as Entry;
const methods = () => within(screen.getByRole('radiogroup', { name: '결제수단' }));

describe('결제수단은 늘 보인다', () => {
  it('카드가 없어도 지출에 결제수단이 있고, 고르지 않으면 지금까지와 같은 일반 지출이다', () => {
    const { onSave } = modal({ initial: draft(), onSaveCard: () => true });
    expect(methods().getByRole('radio', { name: '현금 · 계좌' })).toHaveAttribute('aria-checked', 'true');
    expect(methods().getByRole('button', { name: '신용카드 · 카드 등록' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '9,000' } });
    fireEvent.change(screen.getByRole('combobox', { name: '카테고리' }), { target: { value: 'default-food' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(onSave).money).toMatchObject({ type: 'expense', flow: 'normal', amountMinor: 9_000 });
    expect(saved(onSave).money!.cardId ?? null).toBeNull();
  });

  it('등록 길이 없는 자리는 어디서 등록하는지 적는다', () => {
    modal({ initial: draft() });
    expect(methods().getAllByRole('radio').map((r) => r.textContent)).toEqual(['현금 · 계좌']);
    expect(screen.getByRole('dialog').textContent).toContain('현금흐름 > 카드대금에서 등록합니다');
  });

  it('수입 · 대출 · 카드 대금에는 소비용 결제수단을 묻지 않는다', () => {
    modal({ initial: draft(), cards: [life] });
    fireEvent.click(screen.getByRole('radio', { name: '수입' }));
    expect(screen.queryByRole('radiogroup', { name: '결제수단' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '대출' }));
    expect(screen.queryByRole('radiogroup', { name: '결제수단' })).toBeNull();
    cleanup();
    modal({ initial: tx('pay', { flow: 'cardPayment', cardId: 'life', cardCycle: '2026-10' }), cards: [life] });
    expect(screen.queryByRole('radiogroup', { name: '결제수단' })).toBeNull();
  });
});

describe('지출을 적다가 카드 등록', () => {
  function Harness({ onSave, onClose, accept = true }: { onSave: (e: Entry) => void; onClose: () => void; accept?: boolean }) {
    const [cards, setCards] = useState<readonly Card[]>([]);
    return (
      <EntryModal
        open mode="create" initial={draft()} allTags={[]} linkableTasks={[]} budgets={[]} debts={[]}
        categories={categories} accounts={[account]} cards={cards}
        onSave={onSave} onDelete={() => {}} onClose={onClose}
        // 구독이 한 박자 늦게 돌려주는 것처럼 — 저장 직후에는 목록에 아직 없다.
        onSaveCard={(c) => { if (accept) setTimeout(() => setCards((xs) => [...xs, c]), 0); return accept; }}
      />
    );
  }
  const fill = () => {
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '45,000' } });
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '셔츠' } });
    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-10-14' } });
    fireEvent.change(screen.getByRole('combobox', { name: '카테고리' }), { target: { value: 'default-shopping' } });
  };
  const kept = () => {
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('45,000');
    expect((screen.getByLabelText('내용') as HTMLInputElement).value).toBe('셔츠');
    expect((screen.getByLabelText('날짜') as HTMLInputElement).value).toBe('2026-10-14');
    expect(screen.getByRole('combobox', { name: '카테고리' })).toHaveValue('default-shopping');
  };

  it('등록하면 적던 거래로 돌아와 새 카드가 골라져 있고, 카드 사용으로 저장된다', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<Harness onSave={onSave} onClose={onClose} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '신용카드 · 카드 등록' }));
    expect(screen.getByRole('dialog', { name: '카드 등록' })).toBeInTheDocument();
    expect(screen.queryByLabelText('금액')).toBeNull();
    fireEvent.change(screen.getByLabelText('카드 이름'), { target: { value: '새 카드' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(screen.getByRole('dialog', { name: '지출 거래 추가' })).toBeInTheDocument();
    kept();
    expect(methods().getByRole('radio', { name: '새 카드' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('지워진 카드')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const e = saved(onSave);
    expect(e.startDate).toBe('2026-10-14');
    expect(e.title).toBe('셔츠');
    expect(e.money).toMatchObject({ status: 'actual', flow: 'cardSpend', amountMinor: 45_000, categoryId: 'default-shopping' });
    expect(e.money!.cardId).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('취소 · Esc 는 카드 양식만 닫는다 — 적던 내용은 그대로, 결제수단은 현금 · 계좌', () => {
    const onClose = vi.fn();
    render(<Harness onSave={vi.fn()} onClose={onClose} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '신용카드 · 카드 등록' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    kept();
    expect(methods().getByRole('radio', { name: '현금 · 계좌' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: '신용카드 · 카드 등록' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    kept();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('저장을 맡지 못했으면(로그인 전) 카드를 고르지 않는다', () => {
    render(<Harness onSave={vi.fn()} onClose={vi.fn()} accept={false} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '신용카드 · 카드 등록' }));
    fireEvent.change(screen.getByLabelText('카드 이름'), { target: { value: '새 카드' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByRole('dialog', { name: '카드 등록' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    kept();
    expect(methods().getByRole('radio', { name: '현금 · 계좌' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('저장된 거래의 결제수단 바꾸기', () => {
  it('카드 사용의 카드를 바꾸고, 현금으로 되돌린다', () => {
    const spend = tx('s', { flow: 'cardSpend', cardId: 'life', categoryId: 'default-food' });
    const a = modal({ initial: spend, mode: 'edit', cards: [life, biz] });
    fireEvent.click(methods().getByRole('radio', { name: '업무 카드' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(a.onSave).money).toMatchObject({ flow: 'cardSpend', cardId: 'biz', categoryId: 'default-food', amountMinor: 30_000 });
    cleanup();

    const b = modal({ initial: spend, mode: 'edit', cards: [life, biz] });
    fireEvent.click(methods().getByRole('radio', { name: '현금 · 계좌' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(b.onSave).money).toMatchObject({ flow: 'normal', cardId: null, cardCycle: null, amountMinor: 30_000 });
  });

  it('현금 거래를 카드 거래로 바꾼다', () => {
    const { onSave } = modal({ initial: tx('c', { flow: 'normal', categoryId: 'default-food' }), mode: 'edit', cards: [life] });
    fireEvent.click(methods().getByRole('radio', { name: '생활 카드' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(saved(onSave).money).toMatchObject({ flow: 'cardSpend', cardId: 'life', categoryId: 'default-food' });
  });

  it('예정 카드 사용을 확정하면 같은 카드의 실제 카드 사용이 된다', () => {
    const plan = newEntry('money', {
      id: 'p', title: '항공권', startDate: '2026-10-20',
      money: newMoney({ status: 'planned', type: 'expense', flow: 'cardSpend', cardId: 'life', amountMinor: 400_000 }),
    });
    const onSave = vi.fn();
    render(
      <ConfirmSheet
        plan={plan} occurrenceDate="2026-10-20" categories={categories} categoriesReady
        accounts={[account]} budgets={[]} cards={[life]} cardEntries={[]} debts={[]}
        onSave={onSave} onClose={() => {}}
      />,
    );
    expect(methods().getByRole('radio', { name: '생활 카드' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: '확정' }));
    expect(saved(onSave).money).toMatchObject({ status: 'actual', flow: 'cardSpend', cardId: 'life', amountMinor: 400_000 });
  });
});

describe('입력 리스트의 카드 지출', () => {
  const cats = [newCategory('expense', '식비', 0, 'food'), newCategory('income', '급여', 0, 'salary')];
  function Harness({ cards, onSave }: { cards: readonly Card[]; onSave: (e: Entry[], l: string) => Promise<{ ok: number; failed: number }> }) {
    const [rows, setRows] = useState<BatchRow[]>([blankRow(TODAY), blankRow(TODAY), blankRow(TODAY)]);
    return <LedgerBatchInput rows={rows} onRows={setRows} todayISO={TODAY} defaultDate={TODAY} categories={cats} categoriesReady cards={cards} onSave={onSave} />;
  }
  const mount = (cards: readonly Card[]) => {
    const onSave = vi.fn((list: Entry[]) => Promise.resolve({ ok: list.length, failed: 0 }));
    render(<Harness cards={cards} onSave={onSave} />);
    return onSave;
  };
  const field = (n: number, name: string) => screen.getByLabelText(`${n}번째 줄 ${name}`) as HTMLInputElement;

  it('현금 지출 · 카드 지출 · 앞날 카드 사용 예정을 한 번에 저장한다', () => {
    const onSave = mount([life, biz]);
    fireEvent.change(field(1, '금액'), { target: { value: '12,000' } });
    fireEvent.change(field(1, '카테고리'), { target: { value: 'food' } });
    fireEvent.change(field(2, '금액'), { target: { value: '45,000' } });
    fireEvent.change(field(2, '결제수단'), { target: { value: 'life' } });
    fireEvent.change(field(3, '날짜'), { target: { value: '2026-10-30' } });
    fireEvent.change(field(3, '금액'), { target: { value: '80,000' } });
    fireEvent.change(field(3, '결제수단'), { target: { value: 'biz' } });
    fireEvent.click(screen.getByRole('button', { name: '3건 저장' }));
    const [list] = onSave.mock.calls[0]! as unknown as [Entry[]];
    expect(list.map((e) => [e.startDate, e.money!.status, e.money!.type, e.money!.flow, e.money!.cardId, e.money!.amountMinor, e.money!.categoryId])).toEqual([
      [TODAY, 'actual', 'expense', 'normal', null, 12_000, 'food'],
      [TODAY, 'actual', 'expense', 'cardSpend', 'life', 45_000, null],
      ['2026-10-30', 'planned', 'expense', 'cardSpend', 'biz', 80_000, null],
    ]);
  });

  it('지출을 수입 · 대출로 바꾸면 카드를 뗀다 — 결제수단 칸도 잠긴다', () => {
    const onSave = mount([life]);
    fireEvent.change(field(1, '금액'), { target: { value: '3,000,000' } });
    fireEvent.change(field(1, '결제수단'), { target: { value: 'life' } });
    fireEvent.change(field(1, '흐름'), { target: { value: 'income' } });
    expect(field(1, '결제수단').disabled).toBe(true);
    fireEvent.change(field(1, '흐름'), { target: { value: 'expense' } });
    expect(field(1, '결제수단').value).toBe('');
    fireEvent.change(field(1, '흐름'), { target: { value: 'income' } });
    fireEvent.click(screen.getByRole('button', { name: '1건 저장' }));
    const [list] = onSave.mock.calls[0]! as unknown as [Entry[]];
    expect(list[0]!.money).toMatchObject({ type: 'income', flow: 'normal', cardId: null });
  });

  it('카드가 없으면 결제수단 칸이 없고, 저장 결과는 지금까지와 같다', () => {
    const onSave = mount([]);
    expect(screen.queryByLabelText('1번째 줄 결제수단')).toBeNull();
    fireEvent.change(field(1, '금액'), { target: { value: '12,000' } });
    fireEvent.click(screen.getByRole('button', { name: '1건 저장' }));
    const [list] = onSave.mock.calls[0]! as unknown as [Entry[]];
    expect(list[0]!.money).toMatchObject({ type: 'expense', flow: 'normal', cardId: null, status: 'actual' });
  });

  it('줄 모양 — 카드는 지출 줄에만 남는다', () => {
    const row: BatchRow = { ...blankRow(TODAY), amount: '1000', cardId: 'life' };
    expect(withPick(row, 'loan').cardId).toBeNull();
    expect(withPick(row, 'expense').cardId).toBe('life');
    // 혹시 수입 줄에 카드가 남아 있어도 거래로 바꿀 때 걸지 않는다.
    const [e] = rowsToEntries([{ ...row, pick: 'income' }], TODAY);
    expect(e!.money).toMatchObject({ type: 'income', flow: 'normal', cardId: null });
  });
});

