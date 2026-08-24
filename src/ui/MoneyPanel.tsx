/**
 * 잔고와 대출.
 *
 * 이전에는 잔고 금액이 '::balance::' 항목의 memo 에 문자열로, 대출 목록 전체가
 * '::loans::' 항목의 memo 에 JSON 배열로 들어갔다. 대출을 두 기기에서 각각 고치면
 * 나중 쓰기가 앞선 편집을 통째로 덮어썼다. 지금은 각자 별도 문서다. (F-05)
 */
import { useState } from 'react';
import { DEFAULT_CURRENCY } from '../domain/constants';
import { fmtDayShort, todayISO as computeToday } from '../domain/date';
import { settle, summarize } from '../domain/tide';
import { formatSigned } from '../domain/money';
import type { Entry } from '../domain/types';
import { useDialog } from './Dialog';
import { uid } from '../domain/entry';
import { formatAmount, minorToInput, parseAmountToMinor } from '../domain/money';
import type { Account, Debt } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  accounts: readonly Account[];
  debts: readonly Debt[];
  entries: readonly Entry[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSaveAccount: (a: Account) => void;
  onSaveDebt: (d: Debt) => void;
  onDeleteDebt: (d: Debt) => void;
}

export function MoneyPanel({
  accounts, debts, entries, collapsed, onToggleCollapsed, onSaveAccount, onSaveDebt, onDeleteDebt,
}: Props) {
  return (
    <div className="mp">
      <BalanceRow accounts={accounts} entries={entries} onSave={onSaveAccount} />
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

function BalanceRow({
  accounts, entries, onSave,
}: {
  accounts: readonly Account[];
  entries: readonly Entry[];
  onSave: (a: Account) => void;
}) {
  const primary = accounts[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const dialog = useDialog();

  const total = accounts.reduce((s, a) => s + a.balanceMinor, 0);

  const start = () => {
    setText(primary ? minorToInput(primary.balanceMinor, primary.currency) : '');
    setEditing(true);
  };

  /**
   * 잔고를 갈아엎는 순간이 정산이다. 예정된 것과 실제 잔고 사이 차이(diff)를
   * 사용자에게 알린 뒤 저장한다. 이 한 순간이 "과거 지출을 입력하지 않는다"의
   * 반대편 — 그 사이 실제로 쓴 돈을 여기서 청산한다.
   */
  const commit = async () => {
    const minor = parseAmountToMinor(text);
    setEditing(false);
    if (minor === null) return;

    const now = new Date().toISOString();
    const build = (): Account => ({
      id: primary?.id ?? uid(),
      name: primary?.name ?? '주계좌',
      balanceMinor: minor,
      currency: primary?.currency ?? DEFAULT_CURRENCY,
      // 잔고를 고친 날·시각이 tide 계산의 기준점이다. 시각까지 남겨야
      // 하루 안에 두 번 갈아엎을 때도 정산이 순서대로 잡힌다.
      asOf: computeToday(),
      checkedAt: now,
      order: primary?.order ?? 0,
      createdAt: primary?.createdAt || now,
      updatedAt: now,
    });

    // 이전 잔고가 없으면 정산할 것도 없다 — 첫 입력.
    if (!primary) { onSave(build()); return; }

    const r = settle(accounts, entries, minor, computeToday());
    const items = summarize(r.passed);

    // 정산할 예정도 없고 diff 도 0 이면 조용히 저장.
    if (r.passed.length === 0 && r.diff === 0) { onSave(build()); return; }

    const ok = await dialog.confirm({
      title: '잔고 정산',
      body: (
        <div className="settle">
          <p>
            <b>{fmtDayShort(r.since)}</b> 이후 예정대로면 <b className="num">₩ {formatAmount(r.expected)}</b>이어야 합니다.
          </p>
          {items.length > 0 && (
            <ul className="settle-list">
              {items.map((it) => (
                <li key={it.key}>
                  <span className="num">{fmtDayShort(it.from)}</span>
                  <span>{it.entry.title || it.entry.money?.type}</span>
                  <span className={'num ' + ((it.entry.money?.amountMinor ?? 0) > 0 ? '' : '')}>
                    {formatSigned((it.entry.money && it.entry.money.type === 'income' ? 1 : -1) * it.amountMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="settle-diff">
            새로 적은 <b className="num">₩ {formatAmount(minor)}</b>과
            <b className={'num ' + (r.diff < 0 ? 'minus' : r.diff > 0 ? 'plus' : '')}>
              {' '}차이 {formatSigned(r.diff)}
            </b>
            {r.diff < 0 ? ' — 예정에 없던 지출이 있었네요.' : r.diff > 0 ? ' — 예정보다 남았어요.' : ''}
          </p>
        </div>
      ),
      confirmLabel: '이 금액으로 정산',
    });
    if (ok) onSave(build());
  };

  return (
    <div className="bal">
      <span className="bal-l"><Icon.Wallet size={14} /> 잔고</span>
      {editing ? (
        <input
          className="bal-in num" type="text" inputMode="numeric" autoFocus
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={commit}
          placeholder="0"
          aria-label="잔고 금액"
        />
      ) : (
        <button className={'bal-v num' + (primary ? '' : ' empty')} onClick={start}>
          {primary ? `₩ ${formatAmount(total)}` : '잔고를 입력하면 현금흐름이 계산됩니다'}
        </button>
      )}
      {primary && !editing && (
        <span className="bal-asof">{primary.asOf} 기준</span>
      )}
      {!editing && <button className="bal-edit" onClick={start}>수정</button>}
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
