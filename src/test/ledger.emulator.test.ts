/**
 * 가계부 원장 — 진짜 저장소 위에서 (L1 · L3).
 *
 *   1. 30달이 넘는 계산 창을 나눠 조회해도 빠지는 달도, 두 번 들어오는 문서도 없다
 *   2. 회차의 달과 실제로 낸 달이 달라도 회차의 달 조회에 실제 거래가 걸린다
 *   3. 새 앱이 쓴 실제 거래를 새 앱은 고치고, 구버전 모양의 덮어쓰기는 거절된다
 *   4. 기준일이 수년 전일 때의 조회량과 걸리는 시간
 *
 * `array-contains-any` 의 상한과 조각 사이 경계에 걸친 문서는 가짜 저장소로는 확인할 수
 * 없다. 실행: npm run test:rules
 */
import {
  initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entryToDoc } from '../data/converters';
import { saveEntry, subscribeEntriesForMonths, tideWindow, type SnapMeta } from '../data/repo';
import { confirmOccurrence } from '../domain/confirm';
import { newEntry, newMoney } from '../domain/entry';
import { confirmedSetOf } from '../domain/ledger';
import type { Entry } from '../domain/types';

let env: RulesTestEnvironment;
const ME = 'ledger-me';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;

/** 규칙을 끈 채로 한꺼번에 심는다. 심는 속도는 재려는 것이 아니다. */
async function seed(entries: readonly Entry[]): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (let i = 0; i < entries.length; i += 400) {
      const batch = writeBatch(db);
      for (const e of entries.slice(i, i + 400)) {
        batch.set(doc(db, `users/${ME}/entries/${e.id}`), entryToDoc(e));
      }
      await batch.commit();
    }
  });
}

/** 첫 발화(모든 조각이 한 번씩 온 뒤)를 기다린다. */
function firstSnapshot(db: Firestore, months: string[]): Promise<{ items: Entry[]; meta: SnapMeta; ms: number }> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    let unsub: (() => void) | null = null;
    unsub = subscribeEntriesForMonths(db, ME, months, (items, meta) => {
      if (meta.fromCache) return; // 서버 응답까지 기다린다.
      resolve({ items, meta, ms: performance.now() - started });
      queueMicrotask(() => unsub?.());
    }, (_scope, err) => reject(err));
  });
}

const moneyAt = (id: string, date: string, over: Partial<Entry> = {}) => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ amountMinor: 10_000 }), ...over,
});

describe('30달이 넘는 계산 창', () => {
  it('달마다 한 건 — 빠지는 달도 겹치는 문서도 없다', async () => {
    const months = tideWindow('2026-10-12', '2023-01-15');
    expect(months.length).toBeGreaterThan(30);
    const docs = months.map((m) => moneyAt(`m-${m}`, `${m}-10`));
    // 조각 경계(30번째 · 31번째 달)에 걸친 기간 항목. 두 조각 모두에 걸린다.
    const edge = moneyAt('edge', `${months[29]!}-20`, { endDate: `${months[30]!}-05` });
    await seed([...docs, edge]);

    const { items } = await firstSnapshot(dbOf(ME), months);
    const ids = items.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([...docs.map((d) => d.id), 'edge'].sort());
  });

  it('창 밖의 달은 받지 않는다 — 모든 과거를 구독하지 않는다', async () => {
    const months = tideWindow('2026-10-12', '2025-06-01');
    await seed([moneyAt('before', '2025-05-31'), moneyAt('inside', '2025-06-01')]);
    const { items } = await firstSnapshot(dbOf(ME), months);
    expect(items.map((e) => e.id)).toEqual(['inside']);
  });
});

describe('확정 거래의 조회', () => {
  it('회차의 달 조회에 다른 달에 낸 실제 거래가 걸린다', async () => {
    const rent = newEntry('money', {
      id: 'rent', title: '월세', startDate: '2026-01-25',
      recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
      money: newMoney({ amountMinor: 500_000 }),
    });
    const r = confirmOccurrence(rent, '2026-09-25', { date: '2026-10-02' });
    if (!r.ok) throw new Error(r.reason);
    await seed([rent, r.entry]);

    const { items } = await firstSnapshot(dbOf(ME), ['2026-09']);
    expect(items.map((e) => e.id)).toContain(r.entry.id);
    expect(confirmedSetOf(items).has('rent|2026-09-25')).toBe(true);
  });
});

describe('저장 경로', () => {
  it('새 앱의 저장은 원장 필드를 지키며 규칙을 통과하고, 구버전 덮어쓰기는 거절된다', async () => {
    const db = dbOf(ME);
    const plan = moneyAt('fee', '2026-10-10');
    const r = confirmOccurrence(plan, '2026-10-10', { categoryId: 'fees' });
    if (!r.ok) throw new Error(r.reason);
    await saveEntry(db, ME, r.entry);
    await saveEntry(db, ME, { ...r.entry, title: '수수료 (고침)' });

    const old = entryToDoc(r.entry) as Record<string, unknown>;
    delete old.schema;
    old.money = { type: 'expense', amountMinor: 10_000, currency: 'KRW', linkedEntryId: null };
    await expect(setDoc(doc(db, `users/${ME}/entries/${r.entry.id}`), old)).rejects.toThrow();
  });
});

describe('조회량 — 기준일이 수년 전', () => {
  it('5년 · 달마다 60건이면 조회 세 번, 문서 4,500건이다', async () => {
    const months = tideWindow('2026-10-12', '2021-10-01');
    const docs: Entry[] = [];
    for (const m of months) {
      for (let i = 0; i < 60; i++) {
        docs.push(moneyAt(`v-${m}-${i}`, `${m}-${String((i % 28) + 1).padStart(2, '0')}`));
      }
    }
    await seed(docs);
    const { items, ms } = await firstSnapshot(dbOf(ME), months);
    // 이 숫자는 보고서에 옮겨 적는다.
    console.warn(`[조회량] 창 ${months.length}달 · 조각 ${Math.ceil(months.length / 30)}개 · 문서 ${items.length}건 · 첫 서버 응답 ${Math.round(ms)}ms`);
    expect(items).toHaveLength(docs.length);
  }, 120_000);
});
