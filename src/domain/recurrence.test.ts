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
