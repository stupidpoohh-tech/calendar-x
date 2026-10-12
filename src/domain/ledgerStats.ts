/**
 * 결산 — 실제 거래를 기간 · 카테고리로 모은다.
 *
 * ── 무엇을 소비로 세는가 ─────────────────────────────────────
 *
 * 분류는 `ledger.ledgerClassOf` 하나가 정한다. 여기서 다시 판정하지 않는다.
 *
 *   수입       income        흐름이 일반인 입금
 *   소비       consumption   일반 지출 + 카드 사용(쓴 날 센다)
 *   금융비용   financeCost   대출 이자. 소비와 따로 적는다
 *   제외       principal · transfer · cardPayment
 *              대출 원금은 빚이 줄어드는 것이고, 이체는 내 돈의 자리만 바뀐 것이며,
 *              카드 대금은 쓴 날 이미 소비로 셌다. 셋 다 현금은 움직이지만 소비가 아니다
 *
 * 지출(spending) = 소비 + 금융비용, 수지 = 수입 − 지출.
 *
 * ── 예정은 소비가 아니다 ──────────────────────────────────────
 *
 * 통계는 **실제 거래만** 본다. 확정하지 않은 지난 예정은 일어났는지 알 수 없다 — 그것을
 * 소비로 세면 적어 둔 계획이 결산을 바꾼다. 내역 화면은 예정을 함께 보여 주되 합계에
 * 넣지 않는다.
 */
import { MONEY_TYPE_BY_ID } from './constants';
import { effectiveEndDate } from './entry';
import { isActual, ledgerClassOf, moneyFlowOf, type LedgerClass } from './ledger';
import { phaseOf, type Period } from './period';
import { materialize } from './recurrence';
import { resolveCategoryBudget, sortCategories, type ResolvedBudget } from './category';
import type { Category, CategoryBudget, DateISO, Entry, PeriodKey } from './types';

/** 미분류 자리. 카테고리 id 로는 쓰이지 않는 값이다. */
export const UNCATEGORIZED = '';

/** [start, end] 안의 실제 거래. 같은 문서가 두 번 들어와도 한 번만 센다. */
export function actualsIn(entries: readonly Entry[], start: DateISO, end: DateISO): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of entries) {
    if (!isActual(e) || seen.has(e.id)) continue;
    if (e.startDate < start || e.startDate > end) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt));
}

export interface LedgerTotals {
  income: number;
  consumption: number;
  financeCost: number;
  principal: number;
  transferIn: number;
  transferOut: number;
  cardPayment: number;
  /** 소비 + 금융비용. */
  spending: number;
  /** 수입 − 지출. */
  net: number;
  count: number;
}

const amountOf = (e: Entry) => Math.abs(e.money?.amountMinor ?? 0);

export function totalsOf(actuals: readonly Entry[]): LedgerTotals {
  const t: LedgerTotals = {
    income: 0, consumption: 0, financeCost: 0, principal: 0,
    transferIn: 0, transferOut: 0, cardPayment: 0, spending: 0, net: 0, count: 0,
  };
  for (const e of actuals) {
    const cls = ledgerClassOf(e);
    const a = amountOf(e);
    t.count++;
    switch (cls) {
      case 'income': t.income += a; break;
      case 'consumption': t.consumption += a; break;
      case 'financeCost': t.financeCost += a; break;
      case 'principal': t.principal += a; break;
      case 'cardPayment': t.cardPayment += a; break;
      case 'transfer':
        if (e.money?.type === 'income') t.transferIn += a; else t.transferOut += a;
        break;
      default: break;
    }
  }
  t.spending = t.consumption + t.financeCost;
  t.net = t.income - t.spending;
  return t;
}

/** 결산의 어느 쪽인가. 지출 쪽은 소비 + 금융비용이다. */
export type Side = 'expense' | 'income';

const SIDE_CLASSES: Record<Side, readonly LedgerClass[]> = {
  expense: ['consumption', 'financeCost'],
  income: ['income'],
};

export function onSide(e: Entry, side: Side): boolean {
  const cls = ledgerClassOf(e);
  return cls !== null && SIDE_CLASSES[side].includes(cls);
}

/** 카테고리별 합계. 카테고리가 없으면 `UNCATEGORIZED`. */
export function byCategory(actuals: readonly Entry[], side: Side): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of actuals) {
    if (!onSide(e, side)) continue;
    const key = e.money?.categoryId || UNCATEGORIZED;
    out.set(key, (out.get(key) ?? 0) + amountOf(e));
  }
  return out;
}

