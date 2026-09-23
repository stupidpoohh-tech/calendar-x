/**
 * 같이 보기 통합 테스트 — 실제 Firestore(에뮬레이터)와 실제 보안 규칙 위에서.
 *
 * 순수 함수 테스트(`domain/shared.test.ts`)는 "겹쳐 보기가 이렇게 계산된다" 를 확인한다.
 * 여기서 확인하는 것은 그것이 **진짜 저장소에서도 성립하는가** 다 — 특히 이 둘.
 *
 *   1. 원본 갱신이 merge 로 나가므로 상대가 고쳐 둔 값(`overrides`)과 감춰 둔 상태
 *      (`hidden`)가 서버에서도 살아남는가. `Promise.reject` 를 흉내 내는 테스트로는
 *      merge 가 실제로 어느 필드를 남기는지 알 수 없다.
 *   2. 공유 화면의 편집이 소유자의 `users/{uid}/entries` 에 **한 글자도** 닿지 않는가.
 *      규칙이 그 방향을 막는지까지 함께 본다.
 *
 * 실행: npm run test:rules
 */
import {
  initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion, collection, doc, getDoc, getDocs, setDoc, updateDoc, type Firestore,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { saveEntry, deleteEntry } from '../data/repo';
import { sharedItemFromDoc } from '../data/sharedConverters';
import {
  acceptInvite, applyOwnerSync, createInvite, deleteBoardDeep, deleteSharedItem,
  fetchBoardInvites, fetchOwnerTasks, planOwnerSync, pushSource, readInvite, revokeInvite,
  saveBoard, saveSharedDday, saveSharedItem, saveSharedPin, SHARED_MEMO_ID,
} from '../data/sharedRepo';
import { newEntry, withDerived } from '../domain/entry';
import {
  applyOverrides, newLocalItem, revertToSource, setHidden, sharedView, sourceOf,
} from '../domain/shared';
import type { Entry, SharedBoard, SharedInvite, SharedTodoItem } from '../domain/types';

let env: RulesTestEnvironment;
const OWNER = 'shared-owner';
const MEMBER = 'shared-member';
const THIRD = 'shared-third';
const BOARD = 'board-1';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const dbOf = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;

const NOW = '2026-09-23T00:00:00.000Z';
/** 오늘. 지나간 일정은 공유 대상이 아니므로 시험 항목은 이 뒤에 둔다. */
const TODAY = '2026-09-23';

const board = (): SharedBoard => ({
  id: BOARD,
  ownerUid: OWNER,
  memberUids: [OWNER],
  memberNames: { [OWNER]: 'owner@example.com' },
  name: '같이 보기',
  createdAt: NOW,
  updatedAt: NOW,
});

const task = (patch: Partial<Entry> = {}): Entry =>
  newEntry('task', { id: 'task-a', title: '병원 예약', startDate: '2026-09-25', ...patch });

/** 소유자가 보드를 만들고 상대가 초대를 수락한 상태. 앱이 지나는 길 그대로 쓴다. */
async function connect(): Promise<{ owner: Firestore; member: Firestore; invite: SharedInvite }> {
  const owner = dbOf(OWNER);
  const member = dbOf(MEMBER);
  await saveBoard(owner, board());
  const invite: SharedInvite = {
    code: 'invitecode0000000001', boardId: BOARD, ownerUid: OWNER,
    boardName: '같이 보기', createdAt: NOW,
  };
  await createInvite(owner, invite);
  const result = await acceptInvite(member, invite.code, MEMBER, 'member@example.com', NOW);
  expect(result.ok).toBe(true);
  return { owner, member, invite };
}

async function readItem(db: Firestore, id: string): Promise<SharedTodoItem | null> {
  const snap = await getDoc(doc(db, `sharedBoards/${BOARD}/items/${id}`));
  if (!snap.exists()) return null;
  return sharedItemFromDoc(snap.id, snap.data() as Record<string, unknown>);
}

describe('초대와 연결', () => {
  it('초대장을 읽고 수락하면 member 가 된다', async () => {
    const { member, invite } = await connect();
    const read = await readInvite(member, invite.code);
    expect(read?.boardId).toBe(BOARD);

    const snap = await getDoc(doc(member, `sharedBoards/${BOARD}`));
    expect(snap.data()?.memberUids).toEqual([OWNER, MEMBER]);
    expect(snap.data()?.memberNames?.[MEMBER]).toBe('member@example.com');
    // 소유자의 이름표는 그대로다.
    expect(snap.data()?.memberNames?.[OWNER]).toBe('owner@example.com');
  });

  it('초대장이 없으면 수락할 수 없다', async () => {
    await saveBoard(dbOf(OWNER), board());
    const result = await acceptInvite(dbOf(MEMBER), 'nosuchcode000000000x', MEMBER, 'm', NOW);
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('초대장을 끊으면 그 뒤로는 들어올 수 없다', async () => {
    const owner = dbOf(OWNER);
    await saveBoard(owner, board());
    const invite: SharedInvite = {
      code: 'invitecode0000000002', boardId: BOARD, ownerUid: OWNER, boardName: '같이 보기', createdAt: NOW,
    };
    await createInvite(owner, invite);

    const mine = await fetchBoardInvites(owner, OWNER, BOARD);
    expect(mine.map((i) => i.code)).toEqual([invite.code]);

    await revokeInvite(owner, invite.code);
    await expect(
      acceptInvite(dbOf(MEMBER), invite.code, MEMBER, 'm', NOW),
    ).resolves.toEqual({ ok: false, reason: 'not-found' });
  });

  it('제3자는 보드에 들어올 수도 읽을 수도 없다', async () => {
    await connect();
    const third = dbOf(THIRD);
    await expect(getDoc(doc(third, `sharedBoards/${BOARD}`))).rejects.toThrow();
    await expect(getDocs(collection(third, `sharedBoards/${BOARD}/items`))).rejects.toThrow();
    // 코드를 모르면 보드에 자기를 더할 수도 없다.
    await expect(updateDoc(doc(third, `sharedBoards/${BOARD}`), {
      memberUids: arrayUnion(THIRD), joinCode: 'guessed00000000000000', updatedAt: NOW,
    })).rejects.toThrow();
  });
});

describe('원본 → 공유는 한 방향이다', () => {
  it('원본을 저장하면 공유 항목이 생기고 상대가 읽는다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    const item = await readItem(member, entry.id);
    expect(item).not.toBeNull();
    expect(sharedView(item!).title).toBe('병원 예약');
    expect(item!.localOnly).toBe(false);
  });

  it('상대가 제목을 고쳐도 소유자의 원본은 한 글자도 바뀌지 않는다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    const item = await readItem(member, entry.id);
    await saveSharedItem(member, BOARD, applyOverrides(item!, { title: '병원 전화하기' }));

    const raw = await getDoc(doc(owner, `users/${OWNER}/entries/${entry.id}`));
    expect(raw.data()?.title).toBe('병원 예약');
    expect(raw.data()?.task?.status).toBe('planned');
  });

  it('상대는 소유자의 원본 TODO 를 직접 고칠 수 없다 — 규칙이 막는다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);

    await expect(setDoc(
      doc(member, `users/${OWNER}/entries/${entry.id}`), { title: '내가 고침' },
    )).rejects.toThrow();
    await expect(getDoc(doc(member, `users/${OWNER}/entries/${entry.id}`))).rejects.toThrow();
  });

  /*
    merge 쓰기가 실제로 무엇을 남기는지는 여기서만 확인된다.
    `overrides` 를 담아 보내면 이 시험이 깨진다.
  */
  it('원본 날짜를 바꾸면 고쳐 둔 제목은 살고 날짜만 따라온다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    const item = await readItem(member, entry.id);
    await saveSharedItem(member, BOARD, applyOverrides(item!, { title: '병원 전화하기' }));

    const moved = withDerived({ ...entry, startDate: '2026-09-27' });
    await saveEntry(owner, OWNER, moved);
    await pushSource(owner, BOARD, moved.id, sourceOf(moved), OWNER, '2026-09-24T00:00:00.000Z');

    const after = sharedView((await readItem(member, entry.id))!);
    expect(after.title).toBe('병원 전화하기');
    expect(after.startDate).toBe('2026-09-27');
  });

  it('원본 상태 변경은 상태 override 가 없을 때만 보인다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    const done = withDerived({ ...entry, task: { ...entry.task!, status: 'done' } });
    await saveEntry(owner, OWNER, done);
    await pushSource(owner, BOARD, done.id, sourceOf(done), OWNER, NOW);
    expect(sharedView((await readItem(member, entry.id))!).status).toBe('done');

    // 상대가 다시 '진행중' 으로 고쳐 두면 그 뒤 원본이 어떻게 바뀌어도 유지된다.
    const item = await readItem(member, entry.id);
    await saveSharedItem(member, BOARD, applyOverrides(item!, { status: 'in-progress' }));
    const planned = withDerived({ ...entry, task: { ...entry.task!, status: 'planned' } });
    await saveEntry(owner, OWNER, planned);
    await pushSource(owner, BOARD, planned.id, sourceOf(planned), OWNER, NOW);
    expect(sharedView((await readItem(member, entry.id))!).status).toBe('in-progress');
  });

  it('원본대로 되돌리면 원본 값이 보이고, 원본은 그대로다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    const item = await readItem(member, entry.id);
    await saveSharedItem(member, BOARD, applyOverrides(item!, { title: '병원 전화하기' }));
    const edited = await readItem(member, entry.id);
    await saveSharedItem(member, BOARD, revertToSource(edited!));

    expect(sharedView((await readItem(member, entry.id))!).title).toBe('병원 예약');
    expect((await getDoc(doc(owner, `users/${OWNER}/entries/${entry.id}`))).data()?.title).toBe('병원 예약');
  });

  it('상대가 완료로 체크해도 소유자의 상태는 예정 그대로다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    const item = await readItem(member, entry.id);
    await saveSharedItem(member, BOARD, applyOverrides(item!, { status: 'done' }));

    expect(sharedView((await readItem(member, entry.id))!).status).toBe('done');
    const raw = await getDoc(doc(owner, `users/${OWNER}/entries/${entry.id}`));
    expect(raw.data()?.task?.status).toBe('planned');
  });
});

