/**
 * 가계부 상세 — 내역 · 예산 · 월별 · 통계.
 *
 * 가계부 렌즈의 달력과 '며칠 버티나' 카드 **아래**에 붙는다. 둘을 대체하지 않는다 —
 * 위는 앞으로의 돈(한도), 아래는 이미 쓴 돈(결산)이다.
 *
 * ── 숫자를 내는 조건 ─────────────────────────────────────────
 *
 * 합계는 고른 기간의 거래를 **다 받은 뒤에만** 낸다. 아직 못 받았으면 "불러오는 중",
 * 실패했으면 그 사실을, 캐시가 비어 있으면 "확인 전" 을 적는다 — 덜 받은 목록의 합계는
 * 그럴듯하게 틀린 숫자다. 캐시에서 온 값이면 숫자는 내되 한 줄을 덧붙인다.
 *
 * ── 무엇이 소비인가 ──────────────────────────────────────────
 *
 * `ledgerStats` 가 정한다. 대출 원금 · 이체 · 카드 대금은 소비가 아니고, 대출 이자는
 * 금융비용으로 따로 적는다. 예정은 합계에 넣지 않는다.
 */
import { useEffect, useMemo, useState } from 'react';
import { setDefaultBudget, setPeriodBudget } from '../domain/category';
import {
  actualsIn, budgetRows, budgetSummary, flowBadge, groupByDay, historyItems, matchesQuery,
  totalsOf, type BudgetRow, type HistoryItem, type LedgerTotals,
} from '../domain/ledgerStats';
import { formatAmount, formatSigned, parseAmountToMinor } from '../domain/money';
import {
  periodByKey, periodName, periodOf, periodRange, phaseOf, shiftPeriodKey, type Period,
} from '../domain/period';
import type {
  Category, CategoryBudget, Entry, LedgerTabId, PeriodKey,
} from '../domain/types';
import type { FeedState } from '../app/useStore';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';
import { LedgerMonthly, LedgerStats } from './LedgerCharts';
import { dayLabel, feedVerdict } from './ledgerView';

const TABS: readonly { id: LedgerTabId; label: string }[] = [
  { id: 'history', label: '내역' },
  { id: 'budget', label: '예산' },
  { id: 'monthly', label: '월별' },
  { id: 'stats', label: '통계' },
];

export interface LedgerScreenProps {
  todayISO: string;
  settleDay: number;
  tab: LedgerTabId;
  onTab: (t: LedgerTabId) => void;
  periodKey: PeriodKey;
  onPeriodKey: (k: PeriodKey) => void;
  year: number;
  onYear: (y: number) => void;
  /** 고른 범위의 원본(반복 원본 포함). 화면용으로 펼친 목록이 아니다. */
  entries: readonly Entry[];
  /** 그 범위 · 카테고리 · 설정을 받았는가. */
  feed: FeedState;
  categories: readonly Category[];
  categoryBudgets: readonly CategoryBudget[];
  categoriesReady: boolean;
  onSeedCategories: () => void;
  onEntryClick: (e: Entry) => void;
  onAdd: (dateISO: string) => void;
  onSaveCategoryBudget: (b: CategoryBudget) => void;
  /** 전체 기록에서 실제 거래를 찾는다. 사용자가 고른 순간 한 번 읽는다. */
  onSearchAll: () => Promise<Entry[]>;
}

