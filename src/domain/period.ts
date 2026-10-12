/**
 * 정산 기간.
 *
 * 사용자가 고른 정산 시작일(1~31)부터 다음 달 같은 날 전날까지가 한 기간이다.
 * 25일이면 9/25 ~ 10/24 가 한 기간이고, 1일이면 달력의 한 달과 같다.
 *
 * ── 이름은 날이 더 많이 든 달이다 ──────────────────────────────
 *
 * 기간의 이름(`PeriodKey`, `YYYY-MM`)은 그 기간의 날이 **더 많이 든 달**이다. 시작일이
 * 1~15일이면 시작하는 달, 16~31일이면 그 다음 달이다. 25일 기준 9/25 ~ 10/24 는
 * `2026-10`(10월) 이다 — 급여일 기준으로 쓰는 사람이 부르는 이름과 같다.
 *
 * 처음에는 시작하는 달로 이름을 붙였다. 그랬더니 시작일을 1일에서 25일로 바꾸는 순간
 * 오늘이 든 기간의 이름이 10월에서 9월로 밀려, "10월부터" 로 정해 둔 기본 예산이 지금
 * 기간에 걸리지 않았다(실제 화면에서 확인). 날이 더 많은 달로 이름을 붙이면 1일 ↔ 25일
 * 처럼 흔한 전환에서 오늘의 기간 이름이 바뀌지 않는다. 화면은 이름만 적지 않고 늘 날짜
 * 범위를 함께 적는다.
 *
 * 시작일을 바꾸면 모든 기간의 경계가 새 시작일로 다시 계산된다(과거 통계도 함께).
 * 기간별 예산은 이름(열쇠)을 따라가므로 지워지지 않는다.
 *
 * ── 그 달에 없는 날 ────────────────────────────────────────────
 *
 * 29 · 30 · 31일은 짧은 달에 없다. 그 달의 **말일**로 당긴다. 31일 기준이면 2월 기간은
 * 2/28(윤년 2/29)에 시작해 3/30 에 끝나고, 3월 기간은 3/31 에 시작한다. 기간은 늘
 * 이어져 있다 — 한 기간의 끝 다음 날이 다음 기간의 시작이다.
 */
import { addDaysISO, normalizeDate, todayISO } from './date';
import type { DateISO, PeriodKey } from './types';

export const DEFAULT_SETTLE_DAY = 1;

/** 1~31 정수가 아니면 1. 저장된 값을 읽을 때 쓴다. */
export function clampSettleDay(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31 ? v : DEFAULT_SETTLE_DAY;
}

export interface Period {
  key: PeriodKey;
  /** 첫날 (포함). */
  start: DateISO;
  /** 마지막 날 (포함). */
  end: DateISO;
}

const pad = (n: number) => String(n).padStart(2, '0');

