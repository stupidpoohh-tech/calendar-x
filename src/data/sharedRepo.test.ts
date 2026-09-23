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
import { isEmptyPlan, planMirrorSync } from './sharedRepo';

const OWNER = 'owner-uid';
const TODAY = '2026-09-23';

function task(id: string, patch: Partial<Entry> = {}): Entry {
  return newEntry('task', { id, title: id, startDate: '2026-09-25', ...patch });
}

/** 지나간 일정. 오늘보다 앞에서 끝난다. */
function pastTask(id: string, patch: Partial<Entry> = {}): Entry {
  return newEntry('task', { id, title: id, startDate: '2026-09-01', ...patch });
}

function mirrored(e: Entry): SharedTodoItem {
  return withSource(null, e.id, sourceOf(e), OWNER, '2026-09-01T00:00:00.000Z');
}

describe('맞추기 계획', () => {
  it('공유에 없는 할 일은 보낸다', () => {
    const plan = planMirrorSync([task('a'), task('b')], [], TODAY, OWNER);
    expect(plan.upserts.map((u) => u.id)).toEqual(['a', 'b']);
    expect(plan.deletes).toEqual([]);
  });

  it('값이 같으면 다시 보내지 않는다', () => {
    const a = task('a');
    expect(isEmptyPlan(planMirrorSync([a], [mirrored(a)], TODAY, OWNER))).toBe(true);
  });

  it('값이 달라졌으면 보낸다', () => {
    const before = task('a');
    const after = task('a', { title: '고친 제목' });
    const plan = planMirrorSync([after], [mirrored(before)], TODAY, OWNER);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]?.source.title).toBe('고친 제목');
  });

  it('원본이 사라진 공유 항목은 지운다 — 유령 항목을 남기지 않는다', () => {
    const plan = planMirrorSync([task('a')], [mirrored(task('a')), mirrored(task('gone'))], TODAY, OWNER);
    expect(plan.deletes).toEqual(['gone']);
    expect(plan.upserts).toEqual([]);
  });

  it('공유 화면에서만 만든 항목은 원본이 없어도 지우지 않는다', () => {
    const local: SharedTodoItem = {
      id: 'local-1', sourceEntryId: null, source: null,
      overrides: { title: '장보기' }, overriddenBy: '', localOnly: true, hiddenBy: [],
      createdBy: 'member', createdAt: '', updatedAt: '',
    };
    expect(planMirrorSync([], [local], TODAY, OWNER).deletes).toEqual([]);
  });

  it('아이디어와 가계부는 보내지 않는다', () => {
    const plan = planMirrorSync(
      [newEntry('idea', { id: 'i1' }), newEntry('money', { id: 'm1' })],
      [], TODAY, OWNER,
    );
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('할 일을 아이디어로 옮기면 공유에서 지운다', () => {
    const wasTask = task('a');
    const nowIdea = newEntry('idea', { id: 'a', title: 'a' });
    const plan = planMirrorSync([nowIdea], [mirrored(wasTask)], TODAY, OWNER);
    expect(plan.deletes).toEqual(['a']);
  });

  it('회복 항목은 보내지 않고, 올라가 있으면 지운다', () => {
    const recovery = task('r1', {
      recovery: { options: [], repayment: false, movedCount: 0 },
    });
    const plan = planMirrorSync([recovery], [mirrored(task('r1'))], TODAY, OWNER);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual(['r1']);
  });

  it('상대가 고쳐 둔 항목도 갱신 대상이다 — 실제 쓰기가 overrides 를 담지 않는다', () => {
    const before = task('a');
    const edited = { ...mirrored(before), overrides: { title: '고친 제목' } };
    const plan = planMirrorSync([task('a', { startDate: '2026-09-27' })], [edited], TODAY, OWNER);
    expect(plan.upserts.map((u) => u.id)).toEqual(['a']);
    expect(plan.deletes).toEqual([]);
  });

  it('반복 할 일도 한 건으로 보낸다 — 발생분으로 펼치지 않는다', () => {
    const repeating = task('a', { recurrence: { freq: 'weekly', interval: 1, until: null, count: null } });
    const plan = planMirrorSync([repeating], [], TODAY, OWNER);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]?.source.recurring).toBe(true);
  });
});

