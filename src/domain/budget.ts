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
 * ── 끝난 주머니 ────────────────────────────────────────────────
 *
 * 주머니는 **그 기간 안에 쓸 돈**을 미리 떼어 두는 것이다. 기간이 끝나면(오늘 > 종료일)
 * 쓰지 않은 잔액은 더 이상 떼어 둘 이유가 없다 — 예전에는 그 잔액이 끝난 뒤에도 영영
 * 한도에서 빠져 있었다. 다만 그 주머니에 걸린 지출 중 **아직 잔고에 반영되지 않은 것**은
 * 실제로 나갈(또는 이미 나간) 돈이라 계속 센다. 걸린 지출은 일반 지출 합계에서 빠지므로,
 * 여기서마저 빼면 어디에서도 세어지지 않는다.
 *
 *   진행 중 · 앞으로     max(총 예산, 쓴 돈) − 잔고에 반영된 지출
 *   끝남                쓴 돈 − 잔고에 반영된 지출   (남은 잔액의 예약은 풀린다)
 *
 *   예) 9월 생활비 700,000 · 쓴 돈 500,000(모두 잔고에 반영) · 오늘 10/13
 *       예전: 200,000 을 계속 예약   지금: 0
 *
 * 종료일 당일까지는 진행 중이다 — 그날 쓸 돈이 남아 있을 수 있다.
 *
 * ── 세이브 ────────────────────────────────────────────────────
 *
 * 잔고에는 있지만 쓰지 않기로 떼어 둔 돈이다. 날짜가 없으므로 언제나 한도에서 빠진다.
 * 잔고 자체는 건드리지 않는다 — 통장에는 그대로 있기 때문이다.
 */
import { DEFAULT_CURRENCY } from './constants';
import { endOfMonth, parseDate, startOfMonth, todayISO, toISO } from './date';
import { uid } from './entry';
import {
  balanceInclusion, confirmedKey, confirmedSetOf, isActual, moneyFlowOf,
} from './ledger';
import type { Account, Budget, DateISO, Entry, Reserve } from './types';

/**
 * 이 지출이 그 예산에서 나가는가.
 *
 * 네 가지를 모두 만족해야 한다.
 *   1. `budgetId` 가 그 예산을 가리킨다
 *   2. 날짜가 예산 기간 **안**에 있다 — 기간 밖 지출은 일반 지출이다
 *   3. 반복 항목이 아니다 — 주머니 하나에 몇 번 들어갈지가 애매해진다
 *   4. 카드 사용이 아니다 — 카드 사용의 현금은 나중에 카드 대금으로 나간다. 주머니가
 *      그 사용을 쓴 돈으로 세면, 대금이 나갈 때 일반 지출로 한 번 더 빠진다.
 *
 * 2~4번이 어긋나면 일반 지출로 돌아간다. 어디에도 안 세어지는 돈은 만들지 않는다.
 */
export function inBudget(entry: Entry, budget: Budget): boolean {
  const m = entry.money;
  if (!m || m.budgetId !== budget.id) return false;
  if (entry.recurrence) return false;
  if (moneyFlowOf(m) === 'cardSpend') return false;
  return entry.startDate >= budget.startDate && entry.startDate <= budget.endDate;
}

/** 이 지출이 **어느** 예산엔가 속하는가. 일반 지출 합계에서 빼는 판정에 쓴다. */
export function inAnyBudget(entry: Entry, budgets: readonly Budget[]): boolean {
  return budgets.some((b) => inBudget(entry, b));
}

/**
 * 예산에 연결된 지출. 날짜 오름차순이다.
 *
 * 실제 거래로 확정된 예정은 빠진다 — 같은 지출이 예정과 실제로 두 번 세어지면 주머니가
 * 두 배로 빈다. 확정을 지우면 예정이 다시 들어온다.
 */
