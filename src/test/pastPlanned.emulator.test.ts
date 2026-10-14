/**
 * 지난 예정 정리 — 진짜 저장소 위에서.
 *
 *  - 서버에서 전부 읽어(`fetchLedgerFromServer`) 가른 후보만, 화면과 같은 쓰기(`ledgerBatch` 의
 *    deleteIds)로 지운다. 실제 거래 · 반복 예정 · 확정한 예정 · 막힌 예정 · 잔고 · 생활비는 그대로다
 *  - 지운 뒤에도 한도 · 예상 잔고 · 생활비 숫자가 같다
 *  - 지우기 전에 받은 백업을 병합하면 지운 예정만 돌아온다
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../data/backup';
import { readBackupFile } from '../data/backupFile';
import { sendPending } from '../data/pendingWrites';
import { createManyIfAbsent, fetchAll, fetchLedgerFromServer } from '../data/repo';
import { safeMerge } from '../data/restore';
import { newBudget } from '../domain/budget';
import { newEntry, newMoney } from '../domain/entry';
import { calcSnapshot, sameSnapshot, scanPastPlanned } from '../domain/pastPlanned';
import type { Account, Entry, MoneyFields } from '../domain/types';

let env: RulesTestEnvironment;
const ME = 'pp-me';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const TODAY = '2026-10-13';
const account: Account = {
  id: 'main', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-10-10', checkedAt: '2026-10-10T09:00:00.000Z', reflectedEntryIds: [],
  order: 0, createdAt: '2026-10-10T09:00:00.000Z', updatedAt: '2026-10-10T09:00:00.000Z',
};
const pocket = newBudget({ id: 'b1', name: '10월 생활비', startDate: '2026-10-01', endDate: '2026-10-31', amountMinor: 200_000 });
const plan = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}, over: Partial<Entry> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ type: 'expense', amountMinor: amount, ...m }), ...over });

const seedEntries: Entry[] = [
  plan('old1', '2025-02-01', 50_000),                                  // 구독 창 밖의 오래된 예정
  plan('old2', '2026-09-15', 30_000, { type: 'income' }),
  plan('late', '2026-10-11', 20_000),                                  // 기준일 뒤 → 막힘
  plan('pb', '2026-10-05', 10_000, { budgetId: 'b1' }),                // 생활비 → 막힘
  plan('rent', '2026-01-25', 500_000, {}, { recurrence: { freq: 'monthly', interval: 1, until: null, count: null } }),
  plan('fut', '2026-10-20', 40_000),
  newEntry('money', { id: 'lunch', title: '점심', startDate: '2026-09-01', money: newMoney({ status: 'actual', type: 'expense', amountMinor: 9_000 }) }),
];

describe('지난 예정 정리', () => {
  it('후보만 지우고, 숫자는 그대로, 나머지는 한 건도 바뀌지 않는다 — 백업으로 되돌린다', async () => {
    const db = dbOf(ME);
    expect((await createManyIfAbsent(db, ME, { entries: seedEntries, accounts: [account], budgets: [pocket] })).failed).toEqual([]);

    const before = await fetchLedgerFromServer(db, ME);
    const res = { budgets: before.budgets, reserves: before.reserves };
    const scan = scanPastPlanned(before.entries, before.accounts, TODAY, res);
    const candidates = scan.items.filter((i) => i.group === 'candidate').map((i) => i.entry.id);
    expect(candidates.sort()).toEqual(['old1', 'old2']);
    expect(scan.items.filter((i) => i.group === 'blocked').map((i) => i.entry.id).sort()).toEqual(['late', 'pb']);

    // 지우기 전 백업 — 화면과 같은 파일 형식.
    const all = await fetchAll(db, ME);
    const file = JSON.stringify(buildBackup({ ...all, ledger: null, recovery: null }));
    const snap = calcSnapshot(before.accounts, before.entries, TODAY, res);

    await sendPending(db, ME, {
      kind: 'ledgerBatch', label: '지난 예정 정리', summary: '',
      payload: { entries: [], deleteIds: candidates, accounts: [] },
    });

    const after = await fetchLedgerFromServer(db, ME);
    expect(after.entries.map((e) => e.id).sort()).toEqual(['fut', 'late', 'lunch', 'pb', 'rent']);
    // 남은 문서는 내용까지 그대로.
    const keep = new Map(before.entries.map((e) => [e.id, e]));
    for (const e of after.entries) expect(e).toEqual(keep.get(e.id));
    expect(after.accounts).toEqual(before.accounts);
    expect(after.budgets).toEqual(before.budgets);
    expect(sameSnapshot(snap, calcSnapshot(after.accounts, after.entries, TODAY, res))).toBe(true);

    // 백업 병합 — 지운 둘만 돌아오고 나머지는 이미 있어 건너뛴다.
    const read = readBackupFile(file);
    if (!read.ok) throw new Error('backup unreadable');
    const outcome = await safeMerge(read.file.data, {
      fetchAll: () => fetchAll(db, ME),
      createIfAbsent: (payload) => createManyIfAbsent(db, ME, payload),
    });
    expect(outcome.kind).toBe('ok');
    const restored = await fetchLedgerFromServer(db, ME);
    expect(restored.entries.map((e) => e.id).sort()).toEqual(before.entries.map((e) => e.id).sort());
  });
});
