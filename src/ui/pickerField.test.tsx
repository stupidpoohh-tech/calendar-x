/**
 * 날짜·시각 칸은 아무 데나 눌러도 열린다.
 *
 * 기본 동작은 오른쪽 끝 달력 그림을 눌러야만 열리는 것이라, 칸 가운데를 누른 사람은
 * "안 눌린다" 고 읽는다. jsdom 에는 `showPicker` 가 없으므로 여기서 심어 두고 그것이
 * 실제로 불리는지 본다 — 없을 때 터지지 않는 것도 함께 확인한다.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PICKER } from './pickerField';

afterEach(cleanup);

type WithPicker = HTMLInputElement & { showPicker?: () => void };

function mount(props: { readOnly?: boolean; disabled?: boolean } = {}) {
  render(<input type="date" aria-label="날짜" defaultValue="2026-09-23" {...PICKER} {...props} />);
  const input = screen.getByLabelText('날짜') as WithPicker;
  const showPicker = vi.fn();
  input.showPicker = showPicker;
  return { input, showPicker };
}

describe('날짜 칸 누르기', () => {
  it('칸을 누르면 선택기가 열린다', () => {
    const { input, showPicker } = mount();
    fireEvent.click(input);
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('읽기 전용 칸에서는 열지 않는다 — 고를 수 없는 값을 고르게 하지 않는다', () => {
    const { input, showPicker } = mount({ readOnly: true });
    fireEvent.click(input);
    expect(showPicker).not.toHaveBeenCalled();
  });

  it('비활성 칸에서는 열지 않는다', () => {
    const { input, showPicker } = mount({ disabled: true });
    fireEvent.click(input);
    expect(showPicker).not.toHaveBeenCalled();
  });

  /*
    `showPicker()` 는 이미 열려 있거나 지원하지 않는 상태에서 던진다. 옛 브라우저에는
    함수 자체가 없다. 어느 쪽이든 그림을 눌러 여는 기본 동작은 그대로 남으므로,
    여기서 삼키는 것은 기능을 잃는 것이 아니라 덤을 포기하는 것이다.
  */
  it('브라우저가 거절해도 화면이 죽지 않는다', () => {
    const { input } = mount();
    input.showPicker = () => { throw new Error('NotAllowedError'); };
    expect(() => fireEvent.click(input)).not.toThrow();
  });

  it('함수가 아예 없어도 죽지 않는다', () => {
    const { input } = mount();
    // 옛 브라우저에는 이 함수가 아예 없다. 타입은 늘 있다고 말하므로 지우고 본다.
    Reflect.deleteProperty(input, 'showPicker');
    expect(() => fireEvent.click(input)).not.toThrow();
  });
});
