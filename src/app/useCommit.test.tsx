/**
 * 서버 쓰기 실패를 알리고 다시 보낼 기회를 준다.
 *
 * 오프라인 지속성 때문에 쓰기 promise 는 서버 ack 까지 resolve 하지 않는다 —
 * 오프라인에서는 **거부되지 않고 매달려 있다**. 그 상태를 실패로 그리면 평소 편집이
 * 오프라인에서 못 쓰는 것처럼 보인다. 여기서 잡는 것은 서버가 거절한 경우뿐이다.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogHost } from '../ui/Dialog';
import { useCommit } from './useCommit';

afterEach(cleanup);

function Harness({ run }: { run: () => Promise<unknown> }) {
  const commit = useCommit();
  return <button onClick={() => commit('잔고', run)}>보내기</button>;
}

const mount = (run: () => Promise<unknown>) =>
  render(<DialogHost><Harness run={run} /></DialogHost>);

describe('useCommit', () => {
  it('받침에 따라 을·를 을 고른다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Two() {
      const commit = useCommit();
      return <button onClick={() => commit('항목', () => Promise.reject(new Error('x')))}>항목</button>;
    }
    render(<DialogHost><Two /></DialogHost>);
    fireEvent.click(screen.getByText('항목'));
    await screen.findByText('항목을 서버에 저장하지 못했습니다');
    boom.mockRestore();
  });

  it('성공하면 아무 말도 하지 않는다', async () => {
    const run = vi.fn(() => Promise.resolve());
    mount(run);
    fireEvent.click(screen.getByText('보내기'));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.dlg')).toBeNull();
  });

  it('거절당하면 로컬에만 남았다는 사실을 알린다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount(() => Promise.reject(new Error('permission-denied')));
    fireEvent.click(screen.getByText('보내기'));

    await screen.findByText('잔고를 서버에 저장하지 못했습니다');
    expect(document.querySelector('.dlg')!.textContent).toContain('이 기기에서만');
    boom.mockRestore();
  });

  it('다시 보내기를 고르면 같은 값을 그대로 다시 보낸다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const run = vi.fn(() => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('unavailable')) : Promise.resolve();
    });
    mount(run);
    fireEvent.click(screen.getByText('보내기'));

    await screen.findByText('잔고를 서버에 저장하지 못했습니다');
    fireEvent.click(screen.getByRole('button', { name: '다시 보내기' }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    // 두 번째는 성공했으니 더 묻지 않는다.
    await waitFor(() => expect(document.querySelector('.dlg')).toBeNull());
    boom.mockRestore();
  });

  it('나중에를 고르면 조용히 끝난다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn(() => Promise.reject(new Error('unavailable')));
    mount(run);
    fireEvent.click(screen.getByText('보내기'));

    await screen.findByText('잔고를 서버에 저장하지 못했습니다');
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));

    await waitFor(() => expect(document.querySelector('.dlg')).toBeNull());
    expect(run).toHaveBeenCalledTimes(1);
    boom.mockRestore();
  });

  it('오프라인에서 매달려 있는 쓰기를 실패로 그리지 않는다', async () => {
    // 오프라인 큐에 들어간 쓰기는 연결이 돌아올 때까지 resolve 도 reject 도 하지 않는다.
    mount(() => new Promise(() => {}));
    fireEvent.click(screen.getByText('보내기'));

    await act(() => Promise.resolve());
    expect(document.querySelector('.dlg')).toBeNull();
  });
});
