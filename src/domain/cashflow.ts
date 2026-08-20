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
import { addDaysISO, normalizeDate, spanDays } from './date';
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

interface DayBucket { delta: number; reserved: number; entries: Entry[] }

function bucketFor(map: Map<DateISO, DayBucket>, date: DateISO): DayBucket {
  let b = map.get(date);
  if (!b) {
    b = { delta: 0, reserved: 0, entries: [] };
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
    } else {
      b.delta += def.sign * part;
    }
  });
}

/**
 * @param accounts  잔고. 각 계좌의 asOf 날짜부터 유효한 값으로 본다.
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
  const money = entries.filter((e) => e.kind === 'money' && e.money?.currency === currency);

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

  // 잔고 기준일이 구간 시작보다 앞이면, 그 사이의 항목을 먼저 반영해야
  // 구간 시작 잔고가 사실과 맞는다.
  const seedDate = relevant.length > 0
    ? relevant.reduce<DateISO>((min, a) => {
        const d = normalizeDate(a.asOf);
        return !min || (d && d < min) ? d : min;
      }, '')
    : start;
  const walkFrom = seedDate && seedDate < start ? seedDate : start;

  const map = new Map<DateISO, DayBucket>();
  for (const e of money) applyEntry(map, e);

  let balance = seedBalance;
  let reserved = 0;
  let openingMinor = seedBalance;
  const points: CashflowPoint[] = [];
  let totalIn = 0;
  let totalOut = 0;

  // seedDate 당일의 잔고는 이미 그날의 결과이므로 다음 날부터 반영한다.
  const applyStart = seedDate && seedDate < start ? addDaysISO(seedDate, 1) : walkFrom;

  for (const day of spanDays(applyStart, end)) {
    const b = map.get(day);
    if (b) {
      balance += b.delta;
      reserved += b.reserved;
    }
    if (day < start) {
      openingMinor = balance;
      continue;
    }
    if (b) {
      if (b.delta > 0) totalIn += b.delta;
      if (b.delta < 0) totalOut += -b.delta;
    }
    points.push({
      date: day,
      deltaMinor: b?.delta ?? 0,
      balanceMinor: balance,
      reservedMinor: reserved,
      entries: b?.entries ?? [],
    });
  }

  // applyStart 가 구간 시작보다 뒤일 수 없으므로 openingMinor 는 위 루프에서 확정된다.
  if (applyStart >= start) openingMinor = seedBalance;

  let low: CashflowPoint | null = null;
  let firstShortfall: CashflowPoint | null = null;
  for (const p of points) {
    if (!low || p.balanceMinor < low.balanceMinor) low = p;
    if (!firstShortfall && p.balanceMinor < 0) firstShortfall = p;
  }

  return {
    currency,
    openingMinor,
    points,
    closingMinor: points.length > 0 ? (points[points.length - 1] as CashflowPoint).balanceMinor : openingMinor,
    totalInMinor: totalIn,
    totalOutMinor: totalOut,
    totalReservedMinor: reserved,
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
