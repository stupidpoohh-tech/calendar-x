/**
 * D-Day.
 *
 * 남은 날은 **저장하지 않고 볼 때마다 센다.** 그리고 그 셈은 벽시계 날짜 두 개의
 * 차이여야 한다 — UTC 로 환산한 날짜를 넣으면 한국 시간 오전에 하루가 밀린다.
 * 테스트는 `vite.config.ts` 가 TZ=Asia/Seoul 로 못박아 돌린다.
 */
import { describe, expect, it } from 'vitest';
import { localDateOf } from './date';
import { ddayCount, fmtDdayDate } from './dday';

describe('남은 날', () => {
  it('오늘보다 뒤면 D-N', () => {
    expect(ddayCount('2026-10-16', '2026-09-23')).toEqual({ days: 23, label: 'D-23', phase: 'before' });
  });

  it('오늘이면 D-Day', () => {
    expect(ddayCount('2026-09-23', '2026-09-23')).toEqual({ days: 0, label: 'D-Day', phase: 'today' });
  });

  it('오늘보다 앞이면 D+N', () => {
    expect(ddayCount('2026-09-11', '2026-09-23')).toEqual({ days: -12, label: 'D+12', phase: 'after' });
  });

  it('하루 경계', () => {
    expect(ddayCount('2026-09-24', '2026-09-23').label).toBe('D-1');
    expect(ddayCount('2026-09-22', '2026-09-23').label).toBe('D+1');
  });

  it('달과 해를 넘어도 실제 날 수로 센다', () => {
    expect(ddayCount('2026-10-01', '2026-09-23').days).toBe(8);
    expect(ddayCount('2027-01-01', '2026-12-25').days).toBe(7);
    // 2028 은 윤년이다. 2월이 29일이어야 셈이 맞는다.
    expect(ddayCount('2028-03-01', '2028-02-01').days).toBe(29);
  });

  it('서머타임 전환이 있는 구간에서도 날 수로 센다', () => {
    // 벽시계 날짜의 차이라 23시간·25시간짜리 날이 있어도 흔들리지 않는다.
    expect(ddayCount('2026-04-01', '2026-03-01').days).toBe(31);
  });

  it('날짜가 깨져 있으면 숫자를 지어내지 않는다', () => {
    expect(ddayCount('', '2026-09-23').label).toBe('D-Day');
  });

  it('패딩 없는 값도 받는다', () => {
    expect(ddayCount('2026-10-6', '2026-09-23').days).toBe(13);
  });
});

/*
  순간에서 날짜를 뽑을 때 UTC 로 환산하면 한국 시간 오전 9시 이전이 하루 밀린다.
  D-Day 는 그 하루가 바로 숫자로 드러나는 자리다.
*/
describe('로컬 날짜 기준', () => {
  const earlyMorning = '2026-09-23T08:00:00+09:00';

  it('localDateOf 로 뽑은 오늘은 밀리지 않는다', () => {
    expect(localDateOf(earlyMorning)).toBe('2026-09-23');
    expect(ddayCount('2026-09-23', localDateOf(earlyMorning)).label).toBe('D-Day');
  });

  it('UTC 로 환산한 날짜를 쓰면 하루가 밀린다 — 그래서 쓰지 않는다', () => {
    const utc = new Date(earlyMorning).toISOString().slice(0, 10);
    expect(utc).toBe('2026-09-22');
    expect(ddayCount('2026-09-23', utc).label).toBe('D-1');
  });
});

describe('날짜 표시', () => {
  it('올해면 월·일만 적는다', () => {
    expect(fmtDdayDate('2026-10-16', '2026-09-23')).toBe('10월 16일');
  });

  it('해가 다르면 연도까지 적는다 — 내년 여행과 지난해 기념일이 같아 보이면 안 된다', () => {
    expect(fmtDdayDate('2027-01-01', '2026-09-23')).toBe('2027년 1월 1일');
  });

  it('날짜가 없으면 아무것도 적지 않는다', () => {
    expect(fmtDdayDate('', '2026-09-23')).toBe('');
  });
});
