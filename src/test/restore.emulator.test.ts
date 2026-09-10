/**
 * 복원 통합 테스트 — 실제 Firestore(에뮬레이터)와 실제 보안 규칙 위에서.
 *
 * 가짜 저장소로 하는 순서 테스트(`src/data/restore.test.ts`)는 "쓰기가 실패하면 지우지
 * 않는다" 를 시험하지만, 진짜 Firestore 가 규칙에 걸린 문서를 어떻게 돌려주는지는
 * 모른다. `writeMany` 는 실패를 **던지지 않고** 결과로 돌려주기 때문에, 그 결과가
 * 실제로 어떤 모양인지 한 번은 진짜 저장소에서 확인해야 한다.
 *
 * 실행: npm run test:rules  (Firestore 에뮬레이터가 자동으로 뜬다)
 */
import {
  initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDocs, collection, setDoc, type Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BackupData } from '../data/backup';
import { deleteMany, fetchAll, writeMany } from '../data/repo';
import { safeMerge, safeReplace, type RestoreIO } from '../data/restore';
import { newEntry } from '../domain/entry';
import type { Account, Debt, Pin } from '../domain/types';

let env: RulesTestEnvironment;
const ME = 'restore-me';
const OTHER = 'restore-other';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;

const account = (p: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-09-01', checkedAt: '2026-09-01T00:00:00.000Z',
  order: 0, createdAt: '', updatedAt: '', ...p,
});
const debt = (p: Partial<Debt> = {}): Debt => ({
  id: 'd1', name: '학자금', balanceMinor: 5_000_000, monthlyMinor: 200_000,
  rate: 3.5, currentRound: 1, totalRounds: 25, order: 0, createdAt: '', updatedAt: '', ...p,
});
const pin = (p: Partial<Pin> = {}): Pin => ({
  id: 'p1', lens: 'task', text: '고정 메모', order: 0, createdAt: '', updatedAt: '', ...p,
});
const data = (p: Partial<BackupData> = {}): BackupData => ({
  entries: [], accounts: [], debts: [], pins: [], recovery: null, ...p,
});

const ioFor = (db: Firestore, uid: string): RestoreIO => ({
  fetchAll: () => fetchAll(db, uid),
  writeMany: (payload) => writeMany(db, uid, payload),
  deleteMany: (targets) => deleteMany(db, uid, [...targets]),
});

/** 지금 저장돼 있는 것을 컬렉션별 id 목록으로. */
async function idsOf(db: Firestore, uid: string) {
  const all = await fetchAll(db, uid);
  return {
    entries: all.entries.map((e) => e.id).sort(),
    accounts: all.accounts.map((a) => a.id).sort(),
    debts: all.debts.map((d) => d.id).sort(),
    pins: all.pins.map((p) => p.id).sort(),
  };
}

const SEED = data({
  entries: [newEntry('task', { id: 'old-1', title: '내 것' }), newEntry('task', { id: 'old-2' })],
  accounts: [account({ id: 'a-old' })],
  debts: [debt({ id: 'd-old' })],
  pins: [pin({ id: 'p-old' })],
});

const RESTORED = data({
  entries: [newEntry('task', { id: 'new-1', title: '복원' }), newEntry('task', { id: 'old-1', title: '덮어씀' })],
  accounts: [account({ id: 'a-new' })],
});

async function seed(db: Firestore, uid: string) {
  const r = await writeMany(db, uid, SEED);
  expect(r.failed).toEqual([]);
}

describe('정상 복원', () => {
  it('파일 내용으로 바뀌고 파일에 없던 것은 네 컬렉션 모두에서 사라진다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);

    const outcome = await safeReplace(RESTORED, ioFor(db, ME));
    expect(outcome.kind).toBe('ok');

    expect(await idsOf(db, ME)).toEqual({
      entries: ['new-1', 'old-1'],
      accounts: ['a-new'],
      // "전체 교체" 인데 예전에는 이 둘이 그대로 남았다.
      debts: [],
      pins: [],
    });
  });

  it('같은 id 는 파일 내용으로 덮인다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    await safeReplace(RESTORED, ioFor(db, ME));

    const all = await fetchAll(db, ME);
    expect(all.entries.find((e) => e.id === 'old-1')?.title).toBe('덮어씀');
  });
});

describe('쓰기 실패 — 아무것도 지우지 않는다', () => {
  it('일부 쓰기가 실패하면 기존 데이터가 그대로 남는다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const before = await idsOf(db, ME);

    // 실제 저장소를 쓰되 한 건만 실패하게 만든다.
    // (규칙을 어기는 문서는 검증기가 먼저 거르므로, 저장소 경계에서 주입한다.)
    const real = ioFor(db, ME);
    const io: RestoreIO = {
      ...real,
      writeMany: async (payload) => {
        const kept = { ...payload, accounts: [] };
        const r = await real.writeMany(kept);
        return { ...r, failed: [{ collection: 'accounts', id: 'a-new', reason: '주입한 실패' }] };
      },
    };

    const outcome = await safeReplace(RESTORED, io);
    expect(outcome.kind).toBe('write-failed');

    const after = await idsOf(db, ME);
    // 예전 구조라면 여기서 entries 가 이미 비어 있었다.
    expect(after.entries).toEqual(['new-1', 'old-1', 'old-2']);
    expect(after.debts).toEqual(before.debts);
    expect(after.pins).toEqual(before.pins);
  });

  it('보안 규칙이 통째로 막으면 allFailed 로 돌아오고 기존 데이터가 남는다', async () => {
    const mine = dbOf(ME);
    await seed(mine, ME);

    // 남의 uid 로 쓰려 하면 규칙이 전부 거부한다.
    const intruder = dbOf(OTHER);
    const outcome = await safeReplace(RESTORED, ioFor(intruder, ME));

    expect(outcome.kind).toBe('write-failed');
    if (outcome.kind === 'write-failed') {
      expect(outcome.written.allFailed).toBe(true);
      expect(outcome.written.written).toBe(0);
      expect(outcome.written.failed.length).toBeGreaterThan(0);
    }
    expect((await idsOf(mine, ME)).entries).toEqual(['old-1', 'old-2']);
  });

  it('writeMany 는 규칙에 걸린 문서를 던지지 않고 결과로 알려 준다', async () => {
    const db = dbOf(ME);
    // 규칙은 제목 500자를 넘기면 거부한다. 검증기가 먼저 거르지만,
    // 저장 계층이 실패를 어떻게 돌려주는지는 여기서 확인해 둔다.
    const tooLong = newEntry('task', { id: 'huge', title: 'x'.repeat(600) });
    const ok = newEntry('task', { id: 'fine' });
    const r = await writeMany(db, ME, { entries: [ok, tooLong] });

    expect(r.written).toBe(1);
    expect(r.failed.map((f) => f.id)).toEqual(['huge']);
    expect(r.allFailed).toBe(false);
    expect((await idsOf(db, ME)).entries).toEqual(['fine']);
  });
});

