/**
 * 구독 계층 회귀 테스트.
 *
 * 지키려는 것 셋.
 *   1. 달력을 넘겨도 **계산 구독**은 다시 붙지 않는다 (화면용만 갈아탄다)
 *   2. 계정이 바뀌면 앞 계정의 자료가 한 렌더도 남지 않는다
 *   3. "아직 못 받았다" 와 "비어 있다" 와 "실패했다" 를 다른 상태로 내놓는다
 *
 * effect 를 하나로 묶어 두었을 때는 1번이 깨졌고, 그때 화면은 달을 넘길 때마다
 * 잠깐 빈 목록으로 계산해 머리 숫자가 깜빡였다.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '../domain/types';
import { newEntry } from '../domain/entry';
import type { SnapMeta } from '../data/repo';

type Kind = 'display-or-calc' | 'recurring' | 'accounts' | 'debts' | 'pins';

interface Sub {
  kind: Kind;
  uid: string;
  months: string[];
  push: (items: unknown[], meta: SnapMeta) => void;
  fail: (scope: string, err: unknown) => void;
  alive: boolean;
}

const subs: Sub[] = [];

const record = (kind: Kind, uid: string, months: string[], cb: unknown, onError: unknown): (() => void) => {
  const sub: Sub = {
    kind, uid, months,
    push: cb as Sub['push'],
    fail: onError as Sub['fail'],
    alive: true,
  };
  subs.push(sub);
  return () => { sub.alive = false; };
};

vi.mock('../data/firebase', () => ({ getFirebase: () => ({ db: {} }) }));

vi.mock('../data/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/repo')>();
  return {
    ...actual,
    subscribeEntriesForMonths: (_db: unknown, uid: string, months: string[], cb: unknown, onError: unknown) =>
      record('display-or-calc', uid, months, cb, onError),
    subscribeRecurringEntries: (_db: unknown, uid: string, cb: unknown, onError: unknown) =>
      record('recurring', uid, [], cb, onError),
    subscribeAccounts: (_db: unknown, uid: string, cb: unknown, onError: unknown) =>
      record('accounts', uid, [], cb, onError),
    subscribeDebts: (_db: unknown, uid: string, cb: unknown, onError: unknown) =>
      record('debts', uid, [], cb, onError),
    subscribePins: (_db: unknown, uid: string, cb: unknown, onError: unknown) =>
      record('pins', uid, [], cb, onError),
  };
});

const { useStore } = await import('./useStore');
const { monthWindow, tideWindow } = await import('../data/repo');

const TODAY = '2026-09-10';
const LIVE: SnapMeta = { fromCache: false, hasPendingWrites: false };
const CACHE: SnapMeta = { fromCache: true, hasPendingWrites: false };

const entryAt = (id: string, startDate: string): Entry => newEntry('task', { id, title: id, startDate });

/** 월 창과 계산 창은 값이 다르다. 그것으로 두 구독을 가려낸다. */
const isCalc = (s: Sub) => s.months.join(',') === tideWindow(TODAY).join(',');
const displaySubs = () => subs.filter((s) => s.kind === 'display-or-calc' && !isCalc(s));
const calcSubs = () => subs.filter((s) => s.kind === 'display-or-calc' && isCalc(s));

beforeEach(() => { subs.length = 0; });

describe('달력을 넘길 때', () => {
  it('화면용만 다시 붙고 계산 구독은 그대로다', () => {
    const { rerender } = renderHook(
      ({ cursor }: { cursor: string }) => useStore('u1', cursor, TODAY),
      { initialProps: { cursor: '2026-09-15' } },
    );

    expect(displaySubs()).toHaveLength(1);
    expect(calcSubs()).toHaveLength(1);
    const calc = calcSubs()[0]!;

    rerender({ cursor: '2026-12-15' });
    rerender({ cursor: '2027-06-15' });

    // 화면용은 커서마다 갈아탄다 — 앞엣것은 끊기고 새것 하나만 살아 있다.
    expect(displaySubs()).toHaveLength(3);
    expect(displaySubs().filter((s) => s.alive)).toHaveLength(1);
    expect(displaySubs().at(-1)!.months).toEqual(monthWindow('2027-06-15'));

    // 계산용은 한 번 붙은 그대로다. 끊긴 적도, 다시 붙은 적도 없다.
    expect(calcSubs()).toHaveLength(1);
    expect(calc.alive).toBe(true);
  });

  it('잔고·대출·고정 메모도 다시 붙지 않는다', () => {
    const { rerender } = renderHook(
      ({ cursor }: { cursor: string }) => useStore('u1', cursor, TODAY),
      { initialProps: { cursor: '2026-09-15' } },
    );
    rerender({ cursor: '2026-12-15' });

    for (const kind of ['recurring', 'accounts', 'debts', 'pins'] as const) {
      const of = subs.filter((s) => s.kind === kind);
      expect(of, kind).toHaveLength(1);
      expect(of[0]!.alive, kind).toBe(true);
    }
  });

  it('오늘이 바뀌면 계산 구독은 새 창으로 갈아탄다', () => {
    const { rerender } = renderHook(
      ({ today }: { today: string }) => useStore('u1', '2026-09-15', today),
      { initialProps: { today: TODAY } },
    );
    const first = calcSubs()[0]!;

    // 자정을 넘겼다. 계산 창은 오늘 기준이므로 따라 움직여야 한다.
    rerender({ today: '2026-10-01' });

    expect(first.alive).toBe(false);
    const live = subs.filter((s) => s.kind === 'display-or-calc' && s.alive
      && s.months.join(',') === tideWindow('2026-10-01').join(','));
    expect(live).toHaveLength(1);
  });
});

