/**
 * 같이 보기 → 내 공간 사본 ("서로 일정에도 등록하기").
 *
 * ── 왜 별도 파일인가 ───────────────────────────────────────────
 *
 * `domain/shared.ts` 에는 **`Entry` 를 만들어 돌려주는 함수가 하나도 없다** — 공유 화면의
 * 수정이 원본으로 역반영될 자리가 코드에 없다는 보증이고, 그 보증은 그대로 둔다. 이
 * 모듈만 `Entry` 를 만들고, 그 대신 더 좁은 약속을 지킨다.
 *
 *   **원본(`sourceEntryId`)을 건드리지 않는다.** 만드는 것은 id 가 `shr-<항목id>` 인
 *   새 문서뿐이고, 그 id 는 내 원본 id 와 겹칠 수 없다.
 *
 * ── 각자 자기 사본을 만든다 ────────────────────────────────────
 *
 * 상대의 `users/{uid}/entries` 에는 아무도 쓸 수 없다(규칙). 그래서 "서로" 는 한쪽이
 * 두 사람 몫을 쓰는 것이 아니라, 보드 항목에 켜 둔 표식(`toPersonal`)을 보고 **각자**
 * 자기 캘린더에 사본을 두는 것이다 — 켠 사람은 바로, 상대는 같이 보기를 열 때.
 *
 * ── 사본은 보드를 따라간다 ─────────────────────────────────────
 *
 * 사본의 값은 공유 표시값(`source ⊕ overrides`)이다. 보드에서 고치면 다음 맞추기가
 * 사본을 갱신하고, 표식을 끄거나 항목이 사라지면 사본을 지운다. 반대 방향은 없다 —
 * 사본을 내 캘린더에서 고쳐도 보드로 돌아가지 않고(`isMirrorableTask` 가 막는다)
 * 다음 맞추기가 보드 값으로 되돌린다.
 */
import { newEntry, withDerived } from './entry';
import { isSharedCopy, sharedCopyId, sharedCopySourceId, sharedView, wantsPersonalCopy } from './shared';
import type { Entry, SharedTodoItem } from './types';

/**
 * 공유 항목 하나의 내 캘린더 사본.
 *
 * `createdAt` 은 보드 항목의 것을 그대로 쓴다 — 기기마다 다른 시각이 들어가면 같은
 * 사본을 두 번 쓸 때마다 문서가 달라 보인다.
 */
export function copyEntryOf(item: SharedTodoItem, now = new Date().toISOString()): Entry {
  const v = sharedView(item);
  return withDerived({
    ...newEntry('task', {
      id: sharedCopyId(item.id),
      title: v.title,
      note: v.note,
      color: v.color,
      startDate: v.startDate,
      endDate: v.endDate,
      startTime: v.startTime,
      task: { status: v.status, important: v.important, urgent: v.urgent, order: 0 },
    }),
    createdAt: item.createdAt || now,
  }, now);
}

/** 사본이 보드 값과 같은가. `updatedAt` · `order` 처럼 따라갈 이유가 없는 칸은 보지 않는다. */
export function sameCopy(a: Entry, b: Entry): boolean {
  return a.title === b.title
    && a.note === b.note
    && a.color === b.color
    && a.startDate === b.startDate
    && (a.endDate ?? null) === (b.endDate ?? null)
    && (a.startTime ?? null) === (b.startTime ?? null)
    && a.task?.status === b.task?.status
    && a.task?.important === b.task?.important
    && a.task?.urgent === b.task?.urgent;
}

export interface PersonalCopyPlan {
  /** 새로 쓰거나 보드 값으로 갱신할 사본. */
  writes: Entry[];
  /** 표식이 꺼졌거나 항목이 사라져 지울 사본의 id. */
  deleteIds: string[];
}

export function isEmptyCopyPlan(plan: PersonalCopyPlan): boolean {
  return plan.writes.length === 0 && plan.deleteIds.length === 0;
}

/**
 * 보드 항목과 내 할 일 전량을 견줘 사본을 맞춘다.
 *
 * `myTasks` 는 **전량**이어야 한다 — 화면 구독 목록으로 판정하면 창 밖의 사본이 "없다"
 * 로 읽혀 같은 문서를 계속 다시 쓴다.
 */
export function planPersonalCopies(
  items: readonly SharedTodoItem[], myTasks: readonly Entry[], myUid: string,
  now = new Date().toISOString(),
): PersonalCopyPlan {
  const wanted = items.filter((i) => wantsPersonalCopy(i, myUid));
  const mine = new Map(myTasks.filter((t) => isSharedCopy(t.id)).map((t) => [t.id, t]));

  const writes: Entry[] = [];
  for (const item of wanted) {
    const next = copyEntryOf(item, now);
    const have = mine.get(next.id);
    if (have && sameCopy(have, next)) continue;
    // 이미 있으면 그 문서의 만든 시각을 지킨다 — 사본을 다시 쓴다고 생일이 바뀌지 않는다.
    writes.push(have ? { ...next, createdAt: have.createdAt } : next);
  }

  const keep = new Set(wanted.map((i) => sharedCopyId(i.id)));
  const deleteIds = [...mine.keys()].filter((id) => !keep.has(id) && itemGone(id, items, myUid));

  return { writes, deleteIds };
}

/**
 * 이 사본을 지워도 되는가.
 *
 * 보드에 없는 항목을 가리키거나, 있는데 표식이 꺼진 것만 지운다. 보드 목록을 아직 못
 * 받았을 때 부르면 **전부 지우게 되므로**, 부르는 쪽이 내용 구독이 도착한 뒤에만 부른다.
 */
function itemGone(copyId: string, items: readonly SharedTodoItem[], myUid: string): boolean {
  const itemId = sharedCopySourceId(copyId);
  if (itemId === null) return false;
  const item = items.find((i) => i.id === itemId);
  return !item || !wantsPersonalCopy(item, myUid);
}
