/**
 * 복원 통합 테스트 — 실제 Firestore(에뮬레이터)와 실제 보안 규칙 위에서.
 *
 * 가짜 저장소로 하는 테스트는 "이미 있으면 덮어쓰지 않는다" 를 **약속대로 구현했다고
 * 가정하고** 시험한다. 그 약속이 진짜 Firestore 에서도 지켜지는지 — 특히 조회와 쓰기
 * 사이에 다른 클라이언트가 끼어들었을 때 — 는 여기서만 확인된다.
 *
 * 실행: npm run test:rules  (Firestore 에뮬레이터가 자동으로 뜬다)
 */
import {
  initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BackupData } from '../data/backup';
import { createManyIfAbsent, fetchAll, writeMany } from '../data/repo';
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
  createIfAbsent: (payload) => createManyIfAbsent(db, uid, payload),
});

async function idsOf(db: Firestore, uid: string) {
  const all = await fetchAll(db, uid);
  return {
    entries: all.entries.map((e) => e.id).sort(),
    accounts: all.accounts.map((a) => a.id).sort(),
    debts: all.debts.map((d) => d.id).sort(),
    pins: all.pins.map((p) => p.id).sort(),
  };
}
const titleOf = async (db: Firestore, uid: string, id: string) =>
  (await fetchAll(db, uid)).entries.find((e) => e.id === id)?.title;

/** 기존 데이터. 'A' 는 백업에도 같은 id 로 들어 있지만 내용이 다르다. */
const SEED = data({
  entries: [newEntry('task', { id: 'A', title: '내 것' }), newEntry('task', { id: 'old-2' })],
  accounts: [account({ id: 'a-old' })],
  debts: [debt({ id: 'd-old' })],
  pins: [pin({ id: 'p-old' })],
});

async function seed(db: Firestore, uid: string) {
  const r = await writeMany(db, uid, SEED);
  expect(r.failed).toEqual([]);
}

describe('전체 교체 — 꺼져 있다', () => {
  it('부르더라도 저장소가 하나도 바뀌지 않는다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const before = await idsOf(db, ME);
    const beforeTitle = await titleOf(db, ME, 'A');

    const outcome = safeReplace();
    expect(outcome.kind).toBe('replace-disabled');

    expect(await idsOf(db, ME)).toEqual(before);
    expect(await titleOf(db, ME, 'A')).toBe(beforeTitle);
  });
});

