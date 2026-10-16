/**
 * 신용카드 (P4) — 진짜 규칙 · 진짜 저장소 위에서.
 *
 *  - 카드 거래 구독(`money.cardId != null`)이 날짜와 무관하게 카드 사용 · 대금만 받는다
 *  - 같은 대금을 두 번 보내도(오프라인 재전송 · 다른 기기) 미결제가 한 번만 준다
 *  - 대금을 지우면(납부 취소) 빚이 돌아온다
 *  - 카드 · 연결이 백업 → 빈 계정 가져오기 뒤에도 같고, 미결제 · 한도도 같다
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../data/backup';
import { readBackupFile } from '../data/backupFile';
import { sendPending } from '../data/pendingWrites';
import { createManyIfAbsent, fetchAll, subscribeCardLinkedEntries } from '../data/repo';
import { reserveUsageOf } from '../domain/budget';
import { cardState, newCard } from '../domain/card';
import { newEntry, newMoney, withDerived } from '../domain/entry';
import { limitOn } from '../domain/tide';
import type { Account, Entry, MoneyFields } from '../domain/types';

let env: RulesTestEnvironment;
const ME = 'card-me';
const NEW = 'card-new';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const TODAY = '2026-10-16';
const account: Account = {
  id: 'main', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: TODAY, checkedAt: `${TODAY}T09:00:00.000Z`, reflectedEntryIds: [],
  order: 0, createdAt: `${TODAY}T09:00:00.000Z`, updatedAt: `${TODAY}T09:00:00.000Z`,
};
const life = newCard({ id: 'life', name: '생활 카드', closeDay: 31, payDay: 25, payMonthOffset: 1, accountId: 'main' });
const tx = (id: string, date: string, amount: number, m: Partial<MoneyFields>): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }),
});
const use = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}) =>
  tx(id, date, amount, { flow: 'cardSpend', cardId: 'life', ...m });
const pay = (id: string, date: string, amount: number, cycle: string) =>
  tx(id, date, amount, { flow: 'cardPayment', cardId: 'life', cardCycle: cycle, accountId: 'main' });

function linkedOnce(db: Firestore, uid: string): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const off = subscribeCardLinkedEntries(db, uid, (list, meta) => {
      if (meta.fromCache) return;
      off();
      resolve(list);
    }, (_scope, err) => { off(); reject(err); });
  });
}

describe('카드 거래 구독', () => {
  it('날짜와 무관하게 카드에 걸린 거래만 받는다 — 카드 없는 카드 사용 · 일반 지출은 빼고', async () => {
    const db = dbOf(ME);
    const entries = [
      use('old', '2024-03-01', 5_000),
      use('now', '2026-10-09', 120_000),
      tx('legacy', '2026-10-09', 30_000, { flow: 'cardSpend' }),
      tx('plain', '2026-10-09', 7_000, {}),
      pay('p', '2026-10-10', 50_000, '2026-10'),
    ];
    expect((await createManyIfAbsent(db, ME, { entries, cards: [life] })).failed).toEqual([]);
    const linked = await linkedOnce(db, ME);
    expect(linked.map((e) => e.id).sort()).toEqual(['now', 'old', 'p']);
  });
});

describe('재전송 · 납부 취소', () => {
  it('같은 대금을 두 번 보내도 미결제는 한 번만 준다 — 지우면 돌아온다', async () => {
    const db = dbOf(ME);
    expect((await createManyIfAbsent(db, ME, { cards: [life], accounts: [account], entries: [use('shoe', '2026-10-05', 300_000)] })).failed).toEqual([]);
    const paid = withDerived(pay('paid', TODAY, 100_000, '2026-11'));
    await sendPending(db, ME, { kind: 'entry', label: '', summary: '', payload: paid });
    await sendPending(db, ME, { kind: 'entry', label: '', summary: '', payload: paid });
    expect(cardState(life, await linkedOnce(db, ME), TODAY).outstandingMinor).toBe(200_000);
    await sendPending(db, ME, { kind: 'entryDelete', label: '', summary: '', payload: { id: 'paid' } });
    expect(cardState(life, await linkedOnce(db, ME), TODAY).outstandingMinor).toBe(300_000);
  });

  it('카드 보관은 문서 전체 쓰기로 — 미결제 계산은 그대로다', async () => {
    const db = dbOf(ME);
    await sendPending(db, ME, { kind: 'card', label: '', summary: '', payload: life });
    await sendPending(db, ME, { kind: 'card', label: '', summary: '', payload: { ...life, archivedAt: '2026-10-16T00:00:00.000Z' } });
    const all = await fetchAll(db, ME);
    expect(all.cards.map((c) => [c.id, c.archivedAt])).toEqual([['life', '2026-10-16T00:00:00.000Z']]);
  });
});

describe('백업 왕복', () => {
  it('빈 계정에 가져와도 카드 · 연결 · 미결제 · 한도가 같다', async () => {
    const src = dbOf(ME);
    const entries = [
      use('shoe', '2026-10-05', 300_000, { reserveId: 'trip', outsidePocket: true }),
      pay('paid', TODAY, 100_000, '2026-11'),
    ];
    const trip = { id: 'trip', name: '여행', amountMinor: 400_000, currency: 'KRW', createdAt: '', updatedAt: '' };
    expect((await createManyIfAbsent(src, ME, { entries, cards: [life], accounts: [account], reserves: [trip] })).failed).toEqual([]);
    const before = await fetchAll(src, ME);
    const resOf = (d: typeof before) => ({
      reserves: d.reserves, reserveUsage: reserveUsageOf(d.entries),
      cards: d.cards, cardEntries: d.entries.filter((e) => !!e.money?.cardId),
    });
    const limitBefore = limitOn(before.accounts, before.entries, '2026-10-24', TODAY, resOf(before));
    // 1,000,000 − 오늘 낸 대금 100,000 − 남은 미결제 200,000 − 세이브 남음 100,000
    expect(limitBefore).toBe(600_000);

    const file = readBackupFile(JSON.stringify(buildBackup({ ...before, ledger: null, recovery: null })));
    if (!file.ok) throw new Error('읽기 실패');
    const dst = dbOf(NEW);
    expect((await createManyIfAbsent(dst, NEW, file.file.data)).failed).toEqual([]);
    const after = await fetchAll(dst, NEW);
    expect(after.cards).toEqual(before.cards);
    expect(cardState(life, after.entries, TODAY).outstandingMinor).toBe(200_000);
    expect(limitOn(after.accounts, after.entries, '2026-10-24', TODAY, resOf(after))).toBe(limitBefore);
    const again = await createManyIfAbsent(dst, NEW, file.file.data);
    expect(again.created).toBe(0);
  });
});
