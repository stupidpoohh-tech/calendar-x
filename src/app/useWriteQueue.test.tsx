/**
 * 저장이 거절당했을 때 값이 살아남는가.
 *
 * ## 왜 이 파일이 필요한가
 *
 * 예전 훅은 실패를 확인창 하나로 알리고, 다시 보내기는 그 창 안에서만 됐다. "나중에" 를
 * 고르면 적은 값을 다시 찾을 길이 없었다 — Firestore 는 거절당한 쓰기를 로컬 캐시에서도
 * 되돌리므로 화면에도 남지 않는다 (`data/pendingWrites.ts` 머리말의 실측 참고).
 *
 * 여기서는 거절 이후에도 값이 목록에 남는지, 새로고침을 넘기는지, 계정에 묶이는지,
 * 옛 값이 새 값을 덮지 않는지를 본다.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { DialogHost } from '../ui/Dialog';
import type { CommitInput } from '../data/pendingWrites';

/* ── 저장 계층을 손으로 흉내 낸다. 실제 Firestore 는 에뮬레이터 테스트가 본다 ── */

interface Sent { uid: string; op: CommitInput }

const sent: Sent[] = [];
/** 다음 보내기의 결과. 큐에서 하나씩 꺼내 쓴다 — 비면 성공. */
const outcomes: (Error | 'ok' | 'throw')[] = [];
/** freshnessOf 가 돌려줄 값. */
let freshness: 'fresh' | 'stale' | 'unknown' = 'fresh';
/** 확인창에서 사용자가 고를 값. */
let confirmAnswer = true;
const confirmed: string[] = [];

vi.mock('../data/firebase', () => ({ getFirebase: () => ({ db: {} }) }));

vi.mock('../data/pendingWrites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/pendingWrites')>();
  return {
    ...actual,
    sendPending: (_db: unknown, uid: string, op: CommitInput) => {
      const next = outcomes.shift() ?? 'ok';
      if (next === 'throw') throw new Error('동기 예외');
      if (next instanceof Error) return Promise.reject(next);
      sent.push({ uid, op });
      return Promise.resolve();
    },
    freshnessOf: () => Promise.resolve(freshness),
  };
});

const { useWriteQueue } = await import('./useWriteQueue');

const wrap = ({ children }: { children: ReactNode }) => <DialogHost>{children}</DialogHost>;

const denied = () => Object.assign(new Error('권한 없음'), { code: 'permission-denied' });
const offline = () => Object.assign(new Error('연결 없음'), { code: 'unavailable' });

const entryOp = (id: string, updatedAt: string): CommitInput => ({
  kind: 'entry', label: '항목', summary: `제목 ${id}`,
  payload: { id, updatedAt } as never,
});

