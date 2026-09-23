/**
 * 공유 보드 저장 계층.
 *
 * ── 개인 경로를 건드리지 않는다 ─────────────────────────────────
 *
 * 이 파일에는 `users/{uid}/entries` 에 **쓰는** 함수가 없다. 있는 것은 소유자의 할 일을
 * 한 번에 읽어 오는 `fetchOwnerTasks` 하나뿐이고, 그것도 자기 자료를 읽는 것이다.
 * 공유 화면의 모든 편집은 `sharedBoards/...` 안에서 끝난다 — 역반영이 새어 나갈 자리가
 * 코드에 없다.
 *
 * ── 갱신은 merge 로, 세 필드는 담지 않는다 ──────────────────────
 *
 * 원본 → 공유 갱신은 `source` 계열만 담은 부분 문서를 merge 로 쓴다
 * (`sharedSourcePatch`). 담지 않은 `overrides` · `hidden` 은 그대로 남는다. 기본값을
 * 함께 보내면 상대가 감춰 둔 항목이 원본을 고칠 때마다 되살아난다.
 *
 * ── 초대는 코드를 아는 사람만 ───────────────────────────────────
 *
 * `sharedInvites/{code}` 는 로그인한 사용자가 **정확한 코드로 한 건만** 읽을 수 있다
 * (목록 조회는 규칙이 막는다). 수락은 보드 문서에 자기 uid 하나를 더하는 것이고, 규칙이
 * 그 초대장의 존재를 확인한다. 공개 URL 로 아무나 읽는 구조가 아니다.
 */
import {
  arrayRemove, arrayUnion, collection, deleteDoc, deleteField, getDoc, getDocs, onSnapshot,
  query, setDoc, updateDoc, where, writeBatch, type Firestore,
} from 'firebase/firestore';
import { isShareableTask, sameSource, sourceOf } from '../domain/shared';
import type {
  Entry, SharedBoard, SharedDday, SharedInvite, SharedPin, SharedSource, SharedTodoItem,
} from '../domain/types';
import {
  sharedBoardFromDoc, sharedBoardToDoc, sharedDdayFromDoc, sharedDdayToDoc,
  sharedInviteFromDoc, sharedInviteToDoc, sharedItemFromDoc, sharedItemToDoc,
  sharedPinFromDoc, sharedPinToDoc, sharedSourcePatch,
} from './sharedConverters';
import { entryFromDoc } from './converters';
import { boardDoc, boardSubCol, boardSubDoc, boardsCol, COL, col, inviteDoc, SHARED } from './paths';
import type { ErrorSink, Unsubscribe } from './repo';

/** 보드 하나에 들어갈 수 있는 사람 수. 규칙에도 같은 값이 박혀 있다. */
export const MAX_BOARD_MEMBERS = 4;

/** 고정메모는 보드당 한 건이다. 문서 id 를 고정해 두면 두 사람이 동시에 적어도 갈라지지 않는다. */
export const SHARED_MEMO_ID = 'memo';

type Raw = Record<string, unknown>;

// ---------- 구독 ----------

/**
 * 내가 속한 보드.
 *
 * `array-contains` 로 찾는다 — 소유자도 `memberUids` 에 들어 있으므로 소유·초대 구분 없이
 * 한 번의 조회로 끝난다. 보안 규칙의 읽기 조건과 조회 조건이 같은 모양이라야
 * Firestore 가 목록 조회를 허용한다.
 */
