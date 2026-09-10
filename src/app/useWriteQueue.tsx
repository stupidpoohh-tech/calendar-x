/**
 * 서버 쓰기 한 건을 보내고, 거절당하면 **값을 붙잡아 둔다.**
 *
 * ── 로컬 반영과 서버 확정은 다른 사건이다 ─────────────────────────
 *
 * 오프라인 지속성이 켜져 있어서 `setDoc` 은 로컬 캐시를 먼저 갱신하고 `onSnapshot` 이
 * 즉시 발화한다. 쓰기 promise 는 **서버 ack 까지 resolve 하지 않는다** — 오프라인에서는
 * 영원히 대기한다. 그래서 이 promise 를 기다려 화면을 막거나 스피너를 돌리면 안 된다.
 * 평소 편집은 오프라인에서도 그대로 되고, 연결이 돌아오면 큐가 알아서 나간다.
 *
 * ── 거절당하면 값은 사라진다 ────────────────────────────────────
 *
 * 예전 안내는 "화면에는 반영돼 있지만 이 기기에서만 보이는 값으로 남습니다" 였다.
 * 에뮬레이터로 재 보니 거짓이었다 — 로컬에 ~90ms 보였다가 Firestore 가 되돌리고,
 * 새로고침해도 돌아오지 않는다 (`data/pendingWrites.ts` 머리말에 측정값을 적어 뒀다).
 * 그러니 값을 **우리가** 붙잡아야 한다. 이 훅이 실패한 쓰기를 계정별 목록에 넣고,
 * 화면은 그 목록을 늘 보여 주며, 사용자는 언제든 다시 보내거나 버릴 수 있다.
 *
 * ── 대화상자로 밀어붙이지 않는다 ────────────────────────────────
 *
 * 실패마다 확인창을 띄우면 두 건이 동시에 실패했을 때 뒤엣것이 앞엣것을 밀어내고,
 * 밀려난 쪽은 다시 찾을 길이 없다. 여기서는 토스트 한 줄과 **없어지지 않는 목록**으로
 * 알린다. "나중에" 는 그냥 목록에 두는 것이고, 목록은 새로고침을 넘긴다.
 */
import { useCallback, useMemo, useState } from 'react';
import { describeFirestoreError } from '../data/errors';
import { getFirebase } from '../data/firebase';
import {
  canPersistFailed, freshnessOf, isOfflineError, loadFailed, saveFailed, sendPending,
  type CommitInput, type PendingOp,
} from '../data/pendingWrites';
import { uid as newId } from '../domain/entry';
import { useDialog } from '../ui/Dialog';

export type Commit = (op: CommitInput) => void;

export interface WriteQueue {
  commit: Commit;
  /** 아직 서버에 못 올린 것들. 계정마다 따로다. */
  failed: PendingOp[];
  /** 새로고침을 넘겨 보관되는가. false 면 이 창을 닫는 순간 사라진다. */
  durable: boolean;
  retry: (id: string) => void;
  retryAll: () => void;
  discard: (id: string) => void;
}

/** 받침에 따라 을/를 을 고른다. '항목을' · '잔고를' 처럼 읽히게 한다. */
export function objectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (!Number.isFinite(code) || code < 0xac00 || code > 0xd7a3) return '을';
  return (code - 0xac00) % 28 === 0 ? '를' : '을';
}

const EMPTY: PendingOp[] = [];

/**
 * 목록에 적을 한 줄의 길이 상한.
 *
 * 제목이 500자를 넘어 거절당하는 경우가 바로 이 목록에 온다. 그것을 그대로 요약에 넣으면
 * 줄이 화면을 밀어내고 보관 자리도 그만큼 부푼다. 값 자체(`payload`)는 온전히 남으므로
 * 여기서 자르는 것은 표시용 한 줄뿐이다.
 */
const SUMMARY_MAX = 60;

