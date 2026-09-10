/**
 * 구독 계층 회귀 테스트.
 *
 * 지키려는 것 넷.
 *   1. 달력을 넘겨도 **계산 구독**은 다시 붙지 않는다 (화면용만 갈아탄다)
 *   2. 계정이 바뀌면 앞 계정의 자료가 한 렌더도 남지 않는다
 *   3. "아직 못 받았다" 와 "비어 있다" 와 "실패했다" 를 다른 상태로 내놓는다
 *   4. 계산 상태는 **세 구독**(계산용 월 항목 · 반복 항목 · 잔고)을 종합한다
 *
 * 4번이 없던 동안에는 월 자료만 도착하면 "다 받았다" 로 굴었다. 2025년에 시작한 반복
 * 지출이 아직 오지 않은 사이에 그 지출이 빠진 한도가 확정값처럼 떴다.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry } from '../domain/types';
import { newEntry } from '../domain/entry';
import type { SnapMeta } from '../data/repo';

type Kind = 'entries' | 'recurring' | 'accounts' | 'debts' | 'pins';

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
      record('entries', uid, months, cb, onError),
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
const PENDING: SnapMeta = { fromCache: false, hasPendingWrites: true };

const entryAt = (id: string, startDate: string): Entry => newEntry('task', { id, title: id, startDate });

/** 월 창과 계산 창은 값이 다르다. 그것으로 두 항목 구독을 가려낸다. */
const isCalc = (s: Sub) => s.months.join(',') === tideWindow(TODAY).join(',');
const displaySubs = () => subs.filter((s) => s.kind === 'entries' && !isCalc(s));
const calcSubs = () => subs.filter((s) => s.kind === 'entries' && isCalc(s));
const one = (kind: Kind) => subs.filter((s) => s.kind === kind && s.alive)[0]!;

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

  it('앞 달의 목록과 준비 상태를 새 달에 물려주지 않는다', () => {
    const { result, rerender } = renderHook(
      ({ cursor }: { cursor: string }) => useStore('u1', cursor, TODAY),
      { initialProps: { cursor: '2026-09-15' } },
    );
    act(() => { displaySubs()[0]!.push([entryAt('a', '2026-09-15')], LIVE); });
    expect(result.current.display.ready).toBe(true);
    expect(result.current.entries.map((e) => e.id)).toEqual(['a']);

    rerender({ cursor: '2026-12-15' });

    // 새 구독은 아직 한 건도 못 받았다. 9월 목록으로 12월을 그리면 안 된다.
    expect(result.current.display.status).toBe('loading');
    expect(result.current.entries).toEqual([]);
  });
});