export function subscribeMyBoards(
  db: Firestore, uid: string, cb: (boards: SharedBoard[]) => void, onError: ErrorSink,
): Unsubscribe {
  const q = query(boardsCol(db), where('memberUids', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => {
      const out: SharedBoard[] = [];
      snap.forEach((d) => out.push(sharedBoardFromDoc(d.id, d.data() as Raw)));
      /*
        활성 보드는 하나다. 여러 개에 속해 있으면 **내가 만든 것**을 먼저 쓰고, 그 다음은
        먼저 만든 순서다. 임의로 고르면 기기마다 다른 보드가 열린다.

        둘이 각자 '공유하기' 를 누른 뒤 링크를 주고받으면 서로 두 보드에 속하게 된다.
        그때 각자 자기 보드를 보는 것이 덜 놀랍고, 화면이 "참여 중인 보드가 둘" 이라는
        사실을 설정 창에서 말해 준다. 여러 보드를 관리하는 화면은 만들지 않는다.
      */
      out.sort((a, b) => {
        const mine = Number(b.ownerUid === uid) - Number(a.ownerUid === uid);
        if (mine !== 0) return mine;
        return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
      });
      cb(out);
    },
    (err) => onError('공유 보드', err),
  );
}

export function subscribeSharedItems(
  db: Firestore, boardId: string, cb: (items: SharedTodoItem[]) => void, onError: ErrorSink,
): Unsubscribe {
  return onSnapshot(
    boardSubCol(db, boardId, SHARED.items),
    (snap) => {
      const out: SharedTodoItem[] = [];
      snap.forEach((d) => out.push(sharedItemFromDoc(d.id, d.data() as Raw)));
      cb(out);
    },
    (err) => onError('공유 TODO', err),
  );
}

export function subscribeSharedPins(
  db: Firestore, boardId: string, cb: (pins: SharedPin[]) => void, onError: ErrorSink,
): Unsubscribe {
  return onSnapshot(
    boardSubCol(db, boardId, SHARED.pins),
    (snap) => {
      const out: SharedPin[] = [];
      snap.forEach((d) => out.push(sharedPinFromDoc(d.id, d.data() as Raw)));
      cb(out.sort((a, b) => a.order - b.order));
    },
    (err) => onError('공유 고정메모', err),
  );
}

export function subscribeSharedDdays(
  db: Firestore, boardId: string, cb: (ddays: SharedDday[]) => void, onError: ErrorSink,
): Unsubscribe {
  return onSnapshot(
    boardSubCol(db, boardId, SHARED.ddays),
    (snap) => {
      const out: SharedDday[] = [];
      snap.forEach((d) => out.push(sharedDdayFromDoc(d.id, d.data() as Raw)));
      cb(out.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order));
    },
    (err) => onError('공유 D-Day', err),
  );
}

// ---------- 쓰기 ----------

export function saveBoard(db: Firestore, b: SharedBoard): Promise<void> {
  return setDoc(boardDoc(db, b.id), sharedBoardToDoc(b));
}

export function createInvite(db: Firestore, invite: SharedInvite): Promise<void> {
  return setDoc(inviteDoc(db, invite.code), sharedInviteToDoc(invite));
}

export function revokeInvite(db: Firestore, code: string): Promise<void> {
  return deleteDoc(inviteDoc(db, code));
}

/**
 * 내가 낸 초대장.
 *
 * 코드는 문서 id 라서 **목록 조회 없이는 다시 찾을 수 없다.** 그래서 소유자에게만
 * 목록을 열어 둔다 (`ownerUid == uid` 로 거른 조회만 규칙이 허용한다) — 안 그러면
 * 한 번 만든 링크를 영영 끊을 수 없다.
 *
 * 보드 필터는 클라이언트에서 건다. 조건을 둘 걸면 복합 색인이 필요해지고, 사람이
 * 가진 초대장은 애초에 몇 건뿐이다.
 */
