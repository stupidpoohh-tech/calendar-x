/**
 * 서버가 거절한 쓰기를 붙잡아 둔다.
 *
 * ── 실측 ────────────────────────────────────────────────────────
 *
 * 에뮬레이터에서 규칙이 거절하는 쓰기(제목 500자 초과)를 보내고 30ms 간격으로 화면을
 * 셌다. 결과는 이렇다.
 *
 *   +0ms    0건
 *   +23ms   1건   ← 로컬 캐시에 먼저 들어가 화면에 보인다
 *   +114ms  0건   ← 서버가 거절하자 Firestore 가 되돌린다
 *
 * 새로고침해도 돌아오지 않았고, 입력칸도 이미 비어 있었다. 즉 **거절당한 값은 어디에도
 * 남지 않는다.** "화면에는 반영돼 있지만 이 기기에서만 보이는 값으로 남습니다" 라고
 * 안내하던 것은 사실이 아니었고, 사용자는 적은 것을 통째로 잃었다.
 *
 * 그래서 값을 우리가 직접 붙잡는다. 이 모듈은 그 값의 모양 · 보관 · 다시 보내기 ·
 * 충돌 판정을 담는다.
 *
 * ── 보관 위치 ──────────────────────────────────────────────────
 *
 * `localStorage` 의 `calendarx.failed.<uid>`. **계정마다 따로** 둔다 — 계정을 바꾼 뒤
 * 남의 계정으로 앞 계정의 실패를 다시 보내는 일이 없어야 한다. 저장소가 막혀 있으면
 * (사생활 보호 모드 등) 메모리에만 들고 있고, 화면이 그 사실을 밝힌다.
 */
import {
  deleteDoc, doc, getDoc, setDoc, writeBatch, type Firestore,
} from 'firebase/firestore';
import type {
  Account, Budget, Debt, Entry, Pin, RecoveryRule, Reserve,
  SharedBoard, SharedDday, SharedInvite, SharedPin, SharedSource, SharedTodoItem,
} from '../domain/types';
import {
  accountToDoc, budgetToDoc, debtToDoc, entryToDoc, pinToDoc, recoveryRuleToDoc, reserveToDoc,
} from './converters';
import {
  sharedBoardToDoc, sharedDdayToDoc, sharedInviteToDoc, sharedItemToDoc, sharedPinToDoc,
  sharedSourcePatch,
} from './sharedConverters';
import { boardDoc, boardSubDoc, COL, docIn, inviteDoc, SHARED, userDoc } from './paths';

export type PendingKind =
  | 'entry' | 'entryDelete'
  | 'account'
  | 'debt' | 'debtDelete'
  | 'pin' | 'pinDelete'
  | 'budget' | 'budgetDelete'
  | 'reserve' | 'reserveDelete'
  | 'taskOrder'
  | 'recoveryRule' | 'recoveryPatch' | 'recoveryCommit'
  // 같이 보기. 개인 자료와 **같은 길**을 쓴다 — 거절당한 공유 편집도 목록에 남아야 한다.
  | 'sharedBoard' | 'sharedInvite' | 'sharedInviteDelete'
  | 'sharedSource' | 'sharedItem' | 'sharedItemDelete'
  | 'sharedPin' | 'sharedPinDelete'
  | 'sharedDday' | 'sharedDdayDelete';

const KINDS: readonly PendingKind[] = [
  'entry', 'entryDelete', 'account', 'debt', 'debtDelete',
  'pin', 'pinDelete', 'budget', 'budgetDelete', 'reserve', 'reserveDelete',
  'taskOrder', 'recoveryRule', 'recoveryPatch', 'recoveryCommit',
  'sharedBoard', 'sharedInvite', 'sharedInviteDelete',
  'sharedSource', 'sharedItem', 'sharedItemDelete',
  'sharedPin', 'sharedPinDelete', 'sharedDday', 'sharedDdayDelete',
];