describe('계정이 바뀔 때', () => {
  it('앞 계정의 자료가 한 렌더도 남지 않는다', () => {
    const { result, rerender } = renderHook(
      ({ uid }: { uid: string }) => useStore(uid, '2026-09-15', TODAY),
      { initialProps: { uid: 'u1' } },
    );

    act(() => {
      for (const s of subs.filter((x) => x.uid === 'u1')) {
        s.push(s.kind === 'display-or-calc' ? [entryAt('a', '2026-09-15')] : [], LIVE);
      }
    });
    expect(result.current.entries.map((e) => e.id)).toEqual(['a']);

    rerender({ uid: 'u2' });

    // 새 계정의 첫 스냅샷이 오기 전이다. 앞사람 일정이 보이면 안 된다.
    expect(result.current.entries).toEqual([]);
    expect(result.current.tideEntries).toEqual([]);
    expect(result.current.accounts).toEqual([]);
    expect(result.current.calc.ready).toBe(false);
  });

  it('앞 계정의 구독을 전부 끊는다', () => {
    const { rerender } = renderHook(
      ({ uid }: { uid: string }) => useStore(uid, '2026-09-15', TODAY),
      { initialProps: { uid: 'u1' } },
    );
    rerender({ uid: 'u2' });

    expect(subs.filter((s) => s.uid === 'u1').every((s) => !s.alive)).toBe(true);
    expect(subs.filter((s) => s.uid === 'u2' && s.alive).length).toBeGreaterThan(0);
  });

  it('앞 계정의 늦은 스냅샷이 도착해도 새 계정 화면에 섞이지 않는다', () => {
    const { result, rerender } = renderHook(
      ({ uid }: { uid: string }) => useStore(uid, '2026-09-15', TODAY),
      { initialProps: { uid: 'u1' } },
    );
    const stale = subs.filter((s) => s.uid === 'u1' && s.kind === 'display-or-calc');

    rerender({ uid: 'u2' });
    act(() => { for (const s of stale) s.push([entryAt('a', '2026-09-15')], LIVE); });

    expect(result.current.entries).toEqual([]);
  });
});

describe('자료 상태', () => {
  const mount = () => renderHook(() => useStore('u1', '2026-09-15', TODAY));

  it('처음에는 화면용도 계산용도 loading 이다', () => {
    const { result } = mount();
    expect(result.current.display.status).toBe('loading');
    expect(result.current.calc.status).toBe('loading');
    expect(result.current.loading).toBe(true);
  });

  it('캐시에서 온 빈 목록은 "비어 있다" 가 아니라 "캐시" 다', () => {
    const { result } = mount();
    act(() => { calcSubs()[0]!.push([], CACHE); });

    expect(result.current.calc.status).toBe('cache');
    expect(result.current.calc.fromCache).toBe(true);
    // 받기는 받았고, 받은 것이 비어 있다 — 두 사실을 따로 알린다.
    expect(result.current.calc.ready).toBe(true);
    expect(result.current.calc.empty).toBe(true);
  });

  it('서버가 확인한 값은 live 다', () => {
    const { result } = mount();
    act(() => { calcSubs()[0]!.push([entryAt('a', '2026-09-15')], LIVE); });

    expect(result.current.calc.status).toBe('live');
    expect(result.current.calc.empty).toBe(false);
    expect(result.current.calc.fromCache).toBe(false);
  });

  it('조회가 실패하면 loading 으로 두지 않는다', () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    act(() => { calcSubs()[0]!.fail('entries', new Error('네트워크')); });

    expect(result.current.calc.status).toBe('error');
    expect(result.current.calc.ready).toBe(false);
    expect(result.current.error).toContain('불러오지 못했습니다');
    boom.mockRestore();
  });

  it('화면용 실패가 계산용 상태를 건드리지 않는다', () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    act(() => { calcSubs()[0]!.push([entryAt('a', '2026-09-15')], LIVE); });
    act(() => { displaySubs()[0]!.fail('entries', new Error('네트워크')); });

    expect(result.current.display.status).toBe('error');
    expect(result.current.calc.status).toBe('live');
    boom.mockRestore();
  });

  it('로그아웃 상태에서는 구독하지 않는다', () => {
    const { result } = renderHook(() => useStore(null, '2026-09-15', TODAY));
    expect(subs).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });
});