describe('감추기와 삭제', () => {
  it('상대가 감춰도 원본은 남고, 원본 갱신이 감춤을 되살리지 않는다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    const item = await readItem(member, entry.id);
    await saveSharedItem(member, BOARD, setHidden(item!, true));

    const moved = withDerived({ ...entry, startDate: '2026-09-27' });
    await saveEntry(owner, OWNER, moved);
    await pushSource(owner, BOARD, moved.id, sourceOf(moved), OWNER, NOW);

    const after = await readItem(member, entry.id);
    expect(after?.hidden).toBe(true);
    expect((await getDoc(doc(owner, `users/${OWNER}/entries/${entry.id}`))).exists()).toBe(true);
  });

  it('공유 항목을 지워도 원본은 남는다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    await deleteSharedItem(member, BOARD, entry.id);
    expect(await readItem(member, entry.id)).toBeNull();
    expect((await getDoc(doc(owner, `users/${OWNER}/entries/${entry.id}`))).exists()).toBe(true);
  });

  it('원본을 지우면 공유 항목도 사라진다 — 유령 항목을 남기지 않는다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    await deleteEntry(owner, OWNER, entry.id);
    await deleteSharedItem(owner, BOARD, entry.id);
    expect(await readItem(member, entry.id)).toBeNull();
  });

  it('보드를 지우면 하위 자료도 함께 사라지고, 원본 TODO 는 남는다', async () => {
    const { owner } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);
    await saveSharedPin(owner, BOARD, {
      id: SHARED_MEMO_ID, text: '토요일 장보기', order: 0, createdBy: OWNER, createdAt: NOW, updatedAt: NOW,
    });
    await saveSharedDday(owner, BOARD, {
      id: 'd1', title: '우리 여행', date: '2026-10-16', order: 0, createdBy: OWNER, createdAt: NOW, updatedAt: NOW,
    });

    await deleteBoardDeep(owner, BOARD);

    await env.withSecurityRulesDisabled(async (ctx) => {
      const raw = ctx.firestore();
      expect((await getDocs(collection(raw, `sharedBoards/${BOARD}/items`))).size).toBe(0);
      expect((await getDocs(collection(raw, `sharedBoards/${BOARD}/pins`))).size).toBe(0);
      expect((await getDocs(collection(raw, `sharedBoards/${BOARD}/ddays`))).size).toBe(0);
      expect((await getDoc(doc(raw, `sharedBoards/${BOARD}`))).exists()).toBe(false);
    });
    expect((await getDoc(doc(owner, `users/${OWNER}/entries/${entry.id}`))).exists()).toBe(true);
  });
});

