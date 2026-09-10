import { describe, expect, it } from 'vitest';
import {
  addMonthsISO, daysBetween, isValidDate, localDateOf, monthGrid, normalizeDate,
  spanDays, toISO, weekdayIndex, weekdayLabels, ymRange,
} from './date';

describe('normalizeDate', () => {
  it('패딩이 빠진 날짜를 맞춘다', () => {
    // 이전 코드에서 캘린더에 항목이 안 뜨던 원인. 문자열 비교는 통과하지만
    // findIndex 가 -1 을 반환했다.
    expect(normalizeDate('2026-5-3')).toBe('2026-05-03');
    expect(normalizeDate('2026-05-03T14:00')).toBe('2026-05-03');
  });
  it('빈 값과 형식 오류를 빈 문자열로 처리한다', () => {
    expect(normalizeDate('')).toBe('');
    expect(normalizeDate(null)).toBe('');
    expect(normalizeDate('2026-05')).toBe('');
  });
});

describe('isValidDate', () => {
  it('존재하지 않는 날짜를 걸러낸다', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2024-02-29')).toBe(true);  // 윤년
    expect(isValidDate('2026-02-29')).toBe(false);
  });
});

describe('addMonthsISO', () => {
  it('말일을 넘기지 않고 해당 월의 마지막 날로 자른다', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsISO('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonthsISO('2026-03-15', -1)).toBe('2026-02-15');
  });
  it('연도를 넘어간다', () => {
    expect(addMonthsISO('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('monthGrid', () => {
  it('항상 42칸을 낸다', () => {
    expect(monthGrid(new Date(2026, 7, 1), 'mon')).toHaveLength(42);
    expect(monthGrid(new Date(2026, 1, 1), 'sun')).toHaveLength(42);
  });
  it('주 시작 설정을 반영한다', () => {
    const mon = monthGrid(new Date(2026, 7, 1), 'mon');
    const sun = monthGrid(new Date(2026, 7, 1), 'sun');
    expect(mon[0]?.getDay()).toBe(1);
    expect(sun[0]?.getDay()).toBe(0);
  });
  it('해당 월의 1일을 포함한다', () => {
    const grid = monthGrid(new Date(2026, 7, 1), 'mon');
    expect(grid.map(toISO)).toContain('2026-08-01');
    expect(grid.map(toISO)).toContain('2026-08-31');
  });
});

describe('weekdayIndex / weekdayLabels', () => {
  it('월요일 시작에서 월요일이 0이다', () => {
    expect(weekdayIndex(new Date(2026, 7, 17), 'mon')).toBe(0); // 2026-08-17 월
    expect(weekdayLabels('mon')[0]).toBe('월');
  });
  it('일요일 시작에서 일요일이 0이다', () => {
    expect(weekdayIndex(new Date(2026, 7, 16), 'sun')).toBe(0); // 2026-08-16 일
    expect(weekdayLabels('sun')[0]).toBe('일');
  });
});

describe('ymRange', () => {
  it('한 달 안이면 하나만 낸다', () => {
    expect(ymRange('2026-08-01', '2026-08-31')).toEqual(['2026-08']);
  });
  it('달을 걸치면 모두 낸다 — 월 단위 조회 인덱스의 근거', () => {
    expect(ymRange('2026-01-28', '2026-03-03')).toEqual(['2026-01', '2026-02', '2026-03']);
  });
  it('종료가 시작보다 앞이면 시작 달만 낸다', () => {
    expect(ymRange('2026-08-10', '2026-08-01')).toEqual(['2026-08']);
  });
});

describe('spanDays', () => {
  it('양끝을 포함한다', () => {
    expect(spanDays('2026-08-01', '2026-08-03')).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });
  it('종료일이 없으면 하루짜리다', () => {
    expect(spanDays('2026-08-01')).toEqual(['2026-08-01']);
  });
});

describe('daysBetween', () => {
  it('일수 차를 낸다', () => {
    expect(daysBetween('2026-08-01', '2026-08-08')).toBe(7);
    expect(daysBetween('2026-08-08', '2026-08-01')).toBe(-7);
  });
  it('서머타임 전환 구간에서도 정수 일수를 낸다', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
});

describe('localDateOf', () => {
  it('순간에서 그 기기의 벽시계 날짜를 뽑는다', () => {
    // 이 저장소의 테스트는 TZ=Asia/Seoul 로 돈다. 08:00 KST 는 UTC 로 전날 23:00 이라
    // toISOString().slice(0, 10) 은 하루 앞선 날짜를 낸다.
    const instant = '2026-09-10T08:00:00+09:00';
    expect(new Date(instant).toISOString().slice(0, 10)).toBe('2026-09-09');
    expect(localDateOf(instant)).toBe('2026-09-10');
  });

  it('깨진 값에는 빈 문자열을 낸다', () => {
    expect(localDateOf('')).toBe('');
    expect(localDateOf('어제')).toBe('');
  });
});
