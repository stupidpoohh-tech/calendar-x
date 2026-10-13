/**
 * 예정을 고치며 확정 거래를 다시 잇기 — 진짜 규칙 위에서.
 *
 *  - 그 예정의 확정 거래를 서버에서 모두 찾는다 (화면 구독 창 밖의 지난 회차까지)
 *  - 예정 · 확정 거래 이동 · 계좌 반영 목록이 한 배치로 들어가고 규칙이 받아 준다
 *  - 다시 이은 뒤 옛 백업을 가져와도 같은 회차를 두 번 세지 않는다 · 건수가 맞는다
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, countBackup } from '../data/backup';
import { readBackupFile } from '../data/backupFile';
import { sendPending, type LedgerBatchPayload } from '../data/pendingWrites';
import { createManyIfAbsent, fetchAll, fetchConfirmationsOf } from '../data/repo';
import { safeMerge } from '../data/restore';
import { confirmOccurrence, lostConfirmations, reflectedAfterRename, repairLink } from '../domain/confirm';
import { newEntry, newMoney, withDerived } from '../domain/entry';
import { applyReflectChoice } from '../domain/ledger';
import { headlineLimit } from '../domain/tide';
import type { Account, Entry } from '../domain/types';

let env: RulesTestEnvironment;
const ME = 'relink-me';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const TODAY = '2026-10-25';

const rent = newEntry('money', {
  id: 'rent', title: '월세', startDate: '2025-01-25',
  recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
  money: newMoney({ type: 'expense', amountMinor: 500_000 }),
});
const confirm = (date: string, amount: number): Entry => {
  const r = confirmOccurrence(rent, date, { amountMinor: amount });
  if (!r.ok) throw new Error(r.reason);
  return r.entry;
};
const account: Account = {
  id: 'main', name: '주계좌', balanceMinor: 2_000_000, currency: 'KRW',
  asOf: '2026-10-25', checkedAt: '2026-10-25T09:00:00.000Z', reflectedEntryIds: [],
  order: 0, createdAt: '2026-10-25T09:00:00.000Z', updatedAt: '2026-10-25T09:00:00.000Z',
};

describe('예정을 고치며 확정 거래를 다시 잇기', () => {
  it('지난해 확정분까지 찾고, 한 배치로 옮기며, 한도가 그대로다', async () => {
    const db = dbOf(ME);
    const old = confirm('2025-03-25', 480_000); // 화면 구독 창 밖
    const oct = confirm('2026-10-25', 510_000);
    const acc = { ...account, reflectedEntryIds: [oct.id] }; // 오늘 적은 잔고에 이미 들어 있다
    const r = await createManyIfAbsent(db, ME, { entries: [rent, old, oct], accounts: [acc] });
    expect(r.failed).toEqual([]);
    const before = headlineLimit([acc], [rent, old, oct], TODAY);

    const found = await fetchConfirmationsOf(db, ME, 'rent');
    expect(found.complete).toBe(true);
    expect(found.entries.map((e) => e.id).sort()).toEqual([old.id, oct.id].sort());

    const moved = withDerived({ ...rent, startDate: '2025-01-26' });
    const lost = lostConfirmations(moved, found.entries);
    expect(lost.map((l) => [l.from, l.candidate])).toEqual([['2025-03-25', '2025-03-26'], ['2026-10-25', '2026-10-26']]);
    let n = 0;
    const repairs = lost.map((l) => repairLink(l, 'relink', 'rent', () => `x${n++}`));
    const payload: LedgerBatchPayload = {
      entries: [moved, ...repairs.map((x) => x.entry)],
      deleteIds: repairs.map((x) => x.removeId),
      accounts: reflectedAfterRename([acc], new Map(repairs.map((x) => [x.removeId, x.entry.id]))),
    };
    await sendPending(db, ME, { kind: 'ledgerBatch', label: '', summary: '', payload });

    const all = await fetchAll(db, ME);
    expect(all.entries.map((e) => e.id).sort()).toEqual(['rent', 'rent~2025-03-26', 'rent~2026-10-26']);
    expect(all.accounts[0]!.reflectedEntryIds).toEqual(['rent~2026-10-26']);
    expect(headlineLimit(all.accounts, all.entries, TODAY)).toBe(before);
  });

  it('다시 이은 뒤 옛 백업을 가져와도 옛 사본을 넣지 않는다 — 건수가 맞는다', async () => {
    const db = dbOf(ME);
    const oct = confirm('2026-10-25', 510_000);
    await createManyIfAbsent(db, ME, { entries: [rent, oct], accounts: [account] });
    const snapshot = await fetchAll(db, ME);
    const oldFile = JSON.stringify(buildBackup({ ...snapshot, ledger: { settleDay: 1 }, recovery: null }));

    const moved = withDerived({ ...rent, startDate: '2025-01-26' });
    const [lost] = lostConfirmations(moved, [oct]);
    const fix = repairLink(lost!, 'relink', 'rent', () => 'x');
    await sendPending(db, ME, {
      kind: 'ledgerBatch', label: '', summary: '',
      payload: { entries: [moved, fix.entry], deleteIds: [fix.removeId], accounts: [] },
    });
    const limit = headlineLimit([account], [moved, fix.entry], TODAY);

    const read = readBackupFile(oldFile);
    if (!read.ok) throw new Error('backup');
    const out = await safeMerge(read.file.data, {
      fetchAll: () => fetchAll(db, ME),
      createIfAbsent: (p) => createManyIfAbsent(db, ME, p),
    });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.skippedLinks).toBe(1);
    expect(out.created.created + out.skippedExisting + out.skippedLinks + out.created.conflicts.length + out.created.failed.length)
      .toBe(countBackup(read.file.data));
    const all = await fetchAll(db, ME);
    expect(all.entries.map((e) => e.id).sort()).toEqual(['rent', 'rent~2026-10-26']);
    expect(headlineLimit(all.accounts, all.entries, TODAY)).toBe(limit);
  });

  it('거래와 잔고 반영 목록이 한 배치로 들어가고, 지울 때 목록에서도 빠진다', async () => {
    const db = dbOf(ME);
    await createManyIfAbsent(db, ME, { accounts: [account] });
    const lunch = newEntry('money', {
      id: 'lunch', title: '점심', startDate: '2026-10-25',
      money: newMoney({ status: 'actual', type: 'expense', amountMinor: 12_000 }),
    });
    const [acc] = applyReflectChoice([account], lunch.id, account.id, true);
    await sendPending(db, ME, { kind: 'ledgerBatch', label: '', summary: '', payload: { entries: [lunch], deleteIds: [], accounts: [acc!] } });
    let all = await fetchAll(db, ME);
    expect(all.accounts[0]!.reflectedEntryIds).toEqual(['lunch']);
    expect(headlineLimit(all.accounts, all.entries, TODAY)).toBe(2_000_000);

    const cleared = { ...acc!, reflectedEntryIds: [] as string[] };
    await sendPending(db, ME, { kind: 'ledgerBatch', label: '', summary: '', payload: { entries: [], deleteIds: ['lunch'], accounts: [cleared] } });
    all = await fetchAll(db, ME);
    expect(all.entries).toEqual([]);
    expect(all.accounts[0]!.reflectedEntryIds).toEqual([]);
  });
});
