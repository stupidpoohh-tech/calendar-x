import { describe, expect, it } from 'vitest';
import { newEntry, setRecurrence } from './entry';
import { baseIdOf, describeRecurrence, expandEntry, materialize, occurrenceDateOf } from './recurrence';
import type { Entry, Recurrence } from './types';

const rule = (p: Partial<Recurrence>): Recurrence =>
  ({ freq: 'weekly', interval: 1, until: null, count: null, ...p });

function repeating(p: Partial<Entry>, r: Recurrence): Entry {
  return setRecurrence(newEntry('task', { startDate: '2026-08-03', ...p }), r);
}

describe('expandEntry', () => {
  it('매주 반복을 구간 안에서 펼친다', () => {
    const e = repeating({}, rule({ freq: 'weekly' }));
    const out = expandEntry(e, '2026-08-01', '2026-08-31');
    expect(out.map((o) => o.startDate)).toEqual([
      '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31',
    ]);
  });

  it('interval 을 반영한다 (격주)', () => {
    const e = repeating({}, rule({ freq: 'weekly', interval: 2 }));
    const out = expandEntry(e, '2026-08-01', '2026-08-31');
    expect(out.map((o) => o.startDate)).toEqual(['2026-08-03', '2026-08-17', '2026-08-31']);
  });

  it('until 을 넘지 않는다', () => {
    const e = repeating({}, rule({ freq: 'weekly', until: '2026-08-17' }));
    const out = expandEntry(e, '2026-08-01', '2026-08-31');
    expect(out.map((o) => o.startDate)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17']);
  });

  it('count 를 넘지 않는다 (최초 발생을 1로 센다)', () => {
    const e = repeating({}, rule({ freq: 'daily', count: 3 }));
    const out = expandEntry(e, '2026-08-01', '2026-08-31');
    expect(out.map((o) => o.startDate)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
  });

  it('매월 반복에서 말일이 밀리지 않는다', () => {
    const e = repeating({ startDate: '2026-01-31' }, rule({ freq: 'monthly' }));
    const out = expandEntry(e, '2026-01-01', '2026-04-30');
    expect(out.map((o) => o.startDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('구간 앞에서 시작해 구간으로 이어지는 기간형 발생분을 포함한다', () => {
    const e = repeating({ startDate: '2026-08-03', endDate: '2026-08-06' }, rule({ freq: 'weekly' }));
    const out = expandEntry(e, '2026-08-05', '2026-08-05');
    expect(out).toHaveLength(1);
    expect(out[0]?.startDate).toBe('2026-08-03');
    expect(out[0]?.endDate).toBe('2026-08-06');
  });

  it('구간 앞에서 끝난 발생분은 뺀다', () => {
    const e = repeating({}, rule({ freq: 'weekly' }));
    const out = expandEntry(e, '2026-08-15', '2026-08-31');
    expect(out.map((o) => o.startDate)).toEqual(['2026-08-17', '2026-08-24', '2026-08-31']);
  });

  it('반복이 없으면 아무것도 펼치지 않는다', () => {
    expect(expandEntry(newEntry('task'), '2026-08-01', '2026-08-31')).toEqual([]);
  });
});

describe('발생분 id', () => {
  it('원본 id 로 되돌릴 수 있다 — 편집·삭제는 원본을 향한다', () => {
    const e = repeating({}, rule({ freq: 'daily' }));
    const first = expandEntry(e, '2026-08-03', '2026-08-03')[0];
    expect(first).toBeDefined();
    expect(baseIdOf(first!.id)).toBe(e.id);
    expect(occurrenceDateOf(first!.id)).toBe('2026-08-03');
  });
  it('반복이 아닌 id 는 그대로 둔다', () => {
    expect(baseIdOf('plain-id')).toBe('plain-id');
    expect(occurrenceDateOf('plain-id')).toBeNull();
  });
});

describe('materialize', () => {
  it('반복 원본을 전개분으로 대체해 첫날 중복을 막는다', () => {
    const rep = repeating({ title: '스크럼' }, rule({ freq: 'weekly' }));
    const once = newEntry('task', { title: '단발', startDate: '2026-08-05' });
    const out = materialize([rep, once], '2026-08-01', '2026-08-14');
    expect(out.filter((o) => o.title === '스크럼').map((o) => o.startDate))
      .toEqual(['2026-08-03', '2026-08-10']);
    expect(out.filter((o) => o.id === rep.id)).toHaveLength(0);
    expect(out.filter((o) => o.id === once.id)).toHaveLength(1);
  });

  it('가계부 항목도 반복한다 — 월세·구독료', () => {
    const rent = setRecurrence(
      newEntry('money', { startDate: '2026-01-05', money: { type: 'expense', amountMinor: 700_000, currency: 'KRW', linkedEntryId: null } }),
      rule({ freq: 'monthly' }),
    );
    const out = materialize([rent], '2026-01-01', '2026-03-31');
    expect(out.map((o) => o.startDate)).toEqual(['2026-01-05', '2026-02-05', '2026-03-05']);
  });
});

describe('describeRecurrence', () => {
  it('사람이 읽는 문장을 낸다', () => {
    expect(describeRecurrence(null)).toBe('반복 없음');
    expect(describeRecurrence(rule({ freq: 'weekly' }))).toBe('매주');
    expect(describeRecurrence(rule({ freq: 'weekly', interval: 2 }))).toBe('2주마다');
    expect(describeRecurrence(rule({ freq: 'daily', count: 5 }))).toBe('매일 · 5회');
    expect(describeRecurrence(rule({ freq: 'monthly', until: '2026-12-31' }))).toBe('매월 · 2026-12-31까지');
  });
});

describe('오래된 반복 — 원점에서 멀어도 사라지지 않는다', () => {
  it('2025-01-01 시작 매일 반복이 2026-09 월에 전부 뜬다', () => {
    // 608칸 떨어져 있다. 원점부터 세면 상한(400)이 먼저 잘라 한 건도 남지 않았다.
    const e = repeating({ startDate: '2025-01-01' }, rule({ freq: 'daily' }));
    const out = expandEntry(e, '2026-09-01', '2026-09-30');
    expect(out).toHaveLength(30);
    expect(out[0]?.startDate).toBe('2026-09-01');
    expect(out[29]?.startDate).toBe('2026-09-30');
  });

  it('materialize 로도 같다', () => {
    const e = repeating({ startDate: '2025-01-01' }, rule({ freq: 'daily' }));
    expect(materialize([e], '2026-09-01', '2026-09-30')).toHaveLength(30);
  });

  it('10년 전 시작 매주 반복도 그 달에 뜬다', () => {
    const e = repeating({ startDate: '2016-01-06' }, rule({ freq: 'weekly' }));
    const out = expandEntry(e, '2026-09-01', '2026-09-30');
    // 2016-01-06 은 수요일. 2026년 9월의 수요일은 2·9·16·23·30.
    expect(out.map((o) => o.startDate)).toEqual([
      '2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30',
    ]);
  });

  it('오래된 매월 반복도 그 달의 지정일에 뜬다', () => {
    const e = repeating({ startDate: '2015-03-25' }, rule({ freq: 'monthly' }));
    expect(expandEntry(e, '2026-09-01', '2026-09-30').map((o) => o.startDate))
      .toEqual(['2026-09-25']);
  });

  it('간격이 있는 오래된 반복도 위상이 맞는다', () => {
    // 2025-01-01 부터 3일마다. 2026-09-01 까지 608일 → 608 = 3·202 + 2.
    // 따라서 9월의 첫 발생은 2025-01-01 + 3·203 = 2026-09-02.
    const e = repeating({ startDate: '2025-01-01' }, rule({ freq: 'daily', interval: 3 }));
    const out = expandEntry(e, '2026-09-01', '2026-09-30');
    // 3일 간격이 그대로 유지된다.
    expect(out.map((o) => o.startDate)).toEqual([
      '2026-09-02', '2026-09-05', '2026-09-08', '2026-09-11', '2026-09-14',
      '2026-09-17', '2026-09-20', '2026-09-23', '2026-09-26', '2026-09-29',
    ]);
  });

  it('건너뛰어도 count 는 원점부터 센다', () => {
    // 2025-01-01 부터 매일 10회 → 2025-01-10 에 끝난다. 2026-09 에는 없다.
    const e = repeating({ startDate: '2025-01-01' }, rule({ freq: 'daily', count: 10 }));
    expect(expandEntry(e, '2026-09-01', '2026-09-30')).toEqual([]);
    expect(expandEntry(e, '2025-01-01', '2025-01-31')).toHaveLength(10);
  });

  it('건너뛰어도 until 은 그대로 끊는다', () => {
    const e = repeating({ startDate: '2025-01-01' }, rule({ freq: 'daily', until: '2026-09-10' }));
    const out = expandEntry(e, '2026-09-01', '2026-09-30');
    expect(out).toHaveLength(10);
    expect(out[9]?.startDate).toBe('2026-09-10');
  });

  it('구간 앞에서 시작해 구간으로 이어지는 기간형 반복도 잡는다', () => {
    // 매월 28일에 시작해 5일짜리. 8월 28일 발생분이 9월 1일까지 걸친다.
    const e = repeating(
      { startDate: '2025-01-28', endDate: '2025-02-01' },
      rule({ freq: 'monthly' }),
    );
    const out = expandEntry(e, '2026-09-01', '2026-09-30');
    expect(out.map((o) => o.startDate)).toEqual(['2026-08-28', '2026-09-28']);
    expect(out[0]?.endDate).toBe('2026-09-01');
  });

  it('말일 반복은 짧은 달에서 당겨지고 다음 달에 되돌아온다', () => {
    const e = repeating({ startDate: '2024-01-31' }, rule({ freq: 'monthly' }));
    expect(expandEntry(e, '2026-02-01', '2026-02-28').map((o) => o.startDate))
      .toEqual(['2026-02-28']);
    expect(expandEntry(e, '2026-03-01', '2026-03-31').map((o) => o.startDate))
      .toEqual(['2026-03-31']);
  });

  it('윤년 2월 29일 반복도 평년에는 28일로 당겨진다', () => {
    const e = repeating({ startDate: '2024-02-29' }, rule({ freq: 'monthly', interval: 12 }));
    expect(expandEntry(e, '2026-01-01', '2026-12-31').map((o) => o.startDate))
      .toEqual(['2026-02-28']);
    expect(expandEntry(e, '2028-01-01', '2028-12-31').map((o) => o.startDate))
      .toEqual(['2028-02-29']);
  });

  it('구간이 뒤집혀 있으면 아무것도 내지 않는다', () => {
    const e = repeating({ startDate: '2025-01-01' }, rule({ freq: 'daily' }));
    expect(expandEntry(e, '2026-09-30', '2026-09-01')).toEqual([]);
  });

  it('원점보다 앞선 구간에는 아무것도 없다', () => {
    const e = repeating({ startDate: '2026-09-01' }, rule({ freq: 'daily' }));
    expect(expandEntry(e, '2025-01-01', '2025-01-31')).toEqual([]);
  });
});
