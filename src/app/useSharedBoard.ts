/**
 * 같이 보기 상태 훅.
 *
 * ── 세 갈래로 나눠 구독한다 ─────────────────────────────────────
 *
 *   1. 보드 문서      로그인해 있는 동안 늘. 문서 하나라 부담이 없고, 이 값이 있어야
 *                     TODO 저장이 "공유에도 보낼지" 를 판정할 수 있다.
 *   2. 보드 내용      **화면을 열었을 때만.** 항목·고정메모·D-Day 는 그 화면에서만
 *                     쓰이므로, 닫혀 있는 동안 읽기를 사서 쓸 이유가 없다.
 *   3. 맞추기         소유자가 화면을 처음 열 때 한 번. 원본과 공유 목록의 차이를 메운다.
 *
 * ── 원본 → 공유는 쓰기 시점에 따라붙는다 ────────────────────────
 *
 * TODO 를 저장할 때 공유 갱신을 **따로 한 건 더** 보낸다. 한 배치로 묶으면 공유 쪽이
 * 규칙에 걸리는 순간 개인 TODO 저장까지 함께 실패한다 — 공유 기능 때문에 기존 CRUD 가
 * 멈추는 것은 어떤 정합성보다 나쁘다. 대신 두 쓰기가 어긋날 수 있으므로
 *   · 실패한 공유 갱신은 다른 쓰기와 같은 "저장하지 못한 것" 목록에 남고,
 *   · 화면을 열 때 맞추기가 남은 차이를 메운다.
 * 이 둘이 어긋남을 오래 남기지 않는 장치다.
 *
 * ── 계정이 바뀌면 한 렌더도 남기지 않는다 ───────────────────────
 *
 * 구독을 끊어도 마지막 스냅샷은 상태에 남는다. 개인 자료와 같은 규칙으로 렌더 중에
 * 비우고, `dataUid` 가 따라잡을 때까지 빈 값을 내보낸다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeFirestoreError } from '../data/errors';
import { getFirebase } from '../data/firebase';
import {
  acceptInvite, applyOwnerSync, deleteBoardDeep, fetchBoardInvites, fetchOwnerTasks, isEmptyPlan,
  leaveBoard, planOwnerSync, readInvite, subscribeMyBoards,
  subscribeSharedDdays, subscribeSharedItems, subscribeSharedPins, SHARED_MEMO_ID,
} from '../data/sharedRepo';
import { uid as newId } from '../domain/entry';
import {
  isShareableTask, newInviteCode, partnerName, sharedTitle, sourceOf,
} from '../domain/shared';
import type {
  Entry, SharedBoard, SharedDday, SharedInvite, SharedPin, SharedTodoItem,
} from '../domain/types';
import type { Commit } from './useWriteQueue';

export interface SharedApi {
  /** 활성 보드. 하나만 지원한다. */
  board: SharedBoard | null;
  /** 보드 구독이 한 번이라도 도착했는가. false 면 "없음" 을 확정할 수 없다. */
  ready: boolean;
  /** 화면에 보일 상대 이름. 아직 아무도 수락하지 않았으면 null. */
  partner: string | null;
  /**
   * 내가 속한 보드 수. 하나만 열지만 여러 개에 속할 수는 있다 —
   * 둘이 각자 '공유하기' 를 누른 뒤 링크를 주고받으면 그렇게 된다.
   */
  boardCount: number;

  items: SharedTodoItem[];
  pins: SharedPin[];
  /** 고정메모 본문. 보드당 한 건이라 문자열 하나로 내놓는다. */
  memoText: string;
  ddays: SharedDday[];
  /** 보드 내용 구독이 한 번이라도 도착했는가. */
  contentReady: boolean;
  error: string | null;

  /** 원본 → 공유. 공유 대상이 아니거나 보드가 없으면 아무것도 하지 않는다. */
  pushEntry: (e: Entry) => void;
  /** 원본이 사라졌다. 공유 항목도 지운다 — 유령 항목을 남기지 않는다. */
  removeEntry: (entryId: string) => void;

  /** 공유 항목 저장. **`sharedBoards` 안에서만 끝난다.** */
  saveItem: (item: SharedTodoItem) => void;
  removeItem: (item: SharedTodoItem) => void;
  saveMemo: (text: string) => void;
  saveDday: (d: SharedDday) => void;
  removeDday: (d: SharedDday) => void;

  createBoard: (name: string) => SharedInvite | null;
  /** 지금 살아 있는 초대 링크. 코드는 문서 id 라 목록 조회로만 되찾을 수 있다. */
  listInvites: () => Promise<SharedInvite[]>;
  /** 새 링크를 내고 **앞 링크는 끊는다.** 보드당 살아 있는 링크는 하나다. */
  makeInvite: () => Promise<SharedInvite | null>;
  dropInvite: (code: string) => void;
  accept: (code: string) => Promise<'ok' | 'not-found' | 'error'>;
  peek: (code: string) => Promise<SharedInvite | null>;
  leave: () => Promise<void>;
  removeBoard: () => Promise<void>;
  /** 원본과 공유 목록의 차이를 메운다. 소유자만 뜻이 있다. */
  syncNow: () => Promise<'ok' | 'skip' | 'error'>;
}

