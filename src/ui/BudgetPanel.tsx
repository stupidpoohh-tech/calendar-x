/**
 * 생활비 예산과 세이브.
 *
 * ── 왜 종류가 아니라 문서인가 ───────────────────────────────────
 *
 * 예전에는 둘 다 `MoneyType` 값이었다 (`living` · `save`). 그래서 생활비 70만을 적고
 * 그 안에서 점심 1만 2천을 적으면 71만 2천이 나가는 것으로 세어졌다 — 예산은 나가는
 * 돈의 **상한**인데 항목이 하나 더 늘어난 셈이었다. 지금 생활비는 주머니 하나이고,
 * 지출은 그 주머니를 **가리킨다** (`money.budgetId`).
 *
 * 카드는 렌즈마다 하나라는 규칙을 지킨다 — 이 조각은 '며칠 버티나' 카드 **안쪽**에
 * 접힌 줄로 들어간다 (`TideBar` 의 children).
 */
import { useState } from 'react';
import { budgetStates, newBudget, newReserve, spendingIn, type BudgetState } from '../domain/budget';
import { fmtDayShort } from '../domain/date';
import { formatAmount, minorToInput, parseAmountToMinor } from '../domain/money';
import type { Budget, Entry, Reserve } from '../domain/types';
import { Icon } from './Icon';
import { PICKER } from './pickerField';

interface Props {
  budgets: readonly Budget[];
  reserves: readonly Reserve[];
  /**
   * 예산에 걸린 지출을 찾을 **원본** 목록. 계산용 목록을 그대로 받는다.
   *
   * 화면용으로 펼친 목록(`materialize()` 결과)을 넘기면 반복 발생분이 섞여
   * 같은 지출이 여러 번 세어진다. 예산에 반복 항목을 걸 수 없는 이유이기도 하다.
   */
  entries: readonly Entry[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSaveBudget: (b: Budget) => void;
  onDeleteBudget: (b: Budget) => void;
  onSaveReserve: (r: Reserve) => void;
  onDeleteReserve: (r: Reserve) => void;
  onEntryClick?: (e: Entry) => void;
}

export function BudgetPanel({
  budgets, reserves, entries, collapsed, onToggleCollapsed,
  onSaveBudget, onDeleteBudget, onSaveReserve, onDeleteReserve, onEntryClick,
}: Props) {
  const [draft, setDraft] = useState<Budget | null>(null);
  const [amountText, setAmountText] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reserveDraft, setReserveDraft] = useState<Reserve | null>(null);
  const [reserveText, setReserveText] = useState('');

  const states = budgetStates(budgets, entries);
  const reservedMinor = reserves.reduce((t, r) => t + r.amountMinor, 0);

  const startEdit = (b: Budget) => {
    setDraft(b);
    setAmountText(b.amountMinor ? minorToInput(b.amountMinor, b.currency) : '');
  };

  const commitBudget = () => {
    if (!draft) return;
    const amountMinor = parseAmountToMinor(amountText, draft.currency) ?? 0;
    const name = draft.name.trim() || '생활비';
    // 기간이 뒤집혀 있으면 어떤 지출도 품지 못한다. 시작일로 맞춘다.
    const endDate = draft.endDate < draft.startDate ? draft.startDate : draft.endDate;
    onSaveBudget({
      ...draft, name, endDate,
      amountMinor: Math.abs(amountMinor),
      updatedAt: new Date().toISOString(),
    });
    setDraft(null);
  };

  const startReserve = (r: Reserve) => {
    setReserveDraft(r);
    setReserveText(r.amountMinor ? minorToInput(r.amountMinor, r.currency) : '');
  };

  const commitReserve = () => {
    if (!reserveDraft) return;
    onSaveReserve({
      ...reserveDraft,
      name: reserveDraft.name.trim() || '세이브',
      amountMinor: Math.abs(parseAmountToMinor(reserveText, reserveDraft.currency) ?? 0),
      updatedAt: new Date().toISOString(),
    });
    setReserveDraft(null);
  };

