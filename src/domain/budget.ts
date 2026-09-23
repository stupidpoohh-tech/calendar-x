/**
 * 생활비 예산과 세이브 — 가용 한도에서 미리 빠져 있는 돈.
 *
 * ── 예산은 기간형 지출이 아니다 ─────────────────────────────────
 *
 * 예전에는 생활비가 `sign: -1` 인 기간형 지출이었다. 그래서 9월 생활비 70만을 적고
 * 점심 1만 2천을 적으면 **71만 2천**이 나가는 것으로 셌다. 사용자가 원한 것은 그게
 * 아니다 — 70만을 확보해 두고 그 안에서 1만 2천을 쓰면 68만 8천이 남는 것이다.
 * 나가는 돈의 총량은 여전히 70만이다.
 *
 * ── 가용 한도에 대한 몫 ────────────────────────────────────────
 *
 * 예산 하나가 한도에서 차지하는 자리는 `max(총 예산, 쓴 돈)` 이다.
 *
 *   예산 700,000 · 쓴 돈      0  →  700,000 을 확보 (한도 −700,000)
 *   예산 700,000 · 쓴 돈 12,000  →  여전히 700,000 (한도 그대로)
 *   예산 700,000 · 쓴 돈 720,000 →  720,000 (초과 20,000 만큼만 더 깎인다)
 *
 * 예산에 연결된 지출은 **일반 지출 합계에서 빠진다.** 그러지 않으면 예산으로 한 번,
 * 지출로 또 한 번 세어진다.
 *
 * ── 이미 통장에서 빠져나간 몫 ───────────────────────────────────
 *
 * 잔고는 적은 날의 사실이다. 그 날까지 나간 예산 지출은 이미 잔고에 반영돼 있으므로
 * 한도에서 또 빼면 안 된다. 그래서 한도에서 빼는 값은
 * `max(총 예산, 쓴 돈) − 이미 잔고에 반영된 지출` 이다.
 *
 *   잔고 3,000,000 (오늘 기준) · 예산 700,000 · 오늘 12,000 씀
 *     → 아직 통장에서 안 빠졌다. 몫 700,000. 한도 2,300,000
 *   잔고를 2,988,000 으로 다시 적음 (12,000 이 빠진 뒤)
 *     → 몫 700,000 − 12,000 = 688,000. 한도 2,988,000 − 688,000 = 2,300,000
 *
 * 어느 쪽이든 한도는 2,300,000 이다. 예산 안에서 쓰는 한 한도는 움직이지 않는다.
 *
 * ── 세이브 ────────────────────────────────────────────────────
 *
 * 잔고에는 있지만 쓰지 않기로 떼어 둔 돈이다. 날짜가 없으므로 언제나 한도에서 빠진다.
 * 잔고 자체는 건드리지 않는다 — 통장에는 그대로 있기 때문이다.
 */
import { DEFAULT_CURRENCY } from './constants';
import { endOfMonth, parseDate, startOfMonth, todayISO, toISO } from './date';
import { uid } from './entry';
import type { Budget, DateISO, Entry, Reserve } from './types';

/**
 * 이 지출이 그 예산에서 나가는가.
 *
 * 세 가지를 모두 만족해야 한다.
 *   1. `budgetId` 가 그 예산을 가리킨다
 *   2. 날짜가 예산 기간 **안**에 있다 — 기간 밖 지출은 일반 지출이다
 *   3. 반복 항목이 아니다 — 주머니 하나에 몇 번 들어갈지가 애매해진다
 *
 * 2번과 3번이 어긋나면 일반 지출로 돌아간다. 어디에도 안 세어지는 돈은 만들지 않는다.
 */
export function inBudget(entry: Entry, budget: Budget): boolean {
  const m = entry.money;
  if (!m || m.budgetId !== budget.id) return false;
  if (entry.recurrence) return false;
  return entry.startDate >= budget.startDate && entry.startDate <= budget.endDate;
}

/** 이 지출이 **어느** 예산엔가 속하는가. 일반 지출 합계에서 빼는 판정에 쓴다. */
export function inAnyBudget(entry: Entry, budgets: readonly Budget[]): boolean {
  return budgets.some((b) => inBudget(entry, b));
}

/** 예산에 연결된 실제 지출. 날짜 오름차순이다. */
export function spendingIn(budget: Budget, entries: readonly Entry[]): Entry[] {
  return entries
    .filter((e) => inBudget(e, budget))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
}