export async function fetchBoardInvites(
  db: Firestore, uid: string, boardId: string,
): Promise<SharedInvite[]> {
  const snap = await getDocs(query(collection(db, SHARED.invites), where('ownerUid', '==', uid)));
  return snap.docs
    .map((d) => sharedInviteFromDoc(d.id, d.data() as Raw))
    .filter((i) => i.boardId === boardId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readInvite(db: Firestore, code: string): Promise<SharedInvite | null> {
  const snap = await getDoc(inviteDoc(db, code));
  if (!snap.exists()) return null;
  return sharedInviteFromDoc(snap.id, snap.data() as Raw);
}

/**
 * 초대 수락.
 *
 * `arrayUnion` 으로 **내 uid 하나만** 더한다. 보드 문서를 먼저 읽지 않는다 — 아직
 * member 가 아니라 읽을 수 없다. 내 이름도 `memberNames.<uid>` 한 칸만 쓴다. 맵을
 * 통째로 쓰면 상대의 이름이 지워진다.
 *
 * `joinCode` 는 규칙에 보여 주는 증거다. 규칙이 이 코드로 초대장을 찾아 그 보드의
 * 초대인지 확인한다 — 코드를 모르면 남의 보드에 들어갈 수 없다.
 *
 * 온라인이 필요하다. 초대장을 읽어야 하고(`getDoc`), 규칙도 서버에서만 판정된다.
 */
export async function acceptInvite(
  db: Firestore, code: string, uid: string, name: string, now: string,
): Promise<{ ok: true; boardId: string } | { ok: false; reason: 'not-found' }> {
  const invite = await readInvite(db, code);
  if (!invite || !invite.boardId) return { ok: false, reason: 'not-found' };
  await updateDoc(boardDoc(db, invite.boardId), {
    memberUids: arrayUnion(uid),
    [`memberNames.${uid}`]: name,
    joinCode: code,
    updatedAt: now,
  });
  return { ok: true, boardId: invite.boardId };
}

/**
 * 보드에서 나간다. 소유자는 이 길을 쓰지 않는다 — 보드를 지운다.
 *
 * 규칙은 "자기 uid 하나만 빼는 것" 만 허용한다. 나간 뒤에는 보드를 읽을 수 없고,
 * 초대 코드가 남아 있으면 다시 들어올 수 있다 — 끊으려면 소유자가 링크를 끊는다.
 */
export function leaveBoard(db: Firestore, boardId: string, uid: string, now: string): Promise<void> {
  return updateDoc(boardDoc(db, boardId), {
    memberUids: arrayRemove(uid),
    [`memberNames.${uid}`]: deleteField(),
    updatedAt: now,
  });
}

/**
 * 원본 → 공유 갱신 한 건.
 *
 * 문서 id 가 **원본 entry 의 id 와 같다.** 그래서 같은 항목을 두 번 만들 수 없고,
 * 갱신이 덮어쓰기 한 번으로 끝난다. merge 라서 `overrides` · `hidden` 은 남는다.
 */
export function pushSource(
  db: Firestore, boardId: string, entryId: string, source: SharedSource, ownerUid: string, now: string,
): Promise<void> {
  return setDoc(
    boardSubDoc(db, boardId, SHARED.items, entryId),
    sharedSourcePatch(entryId, source, ownerUid, now),
    { merge: true },
  );
}

export function saveSharedItem(db: Firestore, boardId: string, item: SharedTodoItem): Promise<void> {
  return setDoc(boardSubDoc(db, boardId, SHARED.items, item.id), sharedItemToDoc(item));
}

export function deleteSharedItem(db: Firestore, boardId: string, itemId: string): Promise<void> {
  return deleteDoc(boardSubDoc(db, boardId, SHARED.items, itemId));
}

export function saveSharedPin(db: Firestore, boardId: string, pin: SharedPin): Promise<void> {
  return setDoc(boardSubDoc(db, boardId, SHARED.pins, pin.id), sharedPinToDoc(pin));
}

export function deleteSharedPin(db: Firestore, boardId: string, pinId: string): Promise<void> {
  return deleteDoc(boardSubDoc(db, boardId, SHARED.pins, pinId));
}

export function saveSharedDday(db: Firestore, boardId: string, dday: SharedDday): Promise<void> {
  return setDoc(boardSubDoc(db, boardId, SHARED.ddays, dday.id), sharedDdayToDoc(dday));
}

export function deleteSharedDday(db: Firestore, boardId: string, ddayId: string): Promise<void> {
  return deleteDoc(boardSubDoc(db, boardId, SHARED.ddays, ddayId));
}

/** 보드를 지운다. 하위 컬렉션은 클라이언트에서 지워야 한다 — 문서만 지우면 남는다. */
export async function deleteBoardDeep(db: Firestore, boardId: string): Promise<void> {
  for (const name of [SHARED.items, SHARED.pins, SHARED.ddays]) {
    const snap = await getDocs(boardSubCol(db, boardId, name));
    const ids = snap.docs.map((d) => d.id);
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of ids.slice(i, i + 400)) batch.delete(boardSubDoc(db, boardId, name, id));
      await batch.commit();
    }
  }
  await deleteDoc(boardDoc(db, boardId));
}

