import { useId } from 'react';
import { formatWon } from '../lib/calc';
import { formatInstant } from '../lib/date';
import type { State } from '../lib/types';
import { Modal } from './Modal';

type Props = {
  incoming: State;
  exportedAt: string;
  current: State | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/** 기존 데이터를 덮어쓰기 전 확인. 되돌릴 수 없는 동작이라 항상 거친다. */
export function RestoreDialog({ incoming, exportedAt, current, onConfirm, onCancel }: Props) {
  const titleId = useId();

  return (
    <Modal titleId={titleId} onClose={onCancel}>
      <h2 id={titleId} className="modal__title">
        기존 데이터를 덮어쓸까요?
      </h2>
      <p className="muted">
        이 기기에 이미 저장된 데이터가 있습니다. 복원하면 아래 내용으로 바뀌고, 지금 데이터는
        사라집니다.
      </p>

      <div className="compare">
        <Summary title="지금 이 기기" state={current} />
        <Summary
          title={`백업 링크${exportedAt ? ` · ${formatInstant(exportedAt)}` : ''}`}
          state={incoming}
          highlight
        />
      </div>

      <div className="modal__actions">
        <button type="button" className="ghost-btn" data-autofocus onClick={onCancel}>
          취소
        </button>
        <button type="button" className="danger-btn" onClick={onConfirm}>
          덮어쓰기
        </button>
      </div>
    </Modal>
  );
}

function Summary({
  title,
  state,
  highlight,
}: {
  title: string;
  state: State | null;
  highlight?: boolean;
}) {
  return (
    <div className={`compare__col ${highlight ? 'is-highlight' : ''}`}>
      <h3>{title}</h3>
      {state === null ? (
        <p className="muted">읽을 수 없음</p>
      ) : (
        <dl>
          <div>
            <dt>잔고</dt>
            <dd>{formatWon(state.balance.amount)}</dd>
          </div>
          <div>
            <dt>기록 시각</dt>
            <dd>{formatInstant(state.balance.checkedAt)}</dd>
          </div>
          <div>
            <dt>예정 항목</dt>
            <dd>{state.entries.length}건</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
