/**
 * 한글 IME.
 *
 * 조합 중의 Enter 는 "글자를 확정한다" 는 뜻이지 "제출한다" 가 아니다. 그 검사가 없으면
 * Enter 가 두 번 발화해 적던 입력이 사라진다. 브라우저마다 알려 주는 방식이 달라 세
 * 갈래를 함께 본다 — `isComposing` 을 주지 않는 구형 경로가 `keyCode 229` 로 온다.
 *
 * 규칙이 한 줄로 적혀 있어야 새 입력칸을 만들 때마다 같은 검사를 다시 발명하지 않는다.
 */
import type { KeyboardEvent } from 'react';

export function isComposingEnter(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.key === 'Process' || e.keyCode === 229;
}
