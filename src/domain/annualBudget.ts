/**
 * 연간 카테고리 예산 (Financial Core P2).
 *
 * ── 네 개를 섞지 않는다 ─────────────────────────────────────────
 *
 *   연간 예산    한 해 이 카테고리에 쓰기로 한 총액       (`AnnualBudget.amountMinor`)
 *   월별 배분    그 총액을 어느 달에 쓸 계획인가          (`monthAllocations`, 선택)
 *   예정 거래    미래 특정 날에 실제로 나갈 돈            (기존 원장의 예정 — 현금흐름에 들어간다)
 *   실제 거래    이미 일어난 소비                        (기존 원장의 실제 — 결산에 들어간다)
 *
 * 앞의 둘은 **계획**이라 잔고 · 예상 잔고 · 가용 한도 · 생활비 · 세이브 어느 계산에도 들어가지 않는다.
 * 이 파일은 `tide` · `budget` 을 import 하지 않는다 — 들어갈 길 자체를 두지 않는다. 월별 배분으로 예정
 * 거래를 만들지도 않는다.
 *
 * ── 실제 사용은 원장의 소비 기준 그대로 ─────────────────────────────
 *
 * 월간 카테고리 예산과 같은 쪽(`ledgerStats.onSide(e, 'expense')` = 소비 + 대출 이자)으로 센다. 대출 원금 ·
 * 이체 · 카드 대금은 소비가 아니라 넣지 않는다. 카드 사용은 쓴 날 소비로 센다. 예정은 실제가 아니다 —
 * 따로 적는다(`plannedMinor`). 확정한 예정 회차는 실제 거래가 대신 센다(`materialize` 가 그 회차를 뺀다).
 *
 * ── 연도는 달력 연도다 ──────────────────────────────────────────
 *
 * 2027년 = 2027-01-01 ~ 2027-12-31. 월별 배분의 4월 = 4/1 ~ 4/30. 월간 예산의 정산 기간(시작일 25일이면
 * 2027년 1월 = 2026/12/25 ~ 2027/1/24)과 경계가 다를 수 있다. 그래서 예산 보기는 정산 기간 이름의 연도
 * (`'2027-01'` → 2027)로 "이 기간에 연간으로 관리하는 카테고리" 를 가르고, 연간 숫자는 늘 달력 연도로 센다.
 * 정산 기간의 숫자와 연간 숫자를 더하지 않는다.
 *
 * ── 월간과 연간은 한 해에 하나 ─────────────────────────────────────
 *
 * 그 해에 연간 예산 문서가 있으면 그 카테고리는 그 해 연간으로 관리한다(`annualCategoryIds`). 예산 보기의
 * 월간 줄 · 요약에서 빠지고 연간 묶음에서 견준다 — 두 예산을 함께 세지 않는다. 그 해의 월간 예산 문서
 * (`CategoryBudget`)는 **지우지도 고치지도 않는다.** 연간 예산을 지우면(월간으로 되돌리면) 그대로 다시 보인다.
 * 다른 해는 영향이 없다 — 2027년을 연간으로 바꿔도 2026년은 월간 그대로다.
 *
 * 주기를 바꾸는 것은 올해와 앞날만이다(`canChangeCycle`). 지난 해를 연간으로 바꾸면 이미 끝난 해의 결산 표시가
 * 바뀐다. 지난 해에 이미 있던 연간 예산의 금액 · 배분은 고칠 수 있다 — 그 해 자기 기록이다.
 */
import { DEFAULT_CURRENCY } from './constants';
import { isActual, isPlanned } from './ledger';
import { actualsIn, onSide } from './ledgerStats';
import { materialize } from './recurrence';
import { sortCategories } from './category';
import type { AnnualBudget, Category, DateISO, Entry, MonthNo, PeriodKey } from './types';

export const MONTH_NOS: readonly MonthNo[] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

