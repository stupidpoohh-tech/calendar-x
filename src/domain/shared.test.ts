/**
 * 같이 보기 — 단방향 동기화와 겹쳐 보기.
 *
 * 이 파일이 지키는 약속은 셋이다.
 *   1. 공유 화면의 편집은 원본을 **한 글자도** 바꾸지 않는다.
 *   2. 고치지 않은 필드는 계속 원본을 따라간다.
 *   3. 고친 필드는 원본이 바뀌어도 유지된다.
 */
import { describe, expect, it } from 'vitest';
import { newEntry, withDerived } from './entry';
import {
  applyOverrides, canRevert, collectionProgress, isHiddenFor, isOverridden, isPastTask,
  isShareableTask, itemsOfCollection, newCollection, newCollectionItem, newLocalItem, newNote,
  noteSummary, noteTitle, overriddenFields, ownsMirror, pinnedNote, repinNotes, revertToSource,
  sameSource, scheduleFromCollectionItem, scheduleGroups, setHiddenFor, sharedSortKey,
  sharedTitle, sharedView, shortName, sortNotes, sourceOf, toggleCollectionItem, withSource,
  partnerName, newInviteCode, inviteUrl,
} from './shared';
import type { Entry, SharedCollectionItem, SharedNote, SharedTodoItem } from './types';

const OWNER = 'owner-uid';
const TODAY = '2026-09-23';
const MEMBER = 'member-uid';

function task(patch: Partial<Entry> = {}): Entry {
  return newEntry('task', { id: 'task-a', title: '병원 예약', startDate: '2026-09-25', ...patch });
}

/** 원본에서 받아 온 공유 항목. 실제 경로와 같은 함수로 만든다. */
function mirrored(e: Entry): SharedTodoItem {
  return withSource(null, e.id, sourceOf(e), OWNER, '2026-09-01T00:00:00.000Z');
}

describe('공유 대상', () => {
  it('할 일만 나간다 — 아이디어와 가계부는 자동 공유하지 않는다', () => {
    expect(isShareableTask(task(), TODAY)).toBe(true);
    expect(isShareableTask(newEntry('idea', { title: '떠오른 것', startDate: '2026-09-25' }), TODAY)).toBe(false);
    expect(isShareableTask(newEntry('money', { title: '전기요금', startDate: '2026-09-25' }), TODAY)).toBe(false);
  });

  it('회복 항목은 빼 둔다 — 개인 시스템 항목이다', () => {
    const recovery = task({
      recovery: { options: [{ id: 'work', label: '회사 일' }], repayment: false, movedCount: 0 },
    });
    expect(isShareableTask(recovery, TODAY)).toBe(false);
  });

  it('반복 전개분은 빼 둔다 — 저장되지 않는 화면용 사본이다', () => {
    expect(isShareableTask({ ...task(), virtual: true }, TODAY)).toBe(false);
  });

  it('공유하는 필드만 뽑는다 — 태그·장소는 가지 않는다', () => {
    const source = sourceOf(task({ color: 'pink', tags: ['비밀'], location: '강남' }));
    expect(Object.keys(source).sort()).toEqual([
      'color', 'endDate', 'important', 'note', 'recurring',
      'startDate', 'startTime', 'status', 'title', 'urgent',
    ]);
  });

  /*
    색은 달력에서 항목을 가르는 값이다. 내 달력에서 빨강이던 일이 공유 화면에서
    파랑이면 같은 일로 읽히지 않는다.
  */
  it('원본의 색을 물려받는다', () => {
    expect(sourceOf(task({ color: 'pink' })).color).toBe('pink');
    expect(sharedView(mirrored(task({ color: 'green' }))).color).toBe('green');
  });

  it('반복 여부는 표식으로만 넘긴다', () => {
    const repeating = withDerived({
      ...task(), recurrence: { freq: 'weekly', interval: 1, until: null, count: null },
    });
    expect(sourceOf(repeating).recurring).toBe(true);
  });
});

