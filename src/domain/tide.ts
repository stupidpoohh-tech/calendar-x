/**
 * "이 돈으로 며칠 버티나" — tide-over 앱의 계산 로직을 Dada Entry 위에서 다시 짠 것.
 *
 * ─────────────────────────────────────────────────────────────────
 * 이 모듈이 지키는 원칙 (tide-over CLAUDE.md §1·§2 그대로)
 *
 *   입력의 원자는 지출이 아니라 잔고다. 미래는 달력에, 과거는 잔고에.
 *
 *   • 과거 지출은 입력하지 않는다. 잔고를 옮겨 적는 순간 그 사이의 변동 지출이
 *     정산된 것으로 본다.
 *   • 이 앱은 "예상 잔고"를 만들지 않는다. 표시하는 숫자는 "이 날까지 쓸 수
 *     있는 한도"다. 변동 지출을 추정하지 않는 것은 누락이 아니라 정의다.
 *
 * ─────────────────────────────────────────────────────────────────
 * Dada Entry 위에서 도는 방식
 *
 * tide-over 원본은 { kind, amount, schedule: once|monthly|every|span } 였다.
 * Dada는 이미 { kind: 'money', money: { type, amountMinor }, startDate,
 * endDate, recurrence } 로 같은 것을 표현한다. 스키마를 늘리지 않고 매핑한다:
 *
 *   tide-over          →  Dada Entry (kind: 'money')
 *   once(date)         →  startDate = date, endDate = null, recurrence = null
 *   span(start, end)   →  startDate = start, endDate = end
 *   monthly(day)       →  recurrence.freq = 'monthly' (day는 startDate에서 유도)
 *   every(N days)      →  recurrence.freq = 'daily', interval = N
 *   weekly             →  every 7 과 같다 (원본에 없던 케이스)
 *
 * money.type 의 sign(+1 = 입금, -1 = 출금, 0 = 흐름에 반영 안 함)이 tide-over의
 * income/expense 부호를 겸한다. save · free 는 sign 0 이라 이 계산에서 빠진다.
 */
import { MONEY_TYPE_BY_ID } from './constants';
import { addDaysISO, daysBetween, normalizeDate, parseDate, toISO } from './date';
import { effectiveEndDate } from './entry';
import { isVirtualEntry } from './recurrence';
import type { Account, DateISO, Entry } from './types';

/**
 * 계산에 화면용 목록이 들어왔다.
 *
 * 배선 실수지 사용자 데이터 문제가 아니다 — `virtual` 은 저장 경로에 없어서
 * `expandEntry()` 말고는 켤 수 없다. 조용히 지나가면 같은 입출금을 여러 번 세어
 * 금액이 몇 배로 부풀고, 그 숫자가 그럴듯해서 아무도 눈치채지 못한다.
 */
export class TideInputError extends Error {
  constructor(entryId: string) {
    super(
      `금액 계산에 화면용 발생분이 들어왔습니다 (${entryId}). `
      + 'materialize() 결과가 아니라 원본 항목을 넘겨야 합니다 — '
      + '발생분을 넣으면 반복이 한 번 더 전개돼 같은 입출금을 여러 번 셉니다.',
    );
    this.name = 'TideInputError';
  }
}

/**
 * 계산 입력 검사.
 *
 * tide 로 들어오는 모든 목록이 여기를 지난다. 반복 항목은 `occurrences()` 가 직접
 * 전개하므로, 이미 전개된 사본을 받으면 안 된다.
 */
function assertOriginals(entries: readonly Entry[]): void {
  for (const e of entries) {
    if (isVirtualEntry(e)) throw new TideInputError(e.id);
  }
}

/**
 * 예정 한 건의 하루 발생분. amount 는 그 날 몫(양수).
 * 반복 · 단발은 entry.money.amountMinor 그대로,
 * 기간(span)은 일할 몫(마지막 날에 나머지 몰아 준다).
 */
export interface Occurrence {
  date: DateISO;
  entry: Entry;
  /** 하루 몫. 항상 양수, 원 단위. */
  amountMinor: number;
}

/** money 종류로 부호를 판정한다. 0 이면 tide 계산에서 제외(세이브·가용). */
function signOf(entry: Entry): -1 | 0 | 1 {
  if (entry.kind !== 'money' || !entry.money) return 0;
  return MONEY_TYPE_BY_ID[entry.money.type]?.sign ?? 0;
}

/** 이 항목이 tide 흐름에 반영되는가. */
function participates(entry: Entry): boolean {
  return signOf(entry) !== 0;
}

function amountOf(entry: Entry): number {
  return entry.money?.amountMinor ?? 0;
}