const trim = (s: string) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX)}…` : s);

export function useWriteQueue(uid: string | null): WriteQueue {
  const dialog = useDialog();
  const { db } = getFirebase();
  const durable = useMemo(canPersistFailed, []);

  /*
    목록은 **계정에 묶는다.** 계정이 바뀌면 렌더 중에 그 계정 것으로 갈아 끼운다 —
    effect 로 미루면 한 렌더 동안 남의 실패 목록이 떠 있고, 그 사이 "다시 보내기" 를
    누르면 지금 계정 권한으로 앞 계정의 값을 쓰게 된다.
  */
  const [state, setState] = useState<{ uid: string | null; ops: PendingOp[]; stored: boolean }>(
    () => ({ uid, ops: uid ? loadFailed(uid) : EMPTY, stored: true }),
  );
  if (state.uid !== uid) setState({ uid, ops: uid ? loadFailed(uid) : EMPTY, stored: true });

  const ops = state.uid === uid ? state.ops : EMPTY;

  /**
   * 목록을 바꾸고 같은 계정 앞으로 보관한다.
   *
   * 보관에 실패하면 (자리가 꽉 찼거나 브라우저가 막았거나) 그 사실을 들고 있는다 —
   * "이 기기에 남겨 두었습니다" 를 못 지킬 때 그렇게 말하면 안 된다.
   */
  const write = useCallback((owner: string, next: (prev: PendingOp[]) => PendingOp[]) => {
    setState((prev) => {
      if (prev.uid !== owner) return prev;
      const ops2 = next(prev.ops);
      return { uid: owner, ops: ops2, stored: saveFailed(owner, ops2) };
    });
  }, []);

  const enqueue = useCallback((owner: string, input: CommitInput, err: unknown) => {
    console.error(`[write:${input.kind}]`, err);
    const reason = describeFirestoreError(err);
    write(owner, (prev) => [
      ...prev,
      { ...input, summary: trim(input.summary), id: newId(), at: new Date().toISOString(), reason, tries: 0 },
    ]);
    dialog.toast(
      `${input.label}${objectParticle(input.label)} 서버에 저장하지 못했습니다. `
      + '적은 내용은 아래 "저장하지 못한 것" 에 남겨 두었습니다.',
      'bad',
    );
  }, [write, dialog]);

  const commit = useCallback<Commit>((input) => {
    if (!uid) return;
    const owner = uid;
    let sending: Promise<void>;
    try {
      // 동기 예외도 여기서 잡힌다 — 값이 이상하면 `sendPending` 이 바로 던진다.
      sending = sendPending(db, owner, input);
    } catch (err) {
      enqueue(owner, input, err);
      return;
    }
    void sending.catch((err: unknown) => {
      if (isOfflineError(err)) {
        // 연결이 없어 못 보낸 것은 잃은 것이 아니다. 오프라인 큐가 들고 있다.
        dialog.toast(`연결되면 ${input.label}${objectParticle(input.label)} 보냅니다.`);
        return;
      }
      enqueue(owner, input, err);
    });
  }, [uid, db, enqueue, dialog]);

  const discard = useCallback((id: string) => {
    if (!uid) return;
    write(uid, (prev) => prev.filter((o) => o.id !== id));
  }, [uid, write]);

  /**
   * 한 건을 다시 보낸다.
   *
   * 그냥 보내지 않는다. 이 실패 뒤에 **같은 자리에 성공한 더 새로운 저장**이 있으면
   * 옛 값이 그것을 덮어 버린다. 서버의 현재 `updatedAt` 과 견주어 판정하고, 새것이
   * 있거나 판정할 수 없는 종류면 사용자에게 묻는다.
   */
  const retryOne = useCallback(async (op: PendingOp, owner: string): Promise<boolean> => {
    const fresh = await freshnessOf(db, owner, op);
    if (fresh !== 'fresh') {
      const ok = await dialog.confirm({
        title: fresh === 'stale' ? '더 새로운 내용이 서버에 있습니다' : '최신 여부를 가릴 수 없습니다',
        body: (
          <div className="settle">
            <p>
              {fresh === 'stale'
                ? '이 건이 실패한 뒤에 같은 자리에 저장된 내용이 있습니다. 지금 다시 보내면 그 내용을 덮어씁니다.'
                : '이 종류는 서버의 최신 여부를 견줄 값이 없습니다 (순서 저장 · 회복 설정). 그대로 보내면 지금 서버에 있는 내용을 덮어씁니다.'}
            </p>
            <p className="dlg-note">{op.label} · {op.summary}</p>
          </div>
        ),
        confirmLabel: '덮어쓰고 보내기',
        cancelLabel: '그만두기',
        danger: true,
      });
      if (!ok) return false;
    }

    try {
      await sendPending(db, owner, op);
      write(owner, (prev) => prev.filter((o) => o.id !== op.id));
      return true;
    } catch (err) {
      console.error(`[retry:${op.kind}]`, err);
      const reason = isOfflineError(err)
        ? '연결이 없어 아직 보내지 못했습니다.'
        : describeFirestoreError(err);
      write(owner, (prev) => prev.map((o) => (
        o.id === op.id ? { ...o, reason, tries: o.tries + 1 } : o
      )));
      return false;
    }
  }, [db, dialog, write]);

  const retry = useCallback((id: string) => {
    if (!uid) return;
    const owner = uid;
    const op = ops.find((o) => o.id === id);
    if (!op) return;
    void (async () => {
      const ok = await retryOne(op, owner);
      dialog.toast(
        ok ? `${op.label}${objectParticle(op.label)} 보냈습니다.` : '아직 보내지 못했습니다.',
        ok ? 'ok' : 'bad',
      );
    })();
  }, [uid, ops, retryOne, dialog]);

  /** 적은 순서대로 보낸다. 순서를 뒤집으면 옛 값이 새 값을 덮는다. */
  const retryAll = useCallback(() => {
    if (!uid) return;
    const owner = uid;
    const list = [...ops];
    void (async () => {
      let sent = 0;
      for (const op of list) {
        if (await retryOne(op, owner)) sent += 1;
      }
      dialog.toast(
        sent === list.length
          ? `${sent.toLocaleString('ko-KR')}건을 보냈습니다.`
          : `${sent.toLocaleString('ko-KR')}건을 보냈고 ${(list.length - sent).toLocaleString('ko-KR')}건이 남았습니다.`,
        sent === list.length ? 'ok' : 'bad',
      );
    })();
  }, [uid, ops, retryOne, dialog]);

  return { commit, failed: ops, durable: durable && state.stored, retry, retryAll, discard };
}