/*
  같이 보기는 "둘이 앞으로 무엇을 하는가" 를 보는 자리다. 몇 년치 할 일이 통째로
  올라가면 상대 화면이 지난 기록으로 덮인다. 경계는 시작일이 아니라 **끝나는 날**이다.
*/
describe('지나간 일정은 공유하지 않는다', () => {
  it('어제 끝난 것은 나가지 않는다', () => {
    expect(isShareableTask(task({ startDate: '2026-09-22' }), TODAY)).toBe(false);
  });

  it('오늘 것은 나간다', () => {
    expect(isShareableTask(task({ startDate: TODAY }), TODAY)).toBe(true);
  });

  it('내일 것은 나간다', () => {
    expect(isShareableTask(task({ startDate: '2026-09-24' }), TODAY)).toBe(true);
  });

  it('어제 시작해 모레 끝나는 것은 아직 진행 중이라 나간다', () => {
    const running = task({ startDate: '2026-09-20', endDate: '2026-09-25' });
    expect(isShareableTask(running, TODAY)).toBe(true);
    expect(isPastTask(running, TODAY)).toBe(false);
  });

  it('어제 끝난 기간 일정은 나가지 않는다', () => {
    expect(isPastTask(task({ startDate: '2026-09-01', endDate: '2026-09-22' }), TODAY)).toBe(true);
  });

  /*
    반복은 시작일이 아무리 오래됐어도 지금 돌고 있다. 시작일로 판정하면 2025년에
    시작한 매주 반복이 통째로 빠진다.
  */
  it('끝이 없는 반복은 시작일이 오래돼도 나간다', () => {
    const repeating = withDerived({
      ...task({ startDate: '2025-01-01' }),
      recurrence: { freq: 'weekly', interval: 1, until: null, count: null },
    });
    expect(isShareableTask(repeating, TODAY)).toBe(true);
  });

  it('끝난 반복은 나가지 않는다', () => {
    const finished = withDerived({
      ...task({ startDate: '2025-01-01' }),
      recurrence: { freq: 'weekly', interval: 1, until: '2026-08-01', count: null },
    });
    expect(isShareableTask(finished, TODAY)).toBe(false);
  });

  it('오늘 끝나는 반복은 나간다', () => {
    const endingToday = withDerived({
      ...task({ startDate: '2025-01-01' }),
      recurrence: { freq: 'weekly', interval: 1, until: TODAY, count: null },
    });
    expect(isShareableTask(endingToday, TODAY)).toBe(true);
  });

  it('오늘을 알 수 없으면 지난 것으로 몰아 지우지 않는다', () => {
    expect(isPastTask(task({ startDate: '2020-01-01' }), '')).toBe(false);
  });
});

describe('원본 → 공유', () => {
  it('원본 TODO 를 공유 항목으로 만든다', () => {
    const item = mirrored(task());
    expect(item.id).toBe('task-a');
    expect(item.sourceEntryId).toBe('task-a');
    expect(item.localOnly).toBe(false);
    expect(item.hiddenBy).toEqual([]);
    expect(item.overrides).toEqual({});
    // 올린 사람이 이 항목의 주인이다 — 맞추기와 권한이 이 값으로 갈린다.
    expect(ownsMirror(item, OWNER)).toBe(true);
    expect(ownsMirror(item, MEMBER)).toBe(false);
    expect(sharedView(item).title).toBe('병원 예약');
  });

  it('원본 제목이 바뀌면 공유 화면도 바뀐다', () => {
    const item = mirrored(task());
    const next = withSource(item, 'task-a', sourceOf(task({ title: '치과 예약' })), OWNER);
    expect(sharedView(next).title).toBe('치과 예약');
  });

  it('원본 날짜가 바뀌면 공유 화면도 바뀐다', () => {
    const item = mirrored(task());
    const next = withSource(item, 'task-a', sourceOf(task({ startDate: '2026-09-27' })), OWNER);
    expect(sharedView(next).startDate).toBe('2026-09-27');
  });

  it('원본 갱신은 공유 화면의 수정과 감춤을 건드리지 않는다', () => {
    const hidden = setHiddenFor(applyOverrides(mirrored(task()), { title: '병원 전화하기' }, MEMBER), MEMBER, true);
    const next = withSource(hidden, 'task-a', sourceOf(task({ startDate: '2026-09-27' })), OWNER);
    expect(next.overrides.title).toBe('병원 전화하기');
    expect(isHiddenFor(next, MEMBER)).toBe(true);
  });

  it('값이 같으면 다시 보낼 이유가 없다', () => {
    const a = sourceOf(task());
    expect(sameSource(a, sourceOf(task()))).toBe(true);
    expect(sameSource(a, sourceOf(task({ title: '다른 제목' })))).toBe(false);
    expect(sameSource(a, null)).toBe(false);
    expect(sameSource(null, null)).toBe(true);
  });
});

