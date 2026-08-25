import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, migrateToCurrent } from './storage';

const v1 = {
  payday: 25,
  balance: { amount: 1_900_000, checkedAt: '2026-03-07T09:00:00.000Z' },
  fixed: [
    { id: 'a', name: '월세', amount: 600_000, day: 10 },
    { id: 'b', name: '통신비', amount: 55_000, day: 20 },
  ],
};

const v2 = {
  payday: 25,
  balance: { amount: 1_900_000, checkedAt: '2026-03-07T09:00:00.000Z' },
  entries: [
    {
      id: 'a',
      name: '월세',
      amount: 600_000,
      kind: 'expense',
      schedule: { type: 'monthly', day: 10 },
    },
  ],
};

describe('migrateToCurrent', () => {
  it('v1: fixed[]가 출금 entries[]로, 급여일이 급여 입금으로 올라간다', () => {
    const state = migrateToCurrent(v1, 1);
    expect(state).not.toBeNull();
    expect(state?.entries.slice(0, 2)).toEqual([
      {
        id: 'a',
        name: '월세',
        amount: 600_000,
        kind: 'expense',
        schedule: { type: 'monthly', day: 10 },
      },
      {
        id: 'b',
        name: '통신비',
        amount: 55_000,
        kind: 'expense',
        schedule: { type: 'monthly', day: 20 },
      },
    ]);
    expect(state?.entries[2]).toMatchObject({
      name: '급여',
      amount: 0,
      kind: 'income',
      schedule: { type: 'monthly', day: 25 },
    });
    expect((state as unknown as Record<string, unknown>).payday).toBeUndefined();
  });

  it('v2: 급여일이 0원 급여 입금으로 바뀌고 필드는 사라진다', () => {
    const state = migrateToCurrent(v2, 2);
    expect(state?.entries).toHaveLength(2);
    expect(state?.entries[1]).toMatchObject({
      name: '급여',
      kind: 'income',
      schedule: { type: 'monthly', day: 25 },
    });
    expect((state as unknown as Record<string, unknown>).payday).toBeUndefined();
  });

  it('v2: 급여일과 같은 날의 입금이 이미 있으면 중복으로 넣지 않는다', () => {
    const withSalary = {
      ...v2,
      entries: [
        ...v2.entries,
        {
          id: 's',
          name: '월급',
          amount: 2_000_000,
          kind: 'income',
          schedule: { type: 'monthly', day: 25 },
        },
      ],
    };
    const state = migrateToCurrent(withSalary, 2);
    expect(state?.entries).toHaveLength(2);
    expect(state?.entries.filter((e) => e.kind === 'income')).toHaveLength(1);
  });

  it('현재 버전 데이터는 그대로 통과한다 (N일마다 포함)', () => {
    const current = {
      balance: { amount: 0, checkedAt: '2026-03-07T09:00:00.000Z' },
      entries: [
        {
          id: 'x',
          name: '주급',
          amount: 200_000,
          kind: 'income',
          schedule: { type: 'every', days: 7, anchor: '2026-03-10' },
        },
      ],
    };
    expect(migrateToCurrent(current, SCHEMA_VERSION)).toEqual(current);
  });

  it('모양이 깨진 데이터는 null이다 — 덮어쓰기 전에 걸러야 한다', () => {
    expect(migrateToCurrent({ balance: {} }, SCHEMA_VERSION)).toBeNull();
    expect(migrateToCurrent(null, SCHEMA_VERSION)).toBeNull();
    expect(migrateToCurrent({ ...v1, fixed: [{ id: 'a' }] }, 1)).toBeNull();
    // days가 0이거나 음수인 every 스케줄은 거부한다.
    expect(
      migrateToCurrent(
        {
          balance: { amount: 0, checkedAt: '2026-03-07T09:00:00.000Z' },
          entries: [
            {
              id: 'x',
              name: '깨짐',
              amount: 1,
              kind: 'expense',
              schedule: { type: 'every', days: 0, anchor: '2026-03-10' },
            },
          ],
        },
        SCHEMA_VERSION,
      ),
    ).toBeNull();
  });

  it('span 스케줄을 검증한다 — 끝이 시작보다 앞서면 거부', () => {
    const base = { balance: { amount: 0, checkedAt: '2026-03-07T09:00:00.000Z' } };
    const mk = (start: string, end: string) => ({
      ...base,
      entries: [
        { id: 'x', name: '생활비', amount: 100_000, kind: 'expense', schedule: { type: 'span', start, end } },
      ],
    });
    expect(migrateToCurrent(mk('2026-03-05', '2026-03-15'), SCHEMA_VERSION)).not.toBeNull();
    expect(migrateToCurrent(mk('2026-03-15', '2026-03-05'), SCHEMA_VERSION)).toBeNull();
  });

  it('변환 경로가 없는 버전은 null이다', () => {
    expect(migrateToCurrent(v1, 0)).toBeNull();
  });
});