/** 예산 하나의 상태. 화면이 그대로 그릴 수 있는 값만 담는다. */
export interface BudgetState {
  budget: Budget;
  /** 연결된 지출의 합. */
  spentMinor: number;
  /** 남은 예산. 초과했으면 0. */
  remainingMinor: number;
  /** 예산을 넘긴 금액. 넘지 않았으면 0. */
  overspentMinor: number;
  /** 연결된 지출 건수. */
  count: number;
}

export function budgetState(budget: Budget, entries: readonly Entry[]): BudgetState {
  const linked = spendingIn(budget, entries);
  const spentMinor = linked.reduce((t, e) => t + Math.abs(e.money?.amountMinor ?? 0), 0);
  return {
    budget,
    spentMinor,
    remainingMinor: Math.max(0, budget.amountMinor - spentMinor),
    overspentMinor: Math.max(0, spentMinor - budget.amountMinor),
    count: linked.length,
  };
}

export function budgetStates(
  budgets: readonly Budget[], entries: readonly Entry[],
): BudgetState[] {
  return budgets
    .map((b) => budgetState(b, entries))
    .sort((a, b) => a.budget.startDate.localeCompare(b.budget.startDate));
}

/** 기간이 `date` 를 품는가. 지금 돌고 있는 예산을 고를 때 쓴다. */
export function budgetCovers(budget: Budget, date: DateISO): boolean {
  return budget.startDate <= date && date <= budget.endDate;
}

/**
 * 예산과 세이브가 `date` 시점의 한도에서 차지하는 자리. **양수**로 돌려준다.
 *
 * @param unsettledAfter 잔고가 말해 주는 마지막 날. 이 날까지 나간 예산 지출은 이미
 *   잔고에 반영돼 있으므로 몫에서 뺀다.
 */
export function reservedOn(
  budgets: readonly Budget[], reserves: readonly Reserve[],
  entries: readonly Entry[], date: DateISO, unsettledAfter: DateISO,
): number {
  let total = 0;

  for (const budget of budgets) {
    // 아직 시작하지 않은 예산은 자리를 잡지 않는다 — 기간형 지출과 같은 규칙이다.
    if (budget.startDate > date) continue;

    const linked = spendingIn(budget, entries);
    const spent = linked.reduce((t, e) => t + Math.abs(e.money?.amountMinor ?? 0), 0);
    // 잔고에 이미 반영된 지출. 여기서 또 빼면 두 번 빠진다.
    const settled = linked
      .filter((e) => e.startDate <= unsettledAfter)
      .reduce((t, e) => t + Math.abs(e.money?.amountMinor ?? 0), 0);

    total += Math.max(budget.amountMinor, spent) - settled;
  }

  // 세이브는 날짜가 없다. 언제 보든 같은 금액이 묶여 있다.
  for (const r of reserves) total += r.amountMinor;

  return total;
}

/** 세이브 총액. 카드가 한 줄로 보여 준다. */
export function reservedTotal(reserves: readonly Reserve[]): number {
  return reserves.reduce((t, r) => t + r.amountMinor, 0);
}

// ---------- 만들기 ----------

/**
 * 새 생활비 예산.
 *
 * 기본 기간은 이 달 전체다 — 사용자가 손으로 고칠 수 있지만, 가장 흔한 경우에
 * 날짜 두 칸을 다 채우게 하지 않는다.
 */
export function newBudget(patch: Partial<Budget> = {}): Budget {
  const now = new Date().toISOString();
  const today = todayISO();
  return {
    id: uid(),
    name: '생활비',
    startDate: monthBound(today, 'start'),
    endDate: monthBound(today, 'end'),
    amountMinor: 0,
    currency: DEFAULT_CURRENCY,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

/** 그 날이 든 달의 첫날 · 마지막날. 날짜를 못 읽으면 그 날 자체를 쓴다. */
function monthBound(iso: DateISO, which: 'start' | 'end'): DateISO {
  const d = parseDate(iso);
  if (!d) return iso;
  return toISO(which === 'start' ? startOfMonth(d) : endOfMonth(d));
}

export function newReserve(patch: Partial<Reserve> = {}): Reserve {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: '세이브',
    amountMinor: 0,
    currency: DEFAULT_CURRENCY,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}