describe('병합 — 기존 문서를 덮어쓰지 않는다', () => {
  it('파일에만 있는 것을 더하고 같은 id 는 지금 것을 남긴다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);

    const outcome = await safeMerge(data({
      entries: [newEntry('task', { id: 'A', title: '파일 내용' }), newEntry('task', { id: 'new-1' })],
      accounts: [account({ id: 'a-new' })],
    }), ioFor(db, ME));

    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.created.created).toBe(2);
      expect(outcome.skippedExisting).toBe(1);
    }
    expect(await idsOf(db, ME)).toEqual({
      entries: ['A', 'new-1', 'old-2'],
      accounts: ['a-new', 'a-old'],
      // 지우는 단계가 없다.
      debts: ['d-old'],
      pins: ['p-old'],
    });
    expect(await titleOf(db, ME, 'A')).toBe('내 것');
  });

  it('조회 뒤 다른 클라이언트가 같은 id 를 만들면 충돌로 남기고 덮지 않는다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const real = ioFor(db, ME);

    const io: RestoreIO = {
      fetchAll: real.fetchAll,
      // 조회는 끝났고 쓰기 직전이다. 다른 클라이언트가 같은 id 를 먼저 만든다.
      createIfAbsent: async (payload) => {
        const other = dbOf(OTHER);
        void other; // 남의 경로에는 못 쓴다. 같은 사용자의 다른 탭을 흉내 낸다.
        await setDoc(doc(db, 'users', ME, 'entries', 'race'), {
          kind: 'task', title: '다른 탭이 먼저', note: '', color: 'blue', tags: [], location: '',
          startDate: '2026-09-01', startTime: null, endDate: null, endTime: null,
          ymSpan: ['2026-09'], isRecurring: false, recurrence: null,
          task: { status: 'planned', important: false, urgent: false, order: 0 },
          money: null, recovery: null, createdAt: '', updatedAt: '',
        });
        return real.createIfAbsent(payload);
      },
    };

    const outcome = await safeMerge(data({
      entries: [newEntry('task', { id: 'race', title: '파일 내용' })],
    }), io);

    expect(outcome.kind).toBe('partial');
    if (outcome.kind === 'partial') {
      expect(outcome.created.conflicts.map((c) => c.id)).toEqual(['race']);
      expect(outcome.created.created).toBe(0);
    }
    // 먼저 만들어진 쪽이 남는다. setDoc 이었다면 덮였을 자리다.
    expect(await titleOf(db, ME, 'race')).toBe('다른 탭이 먼저');
  });

  it('createManyIfAbsent 는 이미 있는 문서를 건드리지 않는다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);

    const r = await createManyIfAbsent(db, ME, {
      entries: [newEntry('task', { id: 'A', title: '덮어쓰려는 값' }), newEntry('task', { id: 'fresh' })],
    });

    expect(r.created).toBe(1);
    expect(r.conflicts.map((c) => c.id)).toEqual(['A']);
    expect(r.failed).toEqual([]);
    expect(await titleOf(db, ME, 'A')).toBe('내 것');
    expect(await titleOf(db, ME, 'fresh')).toBe('');
  });

  it('보안 규칙이 쓰기를 막으면 한 건도 안 들어가고 기존 데이터가 그대로다', async () => {
    const mine = dbOf(ME);
    await seed(mine, ME);
    const before = await idsOf(mine, ME);

    // 읽기는 내 권한으로, 쓰기는 남의 권한으로 — 규칙이 쓰기만 거부하는 상황.
    const intruder = dbOf(OTHER);
    const io: RestoreIO = {
      fetchAll: () => fetchAll(mine, ME),
      createIfAbsent: (payload) => createManyIfAbsent(intruder, ME, payload),
    };

    const outcome = await safeMerge(data({
      entries: [newEntry('task', { id: 'new-1' }), newEntry('task', { id: 'new-2' })],
    }), io);

    expect(outcome.kind).toBe('all-failed');
    if (outcome.kind === 'all-failed') {
      expect(outcome.created.allFailed).toBe(true);
      expect(outcome.created.created).toBe(0);
      expect(outcome.created.failed.map((f) => f.id).sort()).toEqual(['new-1', 'new-2']);
    }
    expect(await idsOf(mine, ME)).toEqual(before);
    expect(await titleOf(mine, ME, 'A')).toBe('내 것');
  });

  /**
   * 저장 계층에서 한 건만 실패시킨다.
   *
   * 검증기가 이제 보안 규칙 위반을 먼저 걸러내므로, 규칙을 어기는 문서로는 쓰기 단계까지
   * 갈 수 없다. 네트워크 오류처럼 검증으로 알 수 없는 실패를 흉내 내려면 여기서 주입한다.
   */
  const failingOn = (db: Firestore, uid: string, failIds: Set<string>): RestoreIO => ({
    fetchAll: () => fetchAll(db, uid),
    createIfAbsent: async (payload) => {
      const kept: typeof payload = {
        entries: (payload.entries ?? []).filter((x) => !failIds.has(x.id)),
        accounts: (payload.accounts ?? []).filter((x) => !failIds.has(x.id)),
        debts: (payload.debts ?? []).filter((x) => !failIds.has(x.id)),
        pins: (payload.pins ?? []).filter((x) => !failIds.has(x.id)),
      };
      const r = await createManyIfAbsent(db, uid, kept);
      const dropped = [...(payload.entries ?? []), ...(payload.accounts ?? []),
        ...(payload.debts ?? []), ...(payload.pins ?? [])].filter((x) => failIds.has(x.id));
      return {
        ...r,
        failed: [...r.failed, ...dropped.map((x) => ({ collection: 'entries', id: x.id, reason: '주입한 실패' }))],
        allFailed: r.created === 0 && r.conflicts.length === 0,
      };
    },
  });

  it('A 는 이미 있고 B 쓰기가 실패해도 A 의 내용은 그대로다', async () => {
    // 필수 회귀 사례: 기존 A 와 백업 A 의 내용이 다른 상태에서 B 저장 실패.
    const db = dbOf(ME);
    await seed(db, ME);

    const outcome = await safeMerge(data({
      entries: [newEntry('task', { id: 'A', title: '파일 내용' }), newEntry('task', { id: 'B' })],
    }), failingOn(db, ME, new Set(['B'])));

    expect(outcome.kind).toBe('all-failed');
    if (outcome.kind === 'all-failed') {
      expect(outcome.skippedExisting).toBe(1);
      expect(outcome.created.failed.map((f) => f.id)).toEqual(['B']);
    }
    // A 는 쓰기를 시도하지도 않았다. 원래 내용이 그대로다.
    expect(await titleOf(db, ME, 'A')).toBe('내 것');
    expect((await idsOf(db, ME)).entries).toEqual(['A', 'old-2']);
  });

  it('부분 성공 뒤 다시 하면 못 들어간 것만 들어간다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const payload = data({
      entries: [newEntry('task', { id: 'good' }), newEntry('task', { id: 'bad' })],
    });

    const first = await safeMerge(payload, failingOn(db, ME, new Set(['bad'])));
    expect(first.kind).toBe('partial');
    if (first.kind === 'partial') {
      expect(first.created.created).toBe(1);
      expect(first.created.failed.map((f) => f.id)).toEqual(['bad']);
    }
    expect((await idsOf(db, ME)).entries).toEqual(['A', 'good', 'old-2']);

    // 원인이 사라진 뒤 같은 파일로 다시.
    const second = await safeMerge(payload, ioFor(db, ME));
    expect(second.kind).toBe('ok');
    if (second.kind === 'ok') {
      expect(second.created.created).toBe(1);
      expect(second.skippedExisting).toBe(1);
    }
    expect((await idsOf(db, ME)).entries).toEqual(['A', 'bad', 'good', 'old-2']);
  });

  it('두 번 연속 가져와도 같은 자리에 머문다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const payload = data({ entries: [newEntry('task', { id: 'new-1', title: '한 번만' })] });

    await safeMerge(payload, ioFor(db, ME));
    const second = await safeMerge(payload, ioFor(db, ME));

    expect(second.kind).toBe('ok');
    if (second.kind === 'ok') {
      expect(second.created.created).toBe(0);
      expect(second.skippedExisting).toBe(1);
    }
    expect((await idsOf(db, ME)).entries).toEqual(['A', 'new-1', 'old-2']);
  });

  it('동시에 두 번 돌려도 한 번만 만들어진다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const payload = data({
      entries: Array.from({ length: 20 }, (_, i) => newEntry('task', { id: `dup-${i}` })),
    });

    // UI 는 중복 실행을 막지만, 다른 기기에서 동시에 눌렀을 때를 흉내 낸다.
    const [a, b] = await Promise.all([
      safeMerge(payload, ioFor(db, ME)),
      safeMerge(payload, ioFor(db, ME)),
    ]);

    const createdTotal = (a.kind === 'ok' || a.kind === 'partial' ? a.created.created : 0)
      + (b.kind === 'ok' || b.kind === 'partial' ? b.created.created : 0);
    // 둘이 합쳐 정확히 20건. 트랜잭션이 겹친 쪽을 충돌로 돌려세운다.
    expect(createdTotal).toBe(20);
    expect((await idsOf(db, ME)).entries).toEqual(
      ['A', 'old-2', ...Array.from({ length: 20 }, (_, i) => `dup-${i}`)].sort(),
    );
  }, 60_000);

  it('배치 경계(100건)를 넘겨도 전부 만든다', async () => {
    const db = dbOf(ME);
    const many = data({
      entries: Array.from({ length: 250 }, (_, i) => newEntry('task', { id: `bulk-${i}` })),
    });
    const outcome = await safeMerge(many, ioFor(db, ME));

    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') expect(outcome.created.created).toBe(250);
    expect((await idsOf(db, ME)).entries).toHaveLength(250);
  }, 90_000);
});

describe('잘못된 파일', () => {
  it('저장소를 한 번도 건드리지 않는다', async () => {
    const db = dbOf(ME);
    await seed(db, ME);
    const before = await idsOf(db, ME);

    const outcome = await safeMerge(data({ pins: [pin({ id: 'a/b' })] }), ioFor(db, ME));
    expect(outcome.kind).toBe('invalid');
    expect(await idsOf(db, ME)).toEqual(before);
  });
});
