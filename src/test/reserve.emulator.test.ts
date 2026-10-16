/**
 * 세이브 지출 연결 (P3) — 진짜 규칙 · 진짜 저장소 위에서.
 *
 *  - 연결된 거래 구독(`money.reserveId != null`)이 날짜와 무관하게 연결된 것만 받는다
 *  - 연결 · 해제 · 다른 세이브로 옮기기 · 같은 쓰기 두 번이 사용액을 한 번만 바꾼다
 *  - 세이브 삭제가 연결 해제와 한 배치로 나가고, 보관은 연결을 남긴다
 *  - 백업 → 빈 계정 가져오기 뒤에도 연결 · 사용액 · 한도가 같다
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../data/backup';
import { readBackupFile } from '../data/backupFile';
import { sendPending } from '../data/pendingWrites';
import { createManyIfAbsent, fetchAll, subscribeReserveLinkedEntries } from '../data/repo';
import { newReserve, reservePatchOf, reserveUsageOf, unlinkedFromReserve } from '../domain/budget';
import { newEntry, newMoney, withDerived } from '../domain/entry';
import { limitOn } from '../domain/tide';
import type { Account, Entry, MoneyFields } from '../domain/types';

let env: RulesTestEnvironment;
const ME = 'reserve-me';
const NEW = 'reserve-new';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const TODAY = '2026-10-10';
const account: Account = {
  id: 'main', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: TODAY, checkedAt: `${TODAY}T09:00:00.000Z`, reflectedEntryIds: [],
  order: 0, createdAt: `${TODAY}T09:00:00.000Z`, updatedAt: `${TODAY}T09:00:00.000Z`,
};
const trip = newReserve({ id: 'r1', name: '여행', amountMinor: 300_000 });
const gift = newReserve({ id: 'r2', name: '선물', amountMinor: 100_000 });
const tx = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }),
});

/** 연결된 거래 구독의 첫 서버 스냅샷을 기다린다. */
function linkedOnce(db: Firestore, uid: string): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const off = subscribeReserveLinkedEntries(db, uid, (list, meta) => {
      if (meta.fromCache) return;
      off();
      resolve(list);
    }, (_scope, err) => { off(); reject(err); });
  });
}

describe('연결된 거래 구독', () => {
  it('날짜와 무관하게 연결된 거래만 받는다 — 연결 없음 · null 은 빼고, 예정도 받는다', async () => {
    const db = dbOf(ME);
    const entries = [
      tx('old', '2024-03-01', 5_000, { reserveId: 'r1', outsidePocket: true }),
      tx('now', '2026-10-09', 120_000, { reserveId: 'r1', outsidePocket: true }),
      tx('plain', '2026-10-09', 30_000),
      newEntry('money', { id: 'plan', startDate: '2026-11-02', money: newMoney({ amountMinor: 90_000, reserveId: 'r2' }) }),
    ];
    expect((await createManyIfAbsent(db, ME, { entries, reserves: [trip, gift] })).failed).toEqual([]);
    const linked = await linkedOnce(db, ME);
    expect(linked.map((e) => e.id).sort()).toEqual(['now', 'old', 'plan']);
    // 예정은 사용이 아니다.
    expect([...reserveUsageOf(linked)]).toEqual([['r1', 125_000]]);
  });
});

describe('연결 · 해제 · 옮기기 · 다시 보내기', () => {
  it('사용액은 거래에서 센다 — 같은 쓰기를 두 번 보내도, 옮기고 풀어도 한 번만', async () => {
    const db = dbOf(ME);
    expect((await createManyIfAbsent(db, ME, { reserves: [trip, gift], accounts: [account] })).failed).toEqual([]);
    const air = withDerived(tx('air', '2026-10-09', 120_000, { reserveId: 'r1', outsidePocket: true }));

    await sendPending(db, ME, { kind: 'entry', label: '', summary: '', payload: air });
    await sendPending(db, ME, { kind: 'entry', label: '', summary: '', payload: air });
    expect([...reserveUsageOf(await linkedOnce(db, ME))]).toEqual([['r1', 120_000]]);

    const moved = withDerived({ ...air, money: { ...air.money!, reserveId: 'r2' } });
    await sendPending(db, ME, { kind: 'entry', label: '', summary: '', payload: moved });
    expect([...reserveUsageOf(await linkedOnce(db, ME))]).toEqual([['r2', 120_000]]);

    await sendPending(db, ME, { kind: 'entry', label: '', summary: '', payload: withDerived(unlinkedFromReserve(moved, 'x')) });
    expect(await linkedOnce(db, ME)).toEqual([]);

    // 세이브 원본 금액은 어느 단계에서도 바뀌지 않았다.
    const all = await fetchAll(db, ME);
    expect(all.reserves.map((r) => [r.id, r.amountMinor])).toEqual([['r1', 300_000], ['r2', 100_000]]);
  });

  it('저장할 때 앱이 만들지 않는 조합은 연결을 떼어 낸다 — 생활비와 함께 걸면 생활비가 남는다', async () => {
    const db = dbOf(ME);
    const both = withDerived(tx('both', '2026-10-09', 10_000, { reserveId: 'r1', budgetId: 'b1' }));
    await sendPending(db, ME, { kind: 'entry', label: '', summary: '', payload: both });
    const snap = await getDoc(doc(db, `users/${ME}/entries/both`));
    expect(snap.data()?.money).toMatchObject({ budgetId: 'b1', reserveId: null });
  });
});

