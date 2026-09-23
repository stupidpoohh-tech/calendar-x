import { beforeEach, describe, expect, it } from 'vitest';
import { base64UrlEncode, decodeBackup, encodeBackup } from './backup';
import { loadState, migrateToCurrent, saveState, SCHEMA_VERSION } from './storage';
import { type State, isISODate } from './types';

const sample = (): State => ({
  balance: { amount: -100, checkedAt: '2026-09-23T00:00:00Z' },
  entries: [{ id: 'e', name: '지출', amount: 100, kind: 'expense', schedule: { type: 'once', date: '2026-09-23' }, budgetId: 'b' }],
  budgets: [{ id: 'b', name: '생활비', amount: 700_000, start: '2026-09-01', end: '2026-09-30' }],
  reserves: [{ id: 'r', name: '비상금', amount: 200_000 }],
});
const decode = (s: unknown, v = SCHEMA_VERSION) => decodeBackup(base64UrlEncode(JSON.stringify({ v, t: '2026-09-23T00:00:00Z', s })));
beforeEach(() => localStorage.clear());

describe('원시 백업 검증', () => {
  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '0000-01-01'])('실존하지 않는 날짜 %s 거부', (date) => {
    const s = sample(); s.entries[0]!.schedule = { type: 'once', date };
    expect(decode(s).ok).toBe(false);
  });
  it('윤년 날짜는 통과한다', () => expect(isISODate('2024-02-29')).toBe(true));
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '100'])('잘못된 지출 금액 %s 거부', (amount) => {
    const s = sample();
    expect(decode({ ...s, entries: [{ ...s.entries[0], amount }] }).ok).toBe(false);
  });
  it('잔고는 음수 정수를 허용하지만 소수는 거부', () => {
    expect(decode(sample()).ok).toBe(true);
    expect(decode({ ...sample(), balance: { ...sample().balance, amount: 1.5 } }).ok).toBe(false);
  });
  it.each(['entries', 'budgets', 'reserves'] as const)('%s 중복 ID 거부', (key) => {
    const s = sample(); expect(decode({ ...s, [key]: [s[key]![0], s[key]![0]] }).ok).toBe(false);
  });
  it.each(['budgets', 'reserves'] as const)('v5에서 %s 누락은 잘린 백업', (key) => {
    const s = sample(); delete s[key]; expect(decode(s).ok).toBe(false);
  });
  it('v4는 빈 예산·세이브를 추가하며 기존 기간 지출을 그대로 보존', () => {
    const s = { balance: sample().balance, entries: [{ id: 'e', name: '생활비', kind: 'expense', amount: 10_000, schedule: { type: 'span', start: '2026-09-01', end: '2026-09-30' } }] };
    const result = decode(s, 4);
    expect(result.ok && result.state).toEqual({ ...s, budgets: [], reserves: [] });
  });
  it('v4에 포함된 새 필드도 검증하여 보정으로 숨기지 않는다', () => {
    expect(decode({ ...sample(), budgets: null }, 4).ok).toBe(false);
    expect(decode({ ...sample(), reserves: [{ ...sample().reserves![0], amount: -1 }] }, 4).ok).toBe(false);
  });
  it('v1 잘못된 배열·null·중복을 변환 전에 거절하며 예외가 새지 않는다', () => {
    for (const fixed of [undefined, null, [null], [{ id: 'e', name: '월세', amount: 1, day: 1 }, { id: 'e', name: '월세', amount: 1, day: 1 }]]) {
      expect(decode({ balance: sample().balance, fixed }, 1).ok).toBe(false);
    }
    expect(migrateToCurrent(null, 1)).toBeNull();
  });
  it('저장·새로고침·백업 왕복에 예산·세이브·연결 ID가 모두 남는다', () => {
    const s = sample();
    expect(saveState(s)).toBe(true);
    expect(loadState()).toEqual({ status: 'ok', state: s });
    const result = decodeBackup(encodeBackup(s));
    expect(result.ok && result.state).toEqual(s);
  });
  it('잘못된 저장 시 기존 원문을 덮지 않는다', () => {
    saveState(sample());
    const original = localStorage.getItem('tideover.state');
    expect(saveState({ ...sample(), entries: [{ ...sample().entries[0]!, amount: -10 }] })).toBe(false);
    expect(localStorage.getItem('tideover.state')).toBe(original);
  });
  it('실존하지 않는 기록 날짜·잘못된 예산 기간을 거부', () => {
    expect(decode({ ...sample(), balance: { amount: 0, checkedAt: '2026-02-30T00:00:00Z' } }).ok).toBe(false);
    expect(decode({ ...sample(), budgets: [{ ...sample().budgets![0], end: '2026-08-31' }] }).ok).toBe(false);
  });
});
