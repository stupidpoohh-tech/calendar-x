/**
 * 가계부 렌즈의 카드 하나.
 *
 * "이 달 말 예상 잔고" 를 보여주던 CashflowBar 를 대체한다. tide-over 원본이
 * 못박은 원칙을 그대로 지킨다 — 예측하지 않는다. 표시하는 숫자는 "이 날까지
 * 쓸 수 있는 한도" 다.
 *
 * 이 렌즈의 카드는 이것 하나다. 대출과 고정 메모는 children 으로 이 카드 안에
 * 접힌 줄로 들어온다 — 카드를 셋으로 나눠 세우면 모바일에서 달력이 화면 밖으로
 * 밀린다.
 *
 * 금액은 카드에 하나만 뜬다. 예정된 입출금이 없는 구간에서는 한도가 곧 잔고라
 * 잔고를 따로 적으면 같은 숫자가 두 번 보였고, 남은 날이 하루면 하루 몫까지
 * 같아져 세 번 보였다.
 */
import { useMemo, type ReactNode } from 'react';
import { MONEY_TYPE_BY_ID } from '../domain/constants';
import { daysBetween, fmtDayShort, todayISO as computeToday } from '../domain/date';
import { formatAmount, formatSigned } from '../domain/money';
import {
  headlineLimit, horizonOf, summarize, upcomingInHorizon,
  type Summary,
} from '../domain/tide';
import type { Account, Entry } from '../domain/types';
import { BalanceInput, BalanceNote, useBalanceEditor } from './balanceEditor';

interface Props {
  accounts: readonly Account[];
  entries: readonly Entry[];
  hasBalance: boolean;
  onSaveAccount: (a: Account) => void;
  onEntryClick?: (entry: Entry) => void;
  /** 대출 · 고정 메모. 이 카드 안쪽 아래에 접힌 줄로 붙는다. */
  children?: ReactNode;
}

export function TideBar({ accounts, entries, hasBalance, onSaveAccount, onEntryClick, children }: Props) {
  const today = useMemo(() => computeToday(), []);
  const editor = useBalanceEditor(accounts, entries, onSaveAccount);

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
        {editor.editing ? <BalanceInput editor={editor} /> : <BalanceNote editor={editor} />}
        {children && <div className="tide-more">{children}</div>}
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
        {/* 이 숫자를 누르면 잔고를 고친다. 한도는 잔고에서 나오는 값이라
            고칠 대상은 언제나 잔고다. */}
        {editor.editing ? (
          <BalanceInput editor={editor} />
        ) : (
          <button
            type="button"
            className={'tide-v num' + (negative ? ' bad' : '')}
            onClick={editor.start}
            aria-label="잔고 고치기"
          >
            ₩ {formatAmount(limit)}
          </button>
        )}
        <p className="tide-sub num">
          이 돈으로 <b>{daysLeft}일</b> 버티기
          {/* 남은 날이 하루면 하루 몫이 위 숫자와 같다. 같은 금액을 두 번 적지 않는다. */}
          {daysLeft > 1 && <> · 하루 <b>{formatAmount(perDay)}원</b></>}
        </p>
        <BalanceNote editor={editor} />
      </div>

      {upcoming.length > 0 ? (
        <ul className="tide-list">
          {upcoming.map((u) => (
            <TideRow key={u.key} summary={u} onClick={() => onEntryClick?.(u.entry)} />
          ))}
        </ul>
      ) : (
        <p className="tide-empty">이 구간에 예정된 입금·출금이 없습니다.</p>
      )}

      {children && <div className="tide-more">{children}</div>}
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
