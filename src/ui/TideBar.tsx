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
 * 큰 숫자는 **생활비 외 가용 한도**다 — 잔고가 아니다. 잔고 250,000 · 생활비 200,000 이면
 * 큰 숫자는 50,000 이고, 확인 잔고 250,000 은 그 아래 따로 적는다. 예전에는 큰 숫자를 누르면
 * 잔고를 고쳤는데, 그래서 한도를 잔고로 읽고 50,000 을 잔고로 고쳐 적을 수 있었다. 지금
 * 고치는 자리는 확인 잔고 줄 하나다. 생활비 · 세이브로 확보된 몫은 접힌 줄에서 펼쳐 본다.
 */
import { useMemo, type ReactNode } from 'react';
import { budgetStates } from '../domain/budget';
import { MONEY_TYPE_BY_ID } from '../domain/constants';
import { daysBetween, fmtDayShort } from '../domain/date';
import { formatAmount, formatSigned } from '../domain/money';
import {
  balanceViewOn, calcScopeOf, horizonOf, projectedBalanceOn, summarize, unsettledAfter, upcomingInHorizon,
  type Summary,
} from '../domain/tide';
import type { Account, Budget, Entry, Reserve } from '../domain/types';
import { Icon } from './Icon';
import { BalanceInput, BalanceNote, useBalanceEditor } from './balanceEditor';
import {
  CALC_READY, calcCaveat, calcHeadline, calcNotice, calcScopeNotice, type CalcState,
} from './calcState';

interface Props {
  /** 오늘. 자정을 넘기면 바뀌므로 화면이 스스로 재지 않고 위에서 받는다. */
  todayISO: string;
  accounts: readonly Account[];
  entries: readonly Entry[];
  /**
   * 한도에서 미리 빠져 있는 돈 — 생활비 예산과 세이브.
   *
   * 기본값이 빈 목록인 이유는, 이 카드를 목록만 손으로 넘겨 띄우는 자리(테스트)가
   * 예약 개념 없이도 예전과 같은 숫자를 봐야 하기 때문이다.
   */
  budgets?: readonly Budget[];
  reserves?: readonly Reserve[];
  /** 계산 목록이 덮는 가장 이른 날. 정산이 자료 부족을 판정하는 데 쓴다. */
  tideFrom?: string | null;
  /**
   * 계산용 자료를 받았는가. `ready` 가 아니면 숫자를 지어내지 않는다.
   * 기본값은 확정 상태 — 목록을 손으로 넘기는 자리(테스트 등)에서는 기다릴 것이 없다.
   */
  calcState?: CalcState;
  hasBalance: boolean;
  onSaveAccount: (a: Account) => void;
  onEntryClick?: (entry: Entry) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** 대출 · 고정 메모. 이 카드 안쪽 아래에 접힌 줄로 붙는다. */
  children?: ReactNode;
}

const NO_BUDGETS: readonly Budget[] = [];
const NO_RESERVES: readonly Reserve[] = [];