describe('공유 → 원본은 없다', () => {
  it('제목을 고쳐도 원본 Entry 는 그대로다', () => {
    const entry = task();
    const before = JSON.stringify(entry);
    const item = mirrored(entry);

    const edited = applyOverrides(item, { title: '병원 전화하기' }, MEMBER);

    expect(edited.overrides.title).toBe('병원 전화하기');
    // 원본 객체가 그대로여야 한다 — 이 방향으로는 아무것도 흐르지 않는다.
    expect(JSON.stringify(entry)).toBe(before);
    // source 도 원본에서 받은 값 그대로다.
    expect(edited.source?.title).toBe('병원 예약');
  });

  it('완료로 체크해도 원본 상태는 그대로다', () => {
    const entry = task();
    const item = mirrored(entry);
    const done = applyOverrides(item, { status: 'done' }, MEMBER);

    expect(sharedView(done).status).toBe('done');
    expect(entry.task?.status).toBe('planned');
    expect(done.source?.status).toBe('planned');
  });

  it('감춰도 원본은 남는다', () => {
    const entry = task();
    const hidden = setHiddenFor(mirrored(entry), MEMBER, true);
    expect(isHiddenFor(hidden, MEMBER)).toBe(true);
    expect(hidden.source?.title).toBe('병원 예약');
    expect(entry.title).toBe('병원 예약');
  });
});

describe('고치지 않은 필드는 원본을 따라간다', () => {
  it('제목만 고친 뒤 원본 날짜가 바뀌면, 고친 제목 + 새 날짜다', () => {
    const edited = applyOverrides(mirrored(task()), { title: '병원 전화하기' }, MEMBER);
    const after = withSource(edited, 'task-a', sourceOf(task({ startDate: '2026-09-27' })), OWNER);

    const view = sharedView(after);
    expect(view.title).toBe('병원 전화하기');
    expect(view.startDate).toBe('2026-09-27');
    expect(view.overridden).toEqual(['title']);
  });

  it('원본 상태 변경은 override 가 없을 때만 보인다', () => {
    const plain = withSource(mirrored(task()), 'task-a', sourceOf(task({
      task: { status: 'done', important: false, urgent: false, order: 0 },
    })), OWNER);
    expect(sharedView(plain).status).toBe('done');

    const overridden = applyOverrides(mirrored(task()), { status: 'in-progress' }, MEMBER);
    const afterOwner = withSource(overridden, 'task-a', sourceOf(task({
      task: { status: 'done', important: false, urgent: false, order: 0 },
    })), OWNER);
    // 원본이 완료로 바뀌어도 공유 화면의 상태는 고쳐 둔 값을 지킨다.
    expect(sharedView(afterOwner).status).toBe('in-progress');
  });

  /*
    편집 화면은 제목·날짜·상태를 한 번에 제출한다. 받은 필드를 전부 override 로 남기면
    한 번 편집한 항목이 원본에서 통째로 떨어져 나간다 — 이 규칙이 그것을 막는다.
  */
  it('원본과 같은 값으로 제출한 필드는 override 가 되지 않는다', () => {
    const item = mirrored(task());
    const saved = applyOverrides(item, {
      title: '병원 전화하기',
      startDate: '2026-09-25', // 원본과 같다
      status: 'planned',       // 원본과 같다
      note: '',
      important: false,
      urgent: false,
    }, MEMBER);
    expect(overriddenFields(saved)).toEqual(['title']);

    const moved = withSource(saved, 'task-a', sourceOf(task({ startDate: '2026-10-01' })), OWNER);
    expect(sharedView(moved).startDate).toBe('2026-10-01');
  });

  it('원본과 같은 값으로 되돌려 적으면 그 필드는 다시 원본을 따라간다', () => {
    const edited = applyOverrides(mirrored(task()), { title: '병원 전화하기' }, MEMBER);
    const back = applyOverrides(edited, { title: '병원 예약' }, MEMBER);
    expect(overriddenFields(back)).toEqual([]);
  });

  it('색만 고쳐 두면 원본 색이 바뀌어도 고친 색을 지킨다', () => {
    const edited = applyOverrides(mirrored(task({ color: 'blue' })), { color: 'pink' }, MEMBER);
    expect(sharedView(edited).color).toBe('pink');

    const afterOwner = withSource(edited, 'task-a', sourceOf(task({ color: 'green' })), OWNER);
    expect(sharedView(afterOwner).color).toBe('pink');
    // 원본 쪽 값은 따라왔다 — 되돌리면 초록이 보인다.
    expect(afterOwner.source?.color).toBe('green');
    expect(sharedView(revertToSource(afterOwner)).color).toBe('green');
  });

  it('원본과 같은 색으로 고르면 override 가 되지 않는다', () => {
    const saved = applyOverrides(mirrored(task({ color: 'blue' })), { color: 'blue' }, MEMBER);
    expect(overriddenFields(saved)).toEqual([]);
  });

  it('기간 없음으로 고친 것과 고치지 않은 것은 다르다', () => {
    const withRange = mirrored(task({ endDate: '2026-09-28' }));
    expect(sharedView(withRange).endDate).toBe('2026-09-28');

    const cleared = applyOverrides(withRange, { endDate: null }, MEMBER);
    expect(sharedView(cleared).endDate).toBe(null);
    expect(overriddenFields(cleared)).toEqual(['endDate']);
  });
});