beforeEach(() => {
  sent.length = 0;
  outcomes.length = 0;
  confirmed.length = 0;
  freshness = 'fresh';
  confirmAnswer = true;
  localStorage.clear();
  // 확인창은 DialogHost 가 렌더링한다. 누르는 쪽은 아래 헬퍼가 맡는다.
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** 확인창이 뜨면 눌러 준다. 뜨지 않으면 아무 일도 하지 않는다. */
async function answerDialog() {
  await waitFor(() => expect(document.querySelector('.dlg')).not.toBeNull());
  const buttons = [...document.querySelectorAll('.dlg-actions button')] as HTMLButtonElement[];
  confirmed.push(document.querySelector('.dlg-t')?.textContent ?? '');
  await act(async () => { (confirmAnswer ? buttons[1] : buttons[0])?.click(); });
}

const mount = (uid: string | null = 'u1') =>
  renderHook(({ id }: { id: string | null }) => useWriteQueue(id), {
    wrapper: wrap, initialProps: { id: uid },
  });

describe('성공한 쓰기', () => {
  it('아무것도 남기지 않는다', async () => {
    const { result } = mount();
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(result.current.failed).toEqual([]);
  });
});

describe('서버가 거절하면', () => {
  it('적은 값을 목록에 남긴다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });

    await waitFor(() => expect(result.current.failed).toHaveLength(1));
    const op = result.current.failed[0]!;
    expect(op.label).toBe('항목');
    expect(op.summary).toBe('제목 a');
    // 값 자체가 그대로 들어 있어야 다시 보낼 수 있다.
    expect(op.payload).toMatchObject({ id: 'a' });
    boom.mockRestore();
  });

  it('여러 건이 동시에 실패해도 하나도 밀려나지 않는다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied(), denied(), denied());
    act(() => {
      result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z'));
      result.current.commit(entryOp('b', '2026-09-10T00:00:00.000Z'));
      result.current.commit(entryOp('c', '2026-09-10T00:00:00.000Z'));
    });

    await waitFor(() => expect(result.current.failed).toHaveLength(3));
    expect(result.current.failed.map((o) => o.summary)).toEqual(['제목 a', '제목 b', '제목 c']);
    boom.mockRestore();
  });

  it('동기 예외도 잡아 목록에 남긴다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push('throw');
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });

    await waitFor(() => expect(result.current.failed).toHaveLength(1));
    boom.mockRestore();
  });

  it('새로고침을 넘겨 남는다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = mount();
    outcomes.push(denied());
    act(() => { first.result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(first.result.current.failed).toHaveLength(1));
    first.unmount();

    // 새로 뜬 앱이 같은 계정으로 들어온다.
    const again = mount();
    expect(again.result.current.failed).toHaveLength(1);
    expect(again.result.current.failed[0]!.summary).toBe('제목 a');
    expect(again.result.current.durable).toBe(true);
    boom.mockRestore();
  });
});

describe('연결이 없어 못 보낸 것은', () => {
  it('실패로 세지 않는다 — 오프라인 큐가 들고 있다', async () => {
    const { result } = mount();
    outcomes.push(offline());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });

    await waitFor(() => expect(document.querySelector('.toast')).not.toBeNull());
    expect(document.querySelector('.toast')!.textContent).toContain('연결되면');
    expect(result.current.failed).toEqual([]);
  });

  it('연결이 돌아오면 같은 값이 서버로 나간다', async () => {
    const { result } = mount();
    outcomes.push(offline());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(result.current.failed).toEqual([]));

    // 오프라인 큐가 실제로 하는 일 — 같은 쓰기가 뒤늦게 나간다.
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.op.payload).toMatchObject({ id: 'a' });
  });
});

describe('다시 보내기', () => {
  it('목록을 닫았다 다시 열어도 보낼 수 있다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(result.current.failed).toHaveLength(1));

    // "나중에" 는 그냥 목록에 두는 것이다. 언제든 다시 찾을 수 있다.
    const id = result.current.failed[0]!.id;
    act(() => { result.current.retry(id); });

    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() => expect(result.current.failed).toEqual([]));
    boom.mockRestore();
  });

  it('또 실패하면 목록에 남고 이유와 횟수가 갱신된다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(result.current.failed).toHaveLength(1));

    outcomes.push(denied());
    act(() => { result.current.retry(result.current.failed[0]!.id); });

    await waitFor(() => expect(result.current.failed[0]!.tries).toBe(1));
    expect(result.current.failed).toHaveLength(1);
    boom.mockRestore();
  });

  it('버리면 목록에서도 저장소에서도 사라진다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(result.current.failed).toHaveLength(1));

    act(() => { result.current.discard(result.current.failed[0]!.id); });
    expect(result.current.failed).toEqual([]);
    expect(localStorage.getItem('calendarx.failed.u1')).toBeNull();
    boom.mockRestore();
  });
});

