/**
 * 공간 전환 — 👤 / 👥.
 *
 * 이 파일이 지키는 약속은 셋이다.
 *   1. 한 번 눌러 바로 옮긴다 (드롭다운을 한 번 더 여는 두 걸음이 아니다).
 *   2. 지금 어느 공간에 있는지가 분명하다.
 *   3. 보드가 없으면 공유 공간을 열지 않고 **만들기**로 보낸다.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaceSwitch } from './SpaceSwitch';

afterEach(cleanup);

function mount(over: Partial<Parameters<typeof SpaceSwitch>[0]> = {}) {
  const props = {
    space: 'me' as const,
    hasBoard: true,
    ready: true,
    onChange: vi.fn(),
    onStart: vi.fn(),
    ...over,
  };
  render(<SpaceSwitch {...props} />);
  return props;
}

describe('공간 전환', () => {
  it('한 번 눌러 바로 옮긴다', () => {
    const props = mount({ space: 'me' });
    fireEvent.click(screen.getByRole('tab', { name: '같이' }));
    expect(props.onChange).toHaveBeenCalledWith('shared');
    // 고르기 전에 무엇을 더 열지 않는다.
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('지금 있는 공간이 분명하다', () => {
    mount({ space: 'shared' });
    expect(screen.getByRole('tab', { name: '같이' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '내 공간' })).toHaveAttribute('aria-selected', 'false');
  });

  /*
    빈 공유 공간을 미리 만들어 보여 주지 않는다. 보드가 없으면 그 칸은 '만들기' 이고,
    누르면 기존 만들기·초대 흐름으로 간다.
  */
  it('보드가 없으면 공간을 열지 않고 만들기로 보낸다', () => {
    const props = mount({ hasBoard: false });
    fireEvent.click(screen.getByRole('tab', { name: '같이 보기 만들기' }));
    expect(props.onStart).toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  /*
    보드 구독이 아직 안 왔으면 "없음" 을 확정할 수 없다. 그 사이에 누르면 보드가 있는데도
    만들기 창이 뜬다 — 누르지 못하게 둔다.
  */
  it('보드 구독이 아직이면 공유 칸을 누를 수 없다', () => {
    mount({ ready: false, hasBoard: false });
    expect(screen.getByRole('tab', { name: '같이 보기 만들기' })).toBeDisabled();
    // 내 공간은 늘 누를 수 있다.
    expect(screen.getByRole('tab', { name: '내 공간' })).not.toBeDisabled();
  });

  /** 관계를 UI 에 박지 않는다. 같은 구조를 가족 · 친구와도 쓴다. */
  it('관계를 가리키는 말을 쓰지 않는다', () => {
    const { container } = render(
      <SpaceSwitch space="shared" hasBoard ready onChange={vi.fn()} onStart={vi.fn()} />,
    );
    expect(container.textContent).not.toMatch(/애인|커플|연인|가족/);
  });
});