describe('원본대로 되돌리기', () => {
  it('override 를 지우면 원본 값이 보인다. 원본은 건드리지 않는다', () => {
    const entry = task();
    const edited = applyOverrides(mirrored(entry), { title: '병원 전화하기', status: 'done' }, MEMBER);
    expect(isOverridden(edited)).toBe(true);

    const reverted = revertToSource(edited);
    expect(reverted.overrides).toEqual({});
    expect(sharedView(reverted).title).toBe('병원 예약');
    expect(sharedView(reverted).status).toBe('planned');
    expect(entry.title).toBe('병원 예약');
  });

  it('고친 자리가 없으면 되돌릴 것도 없다', () => {
    expect(canRevert(mirrored(task()))).toBe(false);
  });

  it('공유 화면에서만 만든 항목에는 되돌릴 원본이 없다', () => {
    const local = newLocalItem('local-1', 'member-uid', { title: '토요일 같이 장보기' });
    expect(canRevert(local)).toBe(false);
    expect(revertToSource(local)).toBe(local);
  });
});

describe('공유 화면 전용 항목', () => {
  it('원본을 가리키지 않는다 — 개인 TODO 에는 만들어지지 않는다', () => {
    const local = newLocalItem('local-1', 'member-uid', {
      title: '토요일 같이 장보기', startDate: '2026-09-26',
    });
    expect(local.sourceEntryId).toBe(null);
    expect(local.source).toBe(null);
    expect(local.localOnly).toBe(true);
    expect(local.createdBy).toBe('member-uid');
    expect(sharedView(local).title).toBe('토요일 같이 장보기');
    // 원본이 없어도 색은 있다 — 달력에 그릴 값이 필요하다.
    expect(sharedView(local).color).toBe('blue');
  });

  it('값은 전부 자기 것이다 — 비교할 원본이 없어 override 가 지워지지 않는다', () => {
    const local = newLocalItem('local-1', 'member-uid', { title: '장보기', startDate: '2026-09-26' });
    const edited = applyOverrides(local, { title: '장보기', status: 'done' }, MEMBER);
    expect(sharedView(edited).title).toBe('장보기');
    expect(sharedView(edited).status).toBe('done');
  });

  it('공유 화면에서만 만든 항목은 "수정됨" 이 아니다', () => {
    const local = newLocalItem('local-1', 'member-uid', { title: '장보기' });
    expect(isOverridden(local)).toBe(false);
  });
});

/*
  양방향이라 "누가 무엇을 할 수 있는가" 가 항목마다 갈린다. 감추기는 사람별이고,
  수정은 보드 것이되 누가 고쳤는지가 남는다.
*/
describe('사람별 감추기', () => {
  it('내가 감춰도 상대 화면에서는 보인다', () => {
    const hidden = setHiddenFor(mirrored(task()), MEMBER, true);
    expect(isHiddenFor(hidden, MEMBER)).toBe(true);
    expect(isHiddenFor(hidden, OWNER)).toBe(false);
  });

  it('다시 보이게 하면 내 uid 만 빠진다', () => {
    const both = setHiddenFor(setHiddenFor(mirrored(task()), MEMBER, true), OWNER, true);
    const back = setHiddenFor(both, MEMBER, false);
    expect(back.hiddenBy).toEqual([OWNER]);
  });

  it('같은 상태로 다시 부르면 그대로 둔다', () => {
    const item = mirrored(task());
    expect(setHiddenFor(item, MEMBER, false)).toBe(item);
  });
});

