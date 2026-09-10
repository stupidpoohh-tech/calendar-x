/**
 * 서버 쓰기 한 건을 보내고, 거절당하면 그 사실을 알린다.
 *
 * ── 로컬 반영과 서버 확정은 다른 사건이다 ─────────────────────────
 *
 * 오프라인 지속성이 켜져 있어서 `setDoc` 은 로컬 캐시를 먼저 갱신하고 `onSnapshot` 이
 * 즉시 발화한다. 화면에 값이 보이는 것은 **로컬 반영**이지 서버가 받았다는 뜻이 아니다.
 * 그리고 쓰기 promise 는 **서버 ack 까지 resolve 하지 않는다** — 오프라인에서는 영원히
 * 대기한다. 그래서 이 promise 를 기다려 화면을 막거나 스피너를 돌리면 안 된다.
 * 평소 편집은 오프라인에서도 그대로 되고, 연결이 돌아오면 큐가 알아서 나간다.
 *
 * 여기서 잡는 것은 **서버가 거절한** 경우뿐이다 (권한 없음, 규칙 위반, 잘못된 값).
 * 그때는 로컬에만 남고 영영 올라가지 않는다 — 조용히 삼키면 "저장한 줄 알았는데 없는"
 * 상태가 된다. 적은 값은 인자로 들고 있으므로 그대로 다시 보낼 수 있다.
 */
import { useCallback } from 'react';
import { describeFirestoreError } from '../data/errors';
import { useDialog } from '../ui/Dialog';

export type Commit = (label: string, run: () => Promise<unknown>) => void;

/** 받침에 따라 을/를 을 고른다. '항목을' · '잔고를' 처럼 읽히게 한다. */
function objectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (!Number.isFinite(code) || code < 0xac00 || code > 0xd7a3) return '을';
  return (code - 0xac00) % 28 === 0 ? '를' : '을';
}

export function useCommit(): Commit {
  const dialog = useDialog();

  return useCallback((label, run) => {
    const attempt = () => {
      run().catch((err: unknown) => {
        console.error(`[write:${label}]`, err);
        void (async () => {
          const again = await dialog.confirm({
            title: `${label}${objectParticle(label)} 서버에 저장하지 못했습니다`,
            body: (
              <div className="settle">
                <p>
                  화면에는 반영돼 있지만 서버가 받지 않았습니다.
                  이대로 두면 <b>이 기기에서만</b> 보이는 값으로 남습니다.
                </p>
                <p className="dlg-note">{describeFirestoreError(err)}</p>
              </div>
            ),
            confirmLabel: '다시 보내기',
            cancelLabel: '나중에',
          });
          if (again) attempt();
        })();
      });
    };
    attempt();
  }, [dialog]);
}