/** 기간 항목인가. Dada 는 endDate 로 표현한다. */
function isSpan(entry: Entry): boolean {
  return !!entry.endDate && entry.endDate > entry.startDate;
}

/**
 * (after, through] 구간에 잡히는 예정 입금·출금.
 * 시작은 열려 있고 끝은 닫혀 있다 — "오늘 이후 ~ d일까지"가 그대로 이 모양이다.
 * 오늘까지 지나간 발생분은 애초에 잡히지 않는다 (tide-over 불변식 4).
 */
export function occurrences(
  entries: readonly Entry[], after: DateISO, through: DateISO,
): Occurrence[] {
  assertOriginals(entries);

  const afterN = normalizeDate(after);
  const throughN = normalizeDate(through);
  if (!afterN || !throughN || afterN >= throughN) return [];

  const out: Occurrence[] = [];

  for (const entry of entries) {
    if (!participates(entry)) continue;

    const amount = Math.abs(amountOf(entry));
    if (amount === 0) continue;

    const r = entry.recurrence;

    // 반복이 있으면 반복이 이긴다. endDate 로 span 을 겸하는 항목은 없다고 본다.
    if (r) {
      if (r.freq === 'monthly') {
        addMonthlyOccurrences(out, entry, amount, afterN, throughN, r.interval, r.until, r.count);
      } else if (r.freq === 'weekly') {
        addEveryOccurrences(out, entry, amount, afterN, throughN, r.interval * 7, r.until, r.count);
      } else {
        addEveryOccurrences(out, entry, amount, afterN, throughN, r.interval, r.until, r.count);
      }
      continue;
    }

    if (isSpan(entry)) {
      addSpanOccurrences(out, entry, amount, afterN, throughN);
      continue;
    }

    // once
    const d = normalizeDate(entry.startDate);
    if (d && d > afterN && d <= throughN) {
      out.push({ date: d, entry, amountMinor: amount });
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.entry.title.localeCompare(b.entry.title));
  return out;
}

/**
 * 기간 예산 (span): 총액을 일할로 깐다. 나머지를 마지막 날에 몰아줘야
 * 마지막 날이 지나는 순간 합이 정확히 총액이 된다.
 */
function addSpanOccurrences(
  out: Occurrence[], entry: Entry, amount: number,
  after: DateISO, through: DateISO,
): void {
  const start = normalizeDate(entry.startDate);
  const end = normalizeDate(effectiveEndDate(entry));
  if (!start || !end) return;

  const spanDays = daysBetween(start, end) + 1;
  if (spanDays <= 0) return;

  const perDay = Math.floor(amount / spanDays);
  const firstCountable = addDaysISO(after, 1);
  const from = start > firstCountable ? start : firstCountable;
  const to = end <= through ? end : through;

  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    const dayAmount = d === end ? amount - perDay * (spanDays - 1) : perDay;
    out.push({ date: d, entry, amountMinor: dayAmount });
  }
}

/**
 * every N 일마다: anchor(startDate) + k·N 을 돈다.
 * after 보다 뒤인 첫 k 로 바로 점프해 반복이 오래된 항목도 빠르게 잡는다.
 */
function addEveryOccurrences(
  out: Occurrence[], entry: Entry, amount: number,
  after: DateISO, through: DateISO,
  intervalDays: number, until: DateISO | null, count: number | null,
): void {
  if (intervalDays < 1) return;
  const anchor = normalizeDate(entry.startDate);
  if (!anchor) return;

  const gap = daysBetween(anchor, after);
  const kStart = gap >= 0 ? Math.floor(gap / intervalDays) + 1 : 0;
  const limit = count ?? Number.MAX_SAFE_INTEGER;

  for (let k = kStart; k < limit; k++) {
    const date = addDaysISO(anchor, k * intervalDays);
    if (date > through) break;
    if (until && date > until) break;
    if (date > after) out.push({ date, entry, amountMinor: amount });
  }
}

