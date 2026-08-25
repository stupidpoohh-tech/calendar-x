import { describe, expect, it } from 'vitest';
import { addDays, clampDay, dateOfInstant, dayInMonth, diffDays, toISODate } from './date';

describe('clampDay', () => {
  it('말일을 넘지 않는다', () => {
    expect(clampDay(2026, 1, 31)).toBe(28); // 2026년 2월
    expect(clampDay(2028, 1, 31)).toBe(29); // 윤년
    expect(clampDay(2026, 3, 31)).toBe(30); // 4월
    expect(clampDay(2026, 0, 31)).toBe(31); // 1월
  });
});

describe('dayInMonth', () => {
  it('없는 날짜는 말일로 당긴다', () => {
    expect(dayInMonth(2026, 1, 30)).toBe('2026-02-28');
    expect(dayInMonth(2026, 0, 5)).toBe('2026-01-05');
  });
});

describe('addDays / diffDays', () => {
  it('달과 해를 넘어간다', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-03-01', '2026-03-25')).toBe(24);
  });

  it('서머타임이 있는 지역에서도 하루가 밀리지 않는다', () => {
    // 로컬 자정 기준으로만 계산하므로 시각이 끼어들지 않는다.
    expect(diffDays('2026-03-07', '2026-03-08')).toBe(1);
  });
});

describe('dateOfInstant', () => {
  it('ISO datetime에서 로컬 날짜만 떼어낸다', () => {
    const iso = new Date(2026, 2, 7, 23, 30).toISOString();
    expect(dateOfInstant(iso)).toBe('2026-03-07');
  });

  it('toISODate는 로컬 달력 날짜를 쓴다', () => {
    expect(toISODate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});