describe('옛 값이 새 값을 덮지 않는다', () => {
  it('그 뒤에 저장된 최신 내용이 있으면 먼저 묻는다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(result.current.failed).toHaveLength(1));

    // A 가 실패한 뒤 B 가 같은 자리에 성공했다 → 서버 쪽이 더 새롭다.
    freshness = 'stale';
    confirmAnswer = false;
    act(() => { result.current.retry(result.current.failed[0]!.id); });

    await answerDialog();
    expect(confirmed[0]).toContain('더 새로운 내용이 서버에 있습니다');
    // 그만두었으므로 아무것도 보내지 않았고, 값은 그대로 남는다.
    await waitFor(() => expect(result.current.failed).toHaveLength(1));
    expect(sent).toEqual([]);
    boom.mockRestore();
  });

  it('사용자가 덮어쓰기를 고르면 그때야 보낸다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(result.current.failed).toHaveLength(1));

    freshness = 'stale';
    confirmAnswer = true;
    act(() => { result.current.retry(result.current.failed[0]!.id); });

    await answerDialog();
    await waitFor(() => expect(sent).toHaveLength(1));
    boom.mockRestore();
  });

  it('최신 여부를 가릴 수 없는 종류도 먼저 묻는다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied());
    act(() => {
      result.current.commit({
        kind: 'taskOrder', label: '순서', summary: '할 일 3건의 순서',
        payload: { ordered: [] },
      });
    });
    await waitFor(() => expect(result.current.failed).toHaveLength(1));

    freshness = 'unknown';
    confirmAnswer = false;
    act(() => { result.current.retry(result.current.failed[0]!.id); });

    await answerDialog();
    expect(confirmed[0]).toContain('최신 여부를 가릴 수 없습니다');
    expect(sent).toEqual([]);
    boom.mockRestore();
  });

  it('모두 다시 보내기는 적은 순서대로 보낸다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied(), denied());
    act(() => {
      result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z'));
      result.current.commit(entryOp('b', '2026-09-11T00:00:00.000Z'));
    });
    await waitFor(() => expect(result.current.failed).toHaveLength(2));

    act(() => { result.current.retryAll(); });
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => (s.op.payload as { id: string }).id)).toEqual(['a', 'b']);
    boom.mockRestore();
  });
});

describe('계정에 묶인다', () => {
  it('계정을 바꾸면 앞 계정의 실패가 보이지 않는다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = mount('u1');
    outcomes.push(denied());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(result.current.failed).toHaveLength(1));

    rerender({ id: 'u2' });
    expect(result.current.failed).toEqual([]);

    // 계정 B 에서 다시 보내려 해도 A 의 것은 손에 들어오지 않는다.
    act(() => { result.current.retryAll(); });
    await waitFor(() => expect(sent).toEqual([]));

    // 계정 A 로 돌아오면 그대로 있다.
    rerender({ id: 'u1' });
    expect(result.current.failed).toHaveLength(1);
    boom.mockRestore();
  });

  it('계정마다 다른 자리에 보관한다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount('u1');
    outcomes.push(denied());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    await waitFor(() => expect(result.current.failed).toHaveLength(1));

    expect(localStorage.getItem('calendarx.failed.u1')).toContain('제목 a');
    expect(localStorage.getItem('calendarx.failed.u2')).toBeNull();
    boom.mockRestore();
  });

  it('로그아웃 상태에서는 아무것도 보내지 않는다', () => {
    const { result } = mount(null);
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });
    expect(sent).toEqual([]);
    expect(result.current.failed).toEqual([]);
  });
});

describe('보관이 막혔을 때', () => {
  it('"이 기기에 남겨 두었습니다" 라고 말하지 않는다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 자리가 꽉 찼거나 브라우저가 막은 경우. 목록에는 들지만 새로고침을 넘기지 못한다.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('막힘'); });
    const { result } = mount();
    outcomes.push(denied());
    act(() => { result.current.commit(entryOp('a', '2026-09-10T00:00:00.000Z')); });

    await waitFor(() => expect(result.current.failed).toHaveLength(1));
    expect(result.current.durable).toBe(false);
    boom.mockRestore();
  });
});

describe('목록에 적는 한 줄', () => {
  it('아주 긴 값도 줄여서 적는다 — 값 자체는 온전히 남는다', async () => {
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = mount();
    outcomes.push(denied());
    const long = '가'.repeat(600);
    act(() => {
      result.current.commit({
        kind: 'entry', label: '항목', summary: long,
        payload: { id: 'a', updatedAt: '2026-09-10T00:00:00.000Z', title: long } as never,
      });
    });

    await waitFor(() => expect(result.current.failed).toHaveLength(1));
    const op = result.current.failed[0]!;
    expect(op.summary.length).toBeLessThan(70);
    expect((op.payload as { title: string }).title).toHaveLength(600);
    boom.mockRestore();
  });
});
