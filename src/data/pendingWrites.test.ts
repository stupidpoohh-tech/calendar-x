/**
 * 실패한 쓰기의 보관과 갈래 판정.
 *
 * 저장소가 막혀 있을 수 있고, 남의 계정 것이 섞이면 안 되고, 오프라인 대기와 서버 거절은
 * 같은 자리에 오면 안 된다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canPersistFailed, isOfflineError, loadFailed, saveFailed, type PendingOp,
} from './pendingWrites';

const op = (over: Partial<PendingOp> = {}): PendingOp => ({
  id: 'op1', kind: 'entry', label: '항목', summary: '치과',
  payload: { id: 'e1', updatedAt: '2026-09-10T00:00:00.000Z' } as never,
  at: '2026-09-10T01:00:00.000Z', reason: '권한 없음', tries: 0, ...over,
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('보관', () => {
  it('적었다가 그대로 읽는다', () => {
    expect(saveFailed('u1', [op()])).toBe(true);
    expect(loadFailed('u1')).toEqual([op()]);
  });

  it('계정마다 자리가 다르다', () => {
    saveFailed('u1', [op({ summary: 'A 것' })]);
    saveFailed('u2', [op({ summary: 'B 것' })]);
    expect(loadFailed('u1')[0]?.summary).toBe('A 것');
    expect(loadFailed('u2')[0]?.summary).toBe('B 것');
  });

  it('빈 목록을 적으면 자리를 지운다', () => {
    saveFailed('u1', [op()]);
    saveFailed('u1', []);
    expect(localStorage.getItem('calendarx.failed.u1')).toBeNull();
    expect(loadFailed('u1')).toEqual([]);
  });

  it('깨진 값은 버리고 멀쩡한 것만 읽는다', () => {
    // 남은 것을 못 읽어 목록 전체가 쓸모없어지면 안 된다.
    localStorage.setItem('calendarx.failed.u1', JSON.stringify([
      op(), { id: 'x' }, null, 7, { ...op({ id: 'op2' }), kind: '알 수 없는 종류' },
    ]));
    const back = loadFailed('u1');
    expect(back).toHaveLength(1);
    expect(back[0]?.id).toBe('op1');
  });

  it('JSON 이 아니면 빈 목록으로 본다', () => {
    localStorage.setItem('calendarx.failed.u1', '{{{');
    expect(loadFailed('u1')).toEqual([]);
  });

  it('tries 가 없으면 0 으로 채운다', () => {
    const { tries: _drop, ...noTries } = op();
    localStorage.setItem('calendarx.failed.u1', JSON.stringify([noTries]));
    expect(loadFailed('u1')[0]?.tries).toBe(0);
  });

  it('저장소가 막혀 있으면 그 사실을 돌려준다', () => {
    // 사생활 보호 모드에서 setItem 이 던진다. 삼키면 "남겨 두었습니다" 가 거짓말이 된다.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('막힘'); });
    expect(canPersistFailed()).toBe(false);
    expect(saveFailed('u1', [op()])).toBe(false);
    expect(loadFailed('u1')).toEqual([]);
  });
});

describe('오프라인과 거절을 가른다', () => {
  it('unavailable 은 연결 문제다', () => {
    expect(isOfflineError({ code: 'unavailable' })).toBe(true);
    expect(isOfflineError({ code: 'deadline-exceeded' })).toBe(true);
  });

  it('규칙 거절은 연결 문제가 아니다', () => {
    expect(isOfflineError({ code: 'permission-denied' })).toBe(false);
    expect(isOfflineError({ code: 'invalid-argument' })).toBe(false);
  });

  it('브라우저가 오프라인이라고 하면 연결 문제로 본다', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(isOfflineError({ code: 'permission-denied' })).toBe(true);
    spy.mockRestore();
  });
});