describe('공유 화면 전용 항목', () => {
  it('상대가 만든 항목은 소유자의 개인 TODO 에 생기지 않는다', async () => {
    const { owner, member } = await connect();
    const local = newLocalItem('local-1', MEMBER, { title: '토요일 같이 장보기', startDate: '2026-09-26' });
    await saveSharedItem(member, BOARD, local);

    // 두 사람 모두 같은 항목을 본다.
    expect(sharedView((await readItem(owner, 'local-1'))!).title).toBe('토요일 같이 장보기');
    expect(sharedView((await readItem(member, 'local-1'))!).title).toBe('토요일 같이 장보기');

    // 소유자의 개인 TODO 는 그대로다.
    const entries = await getDocs(collection(owner, `users/${OWNER}/entries`));
    expect(entries.size).toBe(0);
    // 상대의 개인 TODO 에도 생기지 않는다.
    expect((await getDocs(collection(member, `users/${MEMBER}/entries`))).size).toBe(0);
  });

  it('맞추기가 공유 전용 항목을 지우지 않는다', async () => {
    const { owner, member } = await connect();
    await saveSharedItem(member, BOARD, newLocalItem('local-1', MEMBER, { title: '장보기' }));

    const tasks = await fetchOwnerTasks(owner, OWNER);
    const items = (await getDocs(collection(owner, `sharedBoards/${BOARD}/items`))).docs
      .map((d) => sharedItemFromDoc(d.id, d.data() as Record<string, unknown>));
    await applyOwnerSync(owner, BOARD, OWNER, planOwnerSync(tasks, items, TODAY), NOW);

    expect(await readItem(owner, 'local-1')).not.toBeNull();
  });
});

