/**
 * 복원 결과를 사실대로 말한다.
 *
 * 예전에는 `saveState` 의 실패를 버리고 무조건 "복원했습니다" 를 띄웠다. 사생활 보호
 * 모드나 용량 초과로 저장이 막히면 창을 닫는 순간 사라지는데, 사용자는 복원된 줄 알고
 * 백업 링크를 버린다.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBackup } from './lib/backup';
import { makeInitialState } from './lib/types';

const saved = vi.hoisted(() => ({ ok: true, calls: 0 }));

vi.mock('./lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/storage')>();
  return {
    ...actual,
    storageAvailable: () => true,
    loadState: () => ({ status: 'empty' as const }),
    requestPersistence: () => Promise.resolve('unsupported' as const),
    hasBackupHistory: () => false,
    lastBackupAt: () => null,
    markBackupTaken: () => {},
    saveState: () => { saved.calls++; return saved.ok; },
  };
});

const { useStore } = await import('./store');

const PAYLOAD = encodeBackup(makeInitialState(1_000_000));

beforeEach(() => { saved.ok = true; saved.calls = 0; });
afterEach(cleanup);

/** 부팅 effect 안의 영속성 요청(비동기)까지 흘려보낸 뒤 돌려준다. */
async function mount() {
  const r = renderHook(() => useStore());
  await act(async () => { await Promise.resolve(); });
  return r;
}

describe('백업 링크 복원', () => {
  it('저장까지 됐으면 복원했다고 알린다', async () => {
    const { result } = await mount();
    act(() => { result.current.offerRestore(PAYLOAD); });

    expect(saved.calls).toBe(1);
    expect(result.current.state?.balance.amount).toBe(1_000_000);
    expect(result.current.toast).toBe('백업 링크에서 복원했습니다.');
  });

  it('이 기기에 저장하지 못했으면 그 사실을 알린다', async () => {
    saved.ok = false;
    const { result } = await mount();
    act(() => { result.current.offerRestore(PAYLOAD); });

    // 화면에는 올라갔다. 하지만 창을 닫으면 사라진다 — 그것을 말해 준다.
    expect(result.current.state?.balance.amount).toBe(1_000_000);
    expect(result.current.toast).toContain('저장하지 못했습니다');
    expect(result.current.toast).toContain('백업 링크를 그대로 두세요');
  });

  it('덮어쓰기 확인을 거친 복원도 같은 판정을 쓴다', async () => {
    saved.ok = false;
    const { result } = await mount();

    // 이미 자료가 있으면 바로 덮지 않고 물어본다.
    act(() => { result.current.setState(makeInitialState(500_000)); });
    act(() => { result.current.offerRestore(PAYLOAD); });
    expect(result.current.pendingRestore).not.toBeNull();

    act(() => { result.current.confirmRestore(); });
    expect(result.current.toast).toContain('저장하지 못했습니다');
  });

  it('깨진 링크는 복원하지 않는다', async () => {
    const { result } = await mount();
    act(() => { result.current.offerRestore('!!!망가진값!!!'); });

    expect(result.current.state).toBeNull();
    expect(saved.calls).toBe(0);
  });
});