describe('누가 고쳤는가', () => {
  it('고친 사람을 남긴다', () => {
    const edited = applyOverrides(mirrored(task()), { title: '병원 전화하기' }, MEMBER);
    expect(edited.overriddenBy).toBe(MEMBER);
  });

  it('고친 자리가 없어지면 고친 사람도 지운다', () => {
    const edited = applyOverrides(mirrored(task()), { title: '병원 전화하기' }, MEMBER);
    const back = applyOverrides(edited, { title: '병원 예약' }, OWNER);
    expect(back.overriddenBy).toBe('');
  });

  it('원본대로 되돌리면 고친 사람도 지운다', () => {
    const edited = applyOverrides(mirrored(task()), { title: '병원 전화하기' }, MEMBER);
    expect(revertToSource(edited).overriddenBy).toBe('');
  });
});

describe('표시', () => {
  it('제목이 비어 있어도 자리를 비워 두지 않는다', () => {
    expect(sharedTitle(newLocalItem('x', 'u', { title: '   ' }))).toBe('(제목 없음)');
  });

  it('날짜가 없는 항목은 목록 뒤로 보낸다', () => {
    const dated = mirrored(task());
    const undated = newLocalItem('x', 'u', { title: '언젠가' });
    expect(sharedSortKey(dated) < sharedSortKey(undated)).toBe(true);
  });

  it('계정 이름은 @ 앞만 쓴다', () => {
    expect(shortName('someone@example.com')).toBe('someone');
    expect(shortName('보리')).toBe('보리');
    expect(shortName('  ')).toBe('상대');
  });

  it('상대는 나 아닌 member 다', () => {
    const names = { me: 'me@example.com', you: 'you@example.com' };
    expect(partnerName(['me', 'you'], names, 'me')).toBe('you');
    expect(partnerName(['me'], names, 'me')).toBe(null);
  });
});

describe('초대 코드', () => {
  it('추측할 수 없는 길이여야 한다', () => {
    const a = newInviteCode();
    const b = newInviteCode();
    expect(a).toHaveLength(20);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z2-9]{20}$/);
  });

  it('링크는 앱 주소에 코드를 붙인다', () => {
    expect(inviteUrl('https://example.com', '/', 'abc')).toBe('https://example.com/?join=abc');
  });
});

/*
  일정은 **해야 할 것 / 완료** 두 덩이다. 상태를 더 잘게 쪼개지 않는다 — 둘이 함께 보는
  목록에서 '진행중' 은 각자의 머릿속에만 있는 값이라 누가 언제 옮기는지가 불분명해진다.
*/
describe('일정 묶기', () => {
  const local = (id: string, title: string, over: Record<string, unknown> = {}) =>
    newLocalItem(id, OWNER, { title, ...over });

  it('완료를 뒤로 보낸다', () => {
    const { todo, done } = scheduleGroups([
      local('a', '장보기', { status: 'done' }),
      local('b', '영화 예매'),
    ]);
    expect(todo.map((i) => i.id)).toEqual(['b']);
    expect(done.map((i) => i.id)).toEqual(['a']);
  });

  it('날짜가 있는 것이 먼저고, 없는 것은 뒤에 남는다', () => {
    const { todo } = scheduleGroups([
      local('none', '언젠가'),
      local('late', '다음 달', { startDate: '2026-10-05' }),
      local('soon', '내일', { startDate: '2026-09-24' }),
    ]);
    expect(todo.map((i) => i.id)).toEqual(['soon', 'late', 'none']);
  });

  it('진행중은 해야 할 것에 남는다', () => {
    const { todo } = scheduleGroups([local('a', '쓰는 중', { status: 'in-progress' })]);
    expect(todo).toHaveLength(1);
  });
});