/** 회복은 항목과 규칙을 한 배치로 쓴다. 그 한 벌이 payload 다. */
export interface RecoveryCommitPayload {
  rule: RecoveryRule;
  entry?: Entry | null;
  removeEntryId?: string | null;
}

/**
 * 원본 → 공유 갱신 한 건.
 *
 * 항목 전체가 아니라 `source` 만 담는다. 실제 쓰기도 그 필드들만 merge 하므로,
 * 다시 보낼 때에도 상대가 고쳐 둔 값(`overrides`)과 감춰 둔 상태(`hidden`)를 덮지 않는다.
 */
export interface SharedSourcePayload {
  boardId: string;
  entryId: string;
  source: SharedSource;
  ownerUid: string;
}

export type PendingPayload =
  | Entry | Account | Debt | Pin | Budget | Reserve | RecoveryRule
  | { id: string }
  | { ordered: { id: string; order: number }[] }
  | Partial<RecoveryRule>
  | RecoveryCommitPayload
  | SharedBoard | SharedInvite
  | SharedSourcePayload
  | { boardId: string; item: SharedTodoItem }
  | { boardId: string; pin: SharedPin }
  | { boardId: string; dday: SharedDday }
  | { boardId: string; id: string };

/** 보낼 값 그 자체. 화면에서 만들어 그대로 넘긴다. */
export interface CommitInput {
  kind: PendingKind;
  /** 사용자에게 보일 이름. '잔고' · '항목' */
  label: string;
  /** 무엇이었는지 한 줄. 목록에서 이것만 보고 고를 수 있어야 한다. */
  summary: string;
  payload: PendingPayload;
}

export interface PendingOp extends CommitInput {
  id: string;
  /** 처음 실패한 시각 (ISO). 삭제처럼 값에 시각이 없는 종류의 충돌 기준이 된다. */
  at: string;
  /** 마지막 실패 이유. 사람이 읽을 문장으로 굳혀 둔다. */
  reason: string;
  /** 몇 번 다시 보냈는가. */
  tries: number;
}

// ---------- 보내기 ----------

const asEntry = (p: PendingPayload) => p as Entry;
const asId = (p: PendingPayload) => (p as { id: string }).id;

/**
 * 한 건을 실제로 보낸다. 실패하면 던진다.
 *
 * 화면이 넘긴 클로저가 아니라 **직렬화된 값**에서 다시 만든다. 그래야 새로고침 뒤에도
 * 같은 쓰기를 재현할 수 있다 — 클로저는 새로고침을 넘기지 못한다.
 */