  const summary = [
    budgets.length > 0 && `생활비 ${budgets.length}건`,
    reservedMinor > 0 && `세이브 ${formatAmount(reservedMinor)}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="bp">
      <button className="debt-h" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
        <Icon.Chevron size={13} dir={collapsed ? 'right' : 'down'} />
        <span className="debt-h-t">생활비 · 세이브</span>
        {summary && <span className="debt-h-n num">{summary}</span>}
      </button>

      {!collapsed && (
        <div className="debt-b">
          {states.map((s) => (
            draft?.id === s.budget.id ? (
              <BudgetForm
                key={s.budget.id} draft={draft} amountText={amountText}
                onDraft={setDraft} onAmount={setAmountText}
                onCancel={() => setDraft(null)} onSave={commitBudget}
              />
            ) : (
              <BudgetRow
                key={s.budget.id}
                state={s}
                open={openId === s.budget.id}
                entries={entries}
                onToggle={() => setOpenId(openId === s.budget.id ? null : s.budget.id)}
                onEdit={() => startEdit(s.budget)}
                onDelete={() => onDeleteBudget(s.budget)}
                onEntryClick={onEntryClick}
              />
            )
          ))}

          {draft && !budgets.some((b) => b.id === draft.id) ? (
            <BudgetForm
              draft={draft} amountText={amountText}
              onDraft={setDraft} onAmount={setAmountText}
              onCancel={() => setDraft(null)} onSave={commitBudget}
            />
          ) : (
            <button className="debt-add" onClick={() => startEdit(newBudget())}>
              + 생활비 만들기
            </button>
          )}

          <hr className="bp-sep" />

          {reserves.map((r) => (
            reserveDraft?.id === r.id ? (
              <ReserveForm
                key={r.id} draft={reserveDraft} amountText={reserveText}
                onDraft={setReserveDraft} onAmount={setReserveText}
                onCancel={() => setReserveDraft(null)} onSave={commitReserve}
              />
            ) : (
              <div key={r.id} className="debt-i">
                <button className="debt-i-main" onClick={() => startReserve(r)}>
                  <span className="debt-n">{r.name}</span>
                  <span className="debt-d num">{formatAmount(r.amountMinor)}원 · 한도에서 빠짐</span>
                </button>
                <button className="debt-x" onClick={() => onDeleteReserve(r)} aria-label={`${r.name} 삭제`}>
                  <Icon.X size={12} />
                </button>
              </div>
            )
          ))}

          {reserveDraft && !reserves.some((r) => r.id === reserveDraft.id) ? (
            <ReserveForm
              draft={reserveDraft} amountText={reserveText}
              onDraft={setReserveDraft} onAmount={setReserveText}
              onCancel={() => setReserveDraft(null)} onSave={commitReserve}
            />
          ) : (
            <button className="debt-add" onClick={() => startReserve(newReserve())}>
              + 세이브 추가
            </button>
          )}

          <p className="bp-note">
            세이브는 잔고에서 빠지지 않습니다. 통장에는 그대로 있고, 쓸 수 있는 한도에서만 빠집니다.
          </p>
        </div>
      )}
    </div>
  );
}

function BudgetRow({
  state, open, entries, onToggle, onEdit, onDelete, onEntryClick,
}: {
  state: BudgetState;
  open: boolean;
  entries: readonly Entry[];
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEntryClick?: (e: Entry) => void;
}) {
  const { budget, spentMinor, remainingMinor, overspentMinor, count } = state;
  // 총 예산이 0이면 비율을 낼 수 없다. 막대를 그리지 않는다.
  const ratio = budget.amountMinor > 0
    ? Math.min(1, spentMinor / budget.amountMinor)
    : 0;
  const linked = open ? spendingIn(budget, entries) : [];

  return (
    <div className="bp-i">
      <div className="debt-i">
        <button className="debt-i-main" onClick={onToggle} aria-expanded={open}>
          <span className="debt-n">{budget.name}</span>
          <span className="debt-d num">
            {fmtDayShort(budget.startDate)} – {fmtDayShort(budget.endDate)} · 예산 {formatAmount(budget.amountMinor)}
          </span>
          <span className={'bp-bar' + (overspentMinor > 0 ? ' over' : '')}>
            <span className="bp-bar-f" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
          <span className="debt-d num">
            사용 {formatAmount(spentMinor)}
            {overspentMinor > 0
              ? <> · <b className="bp-over">초과 {formatAmount(overspentMinor)}</b></>
              : <> · 남음 {formatAmount(remainingMinor)}</>}
            {count > 0 && ` · ${count}건`}
          </span>
        </button>
        <button className="bp-e" onClick={onEdit} aria-label={`${budget.name} 고치기`}>
          <Icon.Settings size={12} />
        </button>
        <button className="debt-x" onClick={onDelete} aria-label={`${budget.name} 삭제`}>
          <Icon.X size={12} />
        </button>
      </div>

      {open && (
        linked.length > 0 ? (
          <ul className="bp-ul">
            {linked.map((e) => (
              <li key={e.id}>
                <button className="bp-li" onClick={() => onEntryClick?.(e)}>
                  <span className="bp-li-d num">{fmtDayShort(e.startDate)}</span>
                  <span className="bp-li-t">{e.title.trim() || '(제목 없음)'}</span>
                  <span className="bp-li-a num">{formatAmount(Math.abs(e.money?.amountMinor ?? 0))}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="bp-empty">아직 이 생활비에서 쓴 것이 없습니다.</p>
        )
      )}
    </div>
  );
}

function BudgetForm({
  draft, amountText, onDraft, onAmount, onCancel, onSave,
}: {
  draft: Budget;
  amountText: string;
  onDraft: (b: Budget) => void;
  onAmount: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="debt-f">
      <input
        className="mod-input" placeholder="이름 (예: 9월 생활비)" value={draft.name} autoFocus
        onChange={(e) => onDraft({ ...draft, name: e.target.value })}
        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') onSave(); }}
      />
      <div className="debt-grid">
        <label>시작일
          <input
            type="date" className="mod-input" {...PICKER} value={draft.startDate}
            onChange={(e) => onDraft({ ...draft, startDate: e.target.value || draft.startDate })}
          />
        </label>
        <label>종료일
          <input
            type="date" className="mod-input" {...PICKER} value={draft.endDate} min={draft.startDate}
            onChange={(e) => onDraft({ ...draft, endDate: e.target.value || draft.endDate })}
          />
        </label>
        <label>총 예산
          <input
            className="mod-input num" inputMode="numeric" value={amountText} placeholder="0"
            onChange={(e) => onAmount(e.target.value)}
            onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') onSave(); }}
          />
        </label>
      </div>
      <div className="debt-f-a">
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" onClick={onSave}>저장</button>
      </div>
    </div>
  );
}

function ReserveForm({
  draft, amountText, onDraft, onAmount, onCancel, onSave,
}: {
  draft: Reserve;
  amountText: string;
  onDraft: (r: Reserve) => void;
  onAmount: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="debt-f">
      <input
        className="mod-input" placeholder="이름 (예: 비상금)" value={draft.name} autoFocus
        onChange={(e) => onDraft({ ...draft, name: e.target.value })}
        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') onSave(); }}
      />
      <input
        className="mod-input num" inputMode="numeric" value={amountText} placeholder="0"
        aria-label="세이브 금액"
        onChange={(e) => onAmount(e.target.value)}
        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') onSave(); }}
      />
      <div className="debt-f-a">
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" onClick={onSave}>저장</button>
      </div>
    </div>
  );
}
