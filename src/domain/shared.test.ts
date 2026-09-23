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
  applyOverrides, canRevert, isOverridden, isPastTask, isShareableTask, newLocalItem,
  overriddenFields, revertToSource, sameSource, setHidden, sharedSortKey,
  sharedTitle, sharedView, shortName, sourceOf, withSource, partnerName,
  newInviteCode, inviteUrl,
} from './shared';
import type { Entry, SharedTodoItem } from './types';

const OWNER = 'owner-uid';
const TODAY = '2026-09-23';

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
    expect(item.hidden).toBe(false);
    expect(item.overrides).toEqual({});
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
    const hidden = setHidden(applyOverrides(mirrored(task()), { title: '병원 전화하기' }), true);
    const next = withSource(hidden, 'task-a', sourceOf(task({ startDate: '2026-09-27' })), OWNER);
    expect(next.overrides.title).toBe('병원 전화하기');
    expect(next.hidden).toBe(true);
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

    const edited = applyOverrides(item, { title: '병원 전화하기' });

    expect(edited.overrides.title).toBe('병원 전화하기');
    // 원본 객체가 그대로여야 한다 — 이 방향으로는 아무것도 흐르지 않는다.
    expect(JSON.stringify(entry)).toBe(before);
    // source 도 원본에서 받은 값 그대로다.
    expect(edited.source?.title).toBe('병원 예약');
  });

  it('완료로 체크해도 원본 상태는 그대로다', () => {
    const entry = task();
    const item = mirrored(entry);
    const done = applyOverrides(item, { status: 'done' });

    expect(sharedView(done).status).toBe('done');
    expect(entry.task?.status).toBe('planned');
    expect(done.source?.status).toBe('planned');
  });

  it('감춰도 원본은 남는다', () => {
    const entry = task();
    const hidden = setHidden(mirrored(entry), true);
    expect(hidden.hidden).toBe(true);
    expect(hidden.source?.title).toBe('병원 예약');
    expect(entry.title).toBe('병원 예약');
  });
});

describe('고치지 않은 필드는 원본을 따라간다', () => {
  it('제목만 고친 뒤 원본 날짜가 바뀌면, 고친 제목 + 새 날짜다', () => {
    const edited = applyOverrides(mirrored(task()), { title: '병원 전화하기' });
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

    const overridden = applyOverrides(mirrored(task()), { status: 'in-progress' });
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
    });
    expect(overriddenFields(saved)).toEqual(['title']);

    const moved = withSource(saved, 'task-a', sourceOf(task({ startDate: '2026-10-01' })), OWNER);
    expect(sharedView(moved).startDate).toBe('2026-10-01');
  });

  it('원본과 같은 값으로 되돌려 적으면 그 필드는 다시 원본을 따라간다', () => {
    const edited = applyOverrides(mirrored(task()), { title: '병원 전화하기' });
    const back = applyOverrides(edited, { title: '병원 예약' });
    expect(overriddenFields(back)).toEqual([]);
  });

  it('색만 고쳐 두면 원본 색이 바뀌어도 고친 색을 지킨다', () => {
    const edited = applyOverrides(mirrored(task({ color: 'blue' })), { color: 'pink' });
    expect(sharedView(edited).color).toBe('pink');

    const afterOwner = withSource(edited, 'task-a', sourceOf(task({ color: 'green' })), OWNER);
    expect(sharedView(afterOwner).color).toBe('pink');
    // 원본 쪽 값은 따라왔다 — 되돌리면 초록이 보인다.
    expect(afterOwner.source?.color).toBe('green');
    expect(sharedView(revertToSource(afterOwner)).color).toBe('green');
  });

  it('원본과 같은 색으로 고르면 override 가 되지 않는다', () => {
    const saved = applyOverrides(mirrored(task({ color: 'blue' })), { color: 'blue' });
    expect(overriddenFields(saved)).toEqual([]);
  });

  it('기간 없음으로 고친 것과 고치지 않은 것은 다르다', () => {
    const withRange = mirrored(task({ endDate: '2026-09-28' }));
    expect(sharedView(withRange).endDate).toBe('2026-09-28');

    const cleared = applyOverrides(withRange, { endDate: null });
    expect(sharedView(cleared).endDate).toBe(null);
    expect(overriddenFields(cleared)).toEqual(['endDate']);
  });
});

describe('원본대로 되돌리기', () => {
  it('override 를 지우면 원본 값이 보인다. 원본은 건드리지 않는다', () => {
    const entry = task();
    const edited = applyOverrides(mirrored(entry), { title: '병원 전화하기', status: 'done' });
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
    const edited = applyOverrides(local, { title: '장보기', status: 'done' });
    expect(sharedView(edited).title).toBe('장보기');
    expect(sharedView(edited).status).toBe('done');
  });

  it('공유 화면에서만 만든 항목은 "수정됨" 이 아니다', () => {
    const local = newLocalItem('local-1', 'member-uid', { title: '장보기' });
    expect(isOverridden(local)).toBe(false);
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