// ---------- 소유자 자료 맞추기 ----------

/**
 * 소유자의 할 일 **전량**.
 *
 * 화면 구독은 보고 있는 달 주변만 받으므로, 그 목록으로 "공유에서 지울 것" 을 판정하면
 * 창 밖의 항목이 통째로 지워진다. 맞추기는 반드시 이 전량 조회를 쓴다.
 */
export async function fetchOwnerTasks(db: Firestore, uid: string): Promise<Entry[]> {
  const snap = await getDocs(query(col(db, uid, COL.entries), where('kind', '==', 'task')));
  return snap.docs.map((d) => entryFromDoc(d.id, d.data() as Raw));
}

export interface SharedSyncPlan {
  /** 새로 보내거나 값이 달라진 것. */
  upserts: { id: string; source: SharedSource }[];
  /** 원본이 사라졌거나 더 이상 공유 대상이 아닌 것. */
  deletes: string[];
}

/**
 * 원본과 공유 목록의 차이.
 *
 * `tasks` 는 **전량**이어야 한다. 부분 목록을 넣으면 없는 항목을 지운 것으로 본다.
 *
 * 공유 화면에서만 만든 항목(`localOnly`)은 원본이 없는 것이 정상이므로 지우지 않는다.
 * 회복 항목은 공유 대상이 아니므로, 어쩌다 올라가 있으면 지운다.
 */
export function planOwnerSync(
  tasks: readonly Entry[], items: readonly SharedTodoItem[],
): SharedSyncPlan {
  const shareable = tasks.filter(isShareableTask);
  const byId = new Map(items.map((i) => [i.id, i]));
  const upserts: SharedSyncPlan['upserts'] = [];
  for (const t of shareable) {
    const source = sourceOf(t);
    const existing = byId.get(t.id);
    if (existing && existing.sourceEntryId === t.id && sameSource(existing.source, source)) continue;
    upserts.push({ id: t.id, source });
  }

  const alive = new Set(shareable.map((t) => t.id));
  const deletes = items
    .filter((i) => !i.localOnly && i.sourceEntryId !== null && !alive.has(i.sourceEntryId))
    .map((i) => i.id);

  return { upserts, deletes };
}

export function isEmptyPlan(plan: SharedSyncPlan): boolean {
  return plan.upserts.length === 0 && plan.deletes.length === 0;
}

/**
 * 차이를 실제로 쓴다.
 *
 * 배치로 보내되 `overrides` · `hidden` 은 담지 않는다 (merge). 맞추기가 상대의 수정을
 * 지우면 "원본은 보호하되 함께 고친다" 가 무너진다.
 */
export async function applyOwnerSync(
  db: Firestore, boardId: string, ownerUid: string, plan: SharedSyncPlan, now: string,
): Promise<void> {
  const ops: { kind: 'set' | 'del'; id: string; data?: Raw }[] = [
    ...plan.upserts.map((u) => ({
      kind: 'set' as const, id: u.id, data: sharedSourcePatch(u.id, u.source, ownerUid, now),
    })),
    ...plan.deletes.map((id) => ({ kind: 'del' as const, id })),
  ];

  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      const ref = boardSubDoc(db, boardId, SHARED.items, op.id);
      if (op.kind === 'set' && op.data) batch.set(ref, op.data, { merge: true });
      else batch.delete(ref);
    }
    await batch.commit();
  }
}