describe('재시도와 중복 실행', () => {
  it('실패한 뒤 다시 하면 이어서 끝난다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);

    const real = ioFor(db, ME);
    const failing: RestoreIO = {
      ...real,
      writeMany: async (payload) => {
        const r = await real.writeMany({ ...payload, accounts: [] });
        return { ...r, failed: [{ collection: 'accounts', id: 'a-new', reason: '주입한 실패' }] };
      },
    };
    expect((await safeReplace(RESTORED, failing)).kind).toBe('write-failed');

    // 원인을 고친 뒤 같은 파일로 다시.
    expect((await safeReplace(RESTORED, real)).kind).toBe('ok');
    expect(await idsOf(db, ME)).toEqual({
      entries: ['new-1', 'old-1'], accounts: ['a-new'], debts: [], pins: [],
    });
  });

  it('두 번 연속 복원해도 같은 자리에 머문다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const io = ioFor(db, ME);

    await safeReplace(RESTORED, io);
    const second = await safeReplace(RESTORED, io);

    expect(second.kind).toBe('ok');
    if (second.kind === 'ok') expect(second.removed.written).toBe(0);
    expect((await idsOf(db, ME)).entries).toEqual(['new-1', 'old-1']);
  });

  it('복원 도중 다른 곳에서 생긴 문서도 파일에 없으면 지운다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const real = ioFor(db, ME);

    const io: RestoreIO = {
      ...real,
      // 쓰기가 끝난 직후, 지우기 목록을 뽑기 전에 다른 탭이 항목을 하나 더했다.
      fetchAll: async () => {
        await setDoc(
          doc(db, 'users', ME, 'entries', 'meanwhile'),
          { kind: 'task', title: '다른 탭', note: '', color: 'blue', tags: [], location: '',
            startDate: '2026-09-01', startTime: null, endDate: null, endTime: null,
            ymSpan: ['2026-09'], isRecurring: false, recurrence: null,
            task: { status: 'planned', important: false, urgent: false, order: 0 },
            money: null, recovery: null, createdAt: '', updatedAt: '' },
        );
        return real.fetchAll();
      },
    };

    expect((await safeReplace(RESTORED, io)).kind).toBe('ok');
    // 파일에 없는 것은 남기지 않는다 — 그것이 전체 교체의 뜻이다.
    expect((await idsOf(db, ME)).entries).toEqual(['new-1', 'old-1']);
  });
});

describe('배치 경계를 넘는 데이터', () => {
  it('400건 경계를 넘겨도 전부 쓰고 전부 지운다', async () => {
    const db = dbOf(ME);
    const bulk = data({
      entries: Array.from({ length: 450 }, (_, i) => newEntry('task', { id: `bulk-${i}` })),
    });
    const written = await writeMany(db, ME, bulk);
    expect(written.failed).toEqual([]);
    expect(written.written).toBe(450);

    const snap = await getDocs(collection(db, 'users', ME, 'entries'));
    expect(snap.size).toBe(450);

    // 백업이 비어 있으면 450건 전부가 지울 목록이다.
    const outcome = await safeReplace(data(), ioFor(db, ME));
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') expect(outcome.removed.written).toBe(450);
    expect((await idsOf(db, ME)).entries).toEqual([]);
  }, 60_000);
});

describe('병합', () => {
  it('파일에만 있는 것을 더하고 기존은 하나도 지우지 않는다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);

    const outcome = await safeMerge(RESTORED, ioFor(db, ME), null);
    expect(outcome.kind).toBe('ok');

    expect(await idsOf(db, ME)).toEqual({
      entries: ['new-1', 'old-1', 'old-2'],
      accounts: ['a-new', 'a-old'],
      debts: ['d-old'],
      pins: ['p-old'],
    });
  });

  it('같은 id 는 지금 것을 남긴다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    await safeMerge(RESTORED, ioFor(db, ME), null);

    const all = await fetchAll(db, ME);
    expect(all.entries.find((e) => e.id === 'old-1')?.title).toBe('내 것');
  });
});

describe('잘못된 파일', () => {
  it('저장소를 한 번도 건드리지 않는다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const before = await idsOf(db, ME);

    const outcome = await safeReplace(data({ pins: [pin({ id: 'a/b' })] }), ioFor(db, ME));
    expect(outcome.kind).toBe('invalid');
    expect(await idsOf(db, ME)).toEqual(before);
  });
});
