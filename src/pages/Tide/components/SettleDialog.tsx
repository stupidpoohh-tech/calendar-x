import { useId, useState } from 'react';
import { formatSignedWon, formatWon, settle, summarize } from '../lib/calc';
import { formatInstant, formatShortDate } from '../lib/date';
import type { State } from '../lib/types';
import { Modal, ModalHeader } from './Modal';
import { MoneyInput } from './MoneyInput';

type Props = {
  state: State;
  onSave: (next: State) => void;
  onClose: () => void;
};

/**
 * 통장 잔고를 옮겨 적는 창. 전에는 탭이었지만,
 * 잔고 숫자를 직접 누르는 편이 "이 숫자를 고친다"는 뜻이 더 분명하다.
 */
export function SettleDialog({ state, onSave, onClose }: Props) {
  const titleId = useId();
  const [amount, setAmount] = useState(state.balance.amount);
  const [touched, setTouched] = useState(false);

  const result = settle(state, amount);

  function save() {
    onSave({ ...state, balance: { amount, checkedAt: new Date().toISOString() } });
    onClose();
  }

  return (
    <Modal titleId={titleId} onClose={onClose}>
      <ModalHeader titleId={titleId} badge="잔고" title="다시 적기" onClose={onClose} />

      <p className="muted">통장에 찍힌 숫자를 그대로 옮겨 적으세요. 그 사이 쓴 돈은 입력하지 않아도 됩니다.</p>

      <div className="dialog-form">
        <label className="dialog-row">
          <span className="dialog-row__label">잔고</span>
          <MoneyInput
            value={amount}
            autoFocus
            onChange={(v) => {
              setAmount(v);
              setTouched(true);
            }}
          />
        </label>
      </div>

      <div className="ledger">
        <div className="ledger__row">
          <span>직전 잔고</span>
          <span>
            {formatWon(state.balance.amount)}
            <em className="muted"> · {formatInstant(state.balance.checkedAt)}</em>
          </span>
        </div>
        {result.passedIn > 0 && (
          <div className="ledger__row">
            <span>그 사이 지나간 예정 입금</span>
            <span className="is-income">+ {formatWon(result.passedIn)}</span>
          </div>
        )}
        <div className="ledger__row">
          <span>그 사이 지나간 예정 출금</span>
          <span>{result.passedOut === 0 ? '없음' : `− ${formatWon(result.passedOut)}`}</span>
        </div>
        {result.passed.length > 0 && (
          <ul className="mini-list mini-list--indent">
            {summarize(result.passed).map((g) => (
              <li key={g.key}>
                <span>
                  <span className="muted">
                    {g.from === g.to
                      ? formatShortDate(g.from)
                      : `${formatShortDate(g.from)}~${formatShortDate(g.to)}`}
                  </span>{' '}
                  {g.entry.name}
                </span>
                <span className={g.entry.kind === 'income' ? 'is-income' : ''}>
                  {g.entry.kind === 'income' ? '+' : '−'}
                  {formatWon(g.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="ledger__row ledger__row--total">
          <span>예정대로였다면</span>
          <span>{formatWon(result.expected)}</span>
        </div>
      </div>

      {touched && (
        <p
          className={`diff ${
            result.diff < 0 ? 'is-negative' : result.diff > 0 ? 'is-positive' : ''
          }`}
        >
          {result.diff < 0 ? (
            <>
              예정에 없던 지출 <b>{formatSignedWon(result.diff)}</b>
            </>
          ) : result.diff > 0 ? (
            <>
              예정보다 남았습니다 <b>{formatSignedWon(result.diff)}</b>
            </>
          ) : (
            <>예정과 정확히 같습니다</>
          )}
        </p>
      )}

      <div className="modal__actions">
        <button type="button" className="ghost-btn" onClick={onClose}>
          취소
        </button>
        <button type="button" className="solid-btn" disabled={!touched} onClick={save}>
          저장
        </button>
      </div>
    </Modal>
  );
}