describe('월 경계 — 계산 창이 바뀔 때', () => {
  it('오늘이 바뀌면 계산 구독은 새 창으로 갈아탄다', () => {
    const { rerender } = renderHook(
      ({ today }: { today: string }) => useStore('u1', '2026-09-15', today),
      { initialProps: { today: TODAY } },
    );
    const first = calcSubs()[0]!;

    // 자정을 넘겨 달이 바뀌었다. 계산 창은 오늘 기준이므로 따라 움직여야 한다.
    rerender({ today: '2026-10-01' });

    expect(first.alive).toBe(false);
    const live = subs.filter((s) => s.kind === 'entries' && s.alive
      && s.months.join(',') === tideWindow('2026-10-01').join(','));
    expect(live).toHaveLength(1);
  });

  it('앞 창의 준비 상태를 새 창에 물려주지 않는다', () => {
    const { result, rerender } = renderHook(
      ({ today }: { today: string }) => useStore('u1', '2026-09-15', today),
      { initialProps: { today: TODAY } },
    );
    act(() => {
      calcSubs()[0]!.push([entryAt('m', '2026-09-20')], LIVE);
      one('recurring').push([], LIVE);
      one('accounts').push([{ id: 'a1' }], LIVE);
    });
    expect(result.current.calc.status).toBe('live');

    rerender({ today: '2026-10-01' });

    // 새 계산 창은 아직 비어 있다. 9월 목록으로 10월 한도를 내면 안 된다.
    expect(result.current.calc.status).toBe('loading');
    expect(result.current.calc.ready).toBe(false);
    expect(result.current.tideEntries).toEqual([]);
    expect(result.current.tideMonths).toEqual(tideWindow('2026-10-01'));
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
        s.push(s.kind === 'entries' ? [entryAt('a', '2026-09-15')] : [], LIVE);
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
    const stale = subs.filter((s) => s.uid === 'u1' && s.kind === 'entries');

    rerender({ uid: 'u2' });
    act(() => { for (const s of stale) s.push([entryAt('a', '2026-09-15')], LIVE); });

    expect(result.current.entries).toEqual([]);
    expect(result.current.calc.ready).toBe(false);
  });

  it('앞 계정의 늦은 오류도 새 계정 상태를 건드리지 않는다', () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = renderHook(
      ({ uid }: { uid: string }) => useStore(uid, '2026-09-15', TODAY),
      { initialProps: { uid: 'u1' } },
    );
    const stale = subs.filter((s) => s.uid === 'u1' && s.kind === 'recurring')[0]!;

    rerender({ uid: 'u2' });
    act(() => { stale.fail('recurring', new Error('늦게 온 실패')); });

    expect(result.current.calc.status).toBe('loading');
    expect(result.current.error).toBeNull();
    boom.mockRestore();
  });
});