export function TideBar({
  todayISO, accounts, entries, budgets = NO_BUDGETS, reserves = NO_RESERVES,
  tideFrom, calcState = CALC_READY,
  hasBalance, onSaveAccount, onEntryClick,
  collapsed, onToggleCollapsed, children,
}: Props) {
  const today = todayISO;
  const editor = useBalanceEditor(accounts, entries, onSaveAccount, tideFrom, todayISO);

  // 통화가 섞이면 최소 단위가 달라 애초에 더할 수 없다. 숫자를 내지 않는다.
  const scope = useMemo(() => calcScopeOf(accounts, entries), [accounts, entries]);

  const res = useMemo(() => ({ budgets, reserves }), [budgets, reserves]);

  const horizon = useMemo(() => horizonOf(entries, today), [entries, today]);
  // 입금 전날의 잔고 보기 — 가용(큰 숫자) · 예상 잔고 · 확보한 몫을 같은 함수에서 함께 낸다.
  const view = useMemo(
    () => balanceViewOn(accounts, entries, horizon.end, today, res),
    [accounts, entries, horizon.end, today, res],
  );
  const limit = view.available;
  // 오늘의 예상 잔고. 확인 잔고와 다르면(아직 반영 안 한 거래 · 기준일 뒤 지난 예정) 함께 적는다.
  const projectedToday = useMemo(
    () => projectedBalanceOn(accounts, entries, today, today),
    [accounts, entries, today],
  );
  const pockets = useMemo(() => {
    const from = unsettledAfter(accounts, today);
    return budgetStates(budgets, entries, { accounts, today, unsettledAfter: from })
      .filter((s) => s.budget.startDate <= horizon.end && s.reservedMinor > 0);
  }, [budgets, entries, accounts, today, horizon.end]);
  const daysLeft = useMemo(() => Math.max(1, daysBetween(today, horizon.end) + 1), [today, horizon.end]);
  const upcoming = useMemo(
    () => summarize(upcomingInHorizon(accounts, entries, today, horizon, res)),
    [accounts, entries, today, horizon, res],
  );

  const head = (summary: string) => (
    <button
      type="button"
      className="tide-hd"
      onClick={onToggleCollapsed}
      aria-expanded={!collapsed}
      aria-label={collapsed ? '가계부 카드 펼치기' : '가계부 카드 접기'}
    >
      <span className="tide-hd-t">며칠 버티나</span>
      {/* 펼쳐 있으면 큰 숫자가 바로 아래에 있다. 접었을 때만 요약을 적는다. */}
      {collapsed && <span className="tide-hd-s num">{summary}</span>}
      <Icon.Chevron size={14} dir={collapsed ? 'right' : 'down'} />
    </button>
  );

  if (calcState.kind !== 'ready') {
    return (
      <section className={'tide' + (collapsed ? ' collapsed' : '')} aria-label="며칠 버티나">
        {head(calcHeadline(calcState))}
        {!collapsed && (
          <>
            <p className="tide-empty">{calcNotice(calcState)}</p>
            {/* 기다려도 풀리지 않는 갈래. 잔고를 다시 적는 자리를 여기 둔다. */}
            {calcState.kind === 'outOfRange'
              && (editor.editing ? <BalanceInput editor={editor} /> : <BalanceNote editor={editor} />)}
            {children && <div className="tide-more">{children}</div>}
          </>
        )}
      </section>
    );
  }

  /* 숫자는 내되 완전하지 않을 수 있으면 그 사실을 한 줄로 덧붙인다. */
  const caveat = calcCaveat(calcState);

  if (!scope.ok) {
    return (
      <section className={'tide' + (collapsed ? ' collapsed' : '')} aria-label="며칠 버티나">
        {head(scope.reason === 'currency' ? '통화 섞임' : '계좌 미정')}
        {!collapsed && (
          <>
            <p className="tide-empty">{calcScopeNotice(scope)}</p>
            {/* 무엇을 고치면 풀리는지 바로 누를 수 있게 그 거래들을 세운다. */}
            {scope.reason === 'unassigned' && (
              <ul className="tide-list" aria-label="계좌를 정해야 하는 거래">
                {scope.entries.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <button className="tide-row" onClick={() => onEntryClick?.(e)}>
                      <span className="tide-when num">{fmtDayShort(e.startDate)}</span>
                      <span className="tide-name">{e.title.trim() || '(내역 없음)'} — 계좌 정하기</span>
                      <span className="tide-amt num minus">{formatAmount(Math.abs(e.money?.amountMinor ?? 0))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {editor.editing ? <BalanceInput editor={editor} /> : <BalanceNote editor={editor} />}
            {children && <div className="tide-more">{children}</div>}
          </>
        )}
      </section>
    );
  }

  if (!hasBalance) {
    return (
      <section className={'tide' + (collapsed ? ' collapsed' : '')} aria-label="며칠 버티나">
        {head('잔고 없음')}
        {!collapsed && (
          <>
            <p className="tide-empty">
              잔고를 입력하면 예정 입출금과 합쳐 <b>다음 입금까지 얼마 · 하루 몫 · 남은 예정</b>이
              여기에 뜹니다.
            </p>
            {editor.editing ? <BalanceInput editor={editor} /> : <BalanceNote editor={editor} />}
            {children && <div className="tide-more">{children}</div>}
          </>
        )}
      </section>
    );
  }

  const perDay = Math.floor(limit / daysLeft);
  const negative = limit < 0;

  return (
    <section className={'tide' + (collapsed ? ' collapsed' : '')} aria-label="며칠 버티나">
      {head(`₩ ${formatAmount(limit)} · ${daysLeft}일`)}
      {collapsed ? null : (
        <>
      <div className="tide-h">
        <p className="tide-l">
          {horizon.nextIncome
            ? <>다음 입금(<b>{fmtDayShort(horizon.nextIncome)}</b>) 전날까지</>
            : '앞으로 30일'}
          {' · '}생활비 · 세이브 빼고 쓸 수 있는 돈
        </p>
        {/* 가용 한도는 잔고가 아니다 — 눌러서 고치는 숫자가 아니다. 고칠 대상은 아래 확인 잔고다. */}
        <p className={'tide-v num' + (negative ? ' bad' : '')} aria-label={`생활비 외 가용 ${formatAmount(limit)}원`}>
          ₩ {formatAmount(limit)}
        </p>
        <p className="tide-sub num">
          이 돈으로 <b>{daysLeft}일</b> 버티기
          {/* 남은 날이 하루면 하루 몫이 위 숫자와 같다. 같은 금액을 두 번 적지 않는다. */}
          {daysLeft > 1 && <> · 하루 <b>{formatAmount(perDay)}원</b></>}
        </p>
        {editor.editing ? (
          <BalanceInput editor={editor} />
        ) : (
          <div className="tide-bal">
            <p className="num">
              확인 잔고 <b aria-label={`확인 잔고 ${formatAmount(view.confirmed)}원`}>₩ {formatAmount(view.confirmed)}</b>
              {projectedToday !== view.confirmed && (
                <span className="tide-bal-p"> · 오늘 예상 <b aria-label={`오늘 예상 잔고 ${formatAmount(projectedToday)}원`}>₩ {formatAmount(projectedToday)}</b></span>
              )}
            </p>
            <BalanceNote editor={editor} />
          </div>
        )}
        {view.held !== 0 && (
          <details className="tide-held">
            <summary className="num">
              생활비 · 세이브로 확보 <b>₩ {formatAmount(view.held)}</b>
            </summary>
            <ul>
              {pockets.map((p) => (
                <li key={p.budget.id} className="num">
                  <span>{p.budget.name} <i>{fmtDayShort(p.budget.startDate)}–{fmtDayShort(p.budget.endDate)}</i></span>
                  <span>
                    남음 {formatAmount(p.remainingMinor)}
                    {p.plannedMinor > 0 && ` · 예정 ${formatAmount(p.plannedMinor)}`}
                    {p.overspentMinor > 0 && ` · 초과 ${formatAmount(p.overspentMinor)}`}
                  </span>
                </li>
              ))}
              {reserves.filter((r) => r.amountMinor > 0).map((r) => (
                <li key={r.id} className="num"><span>{r.name} <i>세이브</i></span><span>{formatAmount(r.amountMinor)}</span></li>
              ))}
            </ul>
            <p className="tide-held-n num">
              {Number(horizon.end.slice(5, 7))}월 {Number(horizon.end.slice(8))}일 예상 잔고 {formatAmount(view.projected)} − 확보 {formatAmount(view.held)} = 쓸 수 있는 돈 {formatAmount(limit)}.
              생활비 · 세이브는 통장에서 빠진 돈이 아니라 잔고 안에서 떼어 둔 몫입니다.
            </p>
          </details>
        )}
        {caveat && <p className="tide-caveat">{caveat}</p>}
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
        </>
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
