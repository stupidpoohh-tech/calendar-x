/**
 * 생활비 P1-E — 진짜 규칙 위에서.
 *
 *  - 주머니에 걸린 거래를 서버에서 모두 찾는다 (구독 창 밖의 지난 거래까지)
 *  - 기간 변경 · 삭제가 주머니와 거래 연결을 한 배치로 고치고 규칙이 받아 준다
 *  - "생활비 외" 표식이 지금 규칙 그대로 저장되고 돌아온다
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendPending } from '../data/pendingWrites';
import { createManyIfAbsent, fetchAll, fetchPocketEntries } from '../data/repo';
import { movedToPocket, newBudget, pocketPeriodImpact, unlinkedFromPocket } from '../domain/budget';
import { newEntry, newMoney, withDerived } from '../domain/entry';
import { balanceViewOn } from '../domain/tide';
import type { Account, Entry, MoneyFields } from '../domain/types';

let env: RulesTestEnvironment;
const ME = 'pocket-me';

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
  id: 'main', name: '주계좌', balanceMinor: 250_000, currency: 'KRW',
  asOf: TODAY, checkedAt: `${TODAY}T09:00:00.000Z`, reflectedEntryIds: [],
  order: 0, createdAt: `${TODAY}T09:00:00.000Z`, updatedAt: `${TODAY}T09:00:00.000Z`,
};
const pocket = newBudget({ id: 'b1', name: '생활비', startDate: '2026-10-10', endDate: '2026-10-14', amountMinor: 200_000 });
const next = newBudget({ id: 'b2', name: '다음 생활비', startDate: '2026-10-13', endDate: '2026-10-31', amountMinor: 300_000 });
const tx = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }),
});

describe('생활비에 걸린 거래 찾기', () => {
  it('구독 창 밖의 지난 거래까지 찾는다 — 다른 주머니 · 미결정은 빼고', async () => {
    const db = dbOf(ME);
    const entries = [
      tx('old', '2025-03-01', 5_000, { budgetId: 'b1' }),
      tx('now', '2026-10-11', 10_000, { budgetId: 'b1' }),
      tx('other', '2026-10-11', 20_000, { budgetId: 'b2' }),
      tx('none', '2026-10-11', 30_000),
    ];
    expect((await createManyIfAbsent(db, ME, { entries })).failed).toEqual([]);
    const r = await fetchPocketEntries(db, ME, 'b1');
    expect(r.complete).toBe(true);
    expect(r.entries.map((e) => e.id).sort()).toEqual(['now', 'old']);
  });
});

describe('기간 변경 · 삭제 — 주머니와 연결을 한 배치로', () => {
  const linked = [
    tx('d11', '2026-10-11', 10_000, { budgetId: 'b1' }),
    tx('d13', '2026-10-13', 20_000, { budgetId: 'b1' }),
  ];

  async function seed(db: Firestore) {
    const r = await createManyIfAbsent(db, ME, { entries: linked, accounts: [account], budgets: [pocket, next] });
    expect(r.failed).toEqual([]);
  }

  it('기간을 줄이며 나가는 거래를 옮긴다 — 한 배치, 금액은 한 번만', async () => {
    const db = dbOf(ME);
    await seed(db);
    const shorter = { ...pocket, endDate: '2026-10-12' };
    const found = await fetchPocketEntries(db, ME, 'b1');
    const impact = pocketPeriodImpact(pocket, shorter, found.entries, [shorter, next]);
    expect(impact.leaving.map((e) => e.id)).toEqual(['d13']);
    expect([...impact.targets!]).toEqual([['d13', 'b2']]);
    const changed = impact.leaving.map((e) => withDerived(movedToPocket(e, 'b2', '2026-10-10T10:00:00.000Z')));
    await sendPending(db, ME, {
      kind: 'ledgerBatch', label: '', summary: '',
      payload: { entries: changed, deleteIds: [], accounts: [], budgets: [shorter] },
    });
    const all = await fetchAll(db, ME);
    expect(all.budgets.find((b) => b.id === 'b1')!.endDate).toBe('2026-10-12');
    expect(all.entries.find((e) => e.id === 'd13')!.money!.budgetId).toBe('b2');
    // 10/12: 250,000 − b1 200,000(10,000 사용 포함) = 50,000 (b2 는 아직 시작 전)
    const v = balanceViewOn(all.accounts, all.entries, '2026-10-12', TODAY, { budgets: all.budgets });
    expect(v.available).toBe(50_000);
  });

  it('삭제 — 주머니를 지우고 걸린 거래는 남기되 연결을 푼다', async () => {
    const db = dbOf(ME);
    await seed(db);
    const found = await fetchPocketEntries(db, ME, 'b1');
    await sendPending(db, ME, {
      kind: 'ledgerBatch', label: '', summary: '',
      payload: {
        entries: found.entries.map((e) => withDerived(unlinkedFromPocket(e, '2026-10-10T10:00:00.000Z'))),
        deleteIds: [], accounts: [], deleteBudgetIds: ['b1'],
      },
    });
    const all = await fetchAll(db, ME);
    expect(all.budgets.map((b) => b.id)).toEqual(['b2']);
    expect(all.entries.map((e) => [e.id, e.money!.budgetId]).sort()).toEqual([['d11', null], ['d13', null]]);
    expect(all.entries.every((e) => e.money!.outsidePocket === false)).toBe(true);
  });
});

describe('생활비 외 표식', () => {
  it('지금 규칙 그대로 저장되고, 읽어도 그대로다', async () => {
    const db = dbOf(ME);
    const out = tx('trip', '2026-10-11', 30_000, { outsidePocket: true });
    expect((await createManyIfAbsent(db, ME, { entries: [out] })).failed).toEqual([]);
    const all = await fetchAll(db, ME);
    expect(all.entries[0]!.money).toMatchObject({ budgetId: null, outsidePocket: true });
  });
});
