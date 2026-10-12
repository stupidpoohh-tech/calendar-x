/**
 * 정산 기간 — 시작일 · 말일 보정 · 윤년 · 이어짐.
 */
import { describe, expect, it } from 'vitest';
import { addDaysISO } from './date';
import {
  clampSettleDay, monthsOfPeriods, periodByKey, periodName, periodOf, periodRange,
  periodsBetween, periodsOfYear, phaseOf, shiftPeriodKey,
} from './period';

describe('기간 만들기', () => {
  it('1일이면 달력의 한 달이다', () => {
    expect(periodByKey('2026-09', 1)).toEqual({ key: '2026-09', start: '2026-09-01', end: '2026-09-30' });
    expect(periodOf('2026-09-30', 1).key).toBe('2026-09');
  });

  it('25일이면 25일부터 다음 달 24일까지다. 이름은 날이 더 많이 든 달이다', () => {
    expect(periodByKey('2026-10', 25)).toEqual({ key: '2026-10', start: '2026-09-25', end: '2026-10-24' });
    expect(periodOf('2026-10-24', 25).key).toBe('2026-10');
    expect(periodOf('2026-10-25', 25).key).toBe('2026-11');
    expect(periodOf('2026-09-24', 25).key).toBe('2026-09');
  });

  it('15일까지는 시작하는 달, 16일부터는 다음 달이 이름이다', () => {
    expect(periodByKey('2026-10', 15)).toEqual({ key: '2026-10', start: '2026-10-15', end: '2026-11-14' });
    expect(periodByKey('2026-10', 16)).toEqual({ key: '2026-10', start: '2026-09-16', end: '2026-10-15' });
  });

  it('시작일을 1일 ↔ 25일로 바꿔도 오늘이 든 기간의 이름은 그대로다 — 기본 예산이 따라간다', () => {
    // 실제 화면에서 찾은 문제: 시작 달로 이름을 붙이면 25일로 바꾸는 순간 이름이 9월로 밀려
    // "10월부터" 의 기본 예산이 지금 기간에 걸리지 않았다.
    for (const today of ['2026-10-01', '2026-10-12', '2026-10-24']) {
      expect(periodOf(today, 25).key, today).toBe(periodOf(today, 1).key);
    }
  });

  it('없는 날은 말일로 당긴다 — 31일 기준 2월', () => {
    expect(periodByKey('2026-02', 31)).toEqual({ key: '2026-02', start: '2026-01-31', end: '2026-02-27' });
    expect(periodByKey('2026-03', 31)).toEqual({ key: '2026-03', start: '2026-02-28', end: '2026-03-30' });
    expect(periodByKey('2026-04', 31)).toEqual({ key: '2026-04', start: '2026-03-31', end: '2026-04-29' });
  });

  it('윤년 2월은 29일까지 간다', () => {
    expect(periodByKey('2028-03', 30)).toEqual({ key: '2028-03', start: '2028-02-29', end: '2028-03-29' });
    expect(periodByKey('2028-02', 1)!.end).toBe('2028-02-29');
    expect(periodOf('2028-02-29', 29).key).toBe('2028-03');
    expect(periodOf('2028-02-28', 29).key).toBe('2028-02');
  });

  it('해를 넘긴다', () => {
    expect(periodByKey('2027-01', 25)).toEqual({ key: '2027-01', start: '2026-12-25', end: '2027-01-24' });
    expect(shiftPeriodKey('2026-12', 1)).toBe('2027-01');
    expect(shiftPeriodKey('2027-01', -1)).toBe('2026-12');
  });

  it('모든 시작일에서 기간이 빈틈없이 이어진다 — 4년 동안', () => {
    for (let day = 1; day <= 31; day++) {
      const ps = periodsBetween('2026-01', '2029-12', day);
      expect(ps).toHaveLength(48);
      for (let i = 1; i < ps.length; i++) {
        expect(ps[i]!.start, `${day}일 ${ps[i]!.key}`).toBe(addDaysISO(ps[i - 1]!.end, 1));
        expect(ps[i]!.start <= ps[i]!.end).toBe(true);
      }
      // 기간 안의 아무 날이든 그 기간으로 돌아온다.
      for (const p of ps) {
        expect(periodOf(p.start, day).key).toBe(p.key);
        expect(periodOf(p.end, day).key).toBe(p.key);
      }
    }
  });

  it('잘못된 시작일 · 열쇠는 안전하게 다룬다', () => {
    expect(clampSettleDay(0)).toBe(1);
    expect(clampSettleDay(32)).toBe(1);
    expect(clampSettleDay(2.5)).toBe(1);
    expect(clampSettleDay('25')).toBe(1);
    expect(clampSettleDay(25)).toBe(25);
    expect(periodByKey('2026-13', 1)).toBeNull();
    expect(periodByKey('nope', 1)).toBeNull();
  });
});

describe('기간 묶음', () => {
  it('한 해의 열두 기간', () => {
    const ps = periodsOfYear(2026, 25);
    expect(ps.map((p) => p.key)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    ]);
    expect(ps[0]!.start).toBe('2025-12-25');
    expect(ps[11]!.end).toBe('2026-12-24');
  });

  it('기간들이 걸친 달 — 조회 범위', () => {
    expect(monthsOfPeriods(periodsBetween('2026-10', '2026-11', 25))).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(monthsOfPeriods(periodsOfYear(2026, 1))).toHaveLength(12);
  });

  it('지남 · 진행 중 · 앞으로', () => {
    const p = periodByKey('2026-10', 25)!;
    expect(phaseOf(p, '2026-09-24')).toBe('future');
    expect(phaseOf(p, '2026-09-25')).toBe('current');
    expect(phaseOf(p, '2026-10-24')).toBe('current');
    expect(phaseOf(p, '2026-10-25')).toBe('past');
  });

  it('이름과 범위를 함께 적는다', () => {
    expect(periodName('2026-09')).toBe('2026년 9월');
    expect(periodRange(periodByKey('2026-10', 25)!)).toBe('9.25 – 10.24');
    expect(periodRange(periodByKey('2027-01', 25)!)).toBe('2026.12.25 – 2027.1.24');
  });
});