describe('세이브 삭제 · 보관', () => {
  const linked = [
    tx('a', '2026-10-01', 50_000, { reserveId: 'r1', outsidePocket: true }),
    tx('b', '2025-12-01', 20_000, { reserveId: 'r1', outsidePocket: true }),
  ];

  it('삭제는 세이브와 연결 해제를 한 배치로 쓴다 — 거래는 남고 금액도 그대로다', async () => {
    const db = dbOf(ME);
    expect((await createManyIfAbsent(db, ME, { entries: linked, reserves: [trip] })).failed).toEqual([]);
    const found = await linkedOnce(db, ME);
    await sendPending(db, ME, {
      kind: 'ledgerBatch', label: '', summary: '',
      payload: {
        entries: found.map((e) => withDerived(unlinkedFromReserve(e, 'x'))),
        deleteIds: [], accounts: [], deleteReserveIds: ['r1'],
      },
    });
    const all = await fetchAll(db, ME);
    expect(all.reserves).toEqual([]);
    expect(all.entries.map((e) => [e.id, e.money?.amountMinor, e.money?.reserveId ?? null]).sort()).toEqual([
      ['a', 50_000, null], ['b', 20_000, null],
    ]);
  });

  it('보관은 연결과 사용을 남긴다 — 보관한 세이브는 한도에서 빠지지 않는다', async () => {
    const db = dbOf(ME);
    expect((await createManyIfAbsent(db, ME, { entries: linked, reserves: [trip], accounts: [account] })).failed).toEqual([]);
    const patch = reservePatchOf(trip, { ...trip, archivedAt: '2026-10-10T00:00:00.000Z' })!;
    await sendPending(db, ME, { kind: 'reservePatch', label: '', summary: '', payload: { id: 'r1', patch, updatedAt: 'x' } });
    const all = await fetchAll(db, ME);
    expect(all.reserves[0]!.archivedAt).toBe('2026-10-10T00:00:00.000Z');
    expect([...reserveUsageOf(await linkedOnce(db, ME))]).toEqual([['r1', 70_000]]);
  });
});

describe('백업 왕복', () => {
  it('빈 계정에 가져와도 연결 · 사용액 · 한도가 같다', async () => {
    const src = dbOf(ME);
    const entries = [
      tx('air', TODAY, 120_000, { reserveId: 'r1', outsidePocket: true }),
      tx('lunch', TODAY, 12_000),
      newEntry('money', { id: 'plan', startDate: '2026-11-02', money: newMoney({ amountMinor: 90_000, reserveId: 'r1' }) }),
    ];
    expect((await createManyIfAbsent(src, ME, { entries, reserves: [trip], accounts: [account] })).failed).toEqual([]);
    const before = await fetchAll(src, ME);
    const usageBefore = reserveUsageOf(before.entries);
    const limitBefore = limitOn([account], before.entries, '2026-10-31', TODAY, {
      budgets: [], reserves: before.reserves, reserveUsage: usageBefore,
    });
    // 1,000,000 − 지출 132,000 − 남은 세이브 180,000. 11/2 예정은 끝점 밖이고, 예정은 사용이 아니다.
    expect(limitBefore).toBe(688_000);

    const file = readBackupFile(JSON.stringify(buildBackup({
      ...before, ledger: null, recovery: null,
    })));
    if (!file.ok) throw new Error('읽기 실패');
    const dst = dbOf(NEW);
    const r = await createManyIfAbsent(dst, NEW, file.file.data);
    expect(r.failed).toEqual([]);

    const after = await fetchAll(dst, NEW);
    const usageAfter = reserveUsageOf(after.entries);
    expect([...usageAfter]).toEqual([...usageBefore]);
    expect(limitOn(after.accounts, after.entries, '2026-10-31', TODAY, {
      budgets: [], reserves: after.reserves, reserveUsage: usageAfter,
    })).toBe(limitBefore);

    // 같은 파일을 다시 가져와도 아무것도 쓰지 않는다 — 사용이 두 번 세어지지 않는다.
    const again = await createManyIfAbsent(dst, NEW, file.file.data);
    expect(again.created).toBe(0);
    expect([...reserveUsageOf((await fetchAll(dst, NEW)).entries)]).toEqual([...usageBefore]);
  });
});
