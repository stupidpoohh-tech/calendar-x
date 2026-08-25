/**
 * 날짜는 전부 'YYYY-MM-DD' 로컬 날짜 문자열로 다룬다.
 * 시각이 끼면 타임존 때문에 하루가 밀리는데, 이 앱의 경계는 항상 "오늘"이라
 * 하루가 밀리면 계산 전체가 틀어진다.
 */
export type ISODate = string;

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 로컬 자정 기준 Date. */
export function fromISODate(s: ISODate): Date {
  // 캘린더X 쪽 tsconfig 는 noUncheckedIndexedAccess 를 켜 두어 구조 분해가
  // number | undefined 로 잡힌다. 원본과 동작은 같다.
  const [y = 0, m = 1, d = 1] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

/** ISO datetime(잔고 기록 시각 등)에서 로컬 날짜만 떼어낸다. */
export function dateOfInstant(iso: string): ISODate {
  return toISODate(new Date(iso));
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** 그 달에 없는 날짜(2월 31일 등)는 말일로 당긴다. */
export function clampDay(year: number, month0: number, day: number): number {
  return Math.min(day, daysInMonth(year, month0));
}

/** 그 달의 지정일. 말일보다 크면 말일. */
export function dayInMonth(year: number, month0: number, day: number): ISODate {
  return toISODate(new Date(year, month0, clampDay(year, month0, day)));
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function addMonths(year: number, month0: number, n: number): { year: number; month0: number } {
  const d = new Date(year, month0 + n, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

/** a < b 이면 음수, 같으면 0, a > b 이면 양수. ISO 날짜는 사전순 비교가 곧 시간순 비교다. */
export function compareDate(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function diffDays(from: ISODate, to: ISODate): number {
  const ms = fromISODate(to).getTime() - fromISODate(from).getTime();
  return Math.round(ms / 86_400_000);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDate(s: ISODate): string {
  const d = fromISODate(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

export function formatShortDate(s: ISODate): string {
  const d = fromISODate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatInstant(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${hh}:${mm}`;
}
