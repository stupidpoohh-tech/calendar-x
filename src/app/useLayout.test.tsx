/**
 * 내 캘린더 구성 훅 — 저장 · 기기 간 · 계정 간 (명세 G · H).
 *
 *   1. 값의 주인은 사용자 문서다 — 다른 기기에서 바꾼 구성이 구독으로 따라온다
 *   2. 바꾸면 쓰기 큐로 한 번만 보낸다(StrictMode 이중 호출에도 한 번)
 *   3. 서버가 거절하면 구독이 되돌린 값을 그대로 보여 준다 — 성공한 것처럼 남지 않는다
 *   4. 필드가 없는 기존 사용자는 지금까지 보던 그대로다
 *   5. 계정이 바뀌면 앞 계정의 구성이 한 렌더도 남지 않는다
 */
import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_LAYOUT, type Layout } from '../domain/layout';
import type { SnapMeta } from '../data/repo';
import { useLayout } from './useLayout';

interface Sub { uid: string; push: (l: Layout, meta: SnapMeta) => void; alive: boolean }
const subs: Sub[] = [];

vi.mock('../data/firebase', () => ({ getFirebase: () => ({ db: {} }) }));
vi.mock('../data/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/repo')>();
  return {
    ...actual,
    subscribeLayout: (_db: unknown, uid: string, cb: Sub['push']) => {
      const sub: Sub = { uid, push: cb, alive: true };
      subs.push(sub);
      return () => { sub.alive = false; };
    },
  };
});

const live: SnapMeta = { fromCache: false, hasPendingWrites: false };
const latest = (uid: string) => [...subs].reverse().find((s) => s.uid === uid && s.alive)!;

beforeEach(() => {
  subs.length = 0;
  localStorage.clear();
});

describe('useLayout', () => {
  it('필드가 없는 기존 사용자는 예전 구성 그대로 — 네 렌즈 · 스위처 · 예상 잔고', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useLayout({ uid: 'u1', commit }));
    expect(result.current.layout).toEqual(LEGACY_LAYOUT);
    expect(result.current.ready).toBe(false);
    act(() => latest('u1').push(LEGACY_LAYOUT, live));
    expect(result.current.ready).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it('다른 기기에서 바꾼 구성이 따라오고, 다음 실행의 첫 화면도 그 값이다', () => {
    const commit = vi.fn();
    const first = renderHook(() => useLayout({ uid: 'u1', commit }));
    act(() => latest('u1').push({ ...LEGACY_LAYOUT, ledger: false }, live));
    expect(first.result.current.layout.ledger).toBe(false);
    first.unmount();
    // 새로 열면 구독이 오기 전에도 기기에 남긴 값으로 그린다 — 숨긴 탭이 잠깐 떴다 사라지지 않는다.
    const again = renderHook(() => useLayout({ uid: 'u1', commit }));
    expect(again.result.current.layout.ledger).toBe(false);
    expect(again.result.current.ready).toBe(false);
  });

  it('바꾸면 화면이 바로 바뀌고, 쓰기 큐로 한 번만 보낸다', () => {
    const commit = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useLayout({ uid: 'u1', commit }), { wrapper });
    act(() => latest('u1').push(LEGACY_LAYOUT, live));
    act(() => result.current.set({ notes: false }));
    expect(result.current.layout.notes).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]![0]).toMatchObject({
      kind: 'layout', label: '내 캘린더 구성', summary: '노트 숨김',
      payload: { ...LEGACY_LAYOUT, notes: false },
    });
    // 이어서 바꾸면 앞의 변경 위에 쌓는다.
    act(() => result.current.set({ calendarAmount: 'pocket' }));
    expect(commit.mock.calls[1]![0].payload).toEqual({ ...LEGACY_LAYOUT, notes: false, calendarAmount: 'pocket' });
    expect(commit.mock.calls[1]![0].summary).toBe('달력 금액 생활비 잔여');
  });

  it('서버가 거절해 저장소가 되돌리면 되돌린 값을 보인다 — 성공한 것처럼 남지 않는다', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useLayout({ uid: 'u1', commit }));
    act(() => latest('u1').push(LEGACY_LAYOUT, live));
    act(() => result.current.set({ ledger: false }));
    expect(result.current.layout.ledger).toBe(false);
    // Firestore 는 거절된 쓰기를 로컬에서도 되돌리고 앞 값을 다시 보낸다(쓰기는 실패 목록으로 간다).
    act(() => latest('u1').push(LEGACY_LAYOUT, live));
    expect(result.current.layout.ledger).toBe(true);
    expect(JSON.parse(localStorage.getItem('calendarx.layout.u1')!)).toEqual(LEGACY_LAYOUT);
  });

  it('계정이 바뀌면 앞 계정의 구성을 한 렌더도 남기지 않는다', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(({ uid }) => useLayout({ uid, commit }), { initialProps: { uid: 'u1' as string | null } });
    act(() => latest('u1').push({ ...LEGACY_LAYOUT, ledger: false, notes: false }, live));
    rerender({ uid: 'u2' });
    expect(result.current.layout).toEqual(LEGACY_LAYOUT);
    expect(result.current.ready).toBe(false);
    // 앞 계정의 구독은 끊겼다 — 늦게 온 스냅샷이 새 계정에 섞이지 않는다.
    expect(subs.filter((s) => s.uid === 'u1').every((s) => !s.alive)).toBe(true);
    rerender({ uid: null });
    expect(result.current.layout).toEqual(LEGACY_LAYOUT);
    act(() => result.current.set({ ledger: false }));
    expect(commit).not.toHaveBeenCalled();
  });
});
