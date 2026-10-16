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
import type { Account, Budget, DateISO, Entry, Reserve, ReservePatch } from './types';

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
 * 주머니에 걸 수 있는 지출인가 — **일반** 지출만.
 *
 * 수입 · 대출 원금 · 대출 이자 · 이체(저축) · 카드 대금 · 카드 사용은 걸지 않는다. 대출 연결이
 * 있거나 반복이면 걸지 않는다. legacy 종류(`living` · `save` · `free` · `repay` · `priority`)도
 * 걸지 않는다 — 무엇인지 코드로 정할 수 없다.
 *
 * 카드 사용을 막는 이유: 카드 대금과 이어 줄 연결 정보가 없다. 걸면 주머니(사용)와 일반 흐름
 * (대금)에서 같은 돈이 두 번 빠지고, 대금을 낸 뒤에도 주머니가 그 채무를 계속 잡아 둔다.
 *
 * 이 판정은 **새로 고르는 자리**(자동 선택 · 고를 칩)에만 쓴다. 이미 저장된 연결은 건드리지
 * 않는다 — 계산은 지금처럼 `inBudget` 이 정한다.
 */
export function pocketEligible(e: Pick<Entry, 'money' | 'recurrence'>): boolean {
  const m = e.money;
  if (!m || m.type !== 'expense' || m.debtId || e.recurrence) return false;
  return moneyFlowOf(m) === 'normal';
}

/** 사용처 — 주머니에 걸렸는가, 생활비 밖으로 명시했는가, 아직 정하지 않았는가. */
export type PocketUse = 'linked' | 'outside' | 'undecided';

export function pocketUseOf(e: Pick<Entry, 'money'>): PocketUse {
  if (e.money?.budgetId) return 'linked';
  return e.money?.outsidePocket ? 'outside' : 'undecided';
}

/**
 * 새 실제 지출의 주머니 기본값 — 그 날을 품는 주머니가 **하나**일 때만 고른다.
 *
 * 여럿이면 고르지 않는다(넘겨짚으면 다른 주머니의 남은 금액이 틀린다). 마지막에 고른 주머니를
 * 다시 쓰지도 않는다. 사용자가 "생활비 외" 로 명시했거나 이미 골라 둔 것은 덮지 않는다.
 */