export function LedgerScreen(props: LedgerScreenProps) {
  const { tab, onTab, periodKey, onPeriodKey, settleDay, todayISO, feed } = props;
  const period = periodByKey(periodKey, settleDay) ?? periodOf(todayISO, settleDay);
  const current = periodOf(todayISO, settleDay);
  const verdict = feedVerdict(feed);

  return (
    <section className="led" aria-label="가계부 상세">
      <nav className="led-tabs" role="tablist" aria-label="가계부 상세 보기">
        {TABS.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id}
            className={'led-tab' + (tab === t.id ? ' on' : '')}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab !== 'stats' && (
        <PeriodNav
          period={period} todayISO={todayISO} isCurrent={period.key === current.key}
          onPrev={() => onPeriodKey(shiftPeriodKey(period.key, -1))}
          onNext={() => onPeriodKey(shiftPeriodKey(period.key, 1))}
          onNow={() => onPeriodKey(current.key)}
        />
      )}

      {!verdict.ok ? (
        <p className="led-state" role="status">{verdict.message}</p>
      ) : (
        <>
          {verdict.caveat && <p className="led-caveat">{verdict.caveat}</p>}
          {tab === 'history' && <LedgerHistory {...props} period={period} />}
          {tab === 'budget' && <LedgerBudget {...props} period={period} />}
          {tab === 'monthly' && (
            <LedgerMonthly
              entries={props.entries} settleDay={settleDay} todayISO={todayISO} period={period}
              onPick={(k) => { onPeriodKey(k); onTab('history'); }}
            />
          )}
          {tab === 'stats' && (
            <LedgerStats
              entries={props.entries} settleDay={settleDay} todayISO={todayISO}
              year={props.year} onYear={props.onYear} categories={props.categories}
            />
          )}
        </>
      )}
    </section>
  );
}

function PeriodNav({ period, todayISO, isCurrent, onPrev, onNext, onNow }: {
  period: Period; todayISO: string; isCurrent: boolean;
  onPrev: () => void; onNext: () => void; onNow: () => void;
}) {
  const phase = phaseOf(period, todayISO);
  return (
    <div className="led-period">
      <button className="ico-btn sm" onClick={onPrev} aria-label="이전 기간"><Icon.Chevron size={15} dir="left" /></button>
      <div className="led-period-t">
        <strong>{periodName(period.key)}</strong>
        <span className="num">{periodRange(period)}</span>
        {phase === 'current' && <span className="led-badge">진행 중</span>}
        {phase === 'future' && <span className="led-badge muted">아직 오지 않음</span>}
      </div>
      <button className="ico-btn sm" onClick={onNext} aria-label="다음 기간"><Icon.Chevron size={15} /></button>
      {!isCurrent && <button className="today-btn" onClick={onNow}>이번 기간</button>}
    </div>
  );
}

function TotalsRow({ t, phase }: { t: LedgerTotals; phase: 'past' | 'current' | 'future' }) {
  const excluded = t.principal + t.transferOut + t.cardPayment;
  return (
    <div className="led-totals">
      <div><span>수입</span><b className="num plus">{formatAmount(t.income)}</b></div>
      <div><span>지출</span><b className="num minus">{formatAmount(t.spending)}</b></div>
      <div><span>수지</span><b className={'num ' + (t.net < 0 ? 'minus' : '')}>{formatSigned(t.net)}</b></div>
      <p className="led-note">
        지출 = 소비 {formatAmount(t.consumption)}
        {t.financeCost > 0 && <> + 대출 이자 {formatAmount(t.financeCost)}</>}
        {excluded > 0 && <> · 대출 원금 · 이체 · 카드 대금 {formatAmount(excluded)}은 지출에 넣지 않았습니다</>}
        {phase === 'current' && ' · 진행 중인 기간이라 확정 합계가 아닙니다'}
      </p>
    </div>
  );
}

// ---------- 내역 ----------

type Scope = 'period' | 'year' | 'all';

