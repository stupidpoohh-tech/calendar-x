/**
 * 백업 · 복원 최종 검증 (L7) — 진짜 저장소와 진짜 보안 규칙 위에서.
 *
 * 한 계정의 모든 자료(일정 · 아이디어 · 예정 · 실제 거래 · 확정 연결 · 계좌 반영 목록 ·
 * 대출 · 고정 메모 · 생활비 · 세이브 · 카테고리 · 카테고리 예산 · 정산 시작일 · 회복 규칙)를
 * 화면과 같은 길로 내보내고(`fetchAll` → `buildBackup` → JSON), 파일 읽기(`readBackupFile`)를
 * 거쳐 빈 계정에 병합(`safeMerge` → `createManyIfAbsent`)한다.
 *
 * 확인하는 것
 *   1. 빠지는 것이 없다 — 컬렉션마다 같은 문서, 같은 값
 *   2. 계산 결과가 같다 — 한도 · 결산 · 예산 대비가 원래 계정과 일치한다
 *   3. 건수가 맞아떨어진다 — 파일 총계 = created + skippedExisting + conflicts + failed
 *   4. 다시 가져와도, 일부가 이미 있어도 아무것도 덮지 않는다
 *   5. 예전 버전(v2 ~ v5) 파일도 들어온다
 *
 * 실행: npm run test:rules
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, countBackup, type BackupData } from '../data/backup';
import { readBackupFile } from '../data/backupFile';
import { categoryToDoc, recoveryRuleFromDoc } from '../data/converters';
import {
  createManyIfAbsent, fetchAll, fetchLedgerSettings, saveLedgerSettings, saveRecoveryRule, writeMany,
} from '../data/repo';
import { safeMerge, type RestoreIO } from '../data/restore';
import { newBudget, newReserve } from '../domain/budget';
import { defaultCategories, newCategory, setDefaultBudget, setPeriodBudget } from '../domain/category';
import { confirmOccurrence } from '../domain/confirm';
import { newEntry, newMoney } from '../domain/entry';
import { actualsIn, budgetRows, totalsOf } from '../domain/ledgerStats';
import { periodByKey } from '../domain/period';
import { defaultRecoveryRule } from '../domain/recovery';
import { headlineLimit, limitOn } from '../domain/tide';
import type { Account, Entry } from '../domain/types';

let env: RulesTestEnvironment;
const A = 'backup-a';
const B = 'backup-b';
const C = 'backup-c';
const TODAY = '2026-10-12';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const ioFor = (db: Firestore, uid: string): RestoreIO => ({
  fetchAll: () => fetchAll(db, uid),
  createIfAbsent: (payload) => createManyIfAbsent(db, uid, payload),
});

/** 화면의 '내보내기' 와 같은 길. 회복 규칙은 사용자 문서에서 읽는다. */
async function exportFile(db: Firestore, uid: string): Promise<string> {
  const [all, ledger, user] = await Promise.all([
    fetchAll(db, uid), fetchLedgerSettings(db, uid), getDoc(doc(db, `users/${uid}`)),
  ]);
  const recovery = user.data()?.recovery ? recoveryRuleFromDoc(user.data()?.recovery) : null;
  return JSON.stringify(buildBackup({ ...all, ledger, recovery }));
}

function readOk(text: string): BackupData {
  const r = readBackupFile(text);
  if (!r.ok) throw new Error(JSON.stringify(r.problems.slice(0, 3)));
  return r.file.data;
}

const byId = (list: readonly { id: string }[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));

