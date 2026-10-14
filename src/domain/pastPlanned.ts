/**
 * 지난 미확정 예정 — 일회성 정리(사용자가 고르고 승인할 때만).
 *
 * 날짜가 지난 예정은 저절로 실제가 되거나 사라지지 않는다. 오래 쌓이면 과거 달력이 '예정 N' 으로
 * 덮였다(이제 달력은 지난 날의 예정을 적지 않는다 — `MonthCalendar`). 여기서는 그 가운데 **지워도
 * 되는 것**을 가려 미리보기를 만든다. 지우는 일은 하지 않는다 — 저장소에 닿지 않는다.
 *
 * ── 후보 · 확인 필요 · 막힘 · 제외 ──────────────────────────────
 *
 *   후보(candidate)  한 번짜리 예정 · 날짜가 오늘 앞 · 확정하지 않음 · 계산에 영향 없음.
 *                    미리 골라 둔다(그래도 마지막 확인 전에는 지우지 않는다)
 *   확인 필요(review) 기간 예정 · 예전 종류(living · save · free · repay · priority). 무엇이었는지
 *                    코드로 단정할 수 없어 미리 고르지 않는다
 *   막힘(blocked)     지우면 지금 보이는 숫자(예상 잔고 · 한도 · 생활비)가 바뀌는 것. 고를 수 없다 —
 *                    그 돈이 실제로 나갔으면 확정하고, 아니면 잔고를 다시 적은 뒤에 정리한다
 *   제외(excluded)    실제 거래 · 반복 예정 원본(과 그 회차) · 오늘 · 앞날 · 확정한 회차. 목록에도 없다
 *
 * ── 계산 영향 ───────────────────────────────────────────────────
 *
 * 숫자는 잔고 기준일 다음부터 센다(`unsettledAfter`). 그 앞의 예정은 이미 잔고 안이라 지워도
 * 예상 잔고 · 한도가 같다 — 단, 생활비 주머니에 걸린 예정은 주머니가 "쓴 돈" 으로 세므로 기준일
 * 앞이라도 남은 확보액이 바뀔 수 있다. 그래서 날짜로 단정하지 않고 **지우기 전과 후의 숫자를 실제로
 * 견준다** (`calcSnapshot`). 날짜만으로 영향이 없다고 증명되는 경우(기준일 앞 · 주머니 없음)만 건너뛴다.
 */
import { budgetStates } from './budget';
import { normalizeDate } from './date';
import { effectiveEndDate } from './entry';
import { cashSignOf, confirmedKey, confirmedSetOf, isActual } from './ledger';
import { headlineLimit, limitOn, projectedBalanceOn, unsettledAfter, type Reservations } from './tide';
import type { Account, DateISO, Entry, MoneyType } from './types';

const LEGACY: readonly MoneyType[] = ['living', 'save', 'free', 'repay', 'priority'];

export type PastPlanGroup = 'candidate' | 'review' | 'blocked';

export interface PastPlanItem {
  entry: Entry;
  group: PastPlanGroup;
  /** 금액(양수)과 현금 방향. 수입 +1 · 지출 −1 · 0(세이브 등). */
  amount: number;
  sign: -1 | 0 | 1;
  /** 확인 필요 · 막힘의 이유. 화면이 그대로 적는다. */
  reason: string | null;
  /** 기간 예정인가. */
  span: boolean;
}

export interface PastPlanScan {
  items: PastPlanItem[];
  /** 잔고 기준일 경계. 이 날까지의 예정은 이미 잔고 안이다. */
  boundary: DateISO;
  excluded: { recurring: number; confirmed: number; todayOrLater: number };
}

/** 계산 영향을 견주는 숫자들. 화면에 보이는 것 그대로다. */
export interface CalcSnapshot {
  headline: number;
  projectedToday: number;
  availableToday: number;
  /** 생활비마다 실제 · 예정 · 확보. 주머니 숫자도 화면에 보인다. */
  pockets: string;
}

export function calcSnapshot(
  accounts: readonly Account[], entries: readonly Entry[], today: DateISO, res: Reservations,
): CalcSnapshot {
  const from = unsettledAfter(accounts, today);
  return {
    headline: accounts.length > 0 ? headlineLimit(accounts, entries, today, res) : 0,
    projectedToday: projectedBalanceOn(accounts, entries, today, today),
    availableToday: limitOn(accounts, entries, today, today, res),
    pockets: budgetStates(res.budgets ?? [], entries, { accounts, today, unsettledAfter: from })
      .map((s) => `${s.budget.id}:${s.actualMinor}:${s.plannedMinor}:${s.reservedMinor}`).join('|'),
  };
}

export const sameSnapshot = (a: CalcSnapshot, b: CalcSnapshot) =>
  a.headline === b.headline && a.projectedToday === b.projectedToday
  && a.availableToday === b.availableToday && a.pockets === b.pockets;

