/**
 * 실패한 쓰기 — 진짜 Firestore(에뮬레이터)와 진짜 보안 규칙 위에서.
 *
 * `Promise.reject` 를 흉내 내는 테스트로는 알 수 없는 것이 둘 있다.
 *
 *   1. 규칙이 실제로 무엇을 거절하는가 — 흉내는 늘 거절한다
 *   2. 거절 뒤 저장소에 무엇이 남는가 — 흉내는 아무것도 안 남긴다
 *
 * 특히 2번이 중요하다. 브라우저에서 재 보니 거절당한 값은 로컬 캐시에 ~90ms 보였다가
 * 되돌아가고 새로고침해도 돌아오지 않았다. 즉 **우리가 붙잡지 않으면 사라진다.**
 * 여기서는 서버 쪽에도 남지 않는다는 것과, 붙잡아 둔 값으로 다시 보내면 실제로 들어간다는
 * 것, 그리고 그 사이 더 새로운 저장이 있었다면 충돌로 잡힌다는 것을 확인한다.
 *
 * 실행: npm run test:rules
 */
import {
  initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { getDoc, doc, setDoc, type Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  freshnessOf, isOfflineError, sendPending, type CommitInput, type PendingOp, type ReservePatchPayload,
} from '../data/pendingWrites';
import { annualBudgetFromDoc, reserveFromDoc } from '../data/converters';
import { newAnnualBudget } from '../domain/annualBudget';
import { newEntry } from '../domain/entry';
import type { Entry, Reserve } from '../domain/types';

let env: RulesTestEnvironment;
const ME = 'pending-me';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;

const entryAt = (id: string, title: string, updatedAt: string): Entry => ({
  ...newEntry('task', { id, title, startDate: '2026-09-12' }),
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt,
});

const opFor = (e: Entry, at = '2026-09-10T01:00:00.000Z'): PendingOp => ({
  id: `op-${e.id}`, kind: 'entry', label: '항목', summary: e.title,
  payload: e, at, reason: '', tries: 0,
});

const input = (e: Entry): CommitInput =>
  ({ kind: 'entry', label: '항목', summary: e.title, payload: e });

const titleOf = async (db: Firestore, id: string): Promise<string | null> => {
  const snap = await getDoc(doc(db, 'users', ME, 'entries', id));
  return snap.exists() ? (snap.data().title as string) : null;
};

describe('규칙이 거절하면', () => {
  it('서버에는 한 글자도 남지 않는다', async () => {
    const db = dbOf(ME);
    // 규칙은 title 500자를 거부한다.
    const tooLong = entryAt('e1', '가'.repeat(600), '2026-09-10T00:00:00.000Z');

    await expect(sendPending(db, ME, input(tooLong))).rejects.toThrow();
    expect(await titleOf(db, 'e1')).toBeNull();
  });

  it('거절 이유는 연결 문제가 아니다', async () => {
    const db = dbOf(ME);
    const tooLong = entryAt('e1', '가'.repeat(600), '2026-09-10T00:00:00.000Z');
    const err = await sendPending(db, ME, input(tooLong)).catch((e: unknown) => e);

    expect(isOfflineError(err)).toBe(false);
    expect((err as { code?: string }).code).toBe('permission-denied');
  });

  it('붙잡아 둔 값을 고쳐 다시 보내면 그대로 들어간다', async () => {
    const db = dbOf(ME);
    const tooLong = entryAt('e1', '가'.repeat(600), '2026-09-10T00:00:00.000Z');
    await expect(sendPending(db, ME, input(tooLong))).rejects.toThrow();

    // 목록에 남겨 둔 payload 에서 제목만 줄여 다시 보낸다 — 적은 내용이 살아 있다.
    const kept = opFor(tooLong);
    const fixed: Entry = { ...(kept.payload as Entry), title: '치과 예약' };
    await sendPending(db, ME, { ...kept, payload: fixed });

    expect(await titleOf(db, 'e1')).toBe('치과 예약');
  });

  it('그대로 다시 보내면 다시 거절당하고 서버는 그대로다', async () => {
    const db = dbOf(ME);
    const tooLong = entryAt('e1', '가'.repeat(600), '2026-09-10T00:00:00.000Z');
    await expect(sendPending(db, ME, input(tooLong))).rejects.toThrow();
    await expect(sendPending(db, ME, opFor(tooLong))).rejects.toThrow();
    expect(await titleOf(db, 'e1')).toBeNull();
  });
});

describe('충돌 판정', () => {
  it('그 뒤에 아무도 안 건드렸으면 fresh 다', async () => {
    const db = dbOf(ME);
    await sendPending(db, ME, input(entryAt('e1', '처음', '2026-09-10T00:00:00.000Z')));

    const op = opFor(entryAt('e1', '다시 보낼 값', '2026-09-10T00:00:00.000Z'));
    expect(await freshnessOf(db, ME, op)).toBe('fresh');
  });

  it('서버에 없는 문서도 fresh 다 — 새로 만드는 것이다', async () => {
    const db = dbOf(ME);
    const op = opFor(entryAt('없던것', '새로 만들 값', '2026-09-10T00:00:00.000Z'));
    expect(await freshnessOf(db, ME, op)).toBe('fresh');
  });

  it('실패한 A 뒤에 성공한 B 가 있으면 stale 이다', async () => {
    const db = dbOf(ME);
    // A: 규칙에 걸려 실패한다.
    const a = entryAt('e1', '가'.repeat(600), '2026-09-10T00:00:00.000Z');
    await expect(sendPending(db, ME, input(a))).rejects.toThrow();

    // B: 같은 자리에 더 새로운 값이 성공한다.
    const b = entryAt('e1', '나중에 적은 값', '2026-09-10T05:00:00.000Z');
    await sendPending(db, ME, input(b));

    // A 를 다시 보내려 하면 B 를 덮게 된다 — 그것을 먼저 알아채야 한다.
    expect(await freshnessOf(db, ME, opFor(a))).toBe('stale');
    // 판정만 했을 뿐 아무것도 쓰지 않았다.
    expect(await titleOf(db, 'e1')).toBe('나중에 적은 값');
  });

  it('삭제는 실패한 시각을 기준으로 본다', async () => {
    const db = dbOf(ME);
    // 지우려던 뒤에 같은 자리가 새로 채워졌다면 지우면 안 된다.
    await sendPending(db, ME, input(entryAt('e1', '새로 채운 값', '2026-09-10T05:00:00.000Z')));

    const del: PendingOp = {
      id: 'op-del', kind: 'entryDelete', label: '항목 삭제', summary: '옛것',
      payload: { id: 'e1' }, at: '2026-09-10T01:00:00.000Z', reason: '', tries: 0,
    };
    expect(await freshnessOf(db, ME, del)).toBe('stale');
  });

  it('순서 저장은 견줄 값이 없어 unknown 이다', async () => {
    const db = dbOf(ME);
    const op: PendingOp = {
      id: 'op-order', kind: 'taskOrder', label: '순서', summary: '할 일 3건의 순서',
      payload: { ordered: [{ id: 'e1', order: 0 }] },
      at: '2026-09-10T01:00:00.000Z', reason: '', tries: 0,
    };
    expect(await freshnessOf(db, ME, op)).toBe('unknown');
  });

  it('회복 설정도 unknown 이다 — 맵 필드라 시각이 없다', async () => {
    const db = dbOf(ME);
    const op: PendingOp = {
      id: 'op-rec', kind: 'recoveryPatch', label: '회복 예정일', summary: '2026-09-20',
      payload: { nextDueAt: '2026-09-20' },
      at: '2026-09-10T01:00:00.000Z', reason: '', tries: 0,
    };
    expect(await freshnessOf(db, ME, op)).toBe('unknown');
  });
});

describe('다른 종류의 쓰기도 같은 길로 간다', () => {
  it('잔고 · 대출 · 고정 메모 · 삭제가 모두 실제로 나간다', async () => {
    const db = dbOf(ME);
    const now = '2026-09-10T00:00:00.000Z';

    await sendPending(db, ME, {
      kind: 'account', label: '잔고', summary: '주계좌',
      payload: { id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
        asOf: '2026-09-10', checkedAt: now, order: 0, createdAt: now, updatedAt: now },
    });
    await sendPending(db, ME, {
      kind: 'pin', label: '고정 메모', summary: '메모',
      payload: { id: 'p1', lens: 'task', text: '메모', order: 0, createdAt: now, updatedAt: now },
    });
    await sendPending(db, ME, { kind: 'pinDelete', label: '고정 메모 삭제', summary: '메모', payload: { id: 'p1' } });

    expect((await getDoc(doc(db, 'users', ME, 'accounts', 'a1'))).exists()).toBe(true);
    expect((await getDoc(doc(db, 'users', ME, 'pins', 'p1'))).exists()).toBe(false);
  });

  it('회복은 항목과 규칙이 한 배치로 나간다', async () => {
    const db = dbOf(ME);
    const e = entryAt('r1', '회복', '2026-09-10T00:00:00.000Z');
    await sendPending(db, ME, {
      kind: 'recoveryCommit', label: '회복', summary: '2026-09-12 회차',
      payload: {
        rule: {
          enabled: true, intervalDays: 3, window: 'evening', generationHorizonDays: 1,
          lastCompletedAt: null, nextDueAt: '2026-09-12', activeEntryId: 'r1',
          debtCount: 0, completedEntryId: null, prevCompletedAt: null,
          defaultMemo: '', defaultOptionIds: [], options: [],
        },
        entry: e, removeEntryId: null,
      },
    });

    expect(await titleOf(db, 'r1')).toBe('회복');
    const user = await getDoc(doc(db, 'users', ME));
    expect((user.data()?.recovery as { activeEntryId?: string })?.activeEntryId).toBe('r1');
  });
});

/*
  세이브 P1. 새 세이브는 문서 전체를, 이미 있는 세이브는 바꾼 칸만(merge) 쓴다.
  확인하는 것: 다시 보내도 보호 · 목표 · 보관이 사라지지 않는다, 부분 쓰기가 다른 칸(다른 기기의
  수정)을 덮지 않는다, 그 사이 서버가 더 새로워졌으면 덮기 전에 묻는다(stale).
*/
describe('세이브 — 보호 · 목표 · 보관', () => {
  const base: Reserve = {
    id: 's1', name: '비상금', amountMinor: 300_000, currency: 'KRW',
    protected: false, targetAmountMinor: 1_000_000, targetDate: '2027-03-01', archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const readSave = async (db: Firestore) => {
    const snap = await getDoc(doc(db, 'users', ME, 'reserves', 's1'));
    return snap.exists() ? reserveFromDoc('s1', snap.data()) : null;
  };
  const patchOp = (patch: ReservePatchPayload['patch'], updatedAt: string, at = updatedAt): PendingOp => ({
    id: `op-${updatedAt}`, kind: 'reservePatch', label: '세이브', summary: '비상금',
    payload: { id: 's1', patch, updatedAt }, at, reason: '', tries: 0,
  });

  it('새 세이브의 전체 쓰기를 다시 보내도 보호 · 목표가 그대로 남는다', async () => {
    const db = dbOf(ME);
    const op: CommitInput = { kind: 'reserve', label: '세이브', summary: '비상금', payload: base };
    await sendPending(db, ME, op);
    await sendPending(db, ME, op);
    expect(await readSave(db)).toEqual(base);
  });

  it('부분 쓰기는 바꾼 칸만 바꾸고 금액 · 목표는 서버 값을 남긴다', async () => {
    const db = dbOf(ME);
    await sendPending(db, ME, { kind: 'reserve', label: '세이브', summary: '', payload: base });
    // 다른 기기가 금액을 고쳤다.
    await sendPending(db, ME, { ...patchOp({ amountMinor: 350_000 }, '2026-10-02T00:00:00.000Z') });
    // 이 기기는 보호만 켰다.
    await sendPending(db, ME, { ...patchOp({ protected: true }, '2026-10-03T00:00:00.000Z') });
    expect(await readSave(db)).toEqual({ ...base, amountMinor: 350_000, protected: true, updatedAt: '2026-10-03T00:00:00.000Z' });
  });

  it('보관 · 보관 해제가 금액과 보호 설정을 바꾸지 않는다', async () => {
    const db = dbOf(ME);
    await sendPending(db, ME, { kind: 'reserve', label: '세이브', summary: '', payload: base });
    await sendPending(db, ME, patchOp({ archivedAt: '2026-10-02T00:00:00.000Z' }, '2026-10-02T00:00:00.000Z'));
    expect(await readSave(db)).toMatchObject({ amountMinor: 300_000, protected: false, archivedAt: '2026-10-02T00:00:00.000Z' });
    await sendPending(db, ME, patchOp({ archivedAt: null }, '2026-10-03T00:00:00.000Z'));
    expect(await readSave(db)).toMatchObject({ amountMinor: 300_000, protected: false, archivedAt: null });
  });

  it('실패한 부분 쓰기 뒤에 더 새로운 저장이 있으면 stale 이다', async () => {
    const db = dbOf(ME);
    await sendPending(db, ME, { kind: 'reserve', label: '세이브', summary: '', payload: base });
    const failed = patchOp({ protected: true }, '2026-10-02T00:00:00.000Z');
    await sendPending(db, ME, patchOp({ amountMinor: 1 }, '2026-10-03T00:00:00.000Z'));
    expect(await freshnessOf(db, ME, failed)).toBe('stale');
    expect(await freshnessOf(db, ME, patchOp({ protected: true }, '2026-10-04T00:00:00.000Z'))).toBe('fresh');
  });

  it('지워진 세이브에 보낸 부분 쓰기는 거절되고, 이름 없는 문서를 남기지 않는다', async () => {
    const db = dbOf(ME);
    await expect(sendPending(db, ME, patchOp({ protected: true }, '2026-10-02T00:00:00.000Z'))).rejects.toThrow();
    expect(await readSave(db)).toBeNull();
  });

  it('구버전 모양(판 번호 · P1 필드 없음)의 전체 쓰기는 거절되고 서버 값이 남는다', async () => {
    const db = dbOf(ME);
    await sendPending(db, ME, { kind: 'reserve', label: '세이브', summary: '', payload: base });
    await expect(setDoc(doc(db, 'users', ME, 'reserves', 's1'), {
      name: '비상금', amountMinor: 10, currency: 'KRW', createdAt: '', updatedAt: '2026-10-05T00:00:00.000Z',
    })).rejects.toThrow();
    expect(await readSave(db)).toEqual(base);
  });
});

describe('연간 카테고리 예산 (P2)', () => {
  const b = newAnnualBudget('beauty', 2027, 600_000, { '04': 400_000, '10': 200_000 }, '2026-10-14T00:00:00.000Z');
  const read = async (db: Firestore) => {
    const snap = await getDoc(doc(db, 'users', ME, 'annualBudgets', b.id));
    return snap.exists() ? annualBudgetFromDoc(b.id, snap.data()) : null;
  };

  it('저장 · 다시 읽기 · 지우기가 실제로 나가고, 월별 배분이 그대로 돌아온다', async () => {
    const db = dbOf(ME);
    await sendPending(db, ME, { kind: 'annualBudget', label: '연간 예산', summary: '', payload: b });
    expect(await read(db)).toEqual(b);
    await sendPending(db, ME, { kind: 'annualBudgetDelete', label: '연간 예산', summary: '', payload: { id: b.id } });
    expect(await read(db)).toBeNull();
  });

  it('배분 합이 넘는 쓰기는 거절되고, 이미 있던 연간 예산은 그대로 남는다', async () => {
    const db = dbOf(ME);
    await sendPending(db, ME, { kind: 'annualBudget', label: '연간 예산', summary: '', payload: b });
    const over = { ...b, monthAllocations: { '04': 500_000, '10': 200_000 }, updatedAt: '2026-10-15T00:00:00.000Z' };
    await expect(sendPending(db, ME, { kind: 'annualBudget', label: '연간 예산', summary: '', payload: over })).rejects.toThrow();
    expect(await read(db)).toEqual(b);
  });

  it('실패한 쓰기 뒤에 더 새로운 저장이 있으면 stale 이다', async () => {
    const db = dbOf(ME);
    await sendPending(db, ME, { kind: 'annualBudget', label: '', summary: '', payload: { ...b, updatedAt: '2026-10-16T00:00:00.000Z' } });
    const failed: PendingOp = {
      id: 'op', kind: 'annualBudget', label: '', summary: '', payload: b, at: b.updatedAt, reason: '', tries: 0,
    };
    expect(await freshnessOf(db, ME, failed)).toBe('stale');
  });
});