/** 실제로 쓰는 모든 갈래가 들어 있는 계정. */
function richAccount(): BackupData {
  const rent = newEntry('money', {
    id: 'rent', title: '월세', startDate: '2026-01-25',
    recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
    money: newMoney({ amountMinor: 500_000, categoryId: 'default-housing' }),
  });
  const confirmed = confirmOccurrence(rent, '2026-09-25', { amountMinor: 510_000, date: '2026-09-27', accountId: 'acc-main' });
  if (!confirmed.ok) throw new Error(confirmed.reason);
  const entries: Entry[] = [
    newEntry('task', { id: 'task-1', title: '치과', startDate: '2026-10-20', keepPrivate: true }),
    newEntry('idea', { id: 'idea-1', title: '여행 계획' }),
    rent,
    confirmed.entry,
    newEntry('money', {
      id: 'salary', title: '급여', startDate: '2026-01-25',
      recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
      money: newMoney({ type: 'income', amountMinor: 3_000_000, categoryId: 'default-salary' }),
    }),
    newEntry('money', {
      id: 'lunch', title: '점심', startDate: TODAY,
      money: newMoney({ status: 'actual', amountMinor: 12_000, categoryId: 'default-food', method: '신한카드', budgetId: 'pocket', accountId: 'acc-main' }),
    }),
    newEntry('money', {
      id: 'card', title: '옷', startDate: '2026-10-05',
      money: newMoney({ status: 'actual', amountMinor: 80_000, flow: 'cardSpend', categoryId: 'pet' }),
    }),
    newEntry('money', {
      id: 'interest', title: '이자', startDate: '2026-10-03',
      money: newMoney({ status: 'actual', amountMinor: 20_000, flow: 'loanInterest', debtId: 'debt-1', accountId: 'acc-sub' }),
    }),
    // legacy 생활비 — 확정 대상이 아니지만 계산에는 그대로 들어간다.
    newEntry('money', {
      id: 'legacy-living', startDate: '2026-10-01', endDate: '2026-10-31', money: newMoney({ type: 'living', amountMinor: 310_000 }),
    }),
  ];
  const accounts: Account[] = [
    { id: 'acc-main', name: '주계좌', balanceMinor: 2_000_000, currency: 'KRW', asOf: TODAY, checkedAt: `${TODAY}T09:00:00.000Z`, reflectedEntryIds: ['lunch'], order: 0, createdAt: '', updatedAt: '' },
    { id: 'acc-sub', name: '부계좌', balanceMinor: 300_000, currency: 'KRW', asOf: TODAY, checkedAt: `${TODAY}T08:00:00.000Z`, reflectedEntryIds: [], order: 1, createdAt: '', updatedAt: '' },
  ];
  return {
    entries,
    accounts,
    debts: [{ id: 'debt-1', name: '학자금', balanceMinor: 5_000_000, monthlyMinor: 200_000, rate: 3.5, currentRound: 3, totalRounds: 25, order: 0, createdAt: '', updatedAt: '' }],
    pins: [{ id: 'pin-1', lens: 'money', text: '이번 달은 외식 줄이기', order: 0, createdAt: '', updatedAt: '' }],
    budgets: [newBudget({ id: 'pocket', name: '10월 생활비', startDate: '2026-10-01', endDate: '2026-10-31', amountMinor: 700_000 })],
    reserves: [newReserve({ id: 'rsv', name: '비상금', amountMinor: 100_000 })],
    categories: [
      ...defaultCategories('2026-10-01T00:00:00.000Z'),
      { ...newCategory('expense', '반려동물', 20, 'pet', '2026-10-01T00:00:00.000Z'), archived: true },
    ],
    categoryBudgets: [
      setDefaultBudget('default-food', '2026-01', 300_000, '2026-10-01T00:00:00.000Z'),
      setPeriodBudget('default-food', '2026-10', 250_000, '2026-10-01T00:00:00.000Z'),
      setDefaultBudget('pet', '2026-06', null, '2026-10-01T00:00:00.000Z'),
    ],
    ledger: { settleDay: 25 },
    recovery: { ...defaultRecoveryRule(), enabled: true, intervalDays: 4, debtCount: 1 },
  };
}

async function seed(db: Firestore, uid: string, d: BackupData): Promise<void> {
  const r = await writeMany(db, uid, d);
  expect(r.failed).toEqual([]);
  if (d.ledger) await saveLedgerSettings(db, uid, d.ledger);
  if (d.recovery) await saveRecoveryRule(db, uid, d.recovery);
}

/** 그 계정의 자료로 다시 계산한 숫자들. 복원 뒤 원래 계정과 같아야 한다. */
function computed(d: Omit<BackupData, 'recovery' | 'ledger'>, settleDay: number) {
  const period = periodByKey('2026-10', settleDay)!;
  const actuals = actualsIn(d.entries, period.start, period.end);
  return {
    headline: headlineLimit(d.accounts, d.entries, TODAY, { budgets: d.budgets, reserves: d.reserves }),
    limitEndOfMonth: limitOn(d.accounts, d.entries, '2026-10-31', TODAY, { budgets: d.budgets, reserves: d.reserves }),
    totals: totalsOf(actuals),
    budgetRows: budgetRows(d.categories, d.categoryBudgets, actuals, period.key, 'expense'),
  };
}

