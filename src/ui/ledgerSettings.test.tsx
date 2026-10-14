/**
 * 설정 — 정산 시작일 · 카테고리 관리.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCategory } from '../domain/category';
import type { Category } from '../domain/types';
import { LedgerSettings } from './LedgerSettings';

afterEach(cleanup);

function mount(categories: Category[], settleDay = 1) {
  const props = {
    todayISO: '2026-10-12', settleDay, onSettleDay: vi.fn(), categories, categoriesReady: true,
    onSaveCategory: vi.fn(), onSaveCategories: vi.fn(), onSeedCategories: vi.fn(),
  };
  render(<LedgerSettings {...props} />);
  return props;
}

const list = [
  newCategory('expense', '식비', 0, 'food'),
  newCategory('expense', '카페', 1, 'cafe'),
  { ...newCategory('expense', '옛 취미', 2, 'old'), archived: true },
  newCategory('income', '급여', 0, 'salary'),
];

describe('정산 시작일', () => {
  it('1~31일 중 고르고, 지금 기간의 범위를 보여 준다', () => {
    const p = mount(list, 25);
    expect(screen.getByText('9.25 – 10.24')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('정산 시작일'), { target: { value: '31' } });
    expect(p.onSettleDay).toHaveBeenCalledWith(31);
    expect(screen.getAllByRole('option')).toHaveLength(31);
  });

  it('29일 이상이면 말일 보정을 알린다', () => {
    mount(list, 30);
    expect(screen.getByText(/말일부터 시작합니다/)).toBeInTheDocument();
  });
});

describe('카테고리', () => {
  it('흐름별로 보이고, 보관한 것은 접혀 있다', () => {
    mount(list);
    const ul = screen.getByRole('list', { name: '지출 카테고리' });
    expect(within(ul).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '보관한 카테고리 1개' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '수입' }));
    expect(within(screen.getByRole('list', { name: '수입 카테고리' })).getByText('급여')).toBeInTheDocument();
  });

  it('추가 · 이름 바꾸기 · 보관 · 다시 꺼내기 — 지우는 자리는 없다', () => {
    const p = mount(list);
    fireEvent.change(screen.getByLabelText('새 카테고리 이름'), { target: { value: '교통' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(p.onSaveCategory).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'expense', name: '교통', order: 3 }));

    fireEvent.click(screen.getByRole('button', { name: '식비 이름 바꾸기' }));
    fireEvent.change(screen.getByLabelText('카테고리 이름'), { target: { value: '밥' } });
    fireEvent.keyDown(screen.getByLabelText('카테고리 이름'), { key: 'Enter' });
    expect(p.onSaveCategory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'food', name: '밥' }));

    const cafe = screen.getByRole('button', { name: '카페 이름 바꾸기' }).closest('li')!;
    fireEvent.click(within(cafe).getByRole('button', { name: '보관' }));
    expect(p.onSaveCategory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'cafe', archived: true }));

    fireEvent.click(screen.getByRole('button', { name: '보관한 카테고리 1개' }));
    fireEvent.click(screen.getByRole('button', { name: '다시 꺼내기' }));
    expect(p.onSaveCategory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'old', archived: false }));
    expect(screen.queryByRole('button', { name: /삭제/ })).toBeNull();
  });

  it('같은 이름은 새로 만들지 않는다. 보관한 것이면 다시 꺼낸다', () => {
    const p = mount(list);
    fireEvent.change(screen.getByLabelText('새 카테고리 이름'), { target: { value: ' 식비 ' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(p.onSaveCategory).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('이미 있습니다');
    fireEvent.change(screen.getByLabelText('새 카테고리 이름'), { target: { value: '옛 취미' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(p.onSaveCategory).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'old', archived: false }));
  });

  it('순서를 옮기면 바뀐 것만 한꺼번에 넘긴다', () => {
    const p = mount(list);
    fireEvent.click(screen.getByRole('button', { name: '카페 위로' }));
    expect(p.onSaveCategories).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'cafe', order: 0 }), expect.objectContaining({ id: 'food', order: 1 }),
    ]);
  });

  it('카테고리가 없으면 기본 카테고리를 만들 수 있다', () => {
    const p = mount([]);
    fireEvent.click(screen.getByRole('button', { name: '기본 카테고리 만들기' }));
    expect(p.onSeedCategories).toHaveBeenCalled();
  });

  it('목록은 한 줄로 접혀 있다 — 이름 · 개수만, 펼치면 그 자리에서 고친다', () => {
    mount(list);
    const fold = screen.getByText('카테고리', { selector: '.led-catfold-t' }).closest('details')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toContain('지출 2 · 수입 1');
    fireEvent.click(fold.querySelector('summary')!);
    expect(fold.open).toBe(true);
  });

  it("'대출' 카테고리에는 입력에서 빠졌다는 표시가 붙는다 — 지우지 않는다", () => {
    const p = mount([...list, newCategory('expense', '대출', 3, 'loan')]);
    const loan = screen.getByRole('button', { name: '대출 이름 바꾸기' });
    expect(loan.textContent).toContain("입력에서 빠짐 · 흐름 '대출'");
    expect(p.onSaveCategory).not.toHaveBeenCalled();
  });
});
