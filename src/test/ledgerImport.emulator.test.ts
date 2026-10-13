/**
 * 가계부 이관 — 진짜 규칙 위에서.
 *
 *  - 엑셀 파일 → 실제 거래 · 카테고리로 들어가고 규칙이 받아 준다 (대출 원금 흐름 포함)
 *  - 같은 파일을 다시 가져오면 한 건도 쓰지 않는다 · 건수는 파일 총계와 맞는다
 *  - 반쯤 들어간 상태(다른 탭이 먼저 넣은 것)에서 이어 넣어도 두 번 들어가지 않는다
 *  - 넣은 거래는 백업에 실려 다른 계정으로 그대로 옮겨진다
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../data/backup';
import { readBackupFile } from '../data/backupFile';
import { planFromFiles, readImportFiles, writeLedgerImport, type ImportIO, type ImportOutcome } from '../data/ledgerImportRun';
import { createManyIfAbsent, fetchAll } from '../data/repo';
import { safeMerge } from '../data/restore';
import { newCategory } from '../domain/category';
import { actualsIn, totalsOf } from '../domain/ledgerStats';
import { periodByKey } from '../domain/period';
import { HEADER, xlsxOf } from './xlsxFixture';

let env: RulesTestEnvironment;
const A = 'import-a';
const B = 'import-b';

beforeAll(async () => {
  // 에뮬레이터 테스트는 node 환경이다. 엑셀 읽기가 쓰는 DOMParser 만 jsdom 에서 빌린다.
  // (jsdom 은 타입 선언이 없어 이름을 변수로 넘겨 불러온다.)
  const jsdom = 'jsdom';
  const { JSDOM } = (await import(/* @vite-ignore */ jsdom)) as { JSDOM: new () => { window: { DOMParser: typeof DOMParser } } };
  globalThis.DOMParser ??= new JSDOM().window.DOMParser;
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const ioFor = (db: Firestore, uid: string): ImportIO => ({
  fetchExisting: async () => {
    const all = await fetchAll(db, uid);
    return { categories: all.categories, entries: all.entries, accounts: all.accounts };
  },
  createIfAbsent: (payload) => createManyIfAbsent(db, uid, payload),
});

const MARCH = xlsxOf([
  [...HEADER],
  ['2026.03.25', '수입', '3,405,940', '-', '회사', '월급', ''],
  ['2026.03.25', '지출', '9,871', '-', '초밥', '배달', ''],
  ['2026.03.26', '지출', '4,800', '-', '담배', '술담배', ''],
  ['2026.03.26', '지출', '4,800', '-', '담배', '술담배', ''],
  ['2026.03.30', '지출', '30,000', '-', '친구', '-', ''],
  ['2026.04.10', '지출', '2,446,660', '-', '대출', '대출', ''],
  ['2026.04.11', '지출', '5,000', '현금', '떡볶이', '식비', '시장, 둘이'],
  ['2026.04.12', '수입', '55', '-', '', '-', ''],
]);
const APRIL = xlsxOf([
  [...HEADER],
  ['2026.04.25', '지출', '480,000', '-', '월세', '주거', ''],
  ['2026.04.26', '지출', '12,000', '-', '점심', '식당/간식', ''],
]);

async function runImport(uid: string, files: { name: string; bytes: Uint8Array }[], mode: 'skip' | 'all' = 'skip'): Promise<ImportOutcome> {
  const db = dbOf(uid);
  const read = await readImportFiles(files);
  expect(read.problems).toEqual([]);
  const plans = await planFromFiles(read, ioFor(db, uid));
  return writeLedgerImport(plans[mode], ioFor(db, uid));
}

const sumUp = (o: ImportOutcome) => o.created + o.conflicts + o.failed.length + o.skippedBefore;