/*
  함께 할 것은 **언젠가** 같이 하고 싶은 것이다. 날짜도 마감도 우선순위도 없다.
*/
describe('함께 할 것', () => {
  const list = newCollection('c1', OWNER, '갈 곳', 0, '2026-09-01T00:00:00.000Z');
  const item = (id: string, over: Partial<SharedCollectionItem> = {}): SharedCollectionItem => ({
    ...newCollectionItem(id, 'c1', OWNER, id, 0, '2026-09-01T00:00:00.000Z'),
    ...over,
  });

  it('목록 이름은 앞뒤 공백을 지운다', () => {
    expect(newCollection('c2', OWNER, '  게임  ', 0).title).toBe('게임');
  });

  it('완료를 켜면 시각이 남고, 되돌리면 지워진다', () => {
    const on = toggleCollectionItem(item('에버랜드'), '2026-09-23T10:00:00.000Z');
    expect(on.completed).toBe(true);
    expect(on.completedAt).toBe('2026-09-23T10:00:00.000Z');

    const off = toggleCollectionItem(on, '2026-09-23T11:00:00.000Z');
    expect(off.completed).toBe(false);
    // 완료가 아닌데 완료 시각이 남아 있으면 거짓이다.
    expect(off.completedAt).toBe(null);
  });

  it('진행을 n/m 으로 센다 — 다른 목록은 세지 않는다', () => {
    const items = [
      item('a', { completed: true }),
      item('b'),
      { ...item('c'), collectionId: 'other' },
    ];
    expect(collectionProgress(items, list.id)).toEqual({ done: 1, total: 2 });
  });

  it('완료한 것은 목록 아래로 내려간다', () => {
    const items = [item('a', { completed: true, order: 0 }), item('b', { order: 1 })];
    expect(itemsOfCollection(items, 'c1').map((i) => i.id)).toEqual(['b', 'a']);
  });

  /*
    일정으로 만들어도 **원래 항목은 완료하지 않는다.** 날짜를 잡은 것과 다녀온 것은
    다르다. 날짜도 비워 둔다 — 오늘로 메우면 오늘 해야 하는 일처럼 보인다.
  */
  it('일정으로 만들면 날짜 없는 공유 전용 항목이 된다', () => {
    const made = scheduleFromCollectionItem('s1', item('에버랜드'), MEMBER);
    expect(made.localOnly).toBe(true);
    expect(made.sourceEntryId).toBe(null);
    expect(made.createdBy).toBe(MEMBER);
    expect(sharedView(made).title).toBe('에버랜드');
    expect(sharedView(made).startDate).toBe('');
    expect(sharedView(made).status).toBe('planned');
  });
});

/*
  메모는 게시판처럼 쌓인다. **고정메모는 별도 시스템이 아니다** — 글 하나를 세울 뿐이다.
*/
describe('메모', () => {
  const note = (id: string, over: Partial<SharedNote> = {}): SharedNote => ({
    ...newNote(id, OWNER, '', `${id} 본문`, `2026-09-0${id.length}T00:00:00.000Z`),
    ...over,
  });

  it('제목이 없으면 본문 첫 줄을 제목 자리에 쓴다', () => {
    const n = newNote('n1', OWNER, '   ', '\n렌터카 확인\n호텔 체크인');
    expect(n.title).toBe(null);
    expect(noteTitle(n)).toBe('렌터카 확인');
  });

  it('요약은 줄바꿈을 가운뎃점으로 바꾼다', () => {
    const n = newNote('n1', OWNER, '준비물', '충전기\n보조배터리\n우산');
    expect(noteSummary(n)).toBe('충전기 · 보조배터리 · 우산');
  });

  it('고정글이 먼저고 그 다음은 최신 순이다', () => {
    const notes = [
      { ...note('a'), createdAt: '2026-09-01T00:00:00.000Z' },
      { ...note('b'), createdAt: '2026-09-05T00:00:00.000Z' },
      { ...note('c'), createdAt: '2026-09-03T00:00:00.000Z', pinned: true },
    ];
    expect(sortNotes(notes).map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });

  it('고정이 없으면 null 이다', () => {
    expect(pinnedNote([note('a'), note('b')])).toBe(null);
  });

  /*
    살아 있는 고정은 하나다. 여럿이면 보드 위 한 줄에 무엇을 적을지가 매번 애매해진다.
  */
  it('새로 고정하면 앞의 고정이 풀리고, 바뀐 글만 돌려준다', () => {
    const notes = [
      { ...note('a'), pinned: true },
      note('b'),
      note('c'),
    ];
    const changed = repinNotes(notes, 'b', true, 'NOW');
    expect(changed.map((n) => [n.id, n.pinned])).toEqual([['a', false], ['b', true]]);
    // 손대지 않은 글은 돌려주지 않는다 — 다시 쓰면 상대의 편집을 덮는다.
    expect(changed.some((n) => n.id === 'c')).toBe(false);
  });

  it('이미 그 상태면 아무것도 바꾸지 않는다', () => {
    const notes = [{ ...note('a'), pinned: true }];
    expect(repinNotes(notes, 'a', true)).toEqual([]);
  });

  it('고정을 풀면 그 글 하나만 바뀐다', () => {
    const notes = [{ ...note('a'), pinned: true }, note('b')];
    const changed = repinNotes(notes, 'a', false, 'NOW');
    expect(changed.map((n) => n.id)).toEqual(['a']);
    expect(changed[0]!.pinned).toBe(false);
  });
});