/** monthly: 구간에 걸친 달을 돌며 그 달의 지정일(startDate의 day)을 잡는다. */
function addMonthlyOccurrences(
  out: Occurrence[], entry: Entry, amount: number,
  after: DateISO, through: DateISO,
  interval: number, until: DateISO | null, count: number | null,
): void {
  const anchor = parseDate(entry.startDate);
  if (!anchor) return;
  const day = anchor.getDate();
  const step = Math.max(1, interval);

  const startD = parseDate(after);
  const endD = parseDate(through);
  if (!startD || !endD) return;

  // anchor 로부터 몇 번째 발생인지 세면서 count 상한을 지킨다.
  let k = 0;
  const limit = count ?? Number.MAX_SAFE_INTEGER;

  const anchorYm = anchor.getFullYear() * 12 + anchor.getMonth();
  const startYm = startD.getFullYear() * 12 + startD.getMonth();
  // startYm 에 가장 가까운 anchor + k·step 로 점프한다.
  if (startYm > anchorYm) {
    k = Math.floor((startYm - anchorYm) / step);
  }

  const lastYm = endD.getFullYear() * 12 + endD.getMonth();

  while (k < limit) {
    const targetYm = anchorYm + k * step;
    if (targetYm > lastYm) break;
    const year = Math.floor(targetYm / 12);
    const month0 = targetYm - year * 12;
    // 그 달에 없는 날짜(2월 31일 등)는 말일로 당긴다.
    const lastDay = new Date(year, month0 + 1, 0).getDate();
    const date = toISO(new Date(year, month0, Math.min(day, lastDay)));
    if (until && date > until) break;
    if (date > after && date <= through) {
      out.push({ date, entry, amountMinor: amount });
    }
    k += 1;
  }
}

/** 입금은 +, 출금은 −. */
export function netOf(list: readonly Occurrence[]): number {
  return list.reduce((t, o) => t + signOf(o.entry) * o.amountMinor, 0);
}

export function totalIn(list: readonly Occurrence[]): number {
  return list.reduce((t, o) => (signOf(o.entry) > 0 ? t + o.amountMinor : t), 0);
}

export function totalOut(list: readonly Occurrence[]): number {
  return list.reduce((t, o) => (signOf(o.entry) < 0 ? t + o.amountMinor : t), 0);
}

/** (after, through] 구간의 순액. */
export function netBetween(entries: readonly Entry[], after: DateISO, through: DateISO): number {
  return netOf(occurrences(entries, after, through));
}

/**
 * 머리 숫자의 끝점.
 * 급여일 설정은 없다. 급여도 그냥 예정 입금이고, 다음 예정 입금 전날까지로 잡는다.
 * 기간 예산(span)은 흐름이라 "다음 입금"에서 제외한다 —
 * 매일 조금씩 들어오는 걸 기준 삼으면 끝점이 늘 내일이 된다.
 */
export interface Horizon {
  end: DateISO;
  /** 다음 예정 입금 날. 없으면 null (30일 뒤로 폴백). */
  nextIncome: DateISO | null;
}

const SEARCH_DAYS = 400;
const FALLBACK_DAYS = 30;

export function horizonOf(entries: readonly Entry[], today: DateISO): Horizon {
  // 거르기 전에 본다. 걸러낸 뒤에 검사하면 입금이 하나도 없는 화면용 목록이 통과한다.
  assertOriginals(entries);
  const incomes = entries.filter((e) => signOf(e) > 0 && !isSpan(e));
  const upcoming = occurrences(incomes, today, addDaysISO(today, SEARCH_DAYS));
  const next = upcoming[0]?.date;
  if (next) return { end: addDaysISO(next, -1), nextIncome: next };
  return { end: addDaysISO(today, FALLBACK_DAYS), nextIncome: null };
}

/**
 * limit(d) = 현재 잔고 + (오늘 이후 ~ d일까지의 예정 입금 − 예정 출금)
 *
 * "예상 잔고"가 아니라 "이 날까지 쓸 수 있는 한도"다.
 * 기간 예산(span) 규칙: d 가 기간에 들어서는 순간 남은 몫 전체를 예약한다.
 * 일할로 깎으면 기간 안 날들이 매일 줄어드는 숫자로 보인다 — 그 돈은
 * 어차피 기간 동안 묶인 돈이라 다른 지출의 한도에서는 통째로 빼는 게 맞다.
 * 기간 안에서는 상수이고, 마지막 날이 지나도 같은 값이다.
 */
export function limitOn(
  accounts: readonly Account[], entries: readonly Entry[],
  date: DateISO, today: DateISO,
): number {
  assertOriginals(entries);
  const balance = accounts.reduce((s, a) => s + a.balanceMinor, 0);
  let total = balance;
  for (const entry of entries) {
    if (!participates(entry)) continue;
    if (isSpan(entry) && !entry.recurrence) {
      const end = normalizeDate(effectiveEndDate(entry));
      const start = normalizeDate(entry.startDate);
      if (start && end && start <= date) {
        total += netBetween([entry], today, end);
      }
    } else {
      total += netBetween([entry], today, date);
    }
  }
  return total;
}

