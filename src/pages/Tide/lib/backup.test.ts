import { describe, expect, it } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  decodeBackup,
  encodeBackup,
  readBackupFromHash,
} from './backup';
import type { State } from './types';

const sample: State = {
  balance: { amount: 1_900_000, checkedAt: '2026-03-07T09:00:00.000Z' },
  entries: [
    { id: 'a', name: '월세', amount: 600_000, kind: 'expense', schedule: { type: 'monthly', day: 10 } },
    {
      id: 'b',
      name: '통신비 📱',
      amount: 55_000,
      kind: 'expense',
      schedule: { type: 'monthly', day: 20 },
    },
    {
      id: 'c',
      name: '경조사',
      amount: 100_000,
      kind: 'income',
      schedule: { type: 'once', date: '2026-04-02' },
    },
    {
      id: 'd',
      name: '주급',
      amount: 200_000,
      kind: 'income',
      schedule: { type: 'every', days: 7, anchor: '2026-03-10' },
    },
  ],
};

describe('base64url', () => {
  it('한글과 이모지를 안전하게 왕복한다', () => {
    const text = '월세 600,000원 📱 — 정산';
    expect(base64UrlDecode(base64UrlEncode(text))).toBe(text);
  });

  it('URL에 그대로 넣을 수 있는 문자만 쓴다', () => {
    const encoded = base64UrlEncode('?'.repeat(50) + '한글');
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('encode/decode', () => {
  it('상태 전체를 왕복한다', () => {
    const result = decodeBackup(encodeBackup(sample, new Date('2026-03-07T09:00:00Z')));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(sample);
    expect(result.exportedAt).toBe('2026-03-07T09:00:00.000Z');
  });

  it('깨진 payload를 거부한다', () => {
    expect(decodeBackup('!!!not-base64!!!').ok).toBe(false);
    expect(decodeBackup(base64UrlEncode('{"nope":1}')).ok).toBe(false);
    expect(decodeBackup(base64UrlEncode('not json at all')).ok).toBe(false);
  });

  it('모양이 맞지 않는 상태를 거부한다 — 덮어쓰기 전에 걸러야 한다', () => {
    const broken = base64UrlEncode(
      JSON.stringify({ v: 1, t: '', s: { payday: 99, balance: {}, fixed: [] } }),
    );
    expect(decodeBackup(broken).ok).toBe(false);
  });

  it('v1 시절에 만든 백업 링크도 그대로 열린다', () => {
    // 실제로 배포됐던 v1 페이로드 모양.
    const v1 = base64UrlEncode(
      JSON.stringify({
        v: 1,
        t: '2026-03-07T09:00:00.000Z',
        s: {
          payday: 25,
          balance: { amount: 1_900_000, checkedAt: '2026-03-07T09:00:00.000Z' },
          fixed: [{ id: 'a', name: '월세', amount: 600_000, day: 10 }],
        },
      }),
    );
    const result = decodeBackup(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.entries[0]).toEqual({
      id: 'a',
      name: '월세',
      amount: 600_000,
      kind: 'expense',
      schedule: { type: 'monthly', day: 10 },
    });
    // v1의 급여일은 0원 급여 입금으로 살아난다 — 주기 기준이 유지된다.
    expect(result.state.entries[1]).toMatchObject({
      name: '급여',
      kind: 'income',
      schedule: { type: 'monthly', day: 25 },
    });
    expect(result.state.balance.amount).toBe(1_900_000);
  });

  it('더 최신 스키마 버전의 백업을 거부한다', () => {
    const future = base64UrlEncode(JSON.stringify({ v: 99, t: '', s: sample }));
    const result = decodeBackup(future);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('최신 버전');
  });
});

describe('readBackupFromHash', () => {
  it('해시에서 payload를 꺼낸다', () => {
    expect(readBackupFromHash('#b=abc123')).toBe('abc123');
    expect(readBackupFromHash('b=abc123')).toBe('abc123');
  });

  it('다른 파라미터와 섞여 있어도 찾는다', () => {
    expect(readBackupFromHash('#x=1&b=abc&y=2')).toBe('abc');
  });

  it('없으면 null이다', () => {
    expect(readBackupFromHash('')).toBeNull();
    expect(readBackupFromHash('#')).toBeNull();
    expect(readBackupFromHash('#other=1')).toBeNull();
    expect(readBackupFromHash('#b=')).toBeNull();
  });
});