export function sendPending(db: Firestore, uid: string, op: CommitInput): Promise<void> {
  switch (op.kind) {
    case 'entry':
      return setDoc(docIn(db, uid, COL.entries, asEntry(op.payload).id), entryToDoc(asEntry(op.payload)));
    case 'entryDelete':
      return deleteDoc(docIn(db, uid, COL.entries, asId(op.payload)));
    case 'account': {
      const a = op.payload as Account;
      return setDoc(docIn(db, uid, COL.accounts, a.id), accountToDoc(a));
    }
    case 'debt': {
      const d = op.payload as Debt;
      return setDoc(docIn(db, uid, COL.debts, d.id), debtToDoc(d));
    }
    case 'debtDelete':
      return deleteDoc(docIn(db, uid, COL.debts, asId(op.payload)));
    case 'pin': {
      const p = op.payload as Pin;
      return setDoc(docIn(db, uid, COL.pins, p.id), pinToDoc(p));
    }
    case 'pinDelete':
      return deleteDoc(docIn(db, uid, COL.pins, asId(op.payload)));
    case 'budget': {
      const b = op.payload as Budget;
      return setDoc(docIn(db, uid, COL.budgets, b.id), budgetToDoc(b));
    }
    case 'budgetDelete':
      return deleteDoc(docIn(db, uid, COL.budgets, asId(op.payload)));
    case 'reserve': {
      const r = op.payload as Reserve;
      return setDoc(docIn(db, uid, COL.reserves, r.id), reserveToDoc(r));
    }
    case 'reserveDelete':
      return deleteDoc(docIn(db, uid, COL.reserves, asId(op.payload)));
    case 'taskOrder':
      return sendTaskOrder(db, uid, (op.payload as { ordered: { id: string; order: number }[] }).ordered);
    case 'recoveryRule':
      return setDoc(userDoc(db, uid), { recovery: recoveryRuleToDoc(op.payload as RecoveryRule) }, { merge: true });
    case 'recoveryPatch':
      return setDoc(userDoc(db, uid), { recovery: op.payload as Partial<RecoveryRule> }, { merge: true });
    case 'recoveryCommit':
      return sendRecoveryCommit(db, uid, op.payload as RecoveryCommitPayload);

    /*
      같이 보기. 경로가 `users/{uid}` 밖이라 uid 를 쓰지 않는다 — 보드 id 가 자리를 정하고,
      누가 쓸 수 있는지는 보안 규칙이 보드의 member 목록으로 판정한다.
    */
    case 'sharedBoard': {
      const b = op.payload as SharedBoard;
      return setDoc(boardDoc(db, b.id), sharedBoardToDoc(b));
    }
    case 'sharedInvite': {
      const i = op.payload as SharedInvite;
      return setDoc(inviteDoc(db, i.code), sharedInviteToDoc(i));
    }
    case 'sharedInviteDelete':
      return deleteDoc(inviteDoc(db, asId(op.payload)));
    case 'sharedSource': {
      const p = op.payload as SharedSourcePayload;
      // merge. `overrides` · `hidden` 을 담지 않으므로 상대의 수정이 살아남는다.
      return setDoc(
        boardSubDoc(db, p.boardId, SHARED.items, p.entryId),
        sharedSourcePatch(p.entryId, p.source, p.ownerUid, new Date().toISOString()),
        { merge: true },
      );
    }
    case 'sharedItem': {
      const p = op.payload as { boardId: string; item: SharedTodoItem };
      return setDoc(boardSubDoc(db, p.boardId, SHARED.items, p.item.id), sharedItemToDoc(p.item));
    }
    case 'sharedItemDelete': {
      const p = op.payload as { boardId: string; id: string };
      return deleteDoc(boardSubDoc(db, p.boardId, SHARED.items, p.id));
    }
    case 'sharedPin': {
      const p = op.payload as { boardId: string; pin: SharedPin };
      return setDoc(boardSubDoc(db, p.boardId, SHARED.pins, p.pin.id), sharedPinToDoc(p.pin));
    }
    case 'sharedPinDelete': {
      const p = op.payload as { boardId: string; id: string };
      return deleteDoc(boardSubDoc(db, p.boardId, SHARED.pins, p.id));
    }
    case 'sharedDday': {
      const p = op.payload as { boardId: string; dday: SharedDday };
      return setDoc(boardSubDoc(db, p.boardId, SHARED.ddays, p.dday.id), sharedDdayToDoc(p.dday));
    }
    case 'sharedDdayDelete': {
      const p = op.payload as { boardId: string; id: string };
      return deleteDoc(boardSubDoc(db, p.boardId, SHARED.ddays, p.id));
    }
  }
}

async function sendTaskOrder(
  db: Firestore, uid: string, ordered: readonly { id: string; order: number }[],
): Promise<void> {
  const CHUNK = 400; // Firestore 배치 상한은 500. 여유를 둔다.
  for (let i = 0; i < ordered.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const { id, order } of ordered.slice(i, i + CHUNK)) {
      batch.update(docIn(db, uid, COL.entries, id), { 'task.order': order });
    }
    await batch.commit();
  }
}

function sendRecoveryCommit(db: Firestore, uid: string, change: RecoveryCommitPayload): Promise<void> {
  const batch = writeBatch(db);
  if (change.entry) batch.set(docIn(db, uid, COL.entries, change.entry.id), entryToDoc(change.entry));
  if (change.removeEntryId) batch.delete(docIn(db, uid, COL.entries, change.removeEntryId));
  batch.set(userDoc(db, uid), { recovery: recoveryRuleToDoc(change.rule) }, { merge: true });
  return batch.commit();
}

