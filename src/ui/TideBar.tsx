/**
 * 가계부 렌즈의 머리 숫자와 남은 예정.
 *
 * "이 달 말 예상 잔고" 를 보여주던 CashflowBar 를 대체한다. tide-over 원본이
 * 못박은 원칙을 그대로 지킨다 — 예측하지 않는다. 표시하는 숫자는 "이 날까지
 * 쓸 수 있는 한도" 다.
 *
 * 잔고 줄이 이 카드 안에 있다. 따로 세워 두면 잔고와 한도가 같은 금액일 때
 * 같은 숫자가 두 번 보여 어느 쪽이 무엇인지 읽히지 않았다.
 */
import { useMemo } from 'react';
import { MONEY_TYPE_BY_ID } from '../domain/constants';
import { daysBetween, fmtDayShort, todayISO as computeToday } from '../domain/date';
import { formatAmount, formatSigned } from '../domain/money';
import {
  headlineLimit, horizonOf, summarize, upcomingInHorizon,
  type Summary,
} from '../domain/tide';
import type { Account, Entry } from '../domain/types';
import { BalanceRow } from './BalanceRow';

interface Props {
  accounts: readonly Account[];
  entries: readonly Entry[];
  hasBalance: boolean;
  onSaveAccount: (a: Account) => void;
  onEntryClick?: (entry: Entry) => void;
}

export function TideBar({ accounts, entries, hasBalance, onSaveAccount, onEntryClick }: Props) {
  const today = useMemo(() => computeToday(), []);

  const horizon = useMemo(() => horizonOf(entries, today), [entries, today]);
  const limit = useMemo(
    () => headlineLimit(accounts, entries, today),
    [accounts, entries, today],
  );
  const daysLeft = useMemo(() => Math.max(1, daysBetween(today, horizon.end) + 1), [today, horizon.end]);
  const upcoming = useMemo(
    () => summarize(upcomingInHorizon(entries, today, horizon)),
    [entries, today, horizon],
  );

  if (!hasBalance) {
    return (
      <section className="tide" aria-label="며칠 버티나">
        <p className="tide-empty">
          잔고를 입력하면 예정 입출금과 합쳐 <b>다음 입금까지 얼마 · 하루 몫 · 남은 예정</b>이
          여기에 뜹니다.
        </p>
        <BalanceRow accounts={accounts} entries={entries} onSave={onSaveAccount} variant="inline" />
      </section>
    );
  }

  const perDay = Math.floor(limit / daysLeft);
  const negative = limit < 0;

  return (
    <section className="tide" aria-label="며칠 버티나">
      <div className="tide-h">
        <p className="tide-l">
          {horizon.nextIncome
            ? <>다음 입금(<b>{fmtDayShort(horizon.nextIncome)}</b>) 전날까지</>
            : '앞으로 30일'}
        </p>
        <strong className={'tide-v num' + (negative ? ' bad' : '')}>
          ₩ {formatAmount(limit)}
        </strong>
        <p className="tide-sub num">
          이 돈으로 <b>{daysLeft}일</b> 버티기 · 하루 <b>{formatAmount(perDay)}원</b>
        </p>
      </div>

      {/* 한도의 근거. 같은 카드에 있어야 두 숫자가 다른 뜻이라는 게 읽힌다. */}
      <BalanceRow accounts={accounts} entries={entries} onSave={onSaveAccount} variant="inline" />

      {upcoming.length > 0 ? (
        <ul className="tide-list">
          {upcoming.map((u) => (
            <TideRow key={u.key} summary={u} onClick={() => onEntryClick?.(u.entry)} />
          ))}
        </ul>
      ) : (
        <p className="tide-empty">이 구간에 예정된 입금·출금이 없습니다.</p>
      )}
    </section>
  );
}

function TideRow({ summary, onClick }: { summary: Summary; onClick: () => void }) {
  const money = summary.entry.money;
  if (!money) return null;
  const def = MONEY_TYPE_BY_ID[money.type];
  const signed = def.sign * summary.amountMinor;
  const isSpan = summary.from !== summary.to;

  const label = summary.entry.title.trim() || def.label;
  const when = isSpan
    ? `${fmtDayShort(summary.from)} – ${fmtDayShort(summary.to)}`
    : fmtDayShort(summary.from);

  return (
    <li>
      <button className="tide-row" onClick={onClick}>
        <span className="tide-dot" style={{ background: def.color }} />
        <span className="tide-when num">{when}</span>
        <span className="tide-name">{label}</span>
        <span className={'tide-amt num ' + (def.sign > 0 ? 'plus' : 'minus')}>
          {formatSigned(signed)}
        </span>
      </button>
    </li>
  );
}
