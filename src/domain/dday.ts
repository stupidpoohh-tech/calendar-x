/**
 * D-Day.
 *
 * **문자열을 저장하지 않는다.** 'D-23' 은 하루만 참이다. 저장하는 것은 제목과 날짜
 * 뿐이고, 남은 날은 볼 때마다 오늘을 기준으로 다시 센다.
 *
 * 오늘은 이 모듈이 직접 읽지 않고 `todayISO` 로 받는다. 앱의 '오늘' 은 자정 타이머 ·
 * `visibilitychange` · `focus` 세 갈래로 다시 재는 값(`useToday`)이라, 여기서 시계를
 * 따로 읽으면 하루가 밀린 날짜를 화면 한쪽만 가리킨다.
 *
 * 날짜 계산은 `daysBetween` 하나로 한다 — 두 벽시계 날짜의 차이다.
 * `Date#toISOString().slice(0, 10)` 으로 만든 날짜를 넣으면 한국 시간 오전 9시 이전에
 * 하루가 밀리므로, 순간에서 날짜를 뽑을 때는 `localDateOf()` 를 거쳐야 한다.
 */
import { daysBetween, normalizeDate } from './date';
import type { DateISO } from './types';

export interface DdayCount {
  /** 오늘부터 목표일까지 남은 날. 지난 날짜면 음수. */
  days: number;
  /** 'D-23' · 'D-Day' · 'D+12' */
  label: string;
  phase: 'before' | 'today' | 'after';
}

export function ddayCount(dateISO: DateISO, todayISO: DateISO): DdayCount {
  const target = normalizeDate(dateISO);
  const today = normalizeDate(todayISO);
  if (!target || !today) return { days: 0, label: 'D-Day', phase: 'today' };

  const days = daysBetween(today, target);
  if (days === 0) return { days: 0, label: 'D-Day', phase: 'today' };
  if (days > 0) return { days, label: `D-${days}`, phase: 'before' };
  return { days, label: `D+${-days}`, phase: 'after' };
}

/** '10월 16일'. 해가 다르면 연도까지 적는다 — 내년 여행과 지난해 기념일이 같아 보이면 안 된다. */
export function fmtDdayDate(dateISO: DateISO, todayISO: DateISO): string {
  const d = normalizeDate(dateISO);
  if (!d) return '';
  const [y, m, day] = d.split('-') as [string, string, string];
  const sameYear = normalizeDate(todayISO).slice(0, 4) === y;
  const md = `${Number(m)}월 ${Number(day)}일`;
  return sameYear ? md : `${y}년 ${md}`;
}