describe('내보내기 → 빈 계정으로 가져오기', () => {
  it('모든 갈래가 같은 값으로 돌아오고, 계산 결과도 같다', async () => {
    const dbA = dbOf(A);
    const dbB = dbOf(B);
    const original = richAccount();
    await seed(dbA, A, original);

    const file = await exportFile(dbA, A);
    const parsed = JSON.parse(file) as { version: number };
    expect(parsed.version).toBe(6);
    const incoming = readOk(file);
    expect(countBackup(incoming)).toBe(countBackup(original));
    expect(incoming.ledger).toEqual({ settleDay: 25 });
    expect(incoming.recovery?.intervalDays).toBe(4);

    const outcome = await safeMerge(incoming, ioFor(dbB, B));
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.created.created).toBe(countBackup(original));
    expect(outcome.skippedExisting).toBe(0);
    // 화면에서 '정산 시작일까지 바꾸기' 를 고른 경우와 같다.
    await saveLedgerSettings(dbB, B, incoming.ledger!);

    const [a, b] = await Promise.all([fetchAll(dbA, A), fetchAll(dbB, B)]);
    for (const key of ['entries', 'accounts', 'debts', 'pins', 'budgets', 'reserves', 'categories', 'categoryBudgets'] as const) {
      expect(byId(b[key]), key).toEqual(byId(a[key]));
    }
    // 원장 필드가 그대로다 — 실제 거래 · 회차 연결 · 계좌 · 반영 목록.
    const paid = b.entries.find((e) => e.id === 'rent~2026-09-25')!;
    expect(paid.money).toMatchObject({ status: 'actual', amountMinor: 510_000, plannedRef: { entryId: 'rent', date: '2026-09-25' } });
    expect(b.accounts.find((x) => x.id === 'acc-main')?.reflectedEntryIds).toEqual(['lunch']);
    expect(b.categories.find((c) => c.id === 'pet')?.archived).toBe(true);

    expect(computed(b, 25)).toEqual(computed(a, 25));
    expect((await fetchLedgerSettings(dbB, B)).settleDay).toBe(25);
  });

  it('같은 파일을 다시 가져오면 아무것도 쓰지 않는다 — 건수는 파일 총계와 맞는다', async () => {
    const dbA = dbOf(A);
    const dbB = dbOf(B);
    await seed(dbA, A, richAccount());
    const incoming = readOk(await exportFile(dbA, A));
    await safeMerge(incoming, ioFor(dbB, B));
    const again = await safeMerge(incoming, ioFor(dbB, B));
    expect(again.kind).toBe('ok');
    if (again.kind !== 'ok') return;
    expect(again.created.created).toBe(0);
    expect(again.skippedExisting).toBe(countBackup(incoming));
  });

  it('이미 있는 같은 id 는 지금 것을 남긴다 — 고쳐 둔 카테고리 이름 · 보관 상태를 덮지 않는다', async () => {
    const dbA = dbOf(A);
    const dbC = dbOf(C);
    await seed(dbA, A, richAccount());
    const incoming = readOk(await exportFile(dbA, A));
    // C 는 같은 기본 카테고리를 이미 고쳐 쓰고 있다.
    await setDoc(doc(dbC, `users/${C}/categories/default-food`), categoryToDoc({
      ...defaultCategories('x').find((c) => c.id === 'default-food')!, name: '밥값', archived: true,
    }));
    const outcome = await safeMerge(incoming, ioFor(dbC, C));
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const total = countBackup(incoming);
    expect(outcome.created.created + outcome.skippedExisting + outcome.created.conflicts.length + outcome.created.failed.length).toBe(total);
    expect(outcome.skippedExisting).toBe(1);
    const c = await fetchAll(dbC, C);
    expect(c.categories.find((x) => x.id === 'default-food')).toMatchObject({ name: '밥값', archived: true });
  });

  it('계좌 반영 목록 · 실제 거래가 있는 계정에 구버전 모양으로 덮어쓰려는 쓰기는 들어오지 않는다', async () => {
    // 가져오기는 없는 것만 만든다(덮어쓰지 않음). 그래도 같은 id 를 강제로 덮어쓰면 규칙이 막는다.
    const dbA = dbOf(A);
    await seed(dbA, A, richAccount());
    await expect(setDoc(doc(dbA, `users/${A}/accounts/acc-main`), {
      name: '주계좌', balanceMinor: 1, currency: 'KRW', asOf: TODAY, checkedAt: null, order: 0, createdAt: '', updatedAt: '',
    })).rejects.toThrow();
  });
});

describe('예전 버전 파일', () => {
  const base = {
    app: 'Dada Calendar', exportedAt: '2026-09-01T00:00:00.000Z',
    entries: [{
      id: 'old-1', kind: 'money', title: '전기요금', note: '', color: 'red', tags: [], location: '',
      startDate: '2026-10-20', startTime: null, endDate: null, endTime: null, ymSpan: ['2026-10'],
      isRecurring: false, recurrence: null, task: null,
      money: { type: 'expense', amountMinor: 65_000, currency: 'KRW', linkedEntryId: null },
      createdAt: '', updatedAt: '',
    }],
    accounts: [], debts: [], pins: [],
  };

  it.each([
    ['v2', { ...base, version: 2 }],
    ['v3', { ...base, version: 3, recovery: null }],
    ['v4', { ...base, version: 4, recovery: null, budgets: [], reserves: [] }],
    ['v5', { ...base, version: 5, recovery: null, budgets: [], reserves: [] }],
  ])('%s 파일은 예정으로 들어오고 결산 자료는 비어 있다', async (_v, file) => {
    const db = dbOf(B);
    const incoming = readOk(JSON.stringify(file));
    expect(incoming.categories).toEqual([]);
    expect(incoming.ledger).toBeNull();
    const outcome = await safeMerge(incoming, ioFor(db, B));
    expect(outcome.kind).toBe('ok');
    const all = await fetchAll(db, B);
    expect(all.entries[0]?.money).toMatchObject({ status: 'planned', flow: 'normal', plannedRef: null });
  });
});
