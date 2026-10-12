/**
 * 계산 창이 30달을 넘을 때의 조회 나누기 · 합치기.
 *
 * `array-contains-any` 는 값 30개까지다. 예전에는 31번째 달부터 조용히 잘렸다.
 */
import { describe, expect, it } from 'vitest';
import {
  chunkMonths, combineChunks, earliestAsOfOf, tideWindow, tideWindowReaches,
  TIDE_WINDOW_MAX_BACK_MONTHS, type SnapMeta,
} from './repo';

const LIVE: SnapMeta = { fromCache: false, hasPendingWrites: false };
const CACHE: SnapMeta = { fromCache: true, hasPendingWrites: false };
const item = (id: string, updatedAt = '') => ({ id, updatedAt });

describe('chunkMonths', () => {
  it('30달씩 나누고 같은 달은 한 번만 넣는다', () => {
    const months = tideWindow('2026-10-12', '2023-01-05');
    const chunks = chunkMonths([...months, months[0]!]);
    expect(chunks.every((c) => c.length <= 30)).toBe(true);
    expect(chunks.flat()).toEqual(months);
  });

  it('30달 이하는 한 조각이다 — 지금과 같은 조회 한 번', () => {
    expect(chunkMonths(tideWindow('2026-10-12'))).toHaveLength(1);
  });
});

describe('combineChunks', () => {
  it('모든 조각이 한 번씩 오기 전에는 내보내지 않는다', () => {
    const out: string[][] = [];
    const c = combineChunks<{ id: string; updatedAt: string }>(3, (items) => out.push(items.map((x) => x.id)));
    c.sinks[0]!([item('a')], LIVE);
    c.sinks[2]!([item('c')], LIVE);
    expect(out).toEqual([]);
    c.sinks[1]!([item('b')], LIVE);
    expect(out).toEqual([['a', 'b', 'c']]);
  });

  it('두 조각에 걸린 문서는 한 번만, 늦게 고친 판으로 담는다', () => {
    let got: { id: string; updatedAt: string }[] = [];
    const c = combineChunks<{ id: string; updatedAt: string }>(2, (items) => { got = items; });
    c.sinks[0]!([item('x', '2026-10-01T00:00:00Z')], LIVE);
    c.sinks[1]!([item('x', '2026-10-02T00:00:00Z'), item('y')], LIVE);
    expect(got.map((x) => x.id)).toEqual(['x', 'y']);
    expect(got[0]!.updatedAt).toBe('2026-10-02T00:00:00Z');
  });

  it('하나라도 캐시 · 미확정이면 합친 것도 그렇다', () => {
    const metas: SnapMeta[] = [];
    const c = combineChunks<{ id: string }>(2, (_i, m) => metas.push(m));
    c.sinks[0]!([], LIVE);
    c.sinks[1]!([], CACHE);
    c.sinks[0]!([], { fromCache: false, hasPendingWrites: true });
    expect(metas[0]).toEqual({ fromCache: true, hasPendingWrites: false });
    expect(metas[1]).toEqual({ fromCache: true, hasPendingWrites: true });
  });

  it('문서가 그대로면 같은 배열을 돌려준다 — 위쪽 useMemo 가 헛돌지 않게', () => {
    const lists: unknown[] = [];
    const c = combineChunks<{ id: string }>(2, (items) => lists.push(items));
    const a = [item('a')];
    const b = [item('b')];
    c.sinks[0]!(a, CACHE);
    c.sinks[1]!(b, CACHE);
    c.sinks[0]!(a, LIVE);
    expect(lists[0]).toBe(lists[1]);
    c.sinks[1]!([item('b'), item('c')], LIVE);
    expect(lists[2]).not.toBe(lists[1]);
  });

  it('한 조각이 실패하면 그 뒤로는 내보내지 않는다 — 실패 상태를 덮지 않는다', () => {
    const out: number[] = [];
    const c = combineChunks<{ id: string }>(2, (items) => out.push(items.length));
    c.sinks[0]!([item('a')], LIVE);
    c.sinks[1]!([], LIVE);
    expect(c.fail()).toBe(true);
    expect(c.fail()).toBe(false);
    c.sinks[0]!([item('a'), item('b')], LIVE);
    expect(out).toEqual([1]);
  });
});

describe('tideWindow — 잔고 기준일', () => {
  it('기준일이 없거나 창 안이면 지금과 같다', () => {
    expect(tideWindow('2026-10-12', null)).toEqual(tideWindow('2026-10-12'));
    expect(tideWindow('2026-10-12', '2026-09-30')).toEqual(tideWindow('2026-10-12'));
    expect(tideWindow('2026-10-12', '2026-10-12')).toEqual(tideWindow('2026-10-12'));
  });

  it('기준일의 달까지 거슬러 가고 앞쪽 끝은 그대로다', () => {
    const w = tideWindow('2026-10-12', '2024-02-29');
    expect(w[0]).toBe('2024-02');
    expect(w.at(-1)).toBe(tideWindow('2026-10-12').at(-1));
    expect(w).toHaveLength(32 + 1 + 14);
    expect(tideWindowReaches(w, '2024-02-29')).toBe(true);
  });

  it('상한보다 오래된 기준일에는 닿지 않는다고 말한다', () => {
    const w = tideWindow('2026-10-12', '2010-01-01');
    expect(w).toHaveLength(TIDE_WINDOW_MAX_BACK_MONTHS + 1 + 14);
    expect(tideWindowReaches(w, '2010-01-01')).toBe(false);
    expect(chunkMonths(w).length).toBeLessThanOrEqual(5);
  });

  it('가장 이른 기준일을 고른다', () => {
    expect(earliestAsOfOf([{ asOf: '2026-09-01' }, { asOf: '2025-12-31' }])).toBe('2025-12-31');
    expect(earliestAsOfOf([])).toBeNull();
  });
});
