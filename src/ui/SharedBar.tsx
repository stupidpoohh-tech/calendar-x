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
      <button
        title={label}
        aria-label={label}
        disabled={!ready}
        className={'shb-btn' + (board ? ' on' : '')}
        onClick={board ? onOpen : onStart}
      >
        <Icon.Users size={14} />
        <span>{label}</span>
      </button>
    </div>
  );
}
