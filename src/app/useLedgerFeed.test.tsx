/**
 * 결산 범위 구독 — 범위가 바뀌면 앞 범위의 목록을 물려주지 않는다.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SnapMeta } from '../data/repo';

const subs: { months: string[]; push: (items: unknown[], meta: SnapMeta) => void; alive: boolean }[] = [];
vi.mock('../data/firebase', () => ({ getFirebase: () => ({ db: {} }) }));
vi.mock('../data/repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/repo')>()),
  subscribeEntriesForMonths: (_db: unknown, _uid: string, months: string[], cb: unknown) => {
    const sub = { months, push: cb as (items: unknown[], meta: SnapMeta) => void, alive: true };
    subs.push(sub);
    return () => { sub.alive = false; };
  },
}));

const { useLedgerFeed } = await import('./useLedgerFeed');
const LIVE: SnapMeta = { fromCache: false, hasPendingWrites: false };

describe('useLedgerFeed', () => {
  it('꺼져 있으면 구독하지 않는다', () => {
    subs.length = 0;
    renderHook(() => useLedgerFeed('u1', ['2026-09'], false));
    expect(subs).toHaveLength(0);
  });

  it('범위가 바뀌면 앞 범위의 목록과 준비 상태를 버리고 새로 받는다', () => {
    subs.length = 0;
    const { result, rerender } = renderHook(({ m }: { m: string[] }) => useLedgerFeed('u1', m, true), {
      initialProps: { m: ['2026-09', '2026-10'] },
    });
    act(() => { subs[0]!.push([{ id: 'a' }], LIVE); });
    expect(result.current.feed.ready).toBe(true);
    expect(result.current.items).toHaveLength(1);

    rerender({ m: ['2025-01', '2025-02'] });
    expect(subs[0]!.alive).toBe(false);
    expect(result.current.feed.ready).toBe(false);
    expect(result.current.items).toEqual([]);
    // 끊긴 앞 구독의 늦은 발화는 새 범위에 섞이지 않는다.
    act(() => { subs[0]!.push([{ id: 'late' }], LIVE); });
    expect(result.current.items).toEqual([]);
    act(() => { subs[1]!.push([{ id: 'b' }], LIVE); });
    expect(result.current.items.map((e) => e.id)).toEqual(['b']);
  });
});
