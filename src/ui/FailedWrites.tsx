/**
 * 저장하지 못한 것들.
 *
 * 서버가 거절한 쓰기는 Firestore 가 로컬 캐시에서도 되돌린다 — 화면에서도 사라지고
 * 새로고침해도 돌아오지 않는다. 그래서 값을 따로 붙잡아 여기에 세워 둔다.
 *
 * 확인창이 아니라 **줄**인 이유는 두 가지다. 확인창은 두 건이 동시에 실패하면 뒤엣것이
 * 앞엣것을 밀어내고, 한 번 닫으면 다시 찾을 길이 없다. 이 줄은 남아 있는 동안 계속 보이고,
 * 새로고침을 넘겨도 그대로다.
 *
 * 빚 줄(`RecoveryDebtBar`)과 같은 규칙을 따른다 — 남은 것이 없으면 화면에 아예 없다.
 */
import { useState } from 'react';
import type { PendingOp } from '../data/pendingWrites';
import { Icon } from './Icon';

interface Props {
  failed: readonly PendingOp[];
  /** 새로고침을 넘겨 보관되는가. 아니면 그 사실을 밝혀야 한다. */
  durable: boolean;
  onRetry: (id: string) => void;
  onRetryAll: () => void;
  onDiscard: (id: string) => void;
}

export function FailedWrites({ failed, durable, onRetry, onRetryAll, onDiscard }: Props) {
  const [open, setOpen] = useState(false);
  if (failed.length === 0) return null;

  const n = failed.length.toLocaleString('ko-KR');

  return (
    <section className="fw" aria-label="저장하지 못한 것">
      <div className="fw-head">
        <Icon.Flame size={13} filled fillColor="var(--bad)" stroke="var(--bad)" />
        <span className="fw-t">저장하지 못한 {n}건</span>
        <button type="button" className="fw-a" onClick={onRetryAll}>모두 다시 보내기</button>
        <button
          type="button"
          className="fw-a"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? '접기' : '보기'}
        </button>
      </div>

      {open && (
        <>
          <ul className="fw-ul">
            {failed.map((op) => (
              <li key={op.id} className="fw-i">
                <div className="fw-i-main">
                  <span className="fw-i-t">{op.label} · {op.summary}</span>
                  <span className="fw-i-r">
                    {op.reason}
                    {op.tries > 0 && ` · ${op.tries.toLocaleString('ko-KR')}번 더 시도함`}
                  </span>
                </div>
                <button type="button" className="fw-a" onClick={() => onRetry(op.id)}>다시 보내기</button>
                <button type="button" className="fw-a danger" onClick={() => onDiscard(op.id)}>버리기</button>
              </li>
            ))}
          </ul>
          <p className="fw-note">
            {durable
              ? '적은 내용은 이 기기에 남겨 두었습니다. 새로고침해도 사라지지 않습니다.'
              : '이 브라우저가 저장을 막고 있어 창을 닫으면 사라집니다. 지금 다시 보내 주세요.'}
          </p>
        </>
      )}
    </section>
  );
}
