/**
 * 같이 보기 → 내 공간 사본 ("서로 일정에도 등록하기").
 *
 * 여기서 못 박는 것은 넷이다.
 *   1. 내 원본에서 올라온 항목은 사본을 또 만들지 않는다(내 달력에 둘이 되면 안 된다)
 *   2. 사본은 다시 보드로 올라가지 않는다 — 그러지 않으면 같은 일이 보드에 둘이 된다
 *   3. 사본은 보드 표시값(`source ⊕ overrides`)을 따라간다
 *   4. 표식을 끄거나 항목이 사라지면 사본을 지우고, 그 밖에는 지우지 않는다
 */
import { describe, expect, it } from 'vitest';
import { newEntry } from './entry';
import {
  isMirrorableTask, isSharedCopy, newLocalItem, setToPersonal, sharedCopyId, sharedCopySourceId,
  sourceOf, withSource, applyOverrides, wantsPersonalCopy,
} from './shared';
import { copyEntryOf, isEmptyCopyPlan, planPersonalCopies, sameCopy } from './sharedCopy';
import type { Entry, SharedTodoItem } from './types';

const ME = 'me-uid';
const OTHER = 'other-uid';
const AT = '2026-09-01T00:00:00.000Z';

const task = (patch: Partial<Entry> = {}): Entry =>
  newEntry('task', { id: 'task-a', title: '병원 예약', startDate: '2026-09-25', ...patch });

/** 상대 캘린더에서 올라온 항목. */
const theirs = (e: Entry): SharedTodoItem => withSource(null, e.id, sourceOf(e), OTHER, AT);
/** 내 캘린더에서 올라온 항목. */
const minesOwn = (e: Entry): SharedTodoItem => withSource(null, e.id, sourceOf(e), ME, AT);
const local = (id = 'loc-1', title = '전시회'): SharedTodoItem =>
  newLocalItem(id, ME, { title, startDate: '2026-10-02' }, AT);

const on = (i: SharedTodoItem) => setToPersonal(i, true, AT);

describe('사본을 만들 항목 고르기', () => {
  it('표식이 꺼져 있으면 아무것도 만들지 않는다', () => {
    expect(wantsPersonalCopy(theirs(task()), ME)).toBe(false);
    expect(isEmptyCopyPlan(planPersonalCopies([theirs(task())], [], ME, AT))).toBe(true);
  });

  it('상대가 올린 항목과 같이 보기 전용 항목은 내 사본을 만든다', () => {
    expect(wantsPersonalCopy(on(theirs(task())), ME)).toBe(true);
    expect(wantsPersonalCopy(on(local()), ME)).toBe(true);
  });

  it('내 원본에서 올라온 항목은 사본을 또 만들지 않는다 — 내 달력에 이미 있다', () => {
    const item = on(minesOwn(task()));
    expect(wantsPersonalCopy(item, ME)).toBe(false);
    // 같은 항목이 상대에게는 사본이 된다.
    expect(wantsPersonalCopy(item, OTHER)).toBe(true);
  });

  it('반복 항목은 고를 수 없다 — 사본에 반복 규칙을 옮길 수 없다', () => {
    const repeating = task({ recurrence: { freq: 'weekly', interval: 1, until: null, count: null } });
    expect(wantsPersonalCopy(on(theirs(repeating)), ME)).toBe(false);
  });
});

describe('사본의 값', () => {
  it('보드 표시값(원본 ⊕ 고친 값)을 따라간다', () => {
    const item = on(applyOverrides(theirs(task()), { title: '치과 예약', startDate: '2026-09-27' }, ME, AT));
    const copy = copyEntryOf(item, AT);
    expect(copy.title).toBe('치과 예약');
    expect(copy.startDate).toBe('2026-09-27');
    expect(copy.kind).toBe('task');
  });

  it('id 는 `shr-<항목id>` 로 정해진다 — 같은 내용을 두 번 써도 문서 하나다', () => {
    const item = on(theirs(task()));
    expect(copyEntryOf(item, AT).id).toBe(sharedCopyId(item.id));
    expect(copyEntryOf(item, AT).id).toBe(copyEntryOf(item, '2027-01-01T00:00:00.000Z').id);
    expect(sharedCopySourceId(sharedCopyId('x'))).toBe('x');
    expect(sharedCopySourceId('x')).toBeNull();
  });

  it('사본은 보드로 다시 올라가지 않는다', () => {
    const copy = copyEntryOf(on(theirs(task())), AT);
    expect(isSharedCopy(copy.id)).toBe(true);
    expect(isMirrorableTask(copy)).toBe(false);
    // 평범한 할 일은 그대로 올라간다.
    expect(isMirrorableTask(task())).toBe(true);
  });
});

describe('맞추기', () => {
  it('없으면 만들고, 같으면 다시 쓰지 않는다', () => {
    const item = on(theirs(task()));
    const first = planPersonalCopies([item], [], ME, AT);
    expect(first.writes.map((e) => e.id)).toEqual([sharedCopyId(item.id)]);
    expect(first.deleteIds).toEqual([]);
    expect(isEmptyCopyPlan(planPersonalCopies([item], first.writes, ME, AT))).toBe(true);
  });

  it('보드에서 고치면 사본을 갱신한다 — 만든 시각은 지킨다', () => {
    const item = on(theirs(task()));
    const have = { ...copyEntryOf(item, AT), createdAt: '2026-08-01T00:00:00.000Z' };
    const moved = applyOverrides(item, { startDate: '2026-10-05' }, OTHER, AT);
    const plan = planPersonalCopies([moved], [have], ME, AT);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]!.startDate).toBe('2026-10-05');
    expect(plan.writes[0]!.createdAt).toBe('2026-08-01T00:00:00.000Z');
    expect(sameCopy(have, plan.writes[0]!)).toBe(false);
  });

  it('표식을 끄거나 항목이 사라지면 사본을 지운다', () => {
    const item = on(theirs(task()));
    const have = copyEntryOf(item, AT);
    expect(planPersonalCopies([setToPersonal(item, false, AT)], [have], ME, AT).deleteIds)
      .toEqual([have.id]);
    expect(planPersonalCopies([], [have], ME, AT).deleteIds).toEqual([have.id]);
  });

  it('사본이 아닌 내 할 일은 건드리지 않는다', () => {
    const plan = planPersonalCopies([], [task(), task({ id: 'task-b' })], ME, AT);
    expect(isEmptyCopyPlan(plan)).toBe(true);
  });
});