/** 머리 숫자 — 다음 입금 전날(또는 30일 뒤)까지 남는 한도. */
export function headlineLimit(
  accounts: readonly Account[], entries: readonly Entry[], today: DateISO,
): number {
  return limitOn(accounts, entries, horizonOf(entries, today).end, today);
}

/**
 * 정산.
 *
 * diff = 새로 적은 잔고 − (직전 잔고 + 그 사이 지나간 예정 입금 − 예정 출금)
 *
 * 과거 지출을 입력하지 않아도 이 한 줄로 변동 지출이 전부 정산된다.
 * checkedAt 이 없으면(예전 asOf 만 있는 데이터) asOf 를 자정으로 본다.
 */
export interface Settlement {
  since: DateISO;
  passed: Occurrence[];
  passedIn: number;
  passedOut: number;
  /** 예정대로만 움직였다면 남아 있어야 할 금액. */
  expected: number;
  /** 새로 적은 잔고 − expected. 음수면 예정에 없던 지출. */
  diff: number;
}

export function settle(
  accounts: readonly Account[], entries: readonly Entry[],
  newAmountMinor: number, todayISO: DateISO,
): Settlement {
  // 정산 구간이 비면 occurrences 를 거치지 않고 끝난다. 여기서도 직접 본다.
  assertOriginals(entries);
  // 가장 최근에 확인된 잔고 시점을 기준으로 삼는다.
  let since = todayISO;
  let sinceTime = 0;
  for (const a of accounts) {
    const t = a.checkedAt ? Date.parse(a.checkedAt) : Date.parse(`${a.asOf}T00:00:00`);
    if (Number.isFinite(t) && t >= sinceTime) {
      sinceTime = t;
      since = normalizeDate(a.checkedAt?.slice(0, 10) ?? a.asOf) || todayISO;
    }
  }
  const currentBalance = accounts.reduce((s, a) => s + a.balanceMinor, 0);
  const passed = occurrences(entries, since, todayISO);
  const expected = currentBalance + netOf(passed);
  return {
    since,
    passed,
    passedIn: totalIn(passed),
    passedOut: totalOut(passed),
    expected,
    diff: newAmountMinor - expected,
  };
}

/**
 * 오늘 이후 ~ 머리 숫자 끝점까지 남은 예정.
 * 기간 예산은 끝점에 걸치면 남은 몫 전체가 담긴다 — limitOn 과 같은 규칙이라야
 * 내역 합과 머리 숫자가 맞는다.
 */
export function upcomingInHorizon(
  entries: readonly Entry[], today: DateISO, horizon?: Horizon,
): Occurrence[] {
  assertOriginals(entries);
  const h = horizon ?? horizonOf(entries, today);
  const out: Occurrence[] = [];
  for (const entry of entries) {
    if (!participates(entry)) continue;
    if (isSpan(entry) && !entry.recurrence) {
      const end = normalizeDate(effectiveEndDate(entry));
      if (end) out.push(...occurrences([entry], today, end));
    } else {
      out.push(...occurrences([entry], today, h.end));
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.entry.title.localeCompare(b.entry.title));
  return out;
}

/**
 * 목록 표시용 요약. 기간 예산의 하루 발생분들은 한 줄로 합친다 —
 * 계산은 일할이지만 사용자에게 쪼갠 숫자를 보여주지 않는다는 약속.
 */
export interface Summary {
  key: string;
  entry: Entry;
  from: DateISO;
  to: DateISO;
  amountMinor: number;
}

export function summarize(list: readonly Occurrence[]): Summary[] {
  const out: Summary[] = [];
  const spans = new Map<string, Summary>();
  for (const o of list) {
    if (isSpan(o.entry) && !o.entry.recurrence) {
      const g = spans.get(o.entry.id);
      if (g) {
        g.to = o.date;
        g.amountMinor += o.amountMinor;
      } else {
        const item = {
          key: o.entry.id, entry: o.entry, from: o.date, to: o.date,
          amountMinor: o.amountMinor,
        };
        spans.set(o.entry.id, item);
        out.push(item);
      }
    } else {
      out.push({
        key: `${o.date}-${o.entry.id}`, entry: o.entry, from: o.date, to: o.date,
        amountMinor: o.amountMinor,
      });
    }
  }
  return out;
}

/** 하루치 (전날, 그날] 구간의 예정. */
export function entriesOn(entries: readonly Entry[], date: DateISO): Occurrence[] {
  return occurrences(entries, addDaysISO(date, -1), date);
}

/** 이 항목이 tide 흐름에 참여하는가 (컴포넌트에서도 쓴다). */
export function isTideParticipant(entry: Entry): boolean {
  return participates(entry);
}