interface Options {
  uid: string | null;
  /**
   * 오늘. 공유 대상을 가르는 경계다 — 지나간 일정은 올리지 않고, 이미 올라간 것은
   * 맞추기가 지운다. 훅이 시계를 직접 읽지 않는 이유는 개인 화면과 같다 (`useToday`).
   */
  todayISO: string;
  /** 계정 표시 이름. 보드에 적어 두어 상대가 누구인지 알 수 있게 한다. */
  accountName: string;
  /** 보드 내용까지 구독할 것인가 (= 같이 보기 화면이 열려 있는가). */
  open: boolean;
  onError: (message: string) => void;
  commit: Commit;
}

const NO_ITEMS: SharedTodoItem[] = [];
const NO_PINS: SharedPin[] = [];
const NO_DDAYS: SharedDday[] = [];

export function useSharedBoard({ uid, todayISO, accountName, open, onError, commit }: Options): SharedApi {
  const { db } = getFirebase();

  const [boards, setBoards] = useState<SharedBoard[]>([]);
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<SharedTodoItem[]>(NO_ITEMS);
  const [pins, setPins] = useState<SharedPin[]>(NO_PINS);
  const [ddays, setDdays] = useState<SharedDday[]>(NO_DDAYS);
  const [contentReady, setContentReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 계정이 바뀌면 렌더 중에 비운다. effect 로 미루면 한 번은 앞 계정 것이 그려진다.
  const [dataUid, setDataUid] = useState<string | null>(uid);
  if (dataUid !== uid) {
    setDataUid(uid);
    setBoards([]); setReady(false);
    setItems(NO_ITEMS); setPins(NO_PINS); setDdays(NO_DDAYS);
    setContentReady(false); setError(null);
  }

  const errorRef = useRef(onError);
  errorRef.current = onError;

  const sink = useCallback((scope: string, err: unknown) => {
    console.error(`[shared:${scope}]`, err);
    const message = `${scope}를 불러오지 못했습니다. ${describeFirestoreError(err)}`;
    setError(message);
    errorRef.current(message);
  }, []);

  /** 늦게 도착한 콜백을 버린다. 계정이 바뀐 뒤 앞 계정의 스냅샷이 섞이지 않게. */
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const own = useCallback(<A extends unknown[]>(owner: string, fn: (...a: A) => void) =>
    (...a: A) => { if (uidRef.current === owner) fn(...a); }, []);

  // 1. 보드 문서 — 로그인해 있는 동안 늘.
  useEffect(() => {
    if (!uid) return;
    return subscribeMyBoards(
      db, uid,
      own(uid, (next) => { setBoards(next); setReady(true); }),
      own(uid, sink),
    );
  }, [db, uid, own, sink]);

  const board = boards[0] ?? null;
  const boardId = board?.id ?? null;

  // 2. 보드 내용 — 화면이 열려 있을 때만.
  useEffect(() => {
    if (!uid || !boardId || !open) {
      setItems(NO_ITEMS); setPins(NO_PINS); setDdays(NO_DDAYS); setContentReady(false);
      return;
    }
    let got = 0;
    const arrived = () => { got += 1; if (got >= 3) setContentReady(true); };
    const unsubs = [
      subscribeSharedItems(db, boardId, own(uid, (v) => { setItems(v); arrived(); }), own(uid, sink)),
      subscribeSharedPins(db, boardId, own(uid, (v) => { setPins(v); arrived(); }), own(uid, sink)),
      subscribeSharedDdays(db, boardId, own(uid, (v) => { setDdays(v); arrived(); }), own(uid, sink)),
    ];
    return () => unsubs.forEach((u) => u());
  }, [db, uid, boardId, open, own, sink]);

  const isOwner = !!board && !!uid && board.ownerUid === uid;

  /*
    3. 맞추기 — 소유자가 이 보드를 처음 열 때 한 번.

    쓰기 시점 갱신이 실패했거나(연결 · 규칙) 보드를 만들기 전부터 있던 TODO 가 있으면
    공유 목록에 빈자리가 생긴다. 여기서 메운다. 원본 전량을 읽어야 "지울 것" 을 판정할
    수 있으므로 화면 구독 목록을 쓰지 않는다.
  */
  const syncedFor = useRef<string | null>(null);
  const syncNow = useCallback(async (): Promise<'ok' | 'skip' | 'error'> => {
    if (!uid || !board || board.ownerUid !== uid) return 'skip';
    try {
      /*
        원본은 **전량**을 읽는다. 화면 구독 목록으로 판정하면 창 밖의 항목이 "원본이
        사라졌다" 로 읽혀 통째로 지워진다.

        공유 목록은 구독으로 들고 있는 것을 쓴다 — 그래서 이 함수는 내용 구독이 한 번
        도착한 뒤에만 부른다 (아래 effect 가 `contentReady` 를 기다린다).
      */
      const tasks = await fetchOwnerTasks(db, uid);
      const plan = planOwnerSync(tasks, items, todayISO);
      if (isEmptyPlan(plan)) return 'ok';
      await applyOwnerSync(db, board.id, uid, plan, new Date().toISOString());
      return 'ok';
    } catch (err) {
      console.error('[shared:sync]', err);
      errorRef.current(`같이 보기를 맞추지 못했습니다. ${describeFirestoreError(err)}`);
      return 'error';
    }
  }, [db, uid, board, items, todayISO]);

  const syncRef = useRef(syncNow);
  syncRef.current = syncNow;

  useEffect(() => {
    if (!open || !isOwner || !boardId || !contentReady) return;
    if (syncedFor.current === boardId) return;
    syncedFor.current = boardId;
    void syncRef.current();
  }, [open, isOwner, boardId, contentReady]);

  // 보드가 사라지면 다음에 다시 맞출 수 있게 표식을 지운다.
  useEffect(() => { if (!boardId) syncedFor.current = null; }, [boardId]);

  const memo = pins.find((p) => p.id === SHARED_MEMO_ID) ?? pins[0] ?? null;

  return useMemo<SharedApi>(() => {
    const blocked = !uid || dataUid !== uid;
    const activeBoard = blocked ? null : board;

    /*
      원본을 올리는 것은 **보드를 만든 사람뿐이다.**

      같이 보기는 "내 TODO 를 상대에게 보여 주는" 자리다. 초대받은 사람의 개인 TODO 는
      올라가지 않는다 — 그쪽이 보드에 더하는 것은 이 화면에서 만든 항목뿐이다.

      이 검사가 없으면 초대받은 사람의 TODO 도 올라갔다가, 소유자가 화면을 열 때 맞추기
      (`planOwnerSync`)가 "원본이 없는 항목" 으로 보고 지운다. 적은 것이 잠깐 보이다
      말없이 사라지는 것이 이 앱에서 가장 하면 안 되는 일이다.
    */
    const mirrors = !!activeBoard && !!uid && activeBoard.ownerUid === uid;

    const pushEntry = (e: Entry) => {
      if (!activeBoard || !uid || !mirrors) return;
      if (!isShareableTask(e, todayISO)) return;
      commit({
        kind: 'sharedSource', label: '같이 보기',
        summary: e.title.trim() || '(제목 없음)',
        payload: { boardId: activeBoard.id, entryId: e.id, source: sourceOf(e), ownerUid: uid },
      });
    };

    return {
      board: activeBoard,
      ready: blocked ? false : ready,
      partner: activeBoard && uid
        ? partnerName(activeBoard.memberUids, activeBoard.memberNames, uid)
        : null,
      boardCount: blocked ? 0 : boards.length,
      items: blocked ? NO_ITEMS : items,
      pins: blocked ? NO_PINS : pins,
      memoText: blocked ? '' : (memo?.text ?? ''),
      ddays: blocked ? NO_DDAYS : ddays,
      contentReady: blocked ? false : contentReady,
      error,

      pushEntry,

      removeEntry: (entryId) => {
        // 올리지 않는 사람은 지울 것도 없다. 같은 이유로 소유자만 지난다.
        if (!activeBoard || !mirrors) return;
        commit({
          kind: 'sharedItemDelete', label: '같이 보기 항목 삭제',
          summary: entryId, payload: { boardId: activeBoard.id, id: entryId },
        });
      },

      saveItem: (item) => {
        if (!activeBoard) return;
        commit({
          kind: 'sharedItem', label: '같이 보기 항목',
          summary: sharedTitle(item), payload: { boardId: activeBoard.id, item },
        });
      },

      removeItem: (item) => {
        if (!activeBoard) return;
        commit({
          kind: 'sharedItemDelete', label: '같이 보기 항목 삭제',
          summary: sharedTitle(item), payload: { boardId: activeBoard.id, id: item.id },
        });
      },

      /**
       * 고정메모. 보드당 한 건이고 문서 id 가 고정돼 있다 —
       * 두 사람이 같은 순간에 처음 적어도 메모가 둘로 갈라지지 않는다.
       */
      saveMemo: (text) => {
        if (!activeBoard || !uid) return;
        const now = new Date().toISOString();
        const trimmed = text.trim();
        if (!trimmed) {
          if (!memo) return;
          commit({
            kind: 'sharedPinDelete', label: '같이 보기 고정메모 삭제',
            summary: memo.text.slice(0, 40) || '(빈 메모)',
            payload: { boardId: activeBoard.id, id: memo.id },
          });
          return;
        }
        commit({
          kind: 'sharedPin', label: '같이 보기 고정메모',
          summary: trimmed.slice(0, 40),
          payload: {
            boardId: activeBoard.id,
            pin: {
              id: memo?.id ?? SHARED_MEMO_ID,
              text: trimmed,
              order: memo?.order ?? 0,
              // 처음 적은 사람이 만든 사람이다. 고칠 때 바꾸지 않는다.
              createdBy: memo?.createdBy ?? uid,
              createdAt: memo?.createdAt ?? now,
              updatedAt: now,
            },
          },
        });
      },

      saveDday: (d) => {
        if (!activeBoard) return;
        commit({
          kind: 'sharedDday', label: '같이 보기 D-Day',
          summary: d.title.trim() || d.date, payload: { boardId: activeBoard.id, dday: d },
        });
      },

      removeDday: (d) => {
        if (!activeBoard) return;
        commit({
          kind: 'sharedDdayDelete', label: '같이 보기 D-Day 삭제',
          summary: d.title.trim() || d.date, payload: { boardId: activeBoard.id, id: d.id },
        });
      },

      /**
       * 보드를 만들고 초대장을 함께 낸다.
       *
       * 두 쓰기를 기다리지 않는다 — 오프라인 지속성이 로컬에 먼저 반영하고 구독이 곧
       * 발화하므로 화면은 바로 열린다. 서버가 거절하면 "저장하지 못한 것" 에 남는다.
       */
      createBoard: (name) => {
        if (!uid || blocked) return null;
        const now = new Date().toISOString();
        const id = newId();
        const board2: SharedBoard = {
          id,
          ownerUid: uid,
          memberUids: [uid],
          memberNames: { [uid]: accountName },
          name: name.trim() || '같이 보기',
          createdAt: now,
          updatedAt: now,
        };
        commit({ kind: 'sharedBoard', label: '같이 보기 보드', summary: board2.name, payload: board2 });

        const invite: SharedInvite = {
          code: newInviteCode(), boardId: id, ownerUid: uid,
          boardName: board2.name, createdAt: now,
        };
        commit({ kind: 'sharedInvite', label: '초대 링크', summary: board2.name, payload: invite });
        return invite;
      },

      listInvites: async () => {
        if (!activeBoard || !uid || activeBoard.ownerUid !== uid) return [];
        try {
          return await fetchBoardInvites(db, uid, activeBoard.id);
        } catch (err) {
          console.error('[shared:invites]', err);
          return [];
        }
      },

      /*
        살아 있는 링크는 하나로 둔다. 새로 내면서 앞 링크를 끊지 않으면, 한 번 뿌린
        주소가 영영 유효한 채로 남고 그것을 되찾을 방법도 없다.
      */
      makeInvite: async () => {
        if (!activeBoard || !uid || activeBoard.ownerUid !== uid) return null;
        let old: SharedInvite[] = [];
        try {
          old = await fetchBoardInvites(db, uid, activeBoard.id);
        } catch (err) {
          console.error('[shared:invites]', err);
        }
        for (const o of old) {
          commit({ kind: 'sharedInviteDelete', label: '초대 링크 끊기', summary: '초대 링크', payload: { id: o.code } });
        }
        const invite: SharedInvite = {
          code: newInviteCode(), boardId: activeBoard.id, ownerUid: uid,
          boardName: activeBoard.name, createdAt: new Date().toISOString(),
        };
        commit({ kind: 'sharedInvite', label: '초대 링크', summary: activeBoard.name, payload: invite });
        return invite;
      },

      dropInvite: (code) => {
        commit({ kind: 'sharedInviteDelete', label: '초대 링크 끊기', summary: '초대 링크', payload: { id: code } });
      },

      /*
        수락은 **온라인이어야 한다.** 초대장을 읽어야 하고(`getDoc`), 아직 member 가 아닌
        상태에서 보드에 쓰는 것은 서버 규칙만이 판정할 수 있다. 그래서 여기만 기다린다.
      */
      accept: async (code) => {
        if (!uid) return 'error';
        /*
          이미 들어와 있는 보드의 링크를 다시 누르는 일이 실제로 있다 (수락 뒤 같은 주소를
          다시 열거나, 소유자가 자기 링크를 눌러 보거나). 그때 쓰기를 보내면 규칙이
          "자기를 더하는 수락" 이 아니라고 거절한다 — 옳은 거절인데 사용자에게는 고장으로
          보인다. 보낼 필요가 없으므로 보내지 않는다.
        */
        if (boards.some((b) => b.memberUids.includes(uid))) {
          const already = await readInvite(db, code).catch(() => null);
          if (already && boards.some((b) => b.id === already.boardId)) return 'ok';
        }
        try {
          const result = await acceptInvite(db, code, uid, accountName, new Date().toISOString());
          return result.ok ? 'ok' : 'not-found';
        } catch (err) {
          console.error('[shared:accept]', err);
          errorRef.current(`초대를 수락하지 못했습니다. ${describeFirestoreError(err)}`);
          return 'error';
        }
      },

      peek: async (code) => {
        try {
          return await readInvite(db, code);
        } catch (err) {
          console.error('[shared:peek]', err);
          return null;
        }
      },

      leave: async () => {
        if (!activeBoard || !uid) return;
        await leaveBoard(db, activeBoard.id, uid, new Date().toISOString());
      },

      removeBoard: async () => {
        if (!activeBoard || !uid || activeBoard.ownerUid !== uid) return;
        await deleteBoardDeep(db, activeBoard.id);
      },

      syncNow,
    };
  }, [
    db, uid, dataUid, todayISO, accountName, board, boards, ready, items, pins, ddays, memo,
    contentReady, error, commit, syncNow,
  ]);
}
