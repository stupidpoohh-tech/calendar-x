/**
 * 잔고 한 줄. 이 줄을 고치는 순간이 정산이다.
 *
 * 예전에는 가계부 렌즈에서 '며칠 버티나' 카드와 잔고 카드가 따로 서서 같은 금액이
 * 두 번 보였다. 지금은 한 줄짜리 부품이라 카드 안쪽에 얹는다 — 헤드라인(한도)과
 * 그 근거(잔고)가 한 카드에 있어야 숫자 두 개가 다른 뜻이라는 게 읽힌다.
 */
import { useState } from 'react';
import { DEFAULT_CURRENCY } from '../domain/constants';
import { fmtDayShort, todayISO as computeToday } from '../domain/date';
import { uid } from '../domain/entry';
import { formatAmount, formatSigned, minorToInput, parseAmountToMinor } from '../domain/money';
import { settle, summarize } from '../domain/tide';
import type { Account, Entry } from '../domain/types';
import { useDialog } from './Dialog';
import { Icon } from './Icon';

interface Props {
  accounts: readonly Account[];
  entries: readonly Entry[];
  onSave: (a: Account) => void;
  /** 'card' 는 독립 카드, 'inline' 은 다른 카드 안에 얹는 한 줄. */
  variant?: 'card' | 'inline';
}

export function BalanceRow({ accounts, entries, onSave, variant = 'card' }: Props) {
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
                  <span className="num">
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
    <div className={'bal' + (variant === 'inline' ? ' bal-inline' : '')}>
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
          {primary ? `₩ ${formatAmount(total)}` : '잔고를 입력하면 며칠 버티는지 계산됩니다'}
        </button>
      )}
      {primary && !editing && (
        <span className="bal-asof">{primary.asOf} 기준</span>
      )}
      {!editing && <button className="bal-edit" onClick={start}>수정</button>}
    </div>
  );
}