// ---------- 예산 대비 ----------

export interface BudgetRow {
  /** 카테고리 id. 미분류는 `UNCATEGORIZED`. */
  categoryId: string;
  name: string;
  archived: boolean;
  /** 이 기간 예산. 없으면 null. */
  budget: ResolvedBudget;
  actual: number;
  /** 예산 − 실제. 예산이 없으면 null. 음수면 초과다. */
  remaining: number | null;
  over: boolean;
}

/**
 * 그 기간의 카테고리별 예산과 실제.
 *
 * 예산이 없는 카테고리의 실제 지출도 줄로 세운다. 보관한 카테고리는 이 기간에 쓴 것이나
 * 예산이 있을 때만 남긴다. 목록에 없는 카테고리를 가리키는 거래는 그 id 로 한 줄을 만든다
 * — 합계에서 사라지지 않게.
 */
export function budgetRows(
  categories: readonly Category[], budgets: readonly CategoryBudget[],
  actuals: readonly Entry[], period: PeriodKey, side: Side,
): BudgetRow[] {
  const sums = byCategory(actuals, side);
  const rows: BudgetRow[] = [];
  const known = new Set<string>();
  for (const c of sortCategories(categories.filter((x) => x.kind === side))) {
    known.add(c.id);
    const budget = resolveCategoryBudget(budgets, c.id, period);
    const actual = sums.get(c.id) ?? 0;
    if (c.archived && actual === 0 && budget.amountMinor == null) continue;
    rows.push(row(c.id, c.name, c.archived, budget, actual));
  }
  for (const [id, actual] of sums) {
    if (id === UNCATEGORIZED || known.has(id)) continue;
    // 다른 흐름의 카테고리일 수도 있다(입금에 지출 카테고리). 이름을 찾아 붙인다.
    const c = categories.find((x) => x.id === id);
    rows.push(row(id, c ? c.name : '알 수 없는 카테고리', c?.archived ?? false, { source: 'none', amountMinor: null }, actual));
  }
  const loose = sums.get(UNCATEGORIZED) ?? 0;
  if (loose > 0) rows.push(row(UNCATEGORIZED, '미분류', false, { source: 'none', amountMinor: null }, loose));
  return rows;
}

function row(categoryId: string, name: string, archived: boolean, budget: ResolvedBudget, actual: number): BudgetRow {
  const remaining = budget.amountMinor == null ? null : budget.amountMinor - actual;
  return { categoryId, name, archived, budget, actual, remaining, over: remaining !== null && remaining < 0 };
}

export interface BudgetSummary {
  /** 예산이 있는 카테고리의 예산 합. */
  budgeted: number;
  /** 예산이 있는 카테고리의 실제 합. */
  actualInBudgeted: number;
  /** 모든 실제 합 (예산 없는 카테고리 · 미분류 포함). */
  actual: number;
  overCount: number;
}

export function budgetSummary(rows: readonly BudgetRow[]): BudgetSummary {
  const s: BudgetSummary = { budgeted: 0, actualInBudgeted: 0, actual: 0, overCount: 0 };
  for (const r of rows) {
    s.actual += r.actual;
    if (r.budget.amountMinor != null) {
      s.budgeted += r.budget.amountMinor;
      s.actualInBudgeted += r.actual;
    }
    if (r.over) s.overCount++;
  }
  return s;
}

// ---------- 기간 추이 ----------

export interface PeriodSeries {
  period: Period;
  phase: 'past' | 'current' | 'future';
  totals: LedgerTotals;
}

export function periodSeries(entries: readonly Entry[], periods: readonly Period[], today: DateISO): PeriodSeries[] {
  return periods.map((p) => ({
    period: p,
    phase: phaseOf(p, today),
    totals: totalsOf(actualsIn(entries, p.start, p.end)),
  }));
}

export interface CategoryTrend {
  categoryId: string;
  name: string;
  /** 기간마다의 합. `periods` 와 같은 순서다. */
  perPeriod: number[];
  total: number;
  /**
   * 월평균 — **끝난 기간만**의 합 ÷ 끝난 기간 수.
   *
   * 진행 중인 기간을 넣으면 아직 덜 쓴 달이 평균을 끌어내리고, 아직 오지 않은 기간을
   * 넣으면 0 이 평균을 끌어내린다. 끝난 기간이 하나도 없으면 null.
   */
  average: number | null;
  /** 평균에 들어간 기간 수. 화면이 "끝난 N개 기간 평균" 으로 적는다. */
  averagedOver: number;
}

