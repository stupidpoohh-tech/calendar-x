/**
 * 같이 보기 진입점.
 *
 * **상단 렌즈와 나란히 두지 않는다.** `전체 | TODO | 💡 | 가계부` 는 1차 네비게이션이고,
 * 같이 보기는 TODO 의 하위 기능이다. 렌즈 칸을 하나 더 만들면 "축이 다섯 개" 라는 뜻이
 * 되어 구조가 흐려진다. 큰 세그먼트 토글(`내 TODO | 같이 보기`)을 상시 노출하지 않는
 * 이유도 같다 — 1차보다 시각 위계가 낮아야 한다.
 *
 * 그래서 TODO 화면 안쪽의 조용한 한 줄이다. 카드도 아니고 테두리도 없다.
 */
import type { SharedBoard } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  /** 보드 구독이 아직 안 왔으면 "없음" 을 확정할 수 없다 — 버튼 문구를 바꾸지 않는다. */
  ready: boolean;
  board: SharedBoard | null;
  partner: string | null;
  onOpen: () => void;
  onStart: () => void;
}

export function SharedBar({ ready, board, partner, onOpen, onStart }: Props) {
  const label = !ready
    ? '같이 보기'
    : board
      ? (partner ? `${partner}와 같이 보기` : '같이 보기')
      : 'TODO 공유하기';

  return (
    <div className="shb">
      <span className="shb-l">TODO</span>
      <button
        className={'shb-btn' + (board ? ' on' : '')}
        onClick={board ? onOpen : onStart}
      >
        <Icon.Users size={14} />
        <span>{label}</span>
      </button>
    </div>
  );
}
