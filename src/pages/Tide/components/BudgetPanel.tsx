import { useId, useState } from 'react';
import { budgetState, spendingIn } from '../lib/budget';
import { formatWon } from '../lib/calc';
import { formatShortDate, fromISODate, toISODate } from '../lib/date';
import { type Budget, type Entry, type Reserve, type State, isBudget, isReserve, newId } from '../lib/types';
import { Modal, ModalHeader } from './Modal';
import { MoneyInput } from './MoneyInput';

type Editor = { kind: 'budget'; item?: Budget } | { kind: 'reserve'; item?: Reserve };
type Props = {
  state: State;
  today: string;
  onSave: (next: State) => void;
  onSpend: (budget: Budget) => void;
  onEditEntry: (entry: Entry) => void;
};

/** 기존 머리 카드 안쪽에 접힌다. 별도 화면이나 저장소는 만들지 않는다. */
export function BudgetPanel({ state, today, onSave, onSpend, onEditEntry }: Props) {
  const [editing, setEditing] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<Editor | null>(null);
  const budgets = state.budgets ?? [];
  const reserves = state.reserves ?? [];
  return (
    <details className="tide-budgets">
      <summary>생활비 · 세이브{budgets.length + reserves.length > 0 ? ` · ${budgets.length + reserves.length}건` : ''}</summary>
      <div className="tide-budgets__actions">
        <button type="button" className="ghost-btn" onClick={() => setEditing({ kind: 'budget' })}>생활비 예산 추가</button>
        <button type="button" className="ghost-btn" onClick={() => setEditing({ kind: 'reserve' })}>세이브 추가</button>
      </div>
      {budgets.map((b) => {
        const amounts = budgetState(b, state.entries);
        return (
          <div className="tide-budgets__item" key={b.id}>
            <div className="tide-budgets__heading">
              <strong>{b.name}</strong>
              <span>{formatShortDate(b.start)}~{formatShortDate(b.end)}</span>
            </div>
            <p>예산 {formatWon(b.amount)} · 사용 {formatWon(amounts.spent)}</p>
            <p className={amounts.overspent > 0 ? 'is-negative' : 'muted'}>
              {amounts.overspent > 0 ? `초과 ${formatWon(amounts.overspent)}` : `남음 ${formatWon(amounts.remaining)}`}
            </p>
            <div className="tide-budgets__actions">
              <button type="button" className="tiny-btn" aria-label={`${b.name}에서 사용`} onClick={() => onSpend(b)}>사용 기록</button>
              <button type="button" className="tiny-btn" aria-label={`${b.name} 예산 수정`} onClick={() => setEditing({ kind: 'budget', item: b })}>수정</button>
              <button type="button" className="tiny-btn" aria-label={`${b.name} 예산 삭제`} onClick={() => setRemoving({ kind: 'budget', item: b })}>삭제</button>
            </div>
            {spendingIn(b, state.entries).length > 0 && (
              <details>
                <summary>사용 내역</summary>
                <ul className="list">
                  {spendingIn(b, state.entries).map((e) => (
                    <li key={e.id}>
                      <button type="button" className="list__row" onClick={() => onEditEntry(e)}>
                        <span className="list__name">{e.name}</span><span>{formatWon(e.amount)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
      {reserves.map((r) => (
        <div className="tide-budgets__item" key={r.id}>
          <div className="tide-budgets__heading"><strong>{r.name}</strong><span>{formatWon(r.amount)}</span></div>
          <div className="tide-budgets__actions">
            <button type="button" className="tiny-btn" aria-label={`${r.name} 세이브 수정`} onClick={() => setEditing({ kind: 'reserve', item: r })}>수정</button>
            <button type="button" className="tiny-btn" aria-label={`${r.name} 세이브 삭제`} onClick={() => setRemoving({ kind: 'reserve', item: r })}>삭제</button>
          </div>
        </div>
      ))}
      {editing && (
        <BudgetEditor editor={editing} today={today} onClose={() => setEditing(null)} onSave={(item) => {
          if (editing.kind === 'budget') {
            onSave({ ...state, budgets: [...budgets.filter((b) => b.id !== item.id), item as Budget] });
          } else {
            onSave({ ...state, reserves: [...reserves.filter((r) => r.id !== item.id), item] });
          }
          setEditing(null);
        }} />
      )}
      {removing && (
        <RemoveDialog editor={removing} onClose={() => setRemoving(null)} onConfirm={() => {
          // 지출 자체와 참조를 보존한다. 해당 예산이 없으면 계산은 일반 지출로 돌아간다.
          onSave(removing.kind === 'budget'
            ? { ...state, budgets: budgets.filter((b) => b.id !== removing.item?.id) }
            : { ...state, reserves: reserves.filter((r) => r.id !== removing.item?.id) });
          setRemoving(null);
        }} />
      )}
    </details>
  );
}

function BudgetEditor({ editor, today, onClose, onSave }: {
  editor: Editor; today: string; onClose: () => void; onSave: (item: Budget | Reserve) => void;
}) {
  const titleId = useId();
  const [id] = useState(() => editor.item?.id ?? newId());
  const [name, setName] = useState(editor.item?.name ?? (editor.kind === 'budget' ? '생활비' : '세이브'));
  const [amount, setAmount] = useState(editor.item?.amount ?? 0);
  const d = fromISODate(today);
  const [start, setStart] = useState(editor.kind === 'budget' && editor.item ? editor.item.start : toISODate(new Date(d.getFullYear(), d.getMonth(), 1)));
  const [end, setEnd] = useState(editor.kind === 'budget' && editor.item ? editor.item.end : toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0)));
  const item = { id, name: name.trim(), amount, ...(editor.kind === 'budget' ? { start, end } : {}) };
  const valid = editor.kind === 'budget' ? isBudget(item) : isReserve(item);
  return (
    <Modal titleId={titleId} onClose={onClose}>
      <ModalHeader titleId={titleId} badge={editor.kind === 'budget' ? '생활비 예산' : '세이브'} title={editor.item ? '수정' : '새로 만들기'} onClose={onClose} />
      <p className="muted">{editor.kind === 'budget' ? '이 예산에서 쓴 지출을 연결하면 한도에서 두 번 빼지 않습니다.' : '통장 잔고는 그대로 두고, 쓸 수 있는 한도에서만 빼 둡니다.'}</p>
      <form className="dialog-form" onKeyDown={(e) => {
        if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
      }} onSubmit={(e) => { e.preventDefault(); if (valid) onSave(item); }}>
        <label className="dialog-row"><span className="dialog-row__label">이름</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="dialog-row"><span className="dialog-row__label">금액</span><MoneyInput aria-label="금액" value={amount} onChange={setAmount} /></label>
        {editor.kind === 'budget' && <>
          <label className="dialog-row"><span className="dialog-row__label">시작</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="dialog-row"><span className="dialog-row__label">끝</span><input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></label>
        </>}
        {!valid && <p role="status" className="muted">이름·금액·날짜를 확인해 주세요.</p>}
        <div className="modal__actions"><button type="button" className="ghost-btn" onClick={onClose}>취소</button><button type="submit" className="solid-btn" disabled={!valid}>저장</button></div>
      </form>
    </Modal>
  );
}

function RemoveDialog({ editor, onConfirm, onClose }: { editor: Editor; onConfirm: () => void; onClose: () => void }) {
  const titleId = useId();
  return <Modal titleId={titleId} onClose={onClose}>
    <h2 id={titleId} className="modal__title">{editor.item?.name} 삭제</h2>
    <p>{editor.kind === 'budget' ? '예산을 삭제해도 사용 기록은 남으며, 별도 지출로 계산됩니다.' : '확보해 둔 금액이 다시 사용 가능한 한도에 포함됩니다.'}</p>
    <div className="modal__actions"><button type="button" className="ghost-btn" data-autofocus onClick={onClose}>취소</button><button type="button" className="danger-btn" onClick={onConfirm}>삭제</button></div>
  </Modal>;
}