export function defaultPocketFor(
  e: Pick<Entry, 'money' | 'recurrence' | 'startDate' | 'kind'>, budgets: readonly Budget[],
): string | null {
  const m = e.money;
  if (!m || !isActual(e) || !pocketEligible(e)) return m?.budgetId ?? null;
  // 세이브에 건 지출(P3)도 사용처를 이미 정한 것이다 — 주머니를 덮어 고르지 않는다.
  if (m.budgetId || m.outsidePocket || m.reserveId) return m.budgetId ?? null;
  const covering = budgets.filter((b) => budgetCovers(b, e.startDate));
  return covering.length === 1 ? covering[0]!.id : null;
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
      // 일부러 생활비 밖에 둔 것은 경고하지 않는다 — 정하지 않은 것만 보여 준다.
      && !e.money.outsidePocket
      // 세이브에서 쓴 지출(P3)은 사용처를 정한 것이다 — 미결정으로 경고하지 않는다.
      && !e.money.reserveId
      && e.startDate >= budget.startDate && e.startDate <= budget.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * 주머니의 기간을 바꾸면 걸린 거래가 어떻게 되는가 (P1-E).
 *
 *   leaving   지금은 주머니에서 세어지는데 새 기간 밖으로 나가는 거래. 저장 전에 고르게 한다 —
 *             연결 유지(기간 밖이라 일반 지출로 센다) · 연결 해제(미결정) · 다른 주머니로 옮기기.
 *   entering  연결은 돼 있지만 지금은 기간 밖이라 일반 지출로 세어지다가, 새 기간에 다시 들어오는
 *             거래. 고르지 않고 알린다 — 사용자가 걸어 둔 연결이다.
 *   targets   leaving 의 거래마다 그 날을 품는 **다른** 주머니가 정확히 하나일 때 그 id.
 *             하나라도 없거나 여럿이면 null — 옮기기를 제안하지 않는다(넘겨짚지 않는다).
 *
 * 금액만 바꾸면 둘 다 비고, 계산이 그대로 다시 돈다.
 */
export interface PocketPeriodImpact {
  leaving: Entry[];
  entering: Entry[];
  targets: Map<string, string> | null;
}

export function pocketPeriodImpact(
  before: Budget, after: Budget, linked: readonly Entry[], budgets: readonly Budget[],
): PocketPeriodImpact {
  const mine = linked.filter((e) => e.money?.budgetId === before.id);
  const leaving = mine.filter((e) => inBudget(e, before) && !inBudget(e, after));
  const entering = mine.filter((e) => !inBudget(e, before) && inBudget(e, after));
  const others = budgets.filter((b) => b.id !== before.id);
  let targets: Map<string, string> | null = new Map();
  for (const e of leaving) {
    const covering = others.filter((b) => budgetCovers(b, e.startDate));
    if (covering.length !== 1) { targets = null; break; }
    targets.set(e.id, covering[0]!.id);
  }
  if (leaving.length === 0) targets = null;
  return { leaving: sortByDate(leaving), entering: sortByDate(entering), targets };
}

/** 주머니 연결을 푼 거래 — 미결정으로 돌아간다. "생활비 외" 로 바꾸지 않는다(사용자가 정한 적 없다). */
export function unlinkedFromPocket(e: Entry, now: string): Entry {
  return { ...e, updatedAt: now, money: e.money ? { ...e.money, budgetId: null } : e.money };
}

/** 세이브 연결을 푼 거래(P3). 거래 자체 · 금액 · 생활비 사용처는 그대로다. */
export function unlinkedFromReserve(e: Entry, now: string): Entry {
  return { ...e, updatedAt: now, money: e.money ? { ...e.money, reserveId: null } : e.money };
}

/** 다른 주머니로 옮긴 거래. */
export function movedToPocket(e: Entry, budgetId: string, now: string): Entry {
  return { ...e, updatedAt: now, money: e.money ? { ...e.money, budgetId, outsidePocket: false } : e.money };
}

function sortByDate(es: Entry[]): Entry[] {
  return es.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
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
  /** 예정 반영 잔여 = 총 예산 − 실제 − 예정. 넘으면 0 (그때는 `plannedOverMinor`). */
  remainingWithPlannedMinor: number;
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
    remainingWithPlannedMinor: Math.max(0, budget.amountMinor - actualMinor - plannedMinor),
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
  /**
   * 세이브마다 연결된 실제 지출의 합(`reserveUsageOf`). 계산 창이 아니라 **연결된 거래 전량**에서 센 값이어야
   * 한다 — 창 밖의 지난 사용이 빠지면 남은 금액이 실제보다 크게 잡힌다. 없으면 사용액 0(P3 이전과 같다).
   */
  reserveUsage: ReadonlyMap<string, number> = NO_USAGE,
): number {
  let total = 0;
  const confirmed = confirmedSetOf(entries);
  const inBalance = (e: Entry): boolean => (accounts && isActual(e)
    ? balanceInclusion(e, accounts) === 'in'
    : e.startDate <= unsettledAfter);

  for (const budget of budgets) {
    // 아직 시작하지 않은 예산은 자리를 잡지 않는다 — 기간형 지출과 같은 규칙이다.
    if (budget.startDate > date) continue;
    /*
      끝났는지는 **조회하는 날** 기준이다(P1). 10/10~14 생활비를 10/15 로 조회하면 남은 확보액은
      이미 풀려 있다. 예전에는 실제 오늘로만 판정해, 미래 날짜를 조회해도 끝난 주머니가 계속
      예약돼 있었다. 오늘이 이미 지났으면 당연히 끝났다(조회일이 오늘보다 앞서는 경우는 없지만
      그때도 오늘 기준의 해제를 되돌리지 않는다).
      예약 해제는 거래 취소가 아니다 — 걸린 지출 중 잔고 밖인 것은 몫에 그대로 남는다.
    */
    const ended = budget.endDate < date || (today !== undefined && budgetEnded(budget, today));
    total += pocketReserve(budget, spendingIn(budget, entries, confirmed), inBalance, ended);
  }

  // 세이브는 날짜가 없다. 언제 보든 같은 금액이 묶여 있다. 보호를 켠 활성 세이브의 **남은 금액**만 뺀다(P3).
  total += protectedReserveTotal(reserves, reserveUsage);

  return total;
}

/** 세이브 총액 — 보호 · 보관과 무관하게 지금 확보하고 있는 금액의 합. */
export function reservedTotal(reserves: readonly Reserve[]): number {
  return reserves.reduce((t, r) => t + r.amountMinor, 0);
}

/*
  ── 세이브 보호 (P1) ─────────────────────────────────────────────

  세이브가 가용 한도에서 빠지는 것은 **보호를 켠 활성 세이브**뿐이다.

    보호 켬 · 활성        한도에서 뺀다 (예전 세이브는 모두 이 상태로 읽힌다)
    보호 끔              한도에 포함 — 세이브와 금액은 그대로 남는다
    보관                 일반 목록에서 빠지고 보호도 풀린다 — 금액은 지우지 않는다

  잔고 · 예상 잔고는 어느 쪽이든 그대로다. 세이브는 처음부터 잔고를 건드리지 않았다.
  목표 금액 · 목표 날짜는 표시용이라 이 판정에 들어가지 않는다.

  나중(P4)에 카드 사용이 세이브에 배정되면, 그 배정분 가운데 아직 내지 않은 대금은 보호를 끄거나
  보관해도 계속 보호돼야 한다. 그 몫은 여기(봉투 보호)가 아니라 카드 미결제 보호 쪽에서 센다 —
  이 함수가 `false` 를 돌려주는 세이브의 배정분이 그쪽으로 넘어간다. 그래서 봉투 보호 판정은
  이 함수 하나로 모아 둔다.
*/

/** 이 세이브가 지금 가용 한도에서 빠지는가. 필드가 없는 예전 세이브는 빠진다. */
export function reserveProtects(r: Pick<Reserve, 'protected' | 'archivedAt'>): boolean {
  return r.protected !== false && !r.archivedAt;
}

/**
 * 가용 한도에서 빠지는 세이브 금액의 합 (`reservedOn` 의 세이브 몫).
 *
 * P3 부터는 확보액이 아니라 **남은 금액**(확보액 − 연결된 실제 지출)을 뺀다. 세이브에서 쓴 지출은 현금 흐름에서
 * 이미 한 번 빠지므로(잔고 밖이면 실제 거래로, 잔고에 반영됐으면 잔고 자체로), 확보액 전체를 계속 빼면 같은 돈이
 * 두 번 빠진다. 남은 금액이 음수(초과 사용)면 0 으로 센다 — 초과분이 다른 돈을 늘려 주지 않는다.
 */
export function protectedReserveTotal(
  reserves: readonly Reserve[], usage: ReadonlyMap<string, number> = NO_USAGE,
): number {
  return reserves.reduce((t, r) => (reserveProtects(r) ? t + Math.max(0, reserveRemaining(r, usage)) : t), 0);
}

/*
  ── 세이브 사용 (P3) ───────────────────────────────────────────────

  세이브는 가상 봉투다. 그 돈으로 실제로 쓴 지출은 원장에 **한 번만** 적히고(현금 흐름 · 소비 통계 그대로),
  세이브 쪽에서는 그 지출을 가리킬 뿐이다(`money.reserveId`). 세이브의 원본 금액은 깎지 않는다 —

    사용액   = 그 세이브를 가리키는 **실제** 일반 지출의 합      (`reserveUsageOf`)
    남은 금액 = 확보액(`amountMinor`) − 사용액                 (`reserveRemaining`, 음수면 초과)

  사용액이 거래에서 계산되므로 연결 · 해제 · 금액 수정 · 삭제 · 다른 세이브로 옮기기 · 백업에서 되살리기가 모두
  같은 원장에서 저절로 맞는다. 저장을 두 번 해도 같은 문서 하나라 두 번 세지 않는다.

  예정은 사용액이 아니다. 예정에 걸어 둔 연결은 확정할 때 실제 거래로 옮겨 가고(`confirmOccurrence`), 그때부터 센다.
*/

const NO_USAGE: ReadonlyMap<string, number> = new Map();

/**
 * 세이브에 걸 수 있는 흐름인가 — 일반 지출, 또는 **등록한 카드의** 카드 사용(P4).
 *
 * 카드 사용을 세이브에 걸면 세이브의 남은 금액이 줄고, 같은 돈은 카드 미결제로 지켜진다(`tide.cardHoldOn`) —
 * 지키는 자리가 옮겨 갈 뿐 두 번 빠지지 않는다. 카드가 정해지지 않은 카드 사용은 미결제로 지켜지지 않으므로 걸지
 * 않는다(걸면 세이브만 줄고 그 빚은 대금을 적을 때까지 아무도 지키지 않아 한도가 부푼다).
 */
function reserveFlowOk(m: NonNullable<Entry['money']>): boolean {
  const flow = moneyFlowOf(m);
  return flow === 'normal' || (flow === 'cardSpend' && !!m.cardId);
}

/** 고르는 자리에 세이브를 띄울 거래인가 — 일반 지출 · 등록 카드 사용 · 대출 연결 없음 · 반복 아님. */
export function reserveLinkable(e: Pick<Entry, 'money' | 'recurrence'>): boolean {
  const m = e.money;
  if (!m || m.type !== 'expense' || m.debtId || e.recurrence) return false;
  return reserveFlowOk(m);
}

/** 세이브 사용액으로 세는 거래인가 — 실제 · 일반 지출(또는 등록 카드 사용) · 세이브 연결. */
export function countsAsReserveUse(e: Entry): boolean {
  return isActual(e) && !!e.money?.reserveId && e.money.type === 'expense'
    && reserveFlowOk(e.money) && !e.recurrence;
}

/** 세이브 id → 연결된 실제 지출의 합. 같은 문서가 두 번 와도 한 번만 센다. */
export function reserveUsageOf(entries: readonly Entry[]): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id) || !countsAsReserveUse(e)) continue;
    seen.add(e.id);
    const id = e.money!.reserveId!;
    out.set(id, (out.get(id) ?? 0) + Math.abs(e.money!.amountMinor));
  }
  return out;
}