export function categoryTrends(
  entries: readonly Entry[], periods: readonly Period[], categories: readonly Category[],
  side: Side, today: DateISO,
): CategoryTrend[] {
  const perPeriod = periods.map((p) => byCategory(actualsIn(entries, p.start, p.end), side));
  const ids = new Set<string>();
  for (const m of perPeriod) for (const k of m.keys()) ids.add(k);
  const done = periods.map((p) => phaseOf(p, today) === 'past');
  const averagedOver = done.filter(Boolean).length;
  const out: CategoryTrend[] = [];
  for (const id of ids) {
    const values = perPeriod.map((m) => m.get(id) ?? 0);
    const total = values.reduce((a, b) => a + b, 0);
    const doneSum = values.reduce((a, v, i) => (done[i] ? a + v : a), 0);
    const c = categories.find((x) => x.id === id);
    out.push({
      categoryId: id,
      name: id === UNCATEGORIZED ? '미분류' : c ? c.name : '알 수 없는 카테고리',
      perPeriod: values,
      total,
      average: averagedOver > 0 ? Math.round(doneSum / averagedOver) : null,
      averagedOver,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

// ---------- 내역 ----------

export interface HistoryItem {
  /** 화면 키. 반복 발생분이면 `원본id@날짜`. */
  key: string;
  entry: Entry;
  date: DateISO;
  planned: boolean;
  amount: number;
  /** +1 입금 · −1 출금 (표시용. 카드 사용도 −1 로 적는다). */
  sign: 1 | -1 | 0;
}

/**
 * 기간 안의 실제 거래와 예정.
 *
 * 예정은 반복을 펼쳐 담고, 실제 거래로 확정된 회차는 빠진다(`materialize` 가 숨긴다).
 * 기간형 예정은 기간과 겹치면 한 줄로 담는다.
 */
export function historyItems(entries: readonly Entry[], start: DateISO, end: DateISO): HistoryItem[] {
  const out: HistoryItem[] = [];
  const seen = new Set<string>();
  for (const e of materialize(entries.filter((x) => x.kind === 'money' && x.money), start, end)) {
    if (seen.has(e.id) || !e.money) continue;
    const actual = isActual(e);
    const from = e.startDate;
    const to = actual ? from : effectiveEndDate(e);
    if (to < start || from > end) continue;
    seen.add(e.id);
    const sign = MONEY_TYPE_BY_ID[e.money.type]?.sign ?? 0;
    out.push({
      key: e.id, entry: e, date: from < start ? start : from, planned: !actual,
      amount: amountOf(e), sign: sign as 1 | -1 | 0,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)
    || Number(a.planned) - Number(b.planned)
    || b.entry.createdAt.localeCompare(a.entry.createdAt));
}

export interface DayGroup {
  date: DateISO;
  items: HistoryItem[];
  /** 그 날 실제 수입 · 지출(소비 + 금융비용). 예정은 넣지 않는다. */
  income: number;
  spending: number;
}

export function groupByDay(items: readonly HistoryItem[]): DayGroup[] {
  const map = new Map<DateISO, DayGroup>();
  for (const it of items) {
    let g = map.get(it.date);
    if (!g) { g = { date: it.date, items: [], income: 0, spending: 0 }; map.set(it.date, g); }
    g.items.push(it);
    if (!it.planned) {
      if (onSide(it.entry, 'income')) g.income += it.amount;
      if (onSide(it.entry, 'expense')) g.spending += it.amount;
    }
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** 검색. 내역 · 메모 · 결제수단 · 카테고리 이름 · 금액 숫자를 본다. */
export function matchesQuery(e: Entry, q: string, categories: readonly Category[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const cat = e.money?.categoryId ? categories.find((c) => c.id === e.money?.categoryId)?.name ?? '' : '';
  const hay = [e.title, e.note, e.money?.method ?? '', cat, String(e.money?.amountMinor ?? '')]
    .join(' ').toLowerCase();
  const digits = needle.replace(/[,\s원₩]/g, '');
  return hay.includes(needle) || (/^\d+$/.test(digits) && String(e.money?.amountMinor ?? '').includes(digits));
}

/** 흐름의 짧은 이름. 내역 줄에 붙는다. 일반이면 null. */
export function flowBadge(e: Entry): string | null {
  switch (moneyFlowOf(e.money)) {
    case 'cardSpend': return '카드';
    case 'cardPayment': return '카드 대금';
    case 'loanPrincipal': return '대출 원금';
    case 'loanInterest': return '대출 이자';
    case 'transfer': return '이체';
    default: return null;
  }
}