function lastDayOf(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function keyOf(year: number, month1: number): PeriodKey {
  return `${year}-${pad(month1)}`;
}

function parseKey(key: PeriodKey): { year: number; month1: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (month1 < 1 || month1 > 12) return null;
  return { year, month1 };
}

function shiftYm(year: number, month1: number, by: number): { year: number; month1: number } {
  const idx = year * 12 + (month1 - 1) + by;
  return { year: Math.floor(idx / 12), month1: (idx % 12 + 12) % 12 + 1 };
}

/** 그 달에 이 기간이 시작하는 날. 없는 날이면 말일. */
function startIn(year: number, month1: number, settleDay: number): DateISO {
  const day = Math.min(clampSettleDay(settleDay), lastDayOf(year, month1));
  return `${year}-${pad(month1)}-${pad(day)}`;
}

/**
 * 이름이 시작하는 달보다 몇 달 뒤인가. 16일부터는 날이 다음 달에 더 많이 든다.
 * (16일 시작이면 30일짜리 달에서 15 : 15 이고, 31일짜리 달에서는 다음 달이 더 많다.)
 */
const nameShift = (settleDay: number) => (clampSettleDay(settleDay) >= 16 ? 1 : 0);

/** 열쇠로 기간을 만든다. 열쇠 모양이 틀리면 null. */
export function periodByKey(key: PeriodKey, settleDay: number): Period | null {
  const k = parseKey(key);
  if (!k) return null;
  const from = shiftYm(k.year, k.month1, -nameShift(settleDay));
  const next = shiftYm(from.year, from.month1, 1);
  return {
    key,
    start: startIn(from.year, from.month1, settleDay),
    end: addDaysISO(startIn(next.year, next.month1, settleDay), -1),
  };
}

/** 그 날이 든 기간. */
export function periodOf(date: DateISO, settleDay: number): Period {
  const d = normalizeDate(date) || todayISO();
  const year = Number(d.slice(0, 4));
  const month1 = Number(d.slice(5, 7));
  const here = startIn(year, month1, settleDay);
  const from = d >= here ? { year, month1 } : shiftYm(year, month1, -1);
  const named = shiftYm(from.year, from.month1, nameShift(settleDay));
  return periodByKey(keyOf(named.year, named.month1), settleDay)!;
}

/** n 기간 앞(음수면 뒤)의 열쇠. */
export function shiftPeriodKey(key: PeriodKey, by: number): PeriodKey {
  const k = parseKey(key);
  if (!k) return key;
  const s = shiftYm(k.year, k.month1, by);
  return keyOf(s.year, s.month1);
}

/** [from, to] 열쇠 사이의 기간들. 오름차순. from 이 to 보다 뒤면 빈 목록. */
export function periodsBetween(from: PeriodKey, to: PeriodKey, settleDay: number): Period[] {
  const out: Period[] = [];
  let k = from;
  for (let guard = 0; k <= to && guard < 600; guard++) {
    const p = periodByKey(k, settleDay);
    if (!p) break;
    out.push(p);
    k = shiftPeriodKey(k, 1);
  }
  return out;
}

/** 그 해 이름을 가진 열두 기간. 25일 기준 2026년은 2025-12-25 ~ 2026-12-24 다. */
export function periodsOfYear(year: number, settleDay: number): Period[] {
  return periodsBetween(keyOf(year, 1), keyOf(year, 12), settleDay);
}

/** 기간의 상태. 진행 중인 기간의 합계는 확정이 아니다 — 화면이 그렇게 적는다. */
export type PeriodPhase = 'past' | 'current' | 'future';

export function phaseOf(p: Period, today: DateISO): PeriodPhase {
  if (today > p.end) return 'past';
  if (today < p.start) return 'future';
  return 'current';
}

/** "2026년 9월" — 열쇠의 이름. */
export function periodName(key: PeriodKey): string {
  const k = parseKey(key);
  if (!k) return key;
  return `${k.year}년 ${k.month1}월`;
}

/** "9.25 – 10.24" — 범위. 해가 바뀌면 양쪽에 연도를 붙인다. */
export function periodRange(p: Period): string {
  const f = (iso: DateISO, withYear: boolean) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return withYear ? `${y}.${m}.${d}` : `${m}.${d}`;
  };
  const crossYear = p.start.slice(0, 4) !== p.end.slice(0, 4);
  // 해가 바뀌면 양쪽 모두에 연도를 붙인다 — 한쪽만 붙이면 시작한 해를 짐작하게 된다.
  return `${f(p.start, crossYear)} – ${f(p.end, crossYear)}`;
}

/** 이 기간들이 걸친 달. 거래 조회 범위를 정한다. */
export function monthsOfPeriods(periods: readonly Period[]): string[] {
  const out = new Set<string>();
  for (const p of periods) {
    let ym = p.start.slice(0, 7);
    const last = p.end.slice(0, 7);
    for (let guard = 0; ym <= last && guard < 600; guard++) {
      out.add(ym);
      const [y, m] = ym.split('-').map(Number) as [number, number];
      const n = shiftYm(y, m, 1);
      ym = keyOf(n.year, n.month1);
    }
  }
  return [...out].sort();
}
