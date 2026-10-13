/**
 * 가계부 렌즈 — 내역 · 현금흐름 · 예산 · 분석.
 *
 * 렌즈 바로 아래 한 줄이 보기를 고르고, 그 아래에는 **고른 보기의 본문 하나**만 그린다.
 * 예전에는 '며칠 버티나' 카드 → 큰 달력 → 상세 탭이 위아래로 쌓여, 아래 탭을 바꿔도 위의
 * 달력이 남았다. 화면의 중심이 어디인지, 위 달력의 월과 아래 결산 기간 중 무엇이 무엇을
 * 바꾸는지가 흐렸다. 지금은 보기마다 자기 기간 도구를 하나씩 가진다.
 *
 *   내역      정산 기간 하나 — 수입 · 지출 · 수지와 거래 목록, 검색, 거래 추가
 *   현금흐름  달력 월 하나 — '며칠 버티나' 카드와 날짜별 예상 잔고 달력, 거래 추가. 생활비 · 세이브도
 *             여기서 관리한다(카드의 확보 줄 · 달력의 생활비 막대 → PocketSheet). App 이 그려 넘긴다
 *   예산      정산 기간 하나 — "계획대로 쓰고 있는가". 카테고리 예산 · 실제 사용 · 남음 · 초과.
 *             지난 기간과 견주지 않는다. 생활비 · 세이브는 없다(현금흐름의 일이다)
 *   분석      정산 기간 하나 — "평소 어디에 얼마나 쓰는가". 월별 추이(기간 열둘) · 카테고리
 *             (비중 · 직전 대비 · 월평균 · 수입원) 둘 중 하나, 그 아래 기간 돌아보기 한 장
 *
 * 예산과 분석에 같은 금액이 나오는 것은 괜찮다 — 예산에서는 예산과 견주는 값이고, 분석에서는
 * 비중과 추세를 설명하는 값이다. 같은 모양의 표 · 비교를 두 곳에 되풀이하지 않는다.
 * 내부 id(`budget` · `stats`)는 그대로다 — 이름만 바꿨다.
 *
 * ── 숫자를 내는 조건 ─────────────────────────────────────────
 *
 * 합계는 고른 기간의 거래를 **다 받은 뒤에만** 낸다. 아직 못 받았으면 "불러오는 중",
 * 실패했으면 그 사실을, 캐시가 비어 있으면 "확인 전" 을 적는다 — 덜 받은 목록의 합계는
 * 그럴듯하게 틀린 숫자다. 캐시에서 온 값이면 숫자는 내되 한 줄을 덧붙인다. 현금흐름은
 * 결산 구독과 무관하다 — 자기 계산 상태(`calcState`)로 판단한다.
 *
 * ── 무엇이 소비인가 ──────────────────────────────────────────
 *
 * `ledgerStats` 가 정한다. 대출 원금 · 이체 · 카드 대금은 소비가 아니고, 대출 이자는
 * 금융비용으로 따로 적는다. 예정은 합계에 넣지 않는다.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { setDefaultBudget, setPeriodBudget } from '../domain/category';
import {
  actualsIn, budgetRows, budgetSummary, flowBadge, groupByDay, historyItems, matchesQuery,
  totalsOf, type BudgetRow, type HistoryItem, type LedgerTotals,
} from '../domain/ledgerStats';
import { formatAmount, formatSigned, parseAmountToMinor } from '../domain/money';
import {
  periodByKey, periodName, periodOf, periodRange, phaseOf, settlementYearOf, settlementYearRange,
  shiftPeriodKey, type Period,
} from '../domain/period';
import type {
  Category, CategoryBudget, Entry, LedgerNote, LedgerTabId, PeriodKey,
} from '../domain/types';
import { LEDGER_NOTE_MAX } from '../data/converters';
import type { FeedState } from '../app/useStore';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';
import { LedgerMonthly, LedgerStats } from './LedgerCharts';
import { dayLabel, feedVerdict } from './ledgerView';

const VIEWS: readonly { id: LedgerTabId; label: string }[] = [
  { id: 'history', label: '내역' },
  { id: 'cashflow', label: '현금흐름' },
  { id: 'budget', label: '예산' },
  { id: 'stats', label: '분석' },
];

/** 전체 검색 — 켜 둔 동안 실제 거래를 구독한다. 끄면 구독을 끊는다. */
export type SubscribeAll = (cb: (items: Entry[]) => void, onError: () => void) => () => void;