/** 연도 범위. 규칙도 같은 범위를 받는다. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export function annualBudgetId(categoryId: string, year: number): string {
  return `${categoryId}~${year}`;
}

export function newAnnualBudget(
  categoryId: string, year: number, amountMinor: number,
  monthAllocations: Partial<Record<MonthNo, number>> = {}, now = new Date().toISOString(),
): AnnualBudget {
  return {
    id: annualBudgetId(categoryId, year),
    categoryId, year, amountMinor,
    monthAllocations: cleanAllocations(monthAllocations),
    currency: DEFAULT_CURRENCY, createdAt: now, updatedAt: now,
  };
}

/** 배분에서 0 · 빈 값을 뺀다. 키가 없는 달이 "배분 없음" 이다 — 0 을 따로 두지 않는다. */
export function cleanAllocations(m: Partial<Record<MonthNo, number>>): Partial<Record<MonthNo, number>> {
  const out: Partial<Record<MonthNo, number>> = {};
  for (const k of MONTH_NOS) {
    const v = m[k];
    if (typeof v === 'number' && v > 0) out[k] = v;
  }
  return out;
}

export function allocatedTotal(b: Pick<AnnualBudget, 'monthAllocations'>): number {
  let t = 0;
  for (const k of MONTH_NOS) t += b.monthAllocations[k] ?? 0;
  return t;
}

/** 미배분 = 연간 예산 − 월별 배분 합. 배분이 없으면 연간 예산 전체다. */
export function unallocatedOf(b: Pick<AnnualBudget, 'amountMinor' | 'monthAllocations'>): number {
  return b.amountMinor - allocatedTotal(b);
}

/**
 * 저장할 수 있는가. 이유가 있으면 그 이유를, 없으면 null.
 *
 *   amount         연간 예산이 0 이상의 안전한 정수가 아니다
 *   allocation     배분 금액이 1 이상의 안전한 정수가 아니다
 *   over-allocated 배분 합이 연간 예산을 넘는다
 *   year           연도가 범위 밖이다
 */
export type AnnualBudgetProblem = 'amount' | 'allocation' | 'over-allocated' | 'year';

export function annualBudgetProblem(b: Pick<AnnualBudget, 'amountMinor' | 'monthAllocations' | 'year'>): AnnualBudgetProblem | null {
  if (!Number.isSafeInteger(b.year) || b.year < MIN_YEAR || b.year > MAX_YEAR) return 'year';
  if (!Number.isSafeInteger(b.amountMinor) || b.amountMinor < 0) return 'amount';
  for (const [k, v] of Object.entries(b.monthAllocations)) {
    if (!(MONTH_NOS as readonly string[]).includes(k)) return 'allocation';
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) return 'allocation';
  }
  if (allocatedTotal(b) > b.amountMinor) return 'over-allocated';
  return null;
}

/** 달력 연도의 첫날 · 마지막날. */
export function yearRange(year: number): { start: DateISO; end: DateISO } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** 그 달(달력 월)의 첫날 · 마지막날. */
export function monthRange(year: number, month: MonthNo): { start: DateISO; end: DateISO } {
  const last = new Date(year, Number(month), 0).getDate();
  return { start: `${year}-${month}-01`, end: `${year}-${month}-${String(last).padStart(2, '0')}` };
}

/** 정산 기간 이름의 연도 — 예산 보기가 "이 기간의 연간 예산" 을 고르는 기준. */
export function yearOfPeriod(key: PeriodKey): number {
  return Number(key.slice(0, 4));
}

/** 그 해에 연간으로 관리하는 카테고리. 월간 줄 · 요약에서 빼는 데 쓴다. */
export function annualCategoryIds(budgets: readonly AnnualBudget[], year: number): ReadonlySet<string> {
  return new Set(budgets.filter((b) => b.year === year).map((b) => b.categoryId));
}

export function annualBudgetFor(
  budgets: readonly AnnualBudget[], categoryId: string, year: number,
): AnnualBudget | null {
  return budgets.find((b) => b.categoryId === categoryId && b.year === year) ?? null;
}

/** 월간 ↔ 연간을 바꿀 수 있는 해인가 — 올해와 앞날. */
export function canChangeCycle(year: number, today: DateISO): boolean {
  return year >= Number(today.slice(0, 4));
}

// ---------- 견주기 ----------

export interface AnnualMonth {
  month: MonthNo;
  /** 그 달 배분. 없으면 null. */
  allocation: number | null;
  /** 그 달(달력 월)의 실제 사용. */
  actual: number;
  /** 그 달의 예정(확정하지 않은 회차). 실제와 따로 적는다. */
  planned: number;
}

