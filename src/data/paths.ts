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