export interface LedgerScreenProps {
  todayISO: string;
  settleDay: number;
  tab: LedgerTabId;
  onTab: (t: LedgerTabId) => void;
  periodKey: PeriodKey;
  onPeriodKey: (k: PeriodKey) => void;
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
  /** 정산 기간 메모(돌아보기). 기간 하나에 한 장. */
  ledgerNotes: readonly LedgerNote[];
  notesFeed: FeedState;
  onSaveLedgerNote: (n: LedgerNote) => void;
  subscribeAll: SubscribeAll;
  /** 현금흐름 본문 — 카드와 한도 달력, 달력의 월 이동. App 이 그린다. */
  cashflow?: ReactNode;
}

export function LedgerScreen(props: LedgerScreenProps) {
  const { tab, onTab, periodKey, onPeriodKey, settleDay, todayISO, feed } = props;
  const period = periodByKey(periodKey, settleDay) ?? periodOf(todayISO, settleDay);
  const current = periodOf(todayISO, settleDay);
  const verdict = feedVerdict(feed);
  const [statsView, setStatsView] = useState<'trend' | 'category'>('trend');

  const periodNav = (
    <PeriodNav
      period={period} todayISO={todayISO} isCurrent={period.key === current.key}
      onPrev={() => onPeriodKey(shiftPeriodKey(period.key, -1))}
      onNext={() => onPeriodKey(shiftPeriodKey(period.key, 1))}
      onNow={() => onPeriodKey(current.key)}
    />
  );
  const gated = (body: ReactNode) => (!verdict.ok
    ? <p className="led-state" role="status">{verdict.message}</p>
    : <>{verdict.caveat && <p className="led-caveat">{verdict.caveat}</p>}{body}</>);

  return (
    <section className="led" aria-label="가계부">
      <nav className="led-tabs" role="tablist" aria-label="가계부 보기">
        {VIEWS.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id}
            className={'led-tab' + (tab === t.id ? ' on' : '')}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'history' && (
        <>
          <div className="led-toolbar">
            {periodNav}
            <button className="btn primary led-add" onClick={() => props.onAdd(todayISO >= period.start && todayISO <= period.end ? todayISO : period.end)}>
              <Icon.Plus size={14} />거래 추가
            </button>
          </div>
          {gated(<LedgerHistory {...props} period={period} />)}
        </>
      )}

      {tab === 'cashflow' && props.cashflow}

      {tab === 'budget' && (
        <>
          <div className="led-toolbar">{periodNav}</div>
          {gated(<LedgerBudget {...props} period={period} />)}
        </>
      )}

      {tab === 'stats' && (
        <>
          <div className="led-toolbar">{periodNav}</div>
          <div className="seg led-subview" role="radiogroup" aria-label="분석 보기">
            {([['trend', '월별 추이'], ['category', '카테고리']] as const).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={statsView === id}
                className={'seg-btn' + (statsView === id ? ' on' : '')} onClick={() => setStatsView(id)}>
                {label}
              </button>
            ))}
          </div>
          {statsView === 'trend' && (
            <>
              <p className="led-note led-scope">고른 기간까지 열두 정산 기간을 봅니다.</p>
              {gated(
                <LedgerMonthly
                  entries={props.entries} settleDay={settleDay} todayISO={todayISO} period={period}
                  onPick={(k) => { onPeriodKey(k); onTab('history'); }}
                />,
              )}
            </>
          )}
          {statsView === 'category' && gated(
            <LedgerStats
              entries={props.entries} settleDay={settleDay} todayISO={todayISO}
              period={period} categories={props.categories}
            />,
          )}
          {/* 두 하위 보기가 같은 기간을 본다 — 돌아보기는 그 아래 한 번만 그린다. */}
          <PeriodNote
            key={period.key} period={period}
            note={props.ledgerNotes.find((n) => n.id === period.key) ?? null}
            feed={props.notesFeed} onSave={props.onSaveLedgerNote}
          />
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
  const excluded = t.transferOut + t.cardPayment;
  return (
    <div className="led-totals four">
      <div><span>수입</span><b className="num plus">{formatAmount(t.income)}</b></div>
      <div><span>지출</span><b className="num minus">{formatAmount(t.spending)}</b></div>
      <div><span>대금</span><b className="num">{formatAmount(t.repayment)}</b></div>
      <div><span>수지</span><b className={'num ' + (t.net < 0 ? 'minus' : '')}>{formatSigned(t.net)}</b></div>
      <p className="led-note">
        지출 = 소비 {formatAmount(t.consumption)}
        {t.financeCost > 0 && <> + 대출 이자 {formatAmount(t.financeCost)}</>}
        {' '}· 대금 = 대출 원금 · 수지 = 수입 − 지출 − 대금
        {excluded > 0 && <> · 이체 · 카드 대금 {formatAmount(excluded)}은 넣지 않았습니다(카드는 쓴 날 지출로 셉니다)</>}
        {phase === 'current' && ' · 진행 중인 기간이라 확정 합계가 아닙니다'}
      </p>
    </div>
  );
}

