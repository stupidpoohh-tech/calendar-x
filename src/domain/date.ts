/**
 * 날짜 유틸.
 *
 * 이 앱의 날짜는 전부 "벽시계 달력 날짜"다. 8월 20일 14:00 회의는 어느 시간대에서 보든
 * 8월 20일 14:00 이므로 UTC 인스턴트로 저장하지 않고 'YYYY-MM-DD' / 'HH:mm' 로 다룬다.
 * 시간대에 의존하는 것은 "오늘이 며칠인가" 하나뿐이고, 그 계산은 todayISO() 에만 모아 둔다.
 */
import type { DateISO, TimeHM, WeekStart, YearMonth } from './types';

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-M-D' 처럼 패딩이 빠진 값을 'YYYY-MM-DD' 로 맞춘다. */
export function normalizeDate(raw: string | null | undefined): DateISO | '' {
  if (!raw) return '';
  const head = raw.slice(0, 10);
  const parts = head.split('-');
  if (parts.length !== 3) return '';
  const [y, m, d] = parts as [string, string, string];
  if (!y || !m || !d) return '';
  return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function isValidDate(iso: string): boolean {
  const n = normalizeDate(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n)) return false;
  const d = parseDate(n);
  return d !== null && toISO(d) === n;
}

export function toISO(d: Date): DateISO {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDate(iso: DateISO): Date | null {
  const n = normalizeDate(iso);
  if (!n) return null;
  const [y, m, d] = n.split('-').map(Number) as [number, number, number];
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

/**
 * 오늘 날짜. tz 를 주면 그 시간대 기준으로 계산한다.
 * 사용자 프로필의 tz 를 넘기면 기기 시계와 무관하게 같은 결과가 나온다.
 */
export function todayISO(tz?: string): DateISO {
  if (!tz) return toISO(new Date());
  try {
    // en-CA 로케일은 'YYYY-MM-DD' 를 낸다.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return toISO(new Date());
  }
}

/**
 * ISO datetime(순간)에서 **그 기기의 벽시계 날짜**를 뽑는다.
 *
 * `'2026-09-10T08:00:00+09:00'.toISOString().slice(0, 10)` 은 `'2026-09-09'` 다 —
 * UTC 로 환산한 날짜라 한국 시간 오전 9시 이전이면 하루가 밀린다. 이 앱의 날짜는 전부
 * 벽시계 값이므로, 순간을 날짜로 바꿀 때는 반드시 이 함수를 거친다.
 */
export function localDateOf(instantISO: string): DateISO | '' {
  const t = Date.parse(instantISO);
  if (!Number.isFinite(t)) return '';
  return toISO(new Date(t));
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addDaysISO(iso: DateISO, n: number): DateISO {
  const d = parseDate(iso);
  if (!d) return iso;
  return toISO(addDays(d, n));
}

export function addMonthsISO(iso: DateISO, n: number): DateISO {
  const d = parseDate(iso);
  if (!d) return iso;
  const day = d.getDate();
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  // 1월 31일 + 1개월은 2월 31일이 없으므로 해당 월의 마지막 날로 자른다.
  const lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, lastDay));
  return toISO(x);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** weekStart 기준 요일 인덱스. 'mon' 이면 월=0…일=6, 'sun' 이면 일=0…토=6. */
export function weekdayIndex(d: Date, weekStart: WeekStart): number {
  return weekStart === 'mon' ? (d.getDay() + 6) % 7 : d.getDay();
}

export function startOfMonthGrid(d: Date, weekStart: WeekStart): Date {
  const first = startOfMonth(d);
  return addDays(first, -weekdayIndex(first, weekStart));
}

/** 6주 × 7일 = 42칸. 항상 같은 높이를 유지해 월 이동 시 레이아웃이 튀지 않는다. */
export function monthGrid(d: Date, weekStart: WeekStart): Date[] {
  const start = startOfMonthGrid(d, weekStart);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const WEEKDAY_LABELS_MON = ['월', '화', '수', '목', '금', '토', '일'] as const;
export const WEEKDAY_LABELS_SUN = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function weekdayLabels(weekStart: WeekStart): readonly string[] {
  return weekStart === 'mon' ? WEEKDAY_LABELS_MON : WEEKDAY_LABELS_SUN;
}

/** 주말 여부. 요일 인덱스가 아니라 실제 날짜로 판정한다. */
export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function ymOf(iso: DateISO): YearMonth {
  return normalizeDate(iso).slice(0, 7);
}

export function ymOfDate(d: Date): YearMonth {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** start ~ end 사이의 모든 'YYYY-MM'. 두 값이 같은 달이면 한 개. */
export function ymRange(startISO: DateISO, endISO: DateISO, maxMonths = 120): YearMonth[] {
  const s = parseDate(startISO);
  const e = parseDate(endISO) ?? s;
  if (!s || !e) return [];
  if (e < s) return [ymOfDate(s)];
  const out: YearMonth[] = [];
  const cur = new Date(s.getFullYear(), s.getMonth(), 1);
  const last = new Date(e.getFullYear(), e.getMonth(), 1);
  while (cur <= last && out.length < maxMonths) {
    out.push(ymOfDate(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

/** 두 날짜 사이의 모든 날(양끝 포함). end 가 start 보다 앞이면 start 하루만 반환한다. */
export function spanDays(startISO: DateISO, endISO?: DateISO | null, maxDays = 4000): DateISO[] {
  const s = normalizeDate(startISO);
  if (!s) return [];
  const e = normalizeDate(endISO) || s;
  if (e < s) return [s];
  const out: DateISO[] = [];
  let cur = s;
  while (cur <= e && out.length < maxDays) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

export function daysBetween(a: DateISO, b: DateISO): number {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

// ---------- 표시용 포맷 ----------

export function fmtMonthTitle(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

export function fmtDayFull(iso: DateISO): string {
  const d = parseDate(iso);
  if (!d) return iso;
  const dow = WEEKDAY_LABELS_SUN[d.getDay()] ?? '';
  return `${d.getFullYear()}. ${pad2(d.getMonth() + 1)}. ${pad2(d.getDate())} (${dow})`;
}

export function fmtDayShort(iso: DateISO): string {
  const d = parseDate(iso);
  if (!d) return iso;
  const dow = WEEKDAY_LABELS_SUN[d.getDay()] ?? '';
  return `${pad2(d.getDate())}일 (${dow})`;
}

export function fmtTime(t: TimeHM | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}