// ---------- 충돌 판정 ----------

/**
 * 다시 보내도 되는가.
 *
 *   fresh    그 뒤로 아무도 건드리지 않았다. 그대로 보내면 된다
 *   stale    이 실패 뒤에 저장된 **더 새로운** 내용이 서버에 있다. 덮으면 그것을 잃는다
 *   unknown  이 종류는 최신 여부를 가릴 수 없다 (순서 저장 · 회복 규칙)
 *
 * `stale` 과 `unknown` 은 조용히 보내지 않는다. 화면이 사용자에게 묻는다.
 */
export type Freshness = 'fresh' | 'stale' | 'unknown';

/**
 * 종류별로 어느 문서를 보고, 무엇과 견줄지.
 *
 * 경로를 조각으로 돌려준다 — 같이 보기의 문서는 `users/{uid}` 밖(`sharedBoards/...`)에
 * 있어서, 개인 컬렉션 이름 하나로는 자리를 가리킬 수 없다.
 */
function targetOf(op: PendingOp, uid: string): { path: string[]; base: string } | null {
  const mine = (name: string, id: string, base: string) => ({ path: ['users', uid, name, id], base });
  const board = (boardId: string, name: string, id: string, base: string) =>
    ({ path: [SHARED.boards, boardId, name, id], base });

  switch (op.kind) {
    case 'entry': return mine(COL.entries, asEntry(op.payload).id, asEntry(op.payload).updatedAt);
    case 'account': {
      const a = op.payload as Account;
      return mine(COL.accounts, a.id, a.updatedAt);
    }
    case 'debt': {
      const d = op.payload as Debt;
      return mine(COL.debts, d.id, d.updatedAt);
    }
    case 'pin': {
      const p = op.payload as Pin;
      return mine(COL.pins, p.id, p.updatedAt);
    }
    // 삭제에는 값이 없다. 실패한 시각을 기준으로 본다 — 그 뒤에 다시 쓰였다면
    // 사용자가 같은 자리를 새로 채운 것이므로 지우면 안 된다.
    case 'entryDelete': return mine(COL.entries, asId(op.payload), op.at);
    case 'debtDelete': return mine(COL.debts, asId(op.payload), op.at);
    case 'pinDelete': return mine(COL.pins, asId(op.payload), op.at);
    case 'budget': {
      const b = op.payload as Budget;
      return mine(COL.budgets, b.id, b.updatedAt);
    }
    case 'reserve': {
      const r = op.payload as Reserve;
      return mine(COL.reserves, r.id, r.updatedAt);
    }
    case 'budgetDelete': return mine(COL.budgets, asId(op.payload), op.at);
    case 'reserveDelete': return mine(COL.reserves, asId(op.payload), op.at);

    /*
      같이 보기. 보드 문서는 두 사람이 함께 쓰는 자리라 견주는 일이 더 중요하다 —
      "더 새로운 내용이 서버에 있습니다" 가 실제로 상대의 수정일 수 있다.

      원본 → 공유 갱신(`sharedSource`)의 기준은 **큐에 넣은 시각**이다. 그 값에는
      updatedAt 이 없고(보내는 순간에 찍는다), 그 뒤에 서버 항목이 더 새로워졌다면
      다른 기기가 이미 같은 원본을 보냈거나 상대가 같은 항목을 고친 것이다.
    */
    case 'sharedBoard': {
      const b = op.payload as SharedBoard;
      return { path: [SHARED.boards, b.id], base: b.updatedAt };
    }
    case 'sharedSource': {
      const p = op.payload as SharedSourcePayload;
      return board(p.boardId, SHARED.items, p.entryId, op.at);
    }
    case 'sharedItem': {
      const p = op.payload as { boardId: string; item: SharedTodoItem };
      return board(p.boardId, SHARED.items, p.item.id, p.item.updatedAt);
    }
    case 'sharedPin': {
      const p = op.payload as { boardId: string; pin: SharedPin };
      return board(p.boardId, SHARED.pins, p.pin.id, p.pin.updatedAt);
    }
    case 'sharedDday': {
      const p = op.payload as { boardId: string; dday: SharedDday };
      return board(p.boardId, SHARED.ddays, p.dday.id, p.dday.updatedAt);
    }
    case 'sharedItemDelete': {
      const p = op.payload as { boardId: string; id: string };
      return board(p.boardId, SHARED.items, p.id, op.at);
    }
    case 'sharedPinDelete': {
      const p = op.payload as { boardId: string; id: string };
      return board(p.boardId, SHARED.pins, p.id, op.at);
    }
    case 'sharedDdayDelete': {
      const p = op.payload as { boardId: string; id: string };
      return board(p.boardId, SHARED.ddays, p.id, op.at);
    }
    default: return null;
  }
}