/** 남은 금액 = 확보액 − 사용액. 음수면 그만큼 초과해 쓴 것이다. */
export function reserveRemaining(r: Pick<Reserve, 'id' | 'amountMinor'>, usage: ReadonlyMap<string, number>): number {
  return r.amountMinor - (usage.get(r.id) ?? 0);
}

/** 그 세이브에 걸린 거래 — 실제 · 예정 모두. 날짜 내림차순. 화면의 '연결된 거래' 목록이다. */
export function reserveLinkedEntries(reserveId: string, entries: readonly Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries
    .filter((e) => e.money?.reserveId === reserveId && !seen.has(e.id) && (seen.add(e.id), true))
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title));
}

/** 일반 목록에 보이는 세이브 — 보관하지 않은 것. */
export function activeReserves(reserves: readonly Reserve[]): Reserve[] {
  return reserves.filter((r) => !r.archivedAt);
}

/** 보관한 세이브. 따로 접어 두고 거기서 보관을 푼다. */
export function archivedReserves(reserves: readonly Reserve[]): Reserve[] {
  return reserves.filter((r) => !!r.archivedAt);
}

/**
 * 편집 전과 후를 견줘 **바뀐 칸만** 담는다. 바뀐 것이 없으면 null — 쓸 것이 없다.
 *
 * 문서 전체를 다시 쓰지 않는 이유: 편집 창을 연 뒤 다른 기기에서 보호를 껐다면, 창의 옛 값이
 * 그것을 되돌린다. 바꾼 칸만 쓰면 바꾸지 않은 칸은 서버 값이 남는다.
 */