describe('맞추기 — 보드를 만든 뒤 한 번', () => {
  it('보드를 만들기 전부터 있던 TODO 를 공유에 올린다', async () => {
    const owner = dbOf(OWNER);
    await saveEntry(owner, OWNER, task({ id: 'old-1', title: '앞으로 할 일' }));
    await saveEntry(owner, OWNER, newEntry('idea', { id: 'idea-1', title: '아이디어', startDate: '2026-09-25' }));
    await saveEntry(owner, OWNER, newEntry('money', { id: 'money-1', title: '전기요금', startDate: '2026-09-25' }));
    const { member } = await connect();

    const tasks = await fetchOwnerTasks(owner, OWNER);
    await applyOwnerSync(owner, BOARD, OWNER, planOwnerSync(tasks, [], TODAY), NOW);

    const items = await getDocs(collection(member, `sharedBoards/${BOARD}/items`));
    expect(items.docs.map((d) => d.id)).toEqual(['old-1']);
  });

  /*
    사용자의 TODO 는 몇 년치가 쌓여 있다. 그것이 통째로 올라가면 상대 화면이 지난
    기록으로 덮인다 — 실제로 230건이 올라갔다. 맞추기가 그것을 정리하는 자리다.
  */
  it('지나간 일정은 올리지 않고, 이미 올라간 것은 지운다', async () => {
    const { owner, member } = await connect();
    const past = task({ id: 'past-1', title: '지난 달 할 일', startDate: '2026-08-01' });
    const future = task({ id: 'future-1', title: '다음 주 할 일', startDate: '2026-09-30' });
    await saveEntry(owner, OWNER, past);
    await saveEntry(owner, OWNER, future);
    // 지난 항목이 이미 보드에 올라가 있는 상태를 만든다.
    await pushSource(owner, BOARD, past.id, sourceOf(past), OWNER, NOW);

    const tasks = await fetchOwnerTasks(owner, OWNER);
    const items = (await getDocs(collection(owner, `sharedBoards/${BOARD}/items`))).docs
      .map((d) => sharedItemFromDoc(d.id, d.data() as Record<string, unknown>));
    await applyOwnerSync(owner, BOARD, OWNER, planOwnerSync(tasks, items, TODAY), NOW);

    const after = await getDocs(collection(member, `sharedBoards/${BOARD}/items`));
    expect(after.docs.map((d) => d.id)).toEqual(['future-1']);
    // 원본은 그대로다. 공유에서 빠질 뿐이다.
    expect((await getDoc(doc(owner, `users/${OWNER}/entries/past-1`))).exists()).toBe(true);
  });

  it('맞추기가 상대의 수정과 감춤을 지우지 않는다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);

    const item = await readItem(member, entry.id);
    await saveSharedItem(member, BOARD, setHidden(applyOverrides(item!, { title: '병원 전화하기' }), true));

    // 원본이 바뀐 상태에서 맞추기를 돌린다.
    const moved = withDerived({ ...entry, startDate: '2026-10-01' });
    await saveEntry(owner, OWNER, moved);
    const tasks = await fetchOwnerTasks(owner, OWNER);
    const stale = [await readItem(owner, entry.id)].filter((x): x is SharedTodoItem => x !== null);
    await applyOwnerSync(owner, BOARD, OWNER, planOwnerSync(tasks, stale, TODAY), NOW);

    const after = await readItem(member, entry.id);
    expect(after?.hidden).toBe(true);
    expect(sharedView(after!).title).toBe('병원 전화하기');
    expect(sharedView(after!).startDate).toBe('2026-10-01');
  });

  it('원본이 사라진 공유 항목을 맞추기가 정리한다', async () => {
    const { owner, member } = await connect();
    const entry = task();
    await saveEntry(owner, OWNER, entry);
    await pushSource(owner, BOARD, entry.id, sourceOf(entry), OWNER, NOW);
    await deleteEntry(owner, OWNER, entry.id);

    const tasks = await fetchOwnerTasks(owner, OWNER);
    const items = [await readItem(owner, entry.id)].filter((x): x is SharedTodoItem => x !== null);
    await applyOwnerSync(owner, BOARD, OWNER, planOwnerSync(tasks, items, TODAY), NOW);

    expect(await readItem(member, entry.id)).toBeNull();
  });
});

