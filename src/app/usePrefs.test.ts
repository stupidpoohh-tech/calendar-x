import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePrefs } from './usePrefs';

beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe('기본 캘린더 보기', () => {
  it('첫 접속에서는 개인과 공유 모두 캘린더로 시작한다', () => {
    const { result } = renderHook(usePrefs);
    expect(result.current.prefs.view).toBe('calendar');
    expect(result.current.prefs.sharedView).toBe('calendar');
  });
  it('기존 리스트 설정을 한 번 갱신하고 다른 환경설정은 보존한다', () => {
    localStorage.setItem('dada.pref.v2', JSON.stringify({ view: 'list', sharedView: 'list', theme: 'dark', weekStart: 'sun', lens: 'idea', pinCollapsed: { all: true } }));
    const { result } = renderHook(usePrefs);
    expect(result.current.prefs).toMatchObject({ view: 'calendar', sharedView: 'calendar', theme: 'dark', weekStart: 'sun', lens: 'idea', pinCollapsed: { all: true } });
  });
  it('갱신 이후 사용자가 고른 보기는 공간별로 보존한다', () => {
    const hook = renderHook(usePrefs);
    act(() => hook.result.current.set('sharedView', 'list'));
    hook.unmount();
    const next = renderHook(usePrefs);
    expect(next.result.current.prefs.sharedView).toBe('list');
    expect(next.result.current.prefs.view).toBe('calendar');
  });
});