describe('가계부 이관', () => {
  it('엑셀 두 파일 → 실제 거래 · 카테고리. 규칙이 받아 주고 결산이 원본과 맞는다', async () => {
    const out = await runImport(A, [{ name: '3월.xlsx', bytes: MARCH }, { name: '4월.xlsx', bytes: APRIL }]);
    expect(out).toMatchObject({ kind: 'ok', created: 10, failed: [], total: 10 });
    expect(out.categoriesCreated).toBe(7);
    expect(sumUp(out)).toBe(out.total);

    const all = await fetchAll(dbOf(A), A);
    expect(all.entries).toHaveLength(10);
    expect(all.entries.every((e) => e.money?.status === 'actual')).toBe(true);
    expect(all.entries.filter((e) => e.title === '담배')).toHaveLength(2);
    const loan = all.entries.find((e) => e.title === '대출')!;
    expect(loan.money!.flow).toBe('loanPrincipal');
    expect(all.entries.find((e) => e.title === '떡볶이')!.note).toBe('시장, 둘이');

    const p = periodByKey('2026-04', 25)!;
    const t = totalsOf(actualsIn(all.entries, p.start, p.end));
    expect(t.income).toBe(3_405_940 + 55);
    expect(t.principal).toBe(2_446_660);
    expect(t.spending).toBe(9_871 + 4_800 * 2 + 30_000 + 5_000);
  });

  it('같은 파일을 다시 가져오면 한 건도 쓰지 않는다 — 건수는 파일 총계와 맞는다', async () => {
    await runImport(A, [{ name: '3월.xlsx', bytes: MARCH }]);
    const again = await runImport(A, [{ name: '3월 사본.xlsx', bytes: MARCH }, { name: '3월.xlsx', bytes: MARCH }]);
    expect(again).toMatchObject({ kind: 'nothing', created: 0, total: 16, skippedBefore: 16 });
    expect((await fetchAll(dbOf(A), A)).entries).toHaveLength(8);
  });

  it('이미 있는 같은 이름의 카테고리에 붙는다 — 새로 만들지 않는다', async () => {
    const db = dbOf(A);
    const r = await createManyIfAbsent(db, A, { categories: [newCategory('expense', '식비', 0, 'default-food')] });
    expect(r.created).toBe(1);
    await runImport(A, [{ name: '3월.xlsx', bytes: MARCH }]);
    const all = await fetchAll(db, A);
    expect(all.categories.filter((c) => c.name === '식비')).toHaveLength(1);
    expect(all.entries.find((e) => e.title === '떡볶이')!.money!.categoryId).toBe('default-food');
  });

  it('다른 탭이 먼저 넣은 행은 충돌로 세고 덮지 않는다', async () => {
    const db = dbOf(A);
    const read = await readImportFiles([{ name: '3월.xlsx', bytes: MARCH }]);
    const plans = await planFromFiles(read, ioFor(db, A));
    // 계획을 세운 뒤, 쓰기 전에 다른 탭이 두 건을 먼저 넣었다.
    const first = plans.skip.entries.slice(0, 2).map((e) => ({ ...e, title: `${e.title} (다른 탭)` }));
    await createManyIfAbsent(db, A, { categories: plans.skip.newCategories, entries: first });
    const out = await writeLedgerImport(plans.skip, ioFor(db, A));
    expect(out).toMatchObject({ kind: 'ok', created: 6, conflicts: 2 });
    expect(sumUp(out)).toBe(out.total);
    const all = await fetchAll(db, A);
    expect(all.entries).toHaveLength(8);
    expect(all.entries.filter((e) => e.title.endsWith('(다른 탭)'))).toHaveLength(2);
  });

  it('넣은 거래는 백업에 실려 다른 계정으로 그대로 옮겨진다', async () => {
    await runImport(A, [{ name: '3월.xlsx', bytes: MARCH }]);
    const a = await fetchAll(dbOf(A), A);
    const file = JSON.stringify(buildBackup({ ...a, ledger: { settleDay: 25 }, recovery: null }));
    const read = readBackupFile(file);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const outcome = await safeMerge(read.file.data, {
      fetchAll: () => fetchAll(dbOf(B), B),
      createIfAbsent: (payload) => createManyIfAbsent(dbOf(B), B, payload),
    });
    expect(outcome.kind).toBe('ok');
    const b = await fetchAll(dbOf(B), B);
    const byId = (list: readonly { id: string }[]) => [...list].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(b.entries)).toEqual(byId(a.entries));
    expect(byId(b.categories)).toEqual(byId(a.categories));
    // B 에서 같은 엑셀을 다시 가져와도 두 번 들어가지 않는다.
    const again = await runImport(B, [{ name: '3월.xlsx', bytes: MARCH }]);
    expect(again.kind).toBe('nothing');
  });
});
