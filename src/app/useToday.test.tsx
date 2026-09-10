/**
 * 오늘이 최초 렌더에 고정되지 않는다.
 *
 * 이 값 하나가 계산 창(`tideWindow`) · 한도 · 정산 기준 · 오늘 카드를 전부 정한다.
 * 하루가 밀리면 화면 전체가 조용히 어제를 가리키므로, 자정과 복귀 두 갈래를 못 박는다.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToday } from './useToday';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** 벽시계 시각을 그대로 세운다. TZ 가 무엇이든 그 기기의 날짜가 기준이다. */
const setClock = (y: number, m: number, d: number, hh: number, mm = 0) => {
  vi.setSystemTime(new Date(y, m - 1, d, hh, mm, 0, 0));
};

describe('useToday', () => {
  it('자정을 넘기면 타이머가 날짜를 다시 잰다', () => {
    setClock(2026, 9, 10, 23, 58);
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-09-10');

    // 앱을 켜 둔 채 자정을 넘긴다.
    act(() => { vi.advanceTimersByTime(3 * 60_000); });
    expect(result.current).toBe('2026-09-11');
  });

  it('여러 날 자 두어도 계속 따라온다', () => {
    setClock(2026, 9, 10, 23, 58);
    const { result } = renderHook(() => useToday());

    act(() => { vi.advanceTimersByTime(3 * 24 * 60 * 60_000); });
    expect(result.current).toBe('2026-09-13');
  });

  it('백그라운드에서 돌아오면 타이머를 기다리지 않고 다시 잰다', () => {
    setClock(2026, 9, 10, 9, 0);
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-09-10');

    // 모바일에서 화면을 껐다가 다음 날 켜는 경우. 타이머는 늦춰지거나 건너뛴다.
    act(() => {
      setClock(2026, 9, 12, 9, 0);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-09-12');
  });

  it('창이 포커스를 받을 때도 다시 잰다', () => {
    setClock(2026, 9, 10, 9, 0);
    const { result } = renderHook(() => useToday());

    act(() => {
      setClock(2026, 9, 11, 9, 0);
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe('2026-09-11');
  });

  it('같은 날이면 리렌더를 만들지 않는다', () => {
    setClock(2026, 9, 10, 9, 0);
    let renders = 0;
    renderHook(() => { renders++; return useToday(); });
    const after = renders;

    // 구독이 다시 붙는 것을 막으려면 값이 같을 때 상태를 건드리지 않아야 한다.
    act(() => {
      vi.advanceTimersByTime(60_000);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(renders).toBe(after);
  });

  it('풀린 뒤에는 타이머가 남지 않는다', () => {
    setClock(2026, 9, 10, 23, 58);
    const { unmount } = renderHook(() => useToday());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