export async function freshnessOf(db: Firestore, uid: string, op: PendingOp): Promise<Freshness> {
  const t = targetOf(op, uid);
  // 순서 저장은 `task.order` 필드만 건드리고 updatedAt 을 올리지 않는다. 회복 규칙은
  // 맵 필드 하나라 시각 자체가 없다. 초대장에는 갱신이 없다. 견줄 값이 없으면 사람에게 묻는다.
  if (!t) return 'unknown';

  try {
    const snap = await getDoc(doc(db, t.path.join('/')));
    if (!snap.exists()) {
      // 지우려던 것이 이미 없다 — 다시 보낼 필요조차 없지만, 보내도 무해하다.
      return 'fresh';
    }
    const current = snap.data()?.updatedAt;
    if (typeof current !== 'string' || !current) return 'unknown';
    return current > t.base ? 'stale' : 'fresh';
  } catch {
    // 서버에 못 물어봤다. 모른 채로 덮지 않는다.
    return 'unknown';
  }
}

// ---------- 보관 ----------

const keyFor = (uid: string) => `calendarx.failed.${uid}`;

function store(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__calendarx_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** 새로고침을 넘겨 보관할 수 있는가. false 면 창을 닫는 순간 사라진다. */
export function canPersistFailed(): boolean {
  return store() !== null;
}

function isOp(v: unknown): v is PendingOp {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string'
    && typeof o.kind === 'string' && (KINDS as readonly string[]).includes(o.kind)
    && typeof o.label === 'string' && typeof o.summary === 'string'
    && typeof o.at === 'string'
    && o.payload !== null && typeof o.payload === 'object';
}

export function loadFailed(uid: string): PendingOp[] {
  const s = store();
  if (!s) return [];
  try {
    const raw = s.getItem(keyFor(uid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 깨진 항목은 조용히 버린다 — 되살릴 방법이 없고, 남겨 두면 목록이 못 쓰게 된다.
    return parsed.filter(isOp).map((o) => ({ ...o, tries: typeof o.tries === 'number' ? o.tries : 0 }));
  } catch {
    return [];
  }
}

/** 저장에 성공했는지 돌려준다. 실패를 삼키면 "보관했다" 는 안내가 거짓말이 된다. */
export function saveFailed(uid: string, ops: readonly PendingOp[]): boolean {
  const s = store();
  if (!s) return false;
  try {
    if (ops.length === 0) s.removeItem(keyFor(uid));
    else s.setItem(keyFor(uid), JSON.stringify(ops));
    return true;
  } catch {
    return false;
  }
}

// ---------- 오프라인과 거절을 가른다 ----------

/**
 * 연결이 없어 아직 못 보낸 것인가.
 *
 * 평소 편집은 오프라인 지속성이 큐에 넣어 두므로 **거부되지 않고 매달려 있다** —
 * 여기까지 오지 않는다. 여기 오는 오프라인 오류는 트랜잭션이나 서버 조회처럼 연결을
 * 요구하는 경로에서 난다. 그것을 "서버가 거절했다" 로 적으면 사용자가 값을 잃은 줄 안다.
 */
export function isOfflineError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 'unavailable' || code === 'deadline-exceeded') return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
