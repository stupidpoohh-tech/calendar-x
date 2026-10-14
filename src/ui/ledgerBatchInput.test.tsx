/**
 * 입력 리스트 — 줄로 쭉 적고 한 번에 저장. Enter 로 다음 칸 · 다음 줄, 잘못된 줄이 하나라도 있으면
 * 아무것도 저장하지 않고, 오늘까지는 실제 거래 · 앞날은 예정으로.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCategory } from '../domain/category';
import type { Entry } from '../domain/types';
import { blankRow, rowsToEntries, type BatchRow } from './batchRows';
import { LedgerBatchInput } from './LedgerBatchInput';

afterEach(cleanup);
const TODAY = '2026-10-14';
const cats = [newCategory('expense', '식비', 0, 'food'), newCategory('income', '급여', 0, 'salary'), newCategory('expense', '대출', 1, 'loan')];

function Harness({ onSave }: { onSave: (e: Entry[], l: string) => Promise<{ ok: number; failed: number }> }) {
  const [rows, setRows] = useState<BatchRow[]>([blankRow(TODAY), blankRow(TODAY)]);
  return <LedgerBatchInput rows={rows} onRows={setRows} todayISO={TODAY} defaultDate={TODAY} categories={cats} categoriesReady onSave={onSave} />;
}
const mount = () => {
  const onSave = vi.fn((list: Entry[]) => Promise.resolve({ ok: list.length, failed: 0 }));
  render(<Harness onSave={onSave} />);
  return onSave;
};
const field = (n: number, name: string) => screen.getByLabelText(`${n}번째 줄 ${name}`) as HTMLInputElement;

describe('입력 리스트', () => {
  it('여러 줄을 적고 한 번에 저장한다 — 실제 · 예정 · 흐름 · 카테고리, 빈 줄은 건너뛴다', () => {
    const onSave = mount();
    fireEvent.change(field(1, '금액'), { target: { value: '12,000' } });
    fireEvent.change(field(1, '내역'), { target: { value: '점심' } });
    fireEvent.change(field(1, '카테고리'), { target: { value: 'food' } });
    fireEvent.change(field(2, '흐름'), { target: { value: 'income' } });
    fireEvent.change(field(2, '날짜'), { target: { value: '2026-10-25' } });
    fireEvent.change(field(2, '금액'), { target: { value: '3400000' } });
    fireEvent.change(field(2, '카테고리'), { target: { value: 'salary' } });
    fireEvent.click(screen.getByRole('button', { name: /줄 추가/ }));
    fireEvent.change(field(3, '흐름'), { target: { value: 'loan' } });
    fireEvent.change(field(3, '금액'), { target: { value: '1200000' } });
    fireEvent.click(screen.getByRole('button', { name: /줄 추가/ })); // 빈 4번째 줄
    expect(screen.getByLabelText('입력 리스트 합계').textContent).toBe('3건 · 수입 +3,400,000 · 지출 −12,000 · 대출 −1,200,000 · 그중 예정 2건');
    fireEvent.click(screen.getByRole('button', { name: '3건 저장' }));
    const [list, label] = onSave.mock.calls[0]! as unknown as [Entry[], string];
    expect(label).toBe('입력 리스트');
    expect(list.map((e) => [e.startDate, e.title, e.money!.status, e.money!.type, e.money!.flow, e.money!.amountMinor, e.money!.categoryId])).toEqual([
      [TODAY, '점심', 'actual', 'expense', 'normal', 12_000, 'food'],
      ['2026-10-25', '', 'planned', 'income', 'normal', 3_400_000, 'salary'],
      // 새 줄은 앞 줄의 날짜를 이어받는다.
      ['2026-10-25', '', 'planned', 'expense', 'loanPrincipal', 1_200_000, null],
    ]);
    expect(list.every((e) => e.ymSpan.length > 0)).toBe(true);
    // 저장하면 줄을 비우고 알린다.
    expect(screen.getByRole('status').textContent).toBe('3건을 적었습니다.');
    expect(field(1, '금액').value).toBe('');
    expect(screen.queryByLabelText('2번째 줄 금액')).toBeNull();
  });

  it('금액이 잘못된 줄이 있으면 아무것도 저장하지 않고 그 줄을 짚는다', () => {
    const onSave = mount();
    fireEvent.change(field(1, '금액'), { target: { value: '5000' } });
    fireEvent.change(field(2, '내역'), { target: { value: '금액 빠짐' } });
    fireEvent.click(screen.getByRole('button', { name: '2건 저장' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('금액을 0보다 크게 적어 주세요.')).toBeInTheDocument();
    expect(field(2, '금액')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/아무것도 저장하지 않았습니다/)).toBeInTheDocument();
  });

  it('Enter — 금액 → 내역 → 다음 줄, 마지막 줄이면 줄을 더한다. 한글 조합 중 Enter 는 넘기지 않는다', () => {
    mount();
    fireEvent.keyDown(field(2, '내역'), { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(screen.queryByLabelText('3번째 줄 금액')).toBeNull();
    fireEvent.keyDown(field(2, '내역'), { key: 'Enter' });
    expect(screen.getByLabelText('3번째 줄 금액')).toBeInTheDocument();
    expect(document.activeElement).toBe(field(3, '금액'));
    // 이미 있는 칸으로는 그 자리에서 바로 옮긴다.
    fireEvent.keyDown(field(3, '금액'), { key: 'Enter' });
    expect(document.activeElement).toBe(field(3, '내역'));
  });

  it("고르는 카테고리에 '대출' 은 없고, 대출 줄은 카테고리를 고르지 않는다", () => {
    mount();
    expect([...field(1, '카테고리').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['카테고리', '식비']);
    fireEvent.change(field(1, '흐름'), { target: { value: 'loan' } });
    expect(field(1, '카테고리')).toBeDisabled();
  });

  it('rowsToEntries — 앞날은 예정, 오늘은 실제', () => {
    const rows = [{ ...blankRow('2026-10-15'), amount: '1' }, { ...blankRow(TODAY), amount: '2' }];
    expect(rowsToEntries(rows, TODAY).map((e) => e.money!.status)).toEqual(['planned', 'actual']);
  });
});