export function spendingIn(
  budget: Budget, entries: readonly Entry[],
  confirmed: ReadonlySet<string> = confirmedSetOf(entries),
): Entry[] {
  return entries
    .filter((e) => inBudget(e, budget))
    .filter((e) => isActual(e) || !confirmed.has(confirmedKey(e.id, e.startDate)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
}

/**
 * 그 주머니 기간 안의 실제 지출인데 어느 주머니에도 걸려 있지 않은 것.
 *
 * 생활비에서 쓴 돈을 연결하지 않으면 그 돈은 일반 지출로 한도를 한 번 더 깎고, 주머니는
 * 쓴 것이 없는 것처럼 남는다. 자동으로 걸지 않는다 — 여행 경비처럼 생활비가 아닌 지출일
 * 수 있다. 화면이 보여 주고 사용자가 고른다.
 */
export function unlinkedSpendingFor(budget: Budget, entries: readonly Entry[]): Entry[] {
  return entries
    .filter((e) => isActual(e) && e.money?.type === 'expense'
      && moneyFlowOf(e.money) === 'normal'
      && !e.money.budgetId && !e.money.debtId && !e.recurrence
      && e.startDate >= budget.startDate && e.startDate <= budget.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * 예산 하나의 상태. 화면이 그대로 그릴 수 있는 값만 담는다.
 *
 * ── 사용 · 예정 · 현금 · 예약은 서로 다른 숫자다 ──────────────────
 *
 * 예전에는 연결된 지출을 실제 · 예정 가리지 않고 `spentMinor` 하나로 더해 "사용" 으로
 * 적었다. 다음 주에 잡아 둔 예정까지 이미 쓴 돈처럼 보였다. 지금은 갈라 둔다.
 *
 *   actualMinor     실제로 쓴 돈. "남은 생활비" 는 이것만 뺀다
 *   plannedMinor    아직 확정하지 않은 예정. 쓴 돈이 아니다
 *   settledMinor    실제 지출 가운데 이미 잔고에 반영된 것 — 통장에서 이미 빠졌다
 *   unsettledMinor  실제 지출 가운데 아직 잔고 밖인 것 — 예상 잔고가 이만큼 더 줄어든다
 *   reservedMinor   생활비 외 가용 한도에서 지금 빠져 있는 몫 (`pocketReserve`)
 *
 * 생활비를 만드는 것만으로는 잔고도 예상 잔고도 줄지 않는다. 줄어드는 것은 가용 한도뿐이다.
 */
export interface BudgetState {
  budget: Budget;
  /** 실제로 쓴 돈. */
  actualMinor: number;
  /** 아직 확정하지 않은 예정 지출. */
  plannedMinor: number;
  /** 실제 지출 중 잔고에 반영된 것. */
  settledMinor: number;
  /** 실제 지출 중 아직 잔고 밖인 것. */
  unsettledMinor: number;
  /** 남은 생활비 = 총 예산 − 실제로 쓴 돈. 넘겼으면 0. */
  remainingMinor: number;
  /** 실제로 넘긴 금액. 넘지 않았으면 0. */
  overspentMinor: number;
  /** 예정까지 다 쓰면 넘게 되는 금액. 실제 초과와 따로 적는다. */
  plannedOverMinor: number;
  /** 가용 한도에서 빠져 있는 몫. `today` 를 주지 않으면 끝나지 않은 것으로 본다. */
  reservedMinor: number;
  /** 연결된 지출 건수(실제 + 예정). */
  count: number;
}

const amt = (e: Entry) => Math.abs(e.money?.amountMinor ?? 0);

/**
 * 주머니 하나가 가용 한도에서 차지하는 몫. **양수**.
 *
 *   진행 중 · 앞으로   max(총 예산, 실제 + 예정) − 잔고에 반영된 지출
 *   끝남              (실제 + 예정) − 잔고에 반영된 지출
 *
 * 잔고에 반영된 지출을 빼는 것이 이중 차감을 막는 자리다 — 그 돈은 이미 잔고에서 빠졌다.
 * 반영되지 않은 실제 지출은 이 몫 안에 남아 있고, 예상 잔고 쪽에서는 현금으로 빠진다.
 * 두 숫자는 다른 질문에 답하므로 둘 다에 있는 것이 맞다(가용 한도는 예상 잔고가 아니라
 * 확인 잔고에서 출발해 연결 지출을 일반 흐름에서 빼고 센다 — `tide.limitOn`).
 */
export function pocketReserve(
  budget: Budget, linked: readonly Entry[], inBalance: (e: Entry) => boolean, ended: boolean,
): number {
  const spent = linked.reduce((t, e) => t + amt(e), 0);
  const settled = linked.filter(inBalance).reduce((t, e) => t + amt(e), 0);
  return (ended ? spent : Math.max(budget.amountMinor, spent)) - settled;
}

/** 실제 거래는 잔고 반영 여부로, 예정은 날짜로 가른다 — `reservedOn` 과 같은 판정. */
function inBalanceOf(accounts: readonly Account[] | undefined, unsettledAfter: DateISO | undefined) {
  return (e: Entry): boolean => {
    if (accounts && isActual(e)) return balanceInclusion(e, accounts) === 'in';
    return unsettledAfter !== undefined && e.startDate <= unsettledAfter;
  };
}

export function budgetState(
  budget: Budget, entries: readonly Entry[],
  confirmed: ReadonlySet<string> = confirmedSetOf(entries),
  opts: { accounts?: readonly Account[]; today?: DateISO; unsettledAfter?: DateISO } = {},
): BudgetState {
  const linked = spendingIn(budget, entries, confirmed);
  const actual = linked.filter((e) => isActual(e));
  const actualMinor = actual.reduce((t, e) => t + amt(e), 0);
  const plannedMinor = linked.filter((e) => !isActual(e)).reduce((t, e) => t + amt(e), 0);
  const inBalance = inBalanceOf(opts.accounts, opts.unsettledAfter);
  const settledMinor = opts.accounts
    ? actual.filter((e) => balanceInclusion(e, opts.accounts!) === 'in').reduce((t, e) => t + amt(e), 0)
    : 0;
  const ended = opts.today !== undefined && budgetEnded(budget, opts.today);
  return {
    budget,
    actualMinor,
    plannedMinor,
    settledMinor,
    // 계좌를 모르면 반영 여부도 모른다. 둘 다 0 으로 두고 화면은 적지 않는다.
    unsettledMinor: opts.accounts ? actualMinor - settledMinor : 0,
    remainingMinor: Math.max(0, budget.amountMinor - actualMinor),
    overspentMinor: Math.max(0, actualMinor - budget.amountMinor),
    plannedOverMinor: Math.max(0, actualMinor + plannedMinor - budget.amountMinor),
    reservedMinor: pocketReserve(budget, linked, inBalance, ended),
    count: linked.length,
  };
}

export function budgetStates(
  budgets: readonly Budget[], entries: readonly Entry[],
  opts: { accounts?: readonly Account[]; today?: DateISO; unsettledAfter?: DateISO } = {},
): BudgetState[] {
  const confirmed = confirmedSetOf(entries);
  return budgets
    .map((b) => budgetState(b, entries, confirmed, opts))
    .sort((a, b) => a.budget.startDate.localeCompare(b.budget.startDate));
}

/** 끝났는가 — 오늘이 종료일을 지났다. 끝난 주머니는 남은 잔액을 예약하지 않는다. */
export function budgetEnded(budget: Budget, today: DateISO): boolean {
  return budget.endDate < today;
}

/** 기간이 `date` 를 품는가. 지금 돌고 있는 예산을 고를 때 쓴다. */
export function budgetCovers(budget: Budget, date: DateISO): boolean {
  return budget.startDate <= date && date <= budget.endDate;
}

/**
 * 예산과 세이브가 `date` 시점의 한도에서 차지하는 자리. **양수**로 돌려준다.
 *
 * @param unsettledAfter 잔고가 말해 주는 마지막 날. 이 날까지 나간 예산 **예정**
 *   지출은 이미 잔고에 반영돼 있으므로 몫에서 뺀다.
 * @param accounts 실제 거래가 잔고에 들어 있는지 가르는 데 쓴다 (`ledger.balanceInclusion`).
 *   실제 거래는 날짜가 아니라 그 판정으로 반영 여부를 정한다 — 기준일 당일 거래를 날짜로
 *   가르면 두 번 빠지거나 한 번도 안 빠진다. 주지 않으면 실제 거래도 날짜로 가른다.
 */
export function reservedOn(
  budgets: readonly Budget[], reserves: readonly Reserve[],
  entries: readonly Entry[], date: DateISO, unsettledAfter: DateISO,
  accounts?: readonly Account[],
  /** 오늘. 이 날이 종료일을 지난 주머니는 남은 잔액의 예약을 푼다. 없으면 풀지 않는다. */
  today?: DateISO,
): number {
  let total = 0;
  const confirmed = confirmedSetOf(entries);
  const inBalance = (e: Entry): boolean => (accounts && isActual(e)
    ? balanceInclusion(e, accounts) === 'in'
    : e.startDate <= unsettledAfter);

  for (const budget of budgets) {
    // 아직 시작하지 않은 예산은 자리를 잡지 않는다 — 기간형 지출과 같은 규칙이다.
    if (budget.startDate > date) continue;
    const ended = today !== undefined && budgetEnded(budget, today);
    total += pocketReserve(budget, spendingIn(budget, entries, confirmed), inBalance, ended);
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
