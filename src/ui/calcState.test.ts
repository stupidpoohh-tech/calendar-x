/**
 * 계산 자료의 갈래 판정.
 *
 * 여기서 잘못 나누면 화면이 "없음" 과 "아직 못 받음" 을 같은 것으로 그린다.
 */
import { describe, expect, it } from 'vitest';
import { calcCaveat, calcHeadline, calcNotice, calcStateOf } from './calcState';

const feed = (over: Partial<Parameters<typeof calcStateOf>[0]> = {}) => calcStateOf({
  status: 'live', ready: true, empty: false, fromCache: false, pending: false, ...over,
});

describe('calcStateOf', () => {
  it('아직 못 받았으면 loading', () => {
    expect(feed({ status: 'loading', ready: false })).toEqual({ kind: 'loading' });
  });

  it('실패했으면 error — ready 여부와 무관하다', () => {
    expect(feed({ status: 'error', ready: false })).toEqual({ kind: 'error' });
    expect(feed({ status: 'error', ready: true })).toEqual({ kind: 'error' });
  });

  it('캐시에서 온 빈 목록은 "없음" 이 아니라 unconfirmed', () => {
    expect(feed({ status: 'cache', fromCache: true, empty: true })).toEqual({ kind: 'unconfirmed' });
  });

  it('서버가 확인한 빈 목록은 진짜 "없음" 이다', () => {
    expect(feed({ empty: true })).toEqual({ kind: 'ready', fromCache: false, pending: false });
  });

  it('캐시에 자료가 있으면 숫자는 내되 캐시 표시를 단다', () => {
    expect(feed({ status: 'cache', fromCache: true, empty: false }))
      .toEqual({ kind: 'ready', fromCache: true, pending: false });
  });

  it('미확정 쓰기를 그대로 전한다', () => {
    expect(feed({ pending: true })).toEqual({ kind: 'ready', fromCache: false, pending: true });
  });
});

describe('덧붙이는 말', () => {
  it('확정 상태에서는 아무 말도 하지 않는다', () => {
    expect(calcCaveat({ kind: 'ready', fromCache: false, pending: false })).toBeNull();
  });

  it('캐시 기준이면 완전성 한계를 말한다', () => {
    expect(calcCaveat({ kind: 'ready', fromCache: true, pending: false }))
      .toContain('다른 기기에서 적은 것은 아직 빠져 있을 수 있습니다');
  });

  it('미확정 쓰기가 있으면 그 사실을 말한다', () => {
    expect(calcCaveat({ kind: 'ready', fromCache: false, pending: true }))
      .toContain('서버가 확인하지 않은');
  });

  it('숫자를 못 낼 때는 갈래마다 다른 이유를 적는다', () => {
    expect(calcNotice({ kind: 'loading' })).toContain('불러오는 중');
    expect(calcNotice({ kind: 'error' })).toContain('불러오지 못했습니다');
    expect(calcNotice({ kind: 'unconfirmed' })).toContain('가릴 수 없습니다');

    expect(calcHeadline({ kind: 'loading' })).toBe('불러오는 중');
    expect(calcHeadline({ kind: 'error' })).toBe('불러오지 못함');
    expect(calcHeadline({ kind: 'unconfirmed' })).toBe('확인 전');
  });
});