// ---------- 내역 ----------

type Scope = 'period' | 'year' | 'all';

function LedgerHistory({
  entries, period, todayISO, settleDay, categories, onEntryClick, subscribeAll,
}: LedgerScreenProps & { period: Period }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<Scope>('period');
  const [all, setAll] = useState<{ state: 'loading' | 'ready' | 'error'; items: Entry[] }>({ state: 'loading', items: [] });
  const [retry, setRetry] = useState(0);

  /*
    전체 검색은 켜 둔 동안 **구독**한다. 한 번 읽어 두면 결과에서 고치거나 지운 거래가
    옛 모습으로 남는다. 끄면 구독을 끊는다 — 내역을 보는 내내 전량을 붙들지 않는다.
  */
  useEffect(() => {
    if (scope !== 'all') return;
    setAll({ state: 'loading', items: [] });
    return subscribeAll(
      (items) => setAll({ state: 'ready', items }),
      () => setAll({ state: 'error', items: [] }),
    );
  }, [scope, subscribeAll, retry]);

  // 정산 연도. 25일 기준 '2026년 1월'(2025/12/25 ~ 2026/1/24) 은 2026년 정산 연도다.
  const year = settlementYearOf(period.key);
  const yearRange = useMemo(() => settlementYearRange(year, settleDay), [year, settleDay]);
  const totals = useMemo(() => totalsOf(actualsIn(entries, period.start, period.end)), [entries, period]);

  const items: HistoryItem[] = useMemo(() => {
    if (scope === 'all') {
      return actualsIn(all.items, '0000-01-01', '9999-12-31')
        .filter((e) => matchesQuery(e, q, categories))
        .map((e) => ({ key: e.id, entry: e, date: e.startDate, planned: false, amount: Math.abs(e.money?.amountMinor ?? 0), sign: e.money?.type === 'income' ? 1 as const : -1 as const }))
        .sort((a, b) => b.date.localeCompare(a.date));
    }
    const [from, to] = scope === 'year' ? [yearRange.start, yearRange.end] : [period.start, period.end];
    return historyItems(entries, from, to).filter((i) => matchesQuery(i.entry, q, categories));
  }, [scope, all.items, entries, period, q, categories, yearRange]);

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
          {([['period', '이 기간'], ['year', `${year}년`], ['all', '전체']] as const).map(([id, label]) => (
            <button
              key={id} role="radio" aria-checked={scope === id}
              className={'seg-btn' + (scope === id ? ' on' : '')}
              onClick={() => setScope(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {scope === 'year' && (
        <p className="led-note led-scope">{year}년 정산 연도 · {periodRange({ key: period.key, start: yearRange.start, end: yearRange.end })}</p>
      )}
      {scope === 'all' && <p className="led-note">전체 검색은 실제 거래만 찾습니다. 예정은 기간 · 연도 범위에서 보입니다.</p>}

      {scope === 'all' && all.state === 'loading' && <p className="led-state" role="status">전체 기록을 찾는 중입니다.</p>}
      {scope === 'all' && all.state === 'error' && (
        <p className="led-state" role="alert">
          전체 기록을 불러오지 못했습니다. 연결을 확인한 뒤 <button className="set-redo" onClick={() => setRetry((n) => n + 1)}>다시 찾기</button>
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

    </div>
  );
}

// ---------- 기간 메모 ----------

/**
 * 기간 돌아보기 — 그 기간을 돌아보는 글 한 장(반성 · 다짐). 분석 보기 아래에 둔다 — 숫자로 그
 * 기간을 본 뒤에 적는 자리다. 열쇠 · 저장 경로는 그대로(`ledgerNotes/{기간}`)다.
 *
 * 메모 구독이 아직 오지 않았거나 캐시가 비어 "없음" 을 확정할 수 없으면 고치지 못하게 둔다.
 * 그 사이 빈 칸으로 열어 저장하면 서버에 있는 글을 빈 글로 덮는다.
 */
function PeriodNote({ period, note, feed, onSave }: {
  period: Period; note: LedgerNote | null; feed: FeedState; onSave: (n: LedgerNote) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const known = feed.ready && !(feed.empty && feed.fromCache);
  const saved = note?.text ?? '';
  const open = () => { setText(saved); setEditing(true); };
  const save = () => {
    const next = text.replace(/\s+$/, '');
    setEditing(false);
    if (next === saved) return;
    const now = new Date().toISOString();
    onSave({ id: period.key, period: period.key, text: next, createdAt: note?.createdAt || now, updatedAt: now });
  };

  return (
    <section className="led-memo" aria-labelledby="led-memo-h">
      <div className="led-memo-h">
        <h3 className="led-sec-h" id="led-memo-h">
          기간 돌아보기 <span className="led-sub">{periodName(period.key)} · {periodRange(period)}</span>
        </h3>
        {!editing && known && (
          <button className="btn sm" onClick={open}>{saved ? '고치기' : '적기'}</button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            className="mod-input led-memo-in" rows={4} autoFocus maxLength={LEDGER_NOTE_MAX}
            aria-label={`${periodName(period.key)} 메모`}
            placeholder="이 기간에 무엇을 잘했고 무엇을 바꿀지 — 반성 · 다짐"
            value={text} onChange={(e) => setText(e.target.value)}
          />
          <div className="led-memo-a">
            {text.length > LEDGER_NOTE_MAX - 500 && <span className="led-note num">{text.length} / {LEDGER_NOTE_MAX}</span>}
            <button className="btn" onClick={() => setEditing(false)}>취소</button>
            <button className="btn primary" onClick={save}>저장</button>
          </div>
        </>
      ) : !known ? (
        <p className="led-note" role="status">
          {feed.status === 'error' ? '메모를 불러오지 못했습니다. 연결을 확인한 뒤 다시 열어 주세요.' : '메모를 불러오는 중입니다.'}
        </p>
      ) : saved ? (
        <p className="led-memo-t">{saved}</p>
      ) : (
        <p className="led-note">아직 적은 글이 없습니다. 이 기간을 돌아보며 반성 · 다짐을 적어 두세요.</p>
      )}
    </section>
  );
}

// ---------- 예산 ----------

/**
 * 예산 — 이 기간을 계획대로 쓰고 있는가.
 *
 * 맨 위 요약은 **예산을 정한 카테고리만** 견준다: 총 예산 · 그 카테고리의 실제 사용 · 남음(또는 초과).
 * 예전에는 "결산" 자리에 모든 지출을 적고 "남음" 은 예산 카테고리만 견줘, 결산 562,000 옆에
 * 남음 +275,000 이 섰다 — 두 숫자가 서로 다른 범위를 봤다. 예산 밖 지출(예산 없는 카테고리 ·
 * 미분류)은 빠뜨리지 않고 한 줄로 따로 적는다. 숫자는 그대로 `budgetSummary` 다.
 *
 * 지난 기간 결산 · 수입 · 장기 추이는 분석 보기의 몫이고, 생활비 · 세이브는 현금흐름 보기의 몫이다.
 */
function LedgerBudget({
  entries, period, todayISO, settleDay, categories, categoryBudgets, categoriesReady,
  onSeedCategories, onSaveCategoryBudget,
}: LedgerScreenProps & { period: Period }) {
  const [editing, setEditing] = useState<string | null>(null);
  const actuals = useMemo(() => actualsIn(entries, period.start, period.end), [entries, period]);
  const rows = useMemo(() => budgetRows(categories, categoryBudgets, actuals, period.key, 'expense'), [categories, categoryBudgets, actuals, period.key]);
  // 예산을 정한 카테고리가 먼저 — 같은 무리 안에서는 카테고리 순서 그대로.
  const ordered = useMemo(
    () => [...rows.filter((r) => r.budget.amountMinor != null), ...rows.filter((r) => r.budget.amountMinor == null)],
    [rows],
  );
  const sum = budgetSummary(rows);
  const phase = phaseOf(period, todayISO);
  const currentKey = periodOf(todayISO, settleDay).key;
  // 기본 예산은 지난 기간부터 바꾸지 않는다 — 소급되면 지난 결산이 바뀐다.
  const defaultFrom = period.key > currentKey ? period.key : currentKey;
  const left = sum.budgeted - sum.actualInBudgeted;
  const outside = sum.actual - sum.actualInBudgeted;
  const outsideNames = rows.filter((r) => r.budget.amountMinor == null && r.actual > 0).map((r) => r.name);
  const ratio = sum.budgeted > 0 ? sum.actualInBudgeted / sum.budgeted : 0;

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
      <h3 className="led-sec-h">카테고리 예산</h3>
      <div className="led-bsum" role="group" aria-label="예산 요약">
        {sum.budgeted > 0 ? (
          <>
            <div className="led-bsum-n">
              <div><span>총 예산</span><b className="num">{formatAmount(sum.budgeted)}</b></div>
              <div><span>실제 사용</span><b className="num">{formatAmount(sum.actualInBudgeted)}</b></div>
              <div>
                <span>{left < 0 ? '초과' : '남은 예산'}</span>
                <b className={'num ' + (left < 0 ? 'minus' : 'plus')}>{formatAmount(Math.abs(left))}</b>
              </div>
            </div>
            <span className={'bp-bar' + (left < 0 ? ' over' : '')} aria-hidden="true">
              <span className="bp-bar-f" style={{ width: `${Math.round(Math.min(1, ratio) * 100)}%` }} />
            </span>
            <p className="led-bsum-s num">
              사용률 {Math.round(ratio * 100)}%
              {sum.overCount > 0 && <> · <b className="minus">초과 {sum.overCount}개</b></>}
            </p>
          </>
        ) : (
          <p className="led-empty">아직 정한 예산이 없습니다. 아래 카테고리를 눌러 예산을 정하세요.</p>
        )}
        {outside > 0 && (
          <p className="led-bsum-s num">
            예산 밖 지출 {formatAmount(outside)}
            {outsideNames.length > 0 && <> ({outsideNames.slice(0, 3).join(' · ')}{outsideNames.length > 3 ? ` 외 ${outsideNames.length - 3}개` : ''})</>}
            {sum.budgeted > 0 && ' — 남은 예산에는 넣지 않습니다'}
          </p>
        )}
        <p className="led-note">
          사용 = 실제로 쓴 지출(소비 + 대출 이자)
          {phase === 'current' && ' · 진행 중인 기간입니다'}
        </p>
      </div>

      <div className="led-bl-cols" aria-hidden="true">
        <span>카테고리</span><span>예산</span><span>사용</span><span>남음</span>
      </div>
      <ul className="led-budgets" aria-label="카테고리별 예산">
        {ordered.map((r) => (
          <BudgetLine
            key={r.categoryId || '__none'}
            row={r}
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
    </div>
  );
}

function BudgetLine({ row, editing, onEdit, canDefault, defaultFrom, onSave }: {
  row: BudgetRow; editing: boolean; onEdit: () => void;
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
      <button className="led-bl-main cols" onClick={editable ? onEdit : undefined} aria-expanded={editable ? editing : undefined} disabled={!editable}>
        <span className="led-bl-n">
          {row.name}{row.archived && ' (보관)'}
          {row.budget.source === 'period' && <span className="led-badge muted">이 기간만</span>}
          {budget != null && budget > 0 && (
            <span className={'led-bl-s num' + (row.over ? ' minus' : '')}>사용률 {Math.round((row.actual / budget) * 100)}%</span>
          )}
        </span>
        <span className="led-bl-c num" aria-label={`예산 ${budget == null ? '없음' : formatAmount(budget)}`}>
          {budget == null ? <span className="led-bl-none">—</span> : formatAmount(budget)}
        </span>
        <span className="led-bl-c num" aria-label={`사용 ${formatAmount(row.actual)}`}>{formatAmount(row.actual)}</span>
        <span
          className={'led-bl-c num' + (row.over ? ' minus' : '')}
          aria-label={row.remaining == null ? '남음 없음' : row.over ? `초과 ${formatAmount(-row.remaining)}` : `남음 ${formatAmount(row.remaining)}`}
        >
          {row.remaining == null
            ? <span className="led-bl-none">—</span>
            : row.over ? <>초과 {formatAmount(-row.remaining)}</> : formatAmount(row.remaining)}
        </span>
        {budget != null && budget > 0 && (
          <span className={'bp-bar' + (row.over ? ' over' : '')} aria-hidden="true">
            <span className="bp-bar-f" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
        )}
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
