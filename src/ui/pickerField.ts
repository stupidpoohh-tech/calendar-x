/**
 * 날짜·시각 칸은 **아무 데나 눌러도 열린다.**
 *
 * `<input type="date">` 의 기본 동작은 오른쪽 끝의 달력 그림을 눌러야만 선택기가
 * 열리는 것이다. 칸 가운데를 누르면 `2026` 같은 조각 하나에 커서만 들어가고 아무 일도
 * 일어나지 않는다 — 누른 사람은 "안 눌린다" 고 읽는다. 칸 전체가 버튼처럼 생겼는데
 * 실제로 눌리는 자리는 16px짜리 그림 하나뿐이니, 모바일에서는 더 심하다.
 *
 * `showPicker()` 한 줄로 그 차이를 없앤다. 붙이는 자리는 이 파일 하나이고, 날짜·시각
 * 칸을 새로 만들 때마다 같은 처리를 다시 발명하지 않는다 (`ime.ts` 와 같은 이유다).
 *
 * ── 조용히 실패한다, 딱 여기서만 ────────────────────────────────
 *
 * `showPicker()` 는 사용자 동작 없이 부르면 `NotAllowedError` 를, 이미 열려 있거나
 * 지원하지 않는 상태면 `InvalidStateError` 를 던진다. 옛 브라우저에는 함수 자체가
 * 없다. 어느 쪽이든 **원래 동작(그림을 눌러 열기)이 그대로 남으므로** 여기서 삼키는
 * 것은 기능을 잃는 것이 아니라 덤을 포기하는 것이다.
 */
import type { MouseEvent } from 'react';

export function openPicker(e: MouseEvent<HTMLInputElement>): void {
  const input = e.currentTarget;
  // 읽기 전용·비활성 칸에서 선택기를 열면 고칠 수 없는 값을 고르게 한다.
  if (input.readOnly || input.disabled) return;
  try {
    input.showPicker();
  } catch {
    /* 지원하지 않거나 이미 열려 있다. 그림을 눌러 여는 기본 동작은 그대로다. */
  }
}

/**
 * 날짜·시각 `<input>` 에 그대로 펼쳐 넣는다.
 *
 *   <input type="date" {...PICKER} value={...} onChange={...} />
 *
 * `onClick` 만 건다. 포커스에도 걸면 탭으로 지나가기만 해도 선택기가 튀어나오고,
 * 키보드로 숫자를 적어 넣던 사람의 입력을 가린다.
 */
export const PICKER = { onClick: openPicker } as const;
