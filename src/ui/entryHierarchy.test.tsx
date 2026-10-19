import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EntryModal } from './EntryModal';
import { newEntry, newMoney } from '../domain/entry';
import { defaultCategories } from '../domain/category';
afterEach(cleanup);
it('예정 입력의 추가 옵션은 필요할 때 열며 접어도 내용을 저장한다', () => {
  const save = vi.fn();
  render(<EntryModal open mode="create" initial={newEntry('money', { startDate:'2026-10-20', money:newMoney({amountMinor:30000}) })}
    allTags={[]} linkableTasks={[]} budgets={[]} debts={[]} categories={defaultCategories('')}
    onSave={save} onClose={() => {}} onDelete={() => {}} />);
  expect(screen.getByRole('dialog', {name:'지출 예정 추가'})).toBeInTheDocument();
  expect(screen.getByLabelText('메모')).not.toBeVisible();
  expect(screen.getByRole('combobox', {name:'카테고리'})).toBeVisible();
  fireEvent.click(screen.getByRole('button', {name:/추가 옵션/}));
  fireEvent.change(screen.getByLabelText('메모'), {target:{value:'보존할 메모'}});
  fireEvent.change(screen.getByLabelText('반복'), {target:{value:'monthly'}});
  fireEvent.click(screen.getByRole('button', {name:/추가 옵션/}));
  fireEvent.click(screen.getByRole('button', {name:'저장'}));
  expect(save.mock.calls[0]?.[0]).toMatchObject({note:'보존할 메모', recurrence:{freq:'monthly'}});
});
it('이미 옵션이 있는 거래를 수정할 때는 숨겨 두지 않는다', () => {
  render(<EntryModal open mode="edit" initial={newEntry('money', { note:'기존 메모', money:newMoney({amountMinor:30000}) })}
    allTags={[]} linkableTasks={[]} budgets={[]} debts={[]} onSave={() => {}} onClose={() => {}} onDelete={() => {}} />);
  expect(screen.getByLabelText('메모')).toBeVisible();
  expect(screen.getByRole('button', {name:/추가 옵션/})).toHaveAttribute('aria-expanded','true');
});
