import type { SpaceId } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  space: SpaceId;
  /** 보드가 있는가. 없으면 공유 칸은 '만들기' 가 된다. */
  hasBoard: boolean;
  /** 보드 구독이 아직 안 왔으면 "없음" 을 확정할 수 없다 — 누르지 못하게 둔다. */
  ready: boolean;
  onChange: (next: SpaceId) => void;
  /** 보드가 없을 때 누른 경우. 만들기·초대 흐름으로 간다. */
  onStart: () => void;
}

export function SpaceSwitch({ space, hasBoard, ready, onChange, onStart }: Props) {
  const sharedLabel = hasBoard ? '같이' : '같이 보기 만들기';

  return (
    <div className="spx" role="tablist" aria-label="공간">
      <button
        role="tab"
        className={'spx-b' + (space === 'me' ? ' on' : '')}
        aria-selected={space === 'me'}
        aria-label="내 공간"
        title="내 공간"
        onClick={() => onChange('me')}
      >
        <Icon.User size={15} />
        <span className="spx-l">내 공간</span>
      </button>

      <button
        role="tab"
        className={'spx-b' + (space === 'shared' ? ' on' : '')}
        aria-selected={space === 'shared'}
        aria-label={sharedLabel}
        title={sharedLabel}
        disabled={!ready}
        onClick={() => (hasBoard ? onChange('shared') : onStart())}
      >
        <Icon.Users size={15} />
        <span className="spx-l">같이 보기</span>
        {/* 빈 공유 공간을 미리 만들어 두지 않는다. 없으면 '만들기' 다. */}
        {!hasBoard && <span className="spx-plus" aria-hidden="true">+</span>}
      </button>
    </div>
  );
}