function LedgerHistory({
  entries, period, todayISO, categories, onEntryClick, onAdd, onSearchAll,
}: LedgerScreenProps & { period: Period }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<Scope>('period');
  const [all, setAll] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; items: Entry[] }>({ state: 'idle', items: [] });

  useEffect(() => {
    if (scope !== 'all' || all.state !== 'idle') return;
    setAll({ state: 'loading', items: [] });
    onSearchAll().then(
      (items) => setAll({ state: 'ready', items }),
      () => setAll({ state: 'error', items: [] }),
    );
  }, [scope, all.state, onSearchAll]);

  const yearStart = `${period.start.slice(0, 4)}-01-01`;
  const yearEnd = `${period.start.slice(0, 4)}-12-31`;
  const totals = useMemo(() => totalsOf(actualsIn(entries, period.start, period.end)), [entries, period]);

  const items: HistoryItem[] = useMemo(() => {
    if (scope === 'all') {
      return actualsIn(all.items, '0000-01-01', '9999-12-31')
        .filter((e) => matchesQuery(e, q, categories))
        .map((e) => ({ key: e.id, entry: e, date: e.startDate, planned: false, amount: Math.abs(e.money?.amountMinor ?? 0), sign: e.money?.type === 'income' ? 1 as const : -1 as const }))
        .sort((a, b) => b.date.localeCompare(a.date));
    }
    const [from, to] = scope === 'year' ? [yearStart, yearEnd] : [period.start, period.end];
    return historyItems(entries, from, to).filter((i) => matchesQuery(i.entry, q, categories));
  }, [scope, all.items, entries, period, q, categories, yearStart, yearEnd]);

  const groups = useMemo(() => groupByDay(items), [items]);
  const catName = (id: string | null | undefined) => (id ? categories.find((c) => c.id === id)?.name ?? '알 수 없는 카테고리' : null);
  const searching = q.trim().length > 0 || scope !== 'period';

  return (
    <div className="led-body">
      <TotalsRow t={totals} phase={phaseOf(period, todayISO)} />

      <div className="led-search">
        <input
          className="mod-input" type="search" placeholder="내역 · 메모 · 결제수단 · 카테고리 · 금액"
          aria-label="거래 검색" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (isComposingEnter(e)) e.preventDefault(); }}
        />
        <div className="seg" role="radiogroup" aria-label="검색 범위">
          {([['period', '이 기간'], ['year', `${period.start.slice(0, 4)}년`], ['all', '전체']] as const).map(([id, label]) => (
            <button
              key={id} role="radio" aria-checked={scope === id}
              className={'seg-btn' + (scope === id ? ' on' : '')}
              onClick={() => { setScope(id); if (id === 'all') setAll({ state: 'idle', items: [] }); }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {scope === 'all' && <p className="led-note">전체 검색은 실제 거래만 찾습니다. 예정은 기간 · 연도 범위에서 보입니다.</p>}

      {scope === 'all' && all.state === 'loading' && <p className="led-state" role="status">전체 기록을 찾는 중입니다.</p>}
      {scope === 'all' && all.state === 'error' && (
        <p className="led-state" role="alert">
          전체 기록을 불러오지 못했습니다. 연결을 확인한 뒤 <button className="set-redo" onClick={() => setAll({ state: 'idle', items: [] })}>다시 찾기</button>
        </p>
      )}

      {(scope !== 'all' || all.state === 'ready') && (groups.length === 0 ? (
        <p className="led-empty">
          {searching ? '찾는 거래가 없습니다.' : '이 기간에 기록한 거래가 없습니다.'}
        </p>
      ) : (
        <ol className="led-days">
          {groups.map((g) => (
            <li key={g.date} className="led-day">
              <div className="led-day-h">
                <span>{dayLabel(g.date)}</span>
                <span className="num">
                  {g.income > 0 && <span className="plus">+{formatAmount(g.income)}</span>}
                  {g.spending > 0 && <span className="minus">−{formatAmount(g.spending)}</span>}
                </span>
              </div>
              <ul>
                {g.items.map((it) => {
                  const badge = flowBadge(it.entry);
                  const cat = catName(it.entry.money?.categoryId);
                  const method = it.entry.money?.method;
                  return (
                    <li key={it.key}>
                      <button className={'led-row' + (it.planned ? ' planned' : '')} onClick={() => onEntryClick(it.entry)}>
                        <span className="led-row-m">
                          <span className="led-row-t">
                            {it.planned && <span className="led-badge muted">예정</span>}
                            {it.entry.title.trim() || cat || (it.sign > 0 ? '수입' : '지출')}
                          </span>
                          <span className="led-row-s">
                            {[cat, method, badge].filter(Boolean).join(' · ')}
                            {it.entry.money?.plannedRef && ' · 예정 확정'}
                          </span>
                        </span>
                        <span className={'led-row-a num ' + (it.planned ? '' : it.sign > 0 ? 'plus' : 'minus')}>
                          {it.sign > 0 ? '+' : '−'}{formatAmount(it.amount)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      ))}

      <button className="debt-add" onClick={() => onAdd(todayISO >= period.start && todayISO <= period.end ? todayISO : period.end)}>
        + 거래 추가
      </button>
    </div>
  );
}

// ---------- 예산 ----------

function LedgerBudget({
  entries, period, todayISO, settleDay, categories, categoryBudgets, categoriesReady,
  onSeedCategories, onSaveCategoryBudget,
}: LedgerScreenProps & { period: Period }) {
  const [editing, setEditing] = useState<string | null>(null);
  const actuals = useMemo(() => actualsIn(entries, period.start, period.end), [entries, period]);
  const prev = periodByKey(shiftPeriodKey(period.key, -1), settleDay)!;
  const prevActuals = useMemo(() => actualsIn(entries, prev.start, prev.end), [entries, prev]);
  const rows = useMemo(() => budgetRows(categories, categoryBudgets, actuals, period.key, 'expense'), [categories, categoryBudgets, actuals, period.key]);
  const prevRows = useMemo(() => budgetRows(categories, categoryBudgets, prevActuals, prev.key, 'expense'), [categories, categoryBudgets, prevActuals, prev.key]);
  const income = useMemo(() => budgetRows(categories, categoryBudgets, actuals, period.key, 'income'), [categories, categoryBudgets, actuals, period.key]);
  const sum = budgetSummary(rows);
  const phase = phaseOf(period, todayISO);
  const currentKey = periodOf(todayISO, settleDay).key;
  // 기본 예산은 지난 기간부터 바꾸지 않는다 — 소급되면 지난 결산이 바뀐다.
  const defaultFrom = period.key > currentKey ? period.key : currentKey;

  if (categoriesReady && categories.length === 0) {
    return (
      <div className="led-body">
        <p className="led-empty">카테고리가 없습니다. 카테고리를 만들면 카테고리마다 예산을 정하고 실제 지출과 견줄 수 있습니다.</p>
        <button className="btn" onClick={onSeedCategories}>기본 카테고리 만들기</button>
      </div>
    );
  }

  return (
    <div className="led-body">
      <div className="led-totals">
        <div><span>예산</span><b className="num">{formatAmount(sum.budgeted)}</b></div>
        <div><span>예산 안 지출</span><b className="num">{formatAmount(sum.actualInBudgeted)}</b></div>
        <div>
          <span>남음</span>
          <b className={'num ' + (sum.budgeted - sum.actualInBudgeted < 0 ? 'minus' : '')}>
            {formatSigned(sum.budgeted - sum.actualInBudgeted)}
          </b>
        </div>
        <p className="led-note">
          전체 지출 {formatAmount(sum.actual)}
          {sum.overCount > 0 && <> · <b className="minus">초과 {sum.overCount}개</b></>}
          {' '}· 카테고리 예산은 결산용입니다. 생활비 주머니와 달리 한도에서 미리 빼지 않습니다
          {phase === 'current' && ' · 진행 중인 기간입니다'}
        </p>
      </div>

      <ul className="led-budgets" aria-label="카테고리별 예산">
        {rows.map((r) => (
          <BudgetLine
            key={r.categoryId || '__none'}
            row={r}
            prevActual={prevRows.find((p) => p.categoryId === r.categoryId)?.actual ?? 0}
            editing={editing === r.categoryId}
            onEdit={() => setEditing(editing === r.categoryId ? null : r.categoryId)}
            canDefault={phase !== 'past'}
            defaultFrom={defaultFrom}
            onSave={(scope, amount) => {
              setEditing(null);
              onSaveCategoryBudget(scope === 'period'
                ? setPeriodBudget(r.categoryId, period.key, amount)
                : setDefaultBudget(r.categoryId, defaultFrom, amount));
            }}
          />
        ))}
      </ul>

      {income.length > 0 && (
        <>
          <h4 className="led-h">수입 결산</h4>
          <ul className="led-budgets">
            {income.map((r) => (
              <li key={r.categoryId || '__none'} className="led-bl">
                <div className="led-bl-main static">
                  <span className="led-bl-n">{r.name}{r.archived && ' (보관)'}</span>
                  <span className="led-bl-v num plus">{formatAmount(r.actual)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BudgetLine({ row, prevActual, editing, onEdit, canDefault, defaultFrom, onSave }: {
  row: BudgetRow; prevActual: number; editing: boolean; onEdit: () => void;
  canDefault: boolean; defaultFrom: PeriodKey;
  onSave: (scope: 'period' | 'default', amount: number | null) => void;
}) {
  const [text, setText] = useState(row.budget.amountMinor != null ? String(row.budget.amountMinor) : '');
  useEffect(() => { if (editing) setText(row.budget.amountMinor != null ? String(row.budget.amountMinor) : ''); }, [editing, row.budget.amountMinor]);
  const budget = row.budget.amountMinor;
  const ratio = budget && budget > 0 ? Math.min(1, row.actual / budget) : 0;
  const editable = row.categoryId !== '';
  const parsed = text.trim() === '' ? null : parseAmountToMinor(text);
  const valid = text.trim() === '' || (parsed !== null && parsed >= 0);

  return (
    <li className="led-bl">
      <button className="led-bl-main" onClick={editable ? onEdit : undefined} aria-expanded={editable ? editing : undefined} disabled={!editable}>
        <span className="led-bl-n">
          {row.name}{row.archived && ' (보관)'}
          {row.budget.source === 'period' && <span className="led-badge muted">이 기간만</span>}
        </span>
        <span className="led-bl-v num">
          {formatAmount(row.actual)}
          {budget != null && <span className="led-bl-b"> / {formatAmount(budget)}</span>}
        </span>
        {budget != null && budget > 0 && (
          <span className={'bp-bar' + (row.over ? ' over' : '')} aria-hidden="true">
            <span className="bp-bar-f" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
        )}
        <span className="led-bl-s num">
          {row.remaining == null
            ? '예산 없음'
            : row.over
              ? <b className="minus">초과 {formatAmount(-row.remaining)}</b>
              : <>남음 {formatAmount(row.remaining)}</>}
          {' '}· 지난 기간 {formatAmount(prevActual)}
        </span>
      </button>
      {editing && (
        <div className="led-bl-edit">
          <input
            className="mod-input num" inputMode="numeric" placeholder="예산 (비우면 없음)" autoFocus
            aria-label={`${row.name} 예산`} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e) && valid) onSave('period', parsed); }}
          />
          <div className="led-bl-a">
            <button className="btn" disabled={!valid} onClick={() => onSave('period', parsed)}>이 기간만</button>
            <button
              className="btn primary" disabled={!valid || !canDefault} onClick={() => onSave('default', parsed)}
              title={canDefault ? undefined : '지난 기간에서는 기본 예산을 바꾸지 않습니다'}
            >
              기본 예산으로 ({periodName(defaultFrom)}부터)
            </button>
          </div>
          <p className="led-note">
            {canDefault
              ? '기본 예산은 그 기간부터 적용되고, 앞 기간에는 소급되지 않습니다.'
              : '지난 기간입니다. 이 기간의 예산만 바꿀 수 있습니다 — 기본 예산을 바꾸면 지난 결산이 달라집니다.'}
          </p>
        </div>
      )}
    </li>
  );
}

