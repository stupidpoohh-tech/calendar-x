import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboarding } from '../app/useOnboarding';
import { Onboarding } from './Onboarding';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('온보딩 표시 규칙', () => {
  it('처음 열고 건너뛰면 새로고침까지 숨기며 새 세션에는 다시 연다', () => {
    const first = renderHook(() => useOnboarding('a'));
    expect(first.result.current.open).toBe(true);
    act(() => { first.result.current.finish('skip'); });
    expect(first.result.current.open).toBe(false);
    first.unmount();
    const revisit = renderHook(() => useOnboarding('a'));
    expect(revisit.result.current.open).toBe(false);
    revisit.unmount();
    sessionStorage.clear();
    expect(renderHook(() => useOnboarding('a')).result.current.open).toBe(true);
  });

  it.each(['complete', 'dismiss'] as const)('%s 후 새 세션에도 숨기고 수동으로 다시 볼 수 있다', (outcome) => {
    const first = renderHook(() => useOnboarding('a'));
    act(() => { first.result.current.finish(outcome); });
    first.unmount();
    sessionStorage.clear();
    const revisit = renderHook(() => useOnboarding('a'));
    expect(revisit.result.current.open).toBe(false);
    act(() => revisit.result.current.reopen());
    expect(revisit.result.current.open).toBe(true);
    act(() => { revisit.result.current.finish('skip'); });
    revisit.unmount();
    sessionStorage.clear();
    expect(renderHook(() => useOnboarding('a')).result.current.open).toBe(false);
  });

  it('로그아웃 데모와 계정별 설정을 분리하며 계정 전환 즉시 갱신한다', () => {
    const hook = renderHook(({ uid }: { uid: string | null }) => useOnboarding(uid), { initialProps: { uid: null } as { uid: string | null } });
    act(() => { hook.result.current.finish('complete'); });
    hook.rerender({ uid: 'a' });
    expect(hook.result.current.open).toBe(true);
    act(() => { hook.result.current.finish('dismiss'); });
    hook.rerender({ uid: 'b' });
    expect(hook.result.current.open).toBe(true);
    hook.rerender({ uid: 'a' });
    expect(hook.result.current.open).toBe(false);
  });

  it('저장소 접근이 막혀도 닫히며 영구 저장 실패를 호출자에게 알린다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const hook = renderHook(() => useOnboarding('a'));
    let saved = true;
    act(() => { saved = hook.result.current.finish('complete'); });
    expect(saved).toBe(false);
    expect(hook.result.current.open).toBe(false);
  });

  it('StrictMode 재실행이나 표시만으로 완료 처리하지 않는다', () => {
    const hook = renderHook(() => useOnboarding('a'), { wrapper: StrictMode });
    expect(hook.result.current.open).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('온보딩 모달', () => {
  it('6단계 이동·이전·완료와 단계별 제목 포커스를 제공한다', () => {
    const finish = vi.fn();
    render(<Onboarding onFinish={finish} />);
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: '일정도, 생각도, 돈도. 오늘을 한눈에.' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByRole('heading', { name: '일정은 한눈에, 기록은 필요한 방식으로' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '이전' }));
    expect(screen.getByText('1 / 6 · 대시보드')).toBeInTheDocument();
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByRole('heading', { name: '내 기록과 함께할 일을 구분합니다' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    expect(finish).toHaveBeenCalledWith('complete');
  });

  it('상단 내비게이터에서 원하는 단계로 바로 이동하고 완료 전에는 저장하지 않는다', () => {
    const finish = vi.fn();
    render(<Onboarding onFinish={finish} />);
    fireEvent.click(screen.getByRole('button', { name: '5단계 리커버리' }));
    expect(screen.getByRole('button', { name: '5단계 리커버리' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { name: '해야 할 일 사이에, 쉴 시간도 남겨 두세요' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '6단계 같이 보기' }));
    expect(screen.getByRole('heading', { name: '내 기록과 함께할 일을 구분합니다' })).toHaveFocus();
    expect(finish).not.toHaveBeenCalled();
  });

  it('체크 여부에 따라 건너뛰기와 Esc의 영구 숨김을 구분한다', () => {
    const finish = vi.fn();
    render(<Onboarding onFinish={finish} />);
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }));
    expect(finish).toHaveBeenLastCalledWith('skip');
    fireEvent.click(screen.getByRole('checkbox', { name: '다시 보지 않기' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(finish).toHaveBeenLastCalledWith('dismiss');
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }));
    expect(finish).toHaveBeenLastCalledWith('dismiss');
  });

  it('Tab 순환·배경 차단·스크롤 잠금과 닫힌 뒤 원래 포커스를 복구한다', () => {
    const trigger = document.createElement('button');
    trigger.textContent = '설정';
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(<StrictMode><Onboarding onFinish={() => {}} /></StrictMode>);
    expect(trigger.inert).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '다음' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '건너뛰기' })).toHaveFocus();
    trigger.focus();
    expect(screen.getByRole('heading')).toHaveFocus();
    unmount();
    expect(trigger.inert).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('IME 조합 중 Esc와 배경 클릭은 안내를 닫지 않는다', () => {
    const finish = vi.fn();
    render(<Onboarding onFinish={finish} />);
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(finish).not.toHaveBeenCalled();
  });
});