/**
 * 지난 미확정 예정을 가른다. `entries` 는 저장된 원본 **전부**(반복을 펼치지 않은 목록)다 —
 * 구독 창만 넘기면 오래된 예정이 빠진다.
 */
export function scanPastPlanned(
  entries: readonly Entry[], accounts: readonly Account[], today: DateISO, res: Reservations = {},
): PastPlanScan {
  const boundary = unsettledAfter(accounts, today);
  const confirmed = confirmedSetOf(entries);
  const excluded = { recurring: 0, confirmed: 0, todayOrLater: 0 };
  const before = accounts.length > 0 ? calcSnapshot(accounts, entries, today, res) : null;
  const items: PastPlanItem[] = [];

  for (const e of entries) {
    if (e.kind !== 'money' || !e.money || isActual(e)) continue;
    if (e.recurrence) { excluded.recurring++; continue; }
    if (effectiveEndDate(e) >= today) { excluded.todayOrLater++; continue; }
    if (confirmed.has(confirmedKey(e.id, normalizeDate(e.startDate)))) { excluded.confirmed++; continue; }

    const span = effectiveEndDate(e) > normalizeDate(e.startDate);
    const legacy = LEGACY.includes(e.money.type);
    // 날짜로 영향이 없다고 증명되는 경우만 건너뛴다. 나머지는 숫자를 실제로 견준다.
    const provablyNone = effectiveEndDate(e) <= boundary && !e.money.budgetId;
    const affects = before !== null && !provablyNone
      && !sameSnapshot(before, calcSnapshot(accounts, entries.filter((x) => x.id !== e.id), today, res));

    const sign = cashSignOf(e);
    const base = { entry: e, amount: Math.abs(e.money.amountMinor), sign, span } as const;
    if (affects) {
      items.push({
        ...base, group: 'blocked',
        reason: e.money.budgetId
          ? '생활비에 걸려 있어 지우면 남은 생활비 · 한도가 바뀝니다'
          : '잔고 기준일 뒤의 예정이라 지우면 예상 잔고 · 한도가 바뀝니다',
      });
    } else if (span || legacy) {
      items.push({
        ...base, group: 'review',
        reason: span ? '기간 예정입니다' : '예전 종류로 저장된 항목입니다',
      });
    } else {
      items.push({ ...base, group: 'candidate', reason: null });
    }
  }
  items.sort((a, b) => a.entry.startDate.localeCompare(b.entry.startDate) || a.entry.title.localeCompare(b.entry.title));
  return { items, boundary, excluded };
}

/** 고른 것의 합계 — 예정 수입 · 예정 지출 · 기간. */
export function pastPlanTotals(items: readonly PastPlanItem[]) {
  let income = 0; let incomeCount = 0; let outflow = 0; let outflowCount = 0;
  let from: DateISO | null = null; let to: DateISO | null = null;
  for (const it of items) {
    if (it.sign > 0) { income += it.amount; incomeCount++; } else { outflow += it.amount; outflowCount++; }
    const s = normalizeDate(it.entry.startDate);
    const e = effectiveEndDate(it.entry);
    if (!from || s < from) from = s;
    if (!to || e > to) to = e;
  }
  return { count: items.length, income, incomeCount, outflow, outflowCount, from, to };
}

/**
 * 지우기 직전 마지막 점검 — 고른 것을 모두 지운 뒤에도 보이는 숫자가 같은가. 하나씩은 영향이 없어도
 * 함께 지우면 달라질 수 있다(같은 생활비에 걸린 둘 등). 다르면 지우지 않는다.
 */
export function impactOfRemoving(
  entries: readonly Entry[], accounts: readonly Account[], today: DateISO, res: Reservations,
  ids: ReadonlySet<string>,
): { before: CalcSnapshot; after: CalcSnapshot; same: boolean } {
  const before = calcSnapshot(accounts, entries, today, res);
  const after = calcSnapshot(accounts, entries.filter((e) => !ids.has(e.id)), today, res);
  return { before, after, same: sameSnapshot(before, after) };
}

/**
 * 날짜 상세에서 '정리' 를 띄우는 예정 — 한 번짜리 · 기간 아님 · 예전 종류 아님 · 생활비에 걸리지 않음.
 * 누르면 평소 삭제(확인창)로 간다. 생활비에 걸린 예정은 지우면 주머니 숫자가 바뀌므로 띄우지 않는다 —
 * 지우려면 그 거래를 열어 평소처럼 지운다.
 */
export function discardableOnDay(e: Entry): boolean {
  if (e.kind !== 'money' || !e.money || isActual(e) || e.recurrence || e.isRecurring) return false;
  if (e.money.budgetId) return false;
  if (effectiveEndDate(e) > normalizeDate(e.startDate)) return false;
  return !LEGACY.includes(e.money.type);
}
