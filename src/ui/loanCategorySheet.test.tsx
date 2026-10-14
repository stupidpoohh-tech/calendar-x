/**
 * 예전 '대출' 카테고리 정리 창 — 미리보기 → 확인 → 흐름만 바꿔 쓰기 → 서버에서 다시 읽어 확인 → 되돌리기.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCategory } from '../domain/category';
import { newEntry, newMoney } from '../domain/entry';
import type { Entry, MoneyFields } from '../domain/types';
import { DialogHost } from './Dialog';
import { LoanCategorySheet } from './LoanCategorySheet';

afterEach(cleanup);

const cats = [newCategory('expense', '대출', 0, 'loan')];
const tx = (id: string, date: string, m: Partial<MoneyFields> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ status: 'actual', amountMinor: 500_000, categoryId: 'loan', ...m }) });
const ENTRIES = [tx('a', '2026-10-02'), tx('b', '2026-09-02'), tx('pk', '2026-10-03', { budgetId: 'b1' })];

function mount() {
  let server = ENTRIES;
  const onApply = vi.fn(async (list: Entry[]) => {
    server = server.map((e) => list.find((x) => x.id === e.id) ?? e);
    return { ok: list.length, failed: 0 };
  });
  render(
    <DialogHost>
      <LoanCategorySheet categories={cats} load={() => Promise.resolve(server)} onBackup={vi.fn(() => Promise.resolve(true))} onApply={onApply} onClose={vi.fn()} />
    </DialogHost>,
  );
  return onApply;
}

describe('예전 대출 카테고리 정리 창', () => {
  it('옮길 거래는 모두 골라 두고, 생활비에 걸린 것은 고를 수 없게 따로', async () => {
    mount();
    const list = await screen.findByRole('region', { name: '옮길 거래' });
    expect(within(list).getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(within(screen.getByRole('region', { name: '생활비에 걸린 거래' })).getByRole('checkbox', { hidden: true })).toBeDisabled();
    expect(screen.getByLabelText('고른 항목 요약').textContent).toContain('실제 2건 1,000,000원');
  });

  it('확인하면 흐름만 대출로 바꿔 쓰고, 서버에서 다시 읽어 확인하고, 되돌릴 수 있다', async () => {
    const onApply = mount();
    await screen.findByRole('region', { name: '옮길 거래' });
    fireEvent.click(screen.getByRole('checkbox', { name: /^b / }));
    fireEvent.click(screen.getByRole('button', { name: '고른 1건 대출로 바꾸기' }));
    await act(async () => { fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '대출로 바꾸기' })); });
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const written = onApply.mock.calls[0]![0] as Entry[];
    expect(written.map((e) => [e.id, e.money!.flow, e.money!.categoryId, e.money!.amountMinor])).toEqual([['a', 'loanPrincipal', 'loan', 500_000]]);
    expect((await screen.findByText('정리 결과')).parentElement!.textContent).toContain('모두 반영됐습니다');
    // 바꾼 것은 목록에서 빠진다(이미 대출).
    expect(screen.queryByRole('checkbox', { name: /^a / })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '방금 바꾼 1건 되돌리기' })); });
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect((onApply.mock.calls[1]![0] as Entry[]).map((e) => [e.id, e.money!.flow])).toEqual([['a', 'normal']]);
    expect((await screen.findByText('되돌린 결과')).parentElement!.textContent).toContain('모두 반영됐습니다');
  });
});
