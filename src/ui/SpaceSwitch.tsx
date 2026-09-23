/**
 * 공간 전환 — 👤 / 👥.
 *
 * ── 왜 픽토그램인가 ─────────────────────────────────────────────
 *
 * 공간은 둘뿐이고 전환은 자주 일어난다. 텍스트 세그먼트(`[ 내 공간 ][ 같이 보기 ]`)는
 * 아래 탭과 같은 모양이라 어느 쪽이 상위인지가 흐려지고, 드롭다운은 누를 때마다 두
 * 걸음이 된다. 그림 둘이면 한 번에 끝난다.
 *
 * ── 위계는 유지하되 크기는 작게 ─────────────────────────────────
 *
 * 공간 전환은 탭보다 **위**다. 그래서 탭과 같은 세그먼트 모양을 쓰지 않는다. 다만
 * 모바일에서 머리가 한 줄 더 늘면 캘린더가 그만큼 밀리므로, 자리는 브랜드 옆 한 칸이다.
 *
 * ── 보드가 없으면 만들기다 ──────────────────────────────────────
 *
 * 빈 공유 공간을 미리 만들어 보여 주지 않는다. 보드가 없으면 👥 자리에 `+` 가 붙고,
 * 누르면 기존 만들기·초대 흐름으로 간다.
 */
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
        <span className="spx-l">나</span>
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
        <span className="spx-l">같이</span>
        {/* 빈 공유 공간을 미리 만들어 두지 않는다. 없으면 '만들기' 다. */}
        {!hasBoard && <span className="spx-plus" aria-hidden="true">+</span>}
      </button>
    </div>
  );
}
