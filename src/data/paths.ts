import { collection, doc, type CollectionReference, type DocumentReference, type Firestore } from 'firebase/firestore';

/**
 * 컬렉션 경로.
 *
 * 이전에는 전부 users/{uid}/items 한 곳에 들어갔고, 잔고·대출은 title 을 '::balance::' 로
 * 표시하는 우회를 썼다. 여기서는 성격이 다른 데이터를 각자의 컬렉션에 둔다.
 */
export const COL = {
  entries: 'entries',
  accounts: 'accounts',
  debts: 'debts',
  pins: 'pins',
  /** 생활비 예산. */
  budgets: 'budgets',
  /** 세이브 — 잔고에 있지만 쓰지 않기로 떼어 둔 돈. */
  reserves: 'reserves',
  /** 이관 전 구조. 읽기 전용으로만 접근한다. */
  legacyItems: 'items',
} as const;

export function userDoc(db: Firestore, uid: string): DocumentReference {
  return doc(db, 'users', uid);
}

export function col(db: Firestore, uid: string, name: string): CollectionReference {
  return collection(db, 'users', uid, name);
}

export function docIn(db: Firestore, uid: string, name: string, id: string): DocumentReference {
  return doc(db, 'users', uid, name, id);
}

/**
 * 공유 보드 경로.
 *
 * `users/{uid}` 아래가 아니라 **최상위**다. 개인 경로 아래에 두면 상대에게 읽기를 열려면
 * 그 사용자 영역을 열어야 하고, 그러면 TODO 하나를 보여 주려고 아이디어·가계부·회복까지
 * 함께 열린다. 공유는 격리를 약화시키지 않는 자리에 둔다.
 *
 * 초대장은 보드와 또 다른 컬렉션이다 — 초대받은 사람은 아직 보드를 읽을 수 없으므로,
 * "어느 보드로 가면 되는가" 만 담긴 문서가 따로 있어야 한다.
 */
export const SHARED = {
  boards: 'sharedBoards',
  invites: 'sharedInvites',
  /** 보드 하위 컬렉션. */
  items: 'items',
  pins: 'pins',
  ddays: 'ddays',
} as const;

export function boardsCol(db: Firestore): CollectionReference {
  return collection(db, SHARED.boards);
}

export function boardDoc(db: Firestore, boardId: string): DocumentReference {
  return doc(db, SHARED.boards, boardId);
}

export function boardSubCol(db: Firestore, boardId: string, name: string): CollectionReference {
  return collection(db, SHARED.boards, boardId, name);
}

export function boardSubDoc(db: Firestore, boardId: string, name: string, id: string): DocumentReference {
  return doc(db, SHARED.boards, boardId, name, id);
}

export function inviteDoc(db: Firestore, code: string): DocumentReference {
  return doc(db, SHARED.invites, code);
}
