/**
 * 현금흐름 예측.
 *
 * 이 서비스가 "미래 현금 흐름 파악"을 목적으로 내걸었지만, 이전 구조에는 잔고와 예정
 * 입출금을 합쳐 미래 잔고를 계산하는 코드가 아예 없었다. MONEY_TYPES 를 7종으로 나눠
 * 두고도 집계가 없어 그 분류가 쓰이지 않았다. 이 모듈이 그 빈자리를 메운다.
 *
 * 답하려는 질문은 하나다 — "언제 잔고가 바닥나는가."
 */
import { MONEY_TYPE_BY_ID } from './constants';
import { normalizeDate, spanDays } from './date';
import { effectiveEndDate } from './entry';
import type { Account, DateISO, Entry } from './types';

export interface CashflowPoint {
  date: DateISO;
  /** 그날의 순변동. 입금은 +, 지출은 −. */
  deltaMinor: number;
  /** 그날 마감 시점의 예상 잔고. */
  balanceMinor: number;
  /** 그날 잔고에서 떼어 둔 누적액(세이브). 잔고를 줄이지는 않는다. */
  reservedMinor: number;
  /** 그날에 반영된 항목들. 툴팁·상세 시트에서 근거를 보여 주기 위해 함께 넘긴다. */
  entries: Entry[];
}

export interface CashflowResult {
  currency: string;
  /** 구간 시작 직전의 잔고. */
  openingMinor: number;
  points: CashflowPoint[];
  closingMinor: number;
  totalInMinor: number;
  totalOutMinor: number;
  totalReservedMinor: number;
  /** 구간 내 최저 잔고 지점. 자금 압박이 가장 심한 날이다. */
  low: CashflowPoint | null;
  /** 처음으로 잔고가 0 밑으로 떨어지는 날. 없으면 null. */
  firstShortfall: CashflowPoint | null;
}

/**
 * 기간형 항목의 금액을 날짜별로 쪼갠다.
 * 나눗셈 나머지를 마지막 날에 몰아 합계가 원금과 정확히 일치하게 한다.
 */
export function allocateOverDays(amountMinor: number, days: number): number[] {
  if (days <= 1) return [amountMinor];
  const base = Math.trunc(amountMinor / days);
  const out = new Array<number>(days).fill(base);
  const last = out.length - 1;
  out[last] = amountMinor - base * (days - 1);
  return out;
}

interface DayBucket {
  /** 그날의 순변동. */
  delta: number;
  /** 그날 들어온 돈의 합. 순변동과 따로 센다. */
  gross_in: number;
  /** 그날 나간 돈의 합. */
  gross_out: number;
  reserved: number;
  entries: Entry[];
}

function bucketFor(map: Map<DateISO, DayBucket>, date: DateISO): DayBucket {
  let b = map.get(date);
  if (!b) {
    b = { delta: 0, gross_in: 0, gross_out: 0, reserved: 0, entries: [] };
    map.set(date, b);
  }
  return b;
}

/** 가계부 항목 하나를 날짜별 버킷에 반영한다. */
function applyEntry(map: Map<DateISO, DayBucket>, e: Entry): void {
  if (e.kind !== 'money' || !e.money) return;
  const def = MONEY_TYPE_BY_ID[e.money.type];
  const amount = Math.abs(e.money.amountMinor);
  if (amount === 0) return;

  const days = def.ranged ? spanDays(e.startDate, effectiveEndDate(e)) : [normalizeDate(e.startDate)];
  if (days.length === 0) return;
  const parts = allocateOverDays(amount, days.length);

  days.forEach((day, i) => {
    const part = parts[i] ?? 0;
    const b = bucketFor(map, day);
    b.entries.push(e);
    if (def.sign === 0) {
      // '세이브'는 잔고에서 빠지지 않지만 자유롭게 쓸 수 있는 돈도 아니다.
      // '가용'은 참고용이라 어느 쪽에도 넣지 않는다.
      if (e.money?.type === 'save') b.reserved += part;
    } else if (def.sign > 0) {
      b.delta += part;
      b.gross_in += part;
    } else {
      b.delta -= part;
      b.gross_out += part;
    }
  });
}

/**
 * 잔고의 기준일을 정한다.
 *
 * 계좌가 여러 개고 기준일이 서로 다르면 합계가 어느 시점에도 정확하지 않다.
 * 가장 최근 기준일을 앵커로 삼는다 — 가장 최근에 확인한 값이 사실에 가깝기 때문이다.
 * 계좌가 하나면(대부분의 경우, 그리고 이관 결과가 만드는 형태) 정확하다.
 */
function anchorDate(accounts: readonly Account[], fallback: DateISO): DateISO {
  let latest = '';
  for (const a of accounts) {
    const d = normalizeDate(a.asOf);
    if (d && d > latest) latest = d;
  }
  return latest || fallback;
}