export interface AnnualRow {
  budget: AnnualBudget;
  categoryId: string;
  name: string;
  archived: boolean;
  /** 그 해의 실제 사용. */
  actual: number;
  /** 그 해의 남은 예정. 실제 사용에 넣지 않는다. */
  planned: number;
  /** 연간 예산 − 실제 사용. 음수면 초과다. */
  remaining: number;
  over: boolean;
  allocated: number;
  unallocated: number;
  months: AnnualMonth[];
}

const amt = (e: Entry) => Math.abs(e.money?.amountMinor ?? 0);
const catOf = (e: Entry) => e.money?.categoryId || '';

/**
 * 그 해 연간 예산마다 실제 · 예정 · 남음 · 달별 배분 대비.
 *
 * `entries` 는 그 해를 덮는 **원본**이다(반복 원본 포함). 반복 예정은 여기서 그 해 안으로 펼쳐 센다 —
 * 화면용으로 펼친 목록을 받으면 반복이 한 번 더 펼쳐진다. 실제 거래는 같은 문서가 두 번 와도 한 번만 센다.
 */
export function annualRows(
  categories: readonly Category[], budgets: readonly AnnualBudget[],
  entries: readonly Entry[], year: number,
): AnnualRow[] {
  const { start, end } = yearRange(year);
  const actuals = actualsIn(entries, start, end).filter((e) => onSide(e, 'expense'));
  const planned = materialize(entries, start, end)
    .filter((e) => isPlanned(e) && !isActual(e) && onSide(e, 'expense')
      && e.startDate >= start && e.startDate <= end);
  const ofYear = budgets.filter((b) => b.year === year);
  const order = new Map(sortCategories(categories).map((c, i) => [c.id, i]));
  const rows = ofYear.map((b): AnnualRow => {
    const c = categories.find((x) => x.id === b.categoryId);
    const mine = actuals.filter((e) => catOf(e) === b.categoryId);
    const minePlanned = planned.filter((e) => catOf(e) === b.categoryId);
    const actual = mine.reduce((t, e) => t + amt(e), 0);
    const months = MONTH_NOS.map((m): AnnualMonth => {
      const r = monthRange(year, m);
      const inMonth = (e: Entry) => e.startDate >= r.start && e.startDate <= r.end;
      return {
        month: m,
        allocation: b.monthAllocations[m] ?? null,
        actual: mine.filter(inMonth).reduce((t, e) => t + amt(e), 0),
        planned: minePlanned.filter(inMonth).reduce((t, e) => t + amt(e), 0),
      };
    });
    const allocated = allocatedTotal(b);
    return {
      budget: b,
      categoryId: b.categoryId,
      name: c ? c.name : '알 수 없는 카테고리',
      archived: c?.archived ?? false,
      actual,
      planned: minePlanned.reduce((t, e) => t + amt(e), 0),
      remaining: b.amountMinor - actual,
      over: actual > b.amountMinor,
      allocated,
      unallocated: b.amountMinor - allocated,
      months,
    };
  });
  return rows.sort((a, b) => (order.get(a.categoryId) ?? 9999) - (order.get(b.categoryId) ?? 9999)
    || a.name.localeCompare(b.name, 'ko'));
}

export interface AnnualSummary {
  budgeted: number;
  actual: number;
  planned: number;
  overCount: number;
}

export function annualSummary(rows: readonly AnnualRow[]): AnnualSummary {
  const s: AnnualSummary = { budgeted: 0, actual: 0, planned: 0, overCount: 0 };
  for (const r of rows) {
    s.budgeted += r.budget.amountMinor;
    s.actual += r.actual;
    s.planned += r.planned;
    if (r.over) s.overCount++;
  }
  return s;
}

/**
 * 정산 기간의 월간 예산 줄에서 그 해 연간으로 관리하는 카테고리를 뺀다. 빠진 줄은 연간 묶음이 견준다 —
 * 같은 카테고리를 월간 요약과 연간 요약에 함께 세지 않는다. 월간 예산 문서는 건드리지 않는다.
 */
export function withoutAnnual<T extends { categoryId: string }>(rows: readonly T[], annualIds: ReadonlySet<string>): T[] {
  return rows.filter((r) => !annualIds.has(r.categoryId));
}
