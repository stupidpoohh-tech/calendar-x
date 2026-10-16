import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultRecoveryRule } from '../domain/recovery';
import { RecoverySettings } from './RecoverySettings';
afterEach(cleanup);
function Harness() {
  const [rule, setRule] = useState({ ...defaultRecoveryRule(), enabled: true });
  return <RecoverySettings rule={rule} onChange={setRule} onPause={vi.fn()} onResume={vi.fn()} />;
}
it('설정에서 할 것을 추가하고 선택 해제·분류 변경을 반영한다', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Recovery 옵션 관리' }));
  fireEvent.change(screen.getByLabelText('새 항목 구분'), { target: { value: 'do' } });
  fireEvent.change(screen.getByLabelText('새 회복 항목'), { target: { value: '사우나' } });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  const sauna = within(screen.getByRole('group', { name: '할 것' })).getByRole('button', { name: '사우나' });
  expect(sauna).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(sauna);
  expect(sauna).toHaveAttribute('aria-pressed', 'false');
  fireEvent.change(screen.getByLabelText('사우나 구분'), { target: { value: 'off' } });
  expect(within(screen.getByRole('group', { name: '끌 것' })).getByRole('button', { name: '사우나' })).toHaveAttribute('aria-pressed', 'false');
  expect(within(screen.getByRole('group', { name: '할 것' })).queryByRole('button')).toBeNull();
});
it('한글 조합 중 Enter는 추가하지 않고 확정 뒤 추가한다', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Recovery 옵션 관리' }));
  const input = screen.getByLabelText('새 회복 항목');
  fireEvent.change(input, { target: { value: '고민' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(screen.queryByRole('button', { name: '고민' })).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByRole('button', { name: '고민' })).toHaveAttribute('aria-pressed', 'true');
});
