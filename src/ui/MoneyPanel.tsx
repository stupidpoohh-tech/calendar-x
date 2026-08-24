/**
 * 대출.
 *
 * 이전에는 대출 목록 전체가 '::loans::' 항목의 memo 에 JSON 배열로 들어갔다.
 * 대출을 두 기기에서 각각 고치면 나중 쓰기가 앞선 편집을 통째로 덮어썼다.
 * 지금은 대출 1건이 1문서다. (F-05)
 *
 * 잔고 줄은 여기서 떨어져 나가 ui/BalanceRow.tsx 로 갔다 — '며칠 버티나' 카드
 * 안쪽에 얹혀야 한도와 잔고가 한 카드에서 읽힌다.
 */
import { useState } from 'react';
import { uid } from '../domain/entry';
import { formatAmount, minorToInput, parseAmountToMinor } from '../domain/money';
import type { Debt } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  debts: readonly Debt[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSaveDebt: (d: Debt) => void;
  onDeleteDebt: (d: Debt) => void;
}

export function MoneyPanel({
  debts, collapsed, onToggleCollapsed, onSaveDebt, onDeleteDebt,
}: Props) {
  return (
    <div className="mp">
      <DebtCard
        debts={debts}
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
        onSave={onSaveDebt}
        onDelete={onDeleteDebt}
      />
    </div>
  );
}

const emptyDebt = (order: number): Debt => ({
  id: uid(), name: '', balanceMinor: 0, monthlyMinor: 0, rate: null,
  currentRound: 0, totalRounds: 0, order,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

function DebtCard({
  debts, collapsed, onToggle, onSave, onDelete,
}: {
  debts: readonly Debt[];
  collapsed: boolean;
  onToggle: () => void;
  onSave: (d: Debt) => void;
  onDelete: (d: Debt) => void;
}) {
  const [draft, setDraft] = useState<Debt | null>(null);
  const [fields, setFields] = useState({ balance: '', monthly: '', rate: '', current: '', total: '' });

  const startEdit = (d: Debt) => {
    setDraft(d);
    setFields({
      balance: d.balanceMinor ? minorToInput(d.balanceMinor) : '',
      monthly: d.monthlyMinor ? minorToInput(d.monthlyMinor) : '',
      rate: d.rate != null ? String(d.rate) : '',
      current: d.currentRound ? String(d.currentRound) : '',
      total: d.totalRounds ? String(d.totalRounds) : '',
    });
  };

  const commit = () => {
    if (!draft) return;
    if (!draft.name.trim()) { setDraft(null); return; }
    const int = (s: string) => Math.max(0, Math.trunc(Number(s.replace(/[^0-9]/g, '')) || 0));
    const rate = Number(fields.rate.replace(/[^0-9.]/g, ''));
    onSave({
      ...draft,
      name: draft.name.trim(),
      balanceMinor: parseAmountToMinor(fields.balance) ?? 0,
      monthlyMinor: parseAmountToMinor(fields.monthly) ?? 0,
      rate: Number.isFinite(rate) && rate > 0 ? rate : null,
      currentRound: int(fields.current),
      totalRounds: int(fields.total),
      updatedAt: new Date().toISOString(),
    });
    setDraft(null);
  };

  const total = debts.reduce((s, d) => s + d.balanceMinor, 0);
  const monthly = debts.reduce((s, d) => s + d.monthlyMinor, 0);

  return (
    <div className="debt">
      <button className="debt-h" onClick={onToggle} aria-expanded={!collapsed}>
        <Icon.Chevron size={13} dir={collapsed ? 'right' : 'down'} />
        <span className="debt-h-t">대출 현황</span>
        {debts.length > 0 && (
          <span className="debt-h-n num">
            {debts.length}건 · 잔액 {formatAmount(total)} · 월 {formatAmount(monthly)}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="debt-b">
          {debts.map((d) => (
            draft?.id === d.id ? (
              <DebtForm
                key={d.id} draft={draft} fields={fields}
                onName={(name) => setDraft({ ...draft, name })}
                onField={(k, v) => setFields((f) => ({ ...f, [k]: v }))}
                onCancel={() => setDraft(null)} onSave={commit}
              />
            ) : (
              <div key={d.id} className="debt-i">
                <button className="debt-i-main" onClick={() => startEdit(d)}>
                  <span className="debt-n">{d.name}</span>
                  <span className="debt-d num">
                    잔액 {formatAmount(d.balanceMinor)} · 월 {formatAmount(d.monthlyMinor)}
                    {d.rate != null && ` · ${d.rate}%`}
                  </span>
                  {(d.currentRound > 0 || d.totalRounds > 0) && (
                    <span className="debt-r num">{d.currentRound}/{d.totalRounds || '?'}회차</span>
                  )}
                </button>
                <button className="debt-x" onClick={() => onDelete(d)} aria-label={`${d.name} 삭제`}>
                  <Icon.X size={12} />
                </button>
              </div>
            )
          ))}

          {draft && !debts.some((d) => d.id === draft.id) ? (
            <DebtForm
              draft={draft} fields={fields}
              onName={(name) => setDraft({ ...draft, name })}
              onField={(k, v) => setFields((f) => ({ ...f, [k]: v }))}
              onCancel={() => setDraft(null)} onSave={commit}
            />
          ) : (
            <button className="debt-add" onClick={() => { startEdit(emptyDebt(debts.length)); }}>
              + 대출 추가
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DebtForm({
  draft, fields, onName, onField, onCancel, onSave,
}: {
  draft: Debt;
  fields: { balance: string; monthly: string; rate: string; current: string; total: string };
  onName: (v: string) => void;
  onField: (k: 'balance' | 'monthly' | 'rate' | 'current' | 'total', v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="debt-f">
      <input
        className="mod-input" placeholder="명칭 (예: 카카오뱅크)" value={draft.name} autoFocus
        onChange={(e) => onName(e.target.value)}
        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') onSave(); }}
      />
      <div className="debt-grid">
        <label>잔액<input className="mod-input num" inputMode="numeric" value={fields.balance} onChange={(e) => onField('balance', e.target.value)} placeholder="0" /></label>
        <label>월 상환<input className="mod-input num" inputMode="numeric" value={fields.monthly} onChange={(e) => onField('monthly', e.target.value)} placeholder="0" /></label>
        <label>이자율<input className="mod-input num" inputMode="decimal" value={fields.rate} onChange={(e) => onField('rate', e.target.value)} placeholder="예: 3.5" /></label>
        <label>회차
          <span className="debt-round">
            <input className="mod-input num" inputMode="numeric" value={fields.current} onChange={(e) => onField('current', e.target.value)} placeholder="현재" aria-label="현재 회차" />
            <i>/</i>
            <input className="mod-input num" inputMode="numeric" value={fields.total} onChange={(e) => onField('total', e.target.value)} placeholder="전체" aria-label="전체 회차" />
          </span>
        </label>
      </div>
      <div className="debt-f-a">
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" onClick={onSave}>저장</button>
      </div>
    </div>
  );
}