describe('고정메모와 D-Day', () => {
  it('두 사람이 같은 고정메모를 보고 고친다. 개인 고정 메모에는 영향이 없다', async () => {
    const { owner, member } = await connect();
    await saveSharedPin(owner, BOARD, {
      id: SHARED_MEMO_ID, text: '토요일 장보기', order: 0, createdBy: OWNER, createdAt: NOW, updatedAt: NOW,
    });
    expect((await getDoc(doc(member, `sharedBoards/${BOARD}/pins/${SHARED_MEMO_ID}`))).data()?.text)
      .toBe('토요일 장보기');

    await saveSharedPin(member, BOARD, {
      id: SHARED_MEMO_ID, text: '토요일 장보기\n영화 예매 확인', order: 0,
      createdBy: OWNER, createdAt: NOW, updatedAt: '2026-09-24T00:00:00.000Z',
    });
    expect((await getDoc(doc(owner, `sharedBoards/${BOARD}/pins/${SHARED_MEMO_ID}`))).data()?.text)
      .toBe('토요일 장보기\n영화 예매 확인');

    // 개인 고정 메모 컬렉션은 비어 있다 — 다른 자료다.
    expect((await getDocs(collection(owner, `users/${OWNER}/pins`))).size).toBe(0);
    expect((await getDocs(collection(member, `users/${MEMBER}/pins`))).size).toBe(0);
  });

  it('두 사람이 같은 D-Day 를 보고 고친다. 개인 TODO 에는 영향이 없다', async () => {
    const { owner, member } = await connect();
    await saveSharedDday(member, BOARD, {
      id: 'd1', title: '우리 여행', date: '2026-10-16', order: 0,
      createdBy: MEMBER, createdAt: NOW, updatedAt: NOW,
    });

    const seen = await getDoc(doc(owner, `sharedBoards/${BOARD}/ddays/d1`));
    expect(seen.data()?.title).toBe('우리 여행');
    // 'D-23' 같은 문자열은 저장하지 않는다 — 제목과 날짜뿐이다.
    expect(Object.keys(seen.data() ?? {}).sort())
      .toEqual(['createdAt', 'createdBy', 'date', 'order', 'title', 'updatedAt']);

    await saveSharedDday(owner, BOARD, {
      id: 'd1', title: '우리 여행', date: '2026-10-18', order: 0,
      createdBy: MEMBER, createdAt: NOW, updatedAt: NOW,
    });
    expect((await getDoc(doc(member, `sharedBoards/${BOARD}/ddays/d1`))).data()?.date).toBe('2026-10-18');

    expect((await getDocs(collection(owner, `users/${OWNER}/entries`))).size).toBe(0);
    expect((await getDocs(collection(member, `users/${MEMBER}/entries`))).size).toBe(0);
  });

  it('제3자는 고정메모도 D-Day 도 건드릴 수 없다', async () => {
    const { owner } = await connect();
    await saveSharedPin(owner, BOARD, {
      id: SHARED_MEMO_ID, text: '비밀', order: 0, createdBy: OWNER, createdAt: NOW, updatedAt: NOW,
    });
    const third = dbOf(THIRD);
    await expect(getDoc(doc(third, `sharedBoards/${BOARD}/pins/${SHARED_MEMO_ID}`))).rejects.toThrow();
    await expect(saveSharedDday(third, BOARD, {
      id: 'd9', title: '끼어들기', date: '2026-10-16', order: 0,
      createdBy: THIRD, createdAt: NOW, updatedAt: NOW,
    })).rejects.toThrow();
  });
});
