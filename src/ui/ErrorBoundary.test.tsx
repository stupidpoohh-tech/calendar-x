/** 렌더가 무너져도 하얀 화면을 남기지 않는다. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('한도를 계산할 수 없습니다');
  return <p>정상 화면</p>;
}

describe('ErrorBoundary', () => {
  it('무너지면 무엇이 났는지 적는다', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary label="가계부"><Boom fail /></ErrorBoundary>);

    expect(screen.getByRole('alert').textContent).toContain('화면을 그리지 못했습니다');
    expect(screen.getByRole('alert').textContent).toContain('가계부');
    expect(screen.getByRole('alert').textContent).toContain('한도를 계산할 수 없습니다');
    // 오류를 0원이나 빈 화면으로 바꿔 그리지 않는다.
    expect(screen.queryByText('정상 화면')).toBeNull();
    quiet.mockRestore();
  });

  it('자료를 손대지 않았다고 알린다', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom fail /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('저장된 자료는 그대로입니다');
    quiet.mockRestore();
  });

  it('다시 그려 보기로 회복한다', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<ErrorBoundary><Boom fail /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();

    rerender(<ErrorBoundary><Boom fail={false} /></ErrorBoundary>);
    fireEvent.click(screen.getByText('다시 그려 보기'));

    expect(screen.getByText('정상 화면')).toBeTruthy();
    quiet.mockRestore();
  });

  it('멀쩡할 때는 아무것도 하지 않는다', () => {
    render(<ErrorBoundary><Boom fail={false} /></ErrorBoundary>);
    expect(screen.getByText('정상 화면')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