/**
 * @param accounts  잔고. asOf 는 그 금액이 사실이었던 날이다.
 * @param entries   가계부 항목. 반복 항목은 호출 전에 materialize() 로 펼쳐서 넘긴다.
 * @param from,to   결과로 받고 싶은 구간.
 */
export function projectCashflow(
  accounts: readonly Account[],
  entries: readonly Entry[],
  from: DateISO,
  to: DateISO,
  currency = 'KRW',
): CashflowResult {
  const start = normalizeDate(from);
  const end = normalizeDate(to);

  const empty: CashflowResult = {
    currency,
    openingMinor: 0,
    points: [],
    closingMinor: 0,
    totalInMinor: 0,
    totalOutMinor: 0,
    totalReservedMinor: 0,
    low: null,
    firstShortfall: null,
  };
  if (!start || !end || end < start) return empty;

  const relevant = accounts.filter((a) => a.currency === currency);
  const seedBalance = relevant.reduce((sum, a) => sum + a.balanceMinor, 0);
  const anchor = anchorDate(relevant, start);

  const map = new Map<DateISO, DayBucket>();
  for (const e of entries) {
    if (e.kind === 'money' && e.money?.currency === currency) applyEntry(map, e);
  }

  /*
   * 잔고는 anchor 날 "시작" 시점의 사실로 본다. 그래서 anchor 를 기준으로 양쪽으로 편다.
   *
   *   anchor 이후 → 변동을 더한다 (anchor 당일 예정분도 포함)
   *   anchor 이전 → 변동을 되돌린다
   *
   * 이렇게 하지 않으면 "8월 19일 기준 135만원"이라고 입력한 사용자에게
   * 8월 10일에 이미 나간 전기요금을 한 번 더 빼서 보여 주게 된다.
   *
   * 당일 마감이 아니라 시작으로 잡는 이유: 사용자가 오늘 잔고를 적을 때 오늘 나갈
   * 돈이 아직 안 나갔을 수 있다. 마감으로 보면 그 항목이 조용히 사라진다.
   */
  const walkFrom = start < anchor ? start : anchor;
  const walkTo = end > anchor ? end : anchor;
  const days = spanDays(walkFrom, walkTo);

  const cumulative = new Map<DateISO, number>();
  // 각 날짜 "시작" 시점의 누적 변동. 그날의 변동은 아직 반영하지 않은 값이다.
  const cumulativeBefore = new Map<DateISO, number>();
  let running = 0;
  for (const day of days) {
    cumulativeBefore.set(day, running);
    running += map.get(day)?.delta ?? 0;
    cumulative.set(day, running);
  }

  // anchor 날 시작 잔고가 seedBalance 가 되도록 전체를 평행이동한다.
  const offset = seedBalance - (cumulativeBefore.get(anchor) ?? 0);

  const points: CashflowPoint[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let reservedRunning = 0;
  let reservedAtStart = 0;

  for (const day of days) {
    reservedRunning += map.get(day)?.reserved ?? 0;
    if (day < start) { reservedAtStart = reservedRunning; continue; }
    if (day > end) break;

    const b = map.get(day);
    // 하루에 입금과 지출이 같이 있어도 각각을 센다.
    // 순변동으로 세면 "들어올 돈"이 그날 지출만큼 깎여 보인다.
    totalIn += b?.gross_in ?? 0;
    totalOut += b?.gross_out ?? 0;

    points.push({
      date: day,
      deltaMinor: b?.delta ?? 0,
      balanceMinor: (cumulative.get(day) ?? 0) + offset,
      reservedMinor: reservedRunning - reservedAtStart,
      entries: b?.entries ?? [],
    });
  }

  const first = points[0];
  const openingMinor = first ? first.balanceMinor - first.deltaMinor : seedBalance;

  let low: CashflowPoint | null = null;
  let firstShortfall: CashflowPoint | null = null;
  for (const p of points) {
    if (!low || p.balanceMinor < low.balanceMinor) low = p;
    if (!firstShortfall && p.balanceMinor < 0) firstShortfall = p;
  }

  const last = points[points.length - 1];

  return {
    currency,
    openingMinor,
    points,
    closingMinor: last ? last.balanceMinor : openingMinor,
    totalInMinor: totalIn,
    totalOutMinor: totalOut,
    totalReservedMinor: reservedRunning - reservedAtStart,
    low,
    firstShortfall,
  };
}

/** 대출의 월 상환 합계. 카드 요약에 쓴다. */
export function monthlyDebtTotal(debts: readonly { monthlyMinor: number }[]): number {
  return debts.reduce((sum, d) => sum + d.monthlyMinor, 0);
}

export function debtTotal(debts: readonly { balanceMinor: number }[]): number {
  return debts.reduce((sum, d) => sum + d.balanceMinor, 0);
}