describe('계산 상태는 세 구독을 종합한다', () => {
  const mount = () => renderHook(() => useStore('u1', '2026-09-15', TODAY));

  /** 계산에 필요한 세 갈래를 원하는 만큼만 채운다. */
  const deliver = (which: { month?: boolean; recurring?: boolean; accounts?: boolean }, meta = LIVE) => {
    act(() => {
      if (which.month) calcSubs()[0]!.push([entryAt('m', '2026-09-20')], meta);
      if (which.recurring) one('recurring').push([entryAt('r', '2025-01-01')], meta);
      if (which.accounts) one('accounts').push([{ id: 'a1' }], meta);
    });
  };

  it('처음에는 화면용도 계산용도 loading 이다', () => {
    const { result } = mount();
    expect(result.current.display.status).toBe('loading');
    expect(result.current.calc.status).toBe('loading');
    expect(result.current.loading).toBe(true);
  });

  it('잔고와 월 자료만 왔고 반복 구독이 아직이면 준비되지 않았다', () => {
    // 2025년에 시작한 반복 지출이 빠진 한도를 확정값처럼 내보내던 자리다.
    const { result } = mount();
    deliver({ month: true, accounts: true });

    expect(result.current.calc.ready).toBe(false);
    expect(result.current.calc.status).toBe('loading');
  });

  it('반복 자료까지 와야 준비된다', () => {
    const { result } = mount();
    deliver({ month: true, accounts: true });
    deliver({ recurring: true });

    expect(result.current.calc.ready).toBe(true);
    expect(result.current.calc.status).toBe('live');
    expect(result.current.tideEntries.map((e) => e.id).sort()).toEqual(['m', 'r']);
  });

  it('잔고 구독이 아직이면 준비되지 않았다', () => {
    const { result } = mount();
    deliver({ month: true, recurring: true });
    expect(result.current.calc.ready).toBe(false);
  });

  it('반복 구독만 실패해도 계산은 error 다', () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    deliver({ month: true, accounts: true });
    act(() => { one('recurring').fail('recurring', new Error('네트워크')); });

    expect(result.current.calc.status).toBe('error');
    expect(result.current.calc.ready).toBe(false);
    expect(result.current.error).toContain('불러오지 못했습니다');
    boom.mockRestore();
  });

  it('잔고 구독만 실패해도 계산은 error 다', () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    deliver({ month: true, recurring: true });
    act(() => { one('accounts').fail('accounts', new Error('네트워크')); });

    expect(result.current.calc.status).toBe('error');
    boom.mockRestore();
  });

  it('계산용 월 구독만 실패해도 계산은 error 다', () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    deliver({ recurring: true, accounts: true });
    act(() => { calcSubs()[0]!.fail('entries', new Error('네트워크')); });

    expect(result.current.calc.status).toBe('error');
    boom.mockRestore();
  });

  it('화면용 실패가 계산용 상태를 건드리지 않는다', () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    deliver({ month: true, recurring: true, accounts: true });
    act(() => { displaySubs()[0]!.fail('entries', new Error('네트워크')); });

    expect(result.current.display.status).toBe('error');
    expect(result.current.calc.status).toBe('live');
    boom.mockRestore();
  });

  it('한 갈래라도 캐시에서 왔으면 전체가 cache 다', () => {
    const { result } = mount();
    deliver({ month: true, accounts: true });
    act(() => { one('recurring').push([], CACHE); });

    expect(result.current.calc.status).toBe('cache');
    expect(result.current.calc.fromCache).toBe(true);
    expect(result.current.calc.ready).toBe(true);
  });

  it('전부 비어 있을 때만 empty 다', () => {
    const { result } = mount();
    act(() => {
      calcSubs()[0]!.push([], CACHE);
      one('recurring').push([], CACHE);
      one('accounts').push([], CACHE);
    });
    expect(result.current.calc.empty).toBe(true);

    act(() => { one('accounts').push([{ id: 'a1' }], CACHE); });
    expect(result.current.calc.empty).toBe(false);
  });

  it('빈 캐시 뒤에 서버 자료가 오면 live 로 바뀐다', () => {
    const { result } = mount();
    act(() => {
      calcSubs()[0]!.push([], CACHE);
      one('recurring').push([], CACHE);
      one('accounts').push([], CACHE);
    });
    expect(result.current.calc.status).toBe('cache');
    expect(result.current.calc.empty).toBe(true);

    act(() => {
      calcSubs()[0]!.push([entryAt('m', '2026-09-20')], LIVE);
      one('recurring').push([entryAt('r', '2025-01-01')], LIVE);
      one('accounts').push([{ id: 'a1' }], LIVE);
    });
    expect(result.current.calc.status).toBe('live');
    expect(result.current.calc.empty).toBe(false);
    expect(result.current.tideEntries.map((e) => e.id).sort()).toEqual(['m', 'r']);
  });

  it('자료가 그대로인 채 fromCache 만 꺼져도 상태가 따라온다', () => {
    // includeMetadataChanges 가 없으면 이 전환이 아예 오지 않아 영영 cache 로 남는다.
    const { result } = mount();
    const same = [entryAt('m', '2026-09-20')];
    act(() => {
      calcSubs()[0]!.push(same, CACHE);
      one('recurring').push([], CACHE);
      one('accounts').push([{ id: 'a1' }], CACHE);
    });
    expect(result.current.calc.status).toBe('cache');

    act(() => {
      calcSubs()[0]!.push(same, LIVE);
      one('recurring').push([], LIVE);
      one('accounts').push([{ id: 'a1' }], LIVE);
    });
    expect(result.current.calc.status).toBe('live');
    expect(result.current.calc.fromCache).toBe(false);
  });

  it('아직 서버가 확인하지 않은 쓰기가 섞이면 pending 이 선다', () => {
    const { result } = mount();
    deliver({ month: true, accounts: true });
    act(() => { one('recurring').push([], PENDING); });

    expect(result.current.calc.pending).toBe(true);
    expect(result.current.calc.status).toBe('live');
  });

  it('로그아웃 상태에서는 구독하지 않는다', () => {
    const { result } = renderHook(() => useStore(null, '2026-09-15', TODAY));
    expect(subs).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });
});