/*
  같이 보기는 "둘이 앞으로 무엇을 하는가" 를 보는 자리다. 몇 년치 할 일이 통째로
  올라가면 상대 화면이 지난 기록으로 덮인다.

  시간이 흐르기만 해도 어제 것이 지난 것이 되므로, 이 맞추기가 보드를 스스로
  정리하는 자리가 된다.
*/
/*
  양방향이라 둘 다 올린다. 맞추기는 **내가 올린 것**만 본다 — 남의 몫까지 지우면
  상대가 다음에 열 때 다시 올라와, 항목이 사라졌다 나타났다 한다.
*/
describe('내 몫만 맞춘다', () => {
  const theirs = (id: string): SharedTodoItem => ({
    ...mirrored(task(id)), createdBy: 'partner-uid',
  });

  it('상대가 올린 항목은 내 원본에 없어도 지우지 않는다', () => {
    expect(planMirrorSync([], [theirs('t1')], TODAY, OWNER).deletes).toEqual([]);
  });

  it('내가 올린 것만 지운다', () => {
    const plan = planMirrorSync([], [theirs('t1'), mirrored(task('mine'))], TODAY, OWNER);
    expect(plan.deletes).toEqual(['mine']);
  });

  it('상대가 올린 항목과 같은 id 의 내 원본이 있으면 내 것으로 다시 올린다', () => {
    // 있을 수 없는 상태이지만, 주인이 어긋난 채 남아 있으면 내 쪽이 바로잡는다.
    const plan = planMirrorSync([task('t1')], [theirs('t1')], TODAY, OWNER);
    expect(plan.upserts.map((u) => u.id)).toEqual(['t1']);
  });
});

describe('비공개 항목', () => {
  it('올리지 않는다', () => {
    const secret = task('gift', { keepPrivate: true });
    expect(isEmptyPlan(planMirrorSync([secret], [], TODAY, OWNER))).toBe(true);
  });

  it('나중에 비공개로 바꾸면 이미 올라간 것을 내린다', () => {
    const shared = task('gift');
    const secret = task('gift', { keepPrivate: true });
    const plan = planMirrorSync([secret], [mirrored(shared)], TODAY, OWNER);
    expect(plan.deletes).toEqual(['gift']);
    expect(plan.upserts).toEqual([]);
  });

  it('비공개를 풀면 다시 올라간다', () => {
    const plan = planMirrorSync([task('gift')], [], TODAY, OWNER);
    expect(plan.upserts.map((u) => u.id)).toEqual(['gift']);
  });
});

describe('지나간 일정', () => {
  it('보내지 않는다', () => {
    expect(isEmptyPlan(planMirrorSync([pastTask('old')], [], TODAY, OWNER))).toBe(true);
  });

  it('이미 올라가 있으면 지운다', () => {
    const plan = planMirrorSync([pastTask('old')], [mirrored(pastTask('old'))], TODAY, OWNER);
    expect(plan.deletes).toEqual(['old']);
    expect(plan.upserts).toEqual([]);
  });

  it('오늘 것은 남는다', () => {
    const today = task('t', { startDate: TODAY });
    expect(planMirrorSync([today], [], TODAY, OWNER).upserts.map((u) => u.id)).toEqual(['t']);
  });

  it('어제 시작해 모레 끝나는 일정은 아직 진행 중이라 남는다', () => {
    const running = task('r', { startDate: '2026-09-20', endDate: '2026-09-25' });
    expect(planMirrorSync([running], [], TODAY, OWNER).upserts.map((u) => u.id)).toEqual(['r']);
  });

  it('어제 끝난 기간 일정은 지운다', () => {
    const ended = task('e', { startDate: '2026-09-01', endDate: '2026-09-22' });
    expect(planMirrorSync([ended], [mirrored(ended)], TODAY, OWNER).deletes).toEqual(['e']);
  });

  it('끝이 없는 반복은 시작일이 오래돼도 남는다 — 지금 돌고 있다', () => {
    const repeating = newEntry('task', {
      id: 'rep', title: 'rep', startDate: '2025-01-01',
      recurrence: { freq: 'weekly', interval: 1, until: null, count: null },
    });
    expect(planMirrorSync([repeating], [], TODAY, OWNER).upserts.map((u) => u.id)).toEqual(['rep']);
  });

  it('끝난 반복은 지운다', () => {
    const finished = newEntry('task', {
      id: 'rep', title: 'rep', startDate: '2025-01-01',
      recurrence: { freq: 'weekly', interval: 1, until: '2026-08-01', count: null },
    });
    expect(planMirrorSync([finished], [mirrored(finished)], TODAY, OWNER).deletes).toEqual(['rep']);
  });

  it('공유 화면에서만 만든 지난 항목은 지우지 않는다 — 되살릴 곳이 없다', () => {
    const local: SharedTodoItem = {
      id: 'local-old', sourceEntryId: null, source: null,
      overrides: { title: '지난 주 약속', startDate: '2026-09-01' }, overriddenBy: '',
      localOnly: true, hiddenBy: [], createdBy: 'member', createdAt: '', updatedAt: '',
    };
    expect(planMirrorSync([], [local], TODAY, OWNER).deletes).toEqual([]);
  });
});
