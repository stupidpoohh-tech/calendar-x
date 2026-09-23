/**
 * 원본과 공유 목록 맞추기.
 *
 * 쓰기 시점 갱신이 실패했거나(연결 · 규칙) 보드를 만들기 전부터 있던 TODO 가 있으면
 * 공유 목록에 빈자리가 생긴다. 이 계획이 그 차이를 메운다.
 *
 * **전량 목록을 전제한다.** 부분 목록을 넣으면 창 밖의 항목이 "원본이 사라졌다" 로
 * 읽혀 통째로 지워지므로, 그 전제를 여기에 못 박아 둔다.
 */
import { describe, expect, it } from 'vitest';
import { newEntry } from '../domain/entry';
import { sourceOf, withSource } from '../domain/shared';
import type { Entry, SharedTodoItem } from '../domain/types';
import { isEmptyPlan, planOwnerSync } from './sharedRepo';

const OWNER = 'owner-uid';

function task(id: string, patch: Partial<Entry> = {}): Entry {
  return newEntry('task', { id, title: id, startDate: '2026-09-25', ...patch });
}

function mirrored(e: Entry): SharedTodoItem {
  return withSource(null, e.id, sourceOf(e), OWNER, '2026-09-01T00:00:00.000Z');
}

describe('맞추기 계획', () => {
  it('공유에 없는 할 일은 보낸다', () => {
    const plan = planOwnerSync([task('a'), task('b')], []);
    expect(plan.upserts.map((u) => u.id)).toEqual(['a', 'b']);
    expect(plan.deletes).toEqual([]);
  });

  it('값이 같으면 다시 보내지 않는다', () => {
    const a = task('a');
    expect(isEmptyPlan(planOwnerSync([a], [mirrored(a)]))).toBe(true);
  });

  it('값이 달라졌으면 보낸다', () => {
    const before = task('a');
    const after = task('a', { title: '고친 제목' });
    const plan = planOwnerSync([after], [mirrored(before)]);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]?.source.title).toBe('고친 제목');
  });

  it('원본이 사라진 공유 항목은 지운다 — 유령 항목을 남기지 않는다', () => {
    const plan = planOwnerSync([task('a')], [mirrored(task('a')), mirrored(task('gone'))]);
    expect(plan.deletes).toEqual(['gone']);
    expect(plan.upserts).toEqual([]);
  });

  it('공유 화면에서만 만든 항목은 원본이 없어도 지우지 않는다', () => {
    const local: SharedTodoItem = {
      id: 'local-1', sourceEntryId: null, source: null,
      overrides: { title: '장보기' }, localOnly: true, hidden: false,
      createdBy: 'member', createdAt: '', updatedAt: '',
    };
    expect(planOwnerSync([], [local]).deletes).toEqual([]);
  });

  it('아이디어와 가계부는 보내지 않는다', () => {
    const plan = planOwnerSync(
      [newEntry('idea', { id: 'i1' }), newEntry('money', { id: 'm1' })],
      [],
    );
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('할 일을 아이디어로 옮기면 공유에서 지운다', () => {
    const wasTask = task('a');
    const nowIdea = newEntry('idea', { id: 'a', title: 'a' });
    const plan = planOwnerSync([nowIdea], [mirrored(wasTask)]);
    expect(plan.deletes).toEqual(['a']);
  });

  it('회복 항목은 보내지 않고, 올라가 있으면 지운다', () => {
    const recovery = task('r1', {
      recovery: { options: [], repayment: false, movedCount: 0 },
    });
    const plan = planOwnerSync([recovery], [mirrored(task('r1'))]);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual(['r1']);
  });

  it('상대가 고쳐 둔 항목도 갱신 대상이다 — 실제 쓰기가 overrides 를 담지 않는다', () => {
    const before = task('a');
    const edited = { ...mirrored(before), overrides: { title: '고친 제목' } };
    const plan = planOwnerSync([task('a', { startDate: '2026-09-27' })], [edited]);
    expect(plan.upserts.map((u) => u.id)).toEqual(['a']);
    expect(plan.deletes).toEqual([]);
  });

  it('반복 할 일도 한 건으로 보낸다 — 발생분으로 펼치지 않는다', () => {
    const repeating = task('a', { recurrence: { freq: 'weekly', interval: 1, until: null, count: null } });
    const plan = planOwnerSync([repeating], []);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]?.source.recurring).toBe(true);
  });
});