export function reservePatchOf(before: Reserve, after: Reserve): ReservePatch | null {
  const out: ReservePatch = {};
  if (after.name !== before.name) out.name = after.name;
  if (after.amountMinor !== before.amountMinor) out.amountMinor = after.amountMinor;
  if ((after.protected !== false) !== (before.protected !== false)) out.protected = after.protected !== false;
  if ((after.targetAmountMinor ?? null) !== (before.targetAmountMinor ?? null)) {
    out.targetAmountMinor = after.targetAmountMinor ?? null;
  }
  if ((after.targetDate ?? null) !== (before.targetDate ?? null)) out.targetDate = after.targetDate ?? null;
  if ((after.archivedAt ?? null) !== (before.archivedAt ?? null)) out.archivedAt = after.archivedAt ?? null;
  return Object.keys(out).length > 0 ? out : null;
}

/** 실패 목록에 남길 한 줄 — 무엇을 바꾸려던 쓰기였는지. */
export function reservePatchSummary(p: ReservePatch): string {
  const out: string[] = [];
  if (p.name !== undefined) out.push('이름');
  if (p.amountMinor !== undefined) out.push('금액');
  if (p.protected !== undefined) out.push(p.protected ? '가용 한도에서 제외' : '가용 한도에 포함');
  if (p.targetAmountMinor !== undefined || p.targetDate !== undefined) out.push('목표');
  if (p.archivedAt !== undefined) out.push(p.archivedAt ? '보관' : '보관 해제');
  return out.join(' · ');
}

/** 부분 쓰기를 메모리의 세이브에 얹는다 — 화면이 서버 확인 전에도 같은 값을 그린다. */
export function applyReservePatch(r: Reserve, patch: ReservePatch, updatedAt: string): Reserve {
  return { ...r, ...patch, updatedAt };
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
    protected: true,
    targetAmountMinor: null,
    targetDate: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}
