/**
 * 같이 보기 화면 — 사람이 누르는 순서대로 누른다.
 *
 * 도메인 함수만 보면 겹쳐 보기가 맞게 계산되는지까지는 알 수 있어도, 그 값이 실제로
 * 화면에 뜨는지 · 체크박스가 어느 방향으로 저장하는지 · '원본대로 되돌리기' 가 어떤
 * 자리에 있는지는 알 수 없다.
 *
 * 이 화면에는 `Entry` 를 다루는 콜백이 없다. 그것이 "공유 화면에서 고친 것은 원본에
 * 반영되지 않는다" 의 구조적 근거이므로, 저장 콜백이 넘겨받는 값이 항상
 * `SharedTodoItem` 임을 여기서 확인한다.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyOverrides, newLocalItem, sharedView, sourceOf, withSource } from '../domain/shared';
import { newEntry } from '../domain/entry';
import type { Entry, SharedBoard, SharedTodoItem } from '../domain/types';
import { SharedScreen } from './SharedScreen';

afterEach(cleanup);

const TODAY = '2026-09-23';
const OWNER = 'owner-uid';
const ME = 'member-uid';

const board: SharedBoard = {
  id: 'b1', ownerUid: OWNER, memberUids: [OWNER, ME],
  memberNames: { [OWNER]: 'owner@example.com', [ME]: 'member@example.com' },
  name: '우리', createdAt: '', updatedAt: '',
};

const task = (patch: Partial<Entry> = {}): Entry =>
  newEntry('task', { id: 'task-a', title: '병원 예약', startDate: '2026-09-25', ...patch });

/** 상대가 올린 항목. 내가 내릴 수 없고, 할 수 있는 것은 내 화면에서 접는 것뿐이다. */
const mirrored = (e: Entry): SharedTodoItem =>
  withSource(null, e.id, sourceOf(e), OWNER, '2026-09-01T00:00:00.000Z');

/** 내가 올린 항목. 보드에서 내릴 수 있다. */
const mine = (e: Entry): SharedTodoItem =>
  withSource(null, e.id, sourceOf(e), ME, '2026-09-01T00:00:00.000Z');

type P = Parameters<typeof SharedScreen>[0];

function mount(over: {
  items?: SharedTodoItem[];
  ddays?: P['ddays'];
  collections?: P['collections'];
  collectionItems?: P['collectionItems'];
  notes?: P['notes'];
  legacyMemo?: string;
  contentReady?: boolean;
  partner?: string | null;
  myUid?: string;
  board?: SharedBoard;
  /** 기본은 리스트다. 달력은 별도 describe 에서 따로 본다. */
  view?: 'calendar' | 'list';
  cursor?: Date;
  onSaveItem?: (i: SharedTodoItem) => void;
  onUnshareItem?: (i: SharedTodoItem) => void;
  onDeleteItem?: (i: SharedTodoItem) => void;
  onSaveDday?: P['onSaveDday'];
  onSaveCollection?: P['onSaveCollection'];
  onDeleteCollection?: P['onDeleteCollection'];
  onSaveCollectionItem?: P['onSaveCollectionItem'];
  onDeleteCollectionItem?: P['onDeleteCollectionItem'];
  onSaveNote?: P['onSaveNote'];
  onDeleteNote?: P['onDeleteNote'];
  onPinNote?: P['onPinNote'];
  onAdoptLegacyMemo?: () => void;
  onBack?: () => void;
  onViewChange?: (v: 'calendar' | 'list') => void;
  onCursorChange?: (d: Date) => void;
} = {}) {
  const props = {
    board: over.board ?? board,
    partner: over.partner === undefined ? 'owner' : over.partner,
    myUid: over.myUid ?? ME,
    items: over.items ?? [],
    ddays: over.ddays ?? [],
    collections: over.collections ?? [],
    collectionItems: over.collectionItems ?? [],
    notes: over.notes ?? [],
    legacyMemo: over.legacyMemo ?? '',
    contentReady: over.contentReady ?? true,
    todayISO: TODAY,
    // 테스트 항목이 2026-09 에 있으므로 커서도 그 달에 둔다.
    cursor: over.cursor ?? new Date(2026, 8, 1),
    onCursorChange: over.onCursorChange ?? vi.fn(),
    view: over.view ?? ('list' as const),
    onViewChange: over.onViewChange ?? vi.fn(),
    weekStart: 'mon' as const,
    onBack: over.onBack ?? vi.fn(),
    onOpenInvite: vi.fn(),
    onSaveItem: over.onSaveItem ?? vi.fn(),
    onUnshareItem: over.onUnshareItem ?? vi.fn(),
    onDeleteItem: over.onDeleteItem ?? vi.fn(),
    onSaveDday: over.onSaveDday ?? vi.fn(),
    onDeleteDday: vi.fn(),
    onSaveCollection: over.onSaveCollection ?? vi.fn(),
    onDeleteCollection: over.onDeleteCollection ?? vi.fn(),
    onSaveCollectionItem: over.onSaveCollectionItem ?? vi.fn(),
    onDeleteCollectionItem: over.onDeleteCollectionItem ?? vi.fn(),
    onSaveNote: over.onSaveNote ?? vi.fn(),
    onDeleteNote: over.onDeleteNote ?? vi.fn(),
    onPinNote: over.onPinNote ?? vi.fn(),
    onAdoptLegacyMemo: over.onAdoptLegacyMemo ?? vi.fn(),
  };
  render(<SharedScreen {...props} />);
  return props;
}

describe('돌아가기와 머리글', () => {
  it('내 TODO 로 돌아가는 길이 있다', () => {
    const props = mount();
    fireEvent.click(screen.getByRole('button', { name: '내 TODO' }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it('보드 이름과 상대를 함께 보여 준다', () => {
    mount();
    expect(screen.getByText('같이 보기 · 우리')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
  });

  it('아직 아무도 수락하지 않았으면 그 사실을 적는다', () => {
    mount({ board: { ...board, memberUids: [OWNER] }, partner: null, myUid: OWNER });
    expect(screen.getByText('아직 아무도 수락하지 않았습니다')).toBeInTheDocument();
  });

  it('아직 한 건도 못 받았으면 "없다" 고 말하지 않는다', () => {
    mount({ contentReady: false });
    expect(screen.getByText('불러오는 중입니다.')).toBeInTheDocument();
    expect(screen.queryByText(/같이 볼 TODO 가 없습니다/)).not.toBeInTheDocument();
  });
});

describe('목록', () => {
  it('원본에서 온 항목을 날짜별로 보여 준다', () => {
    mount({ items: [mirrored(task())] });
    expect(screen.getByText('병원 예약')).toBeInTheDocument();
    expect(screen.getByText(/25일/)).toBeInTheDocument();
  });

  /*
    "해야 할 것" 은 이번 달에만 있는 것이 아니다. 달로 자르면 다음 달 일정이 목록에서
    사라져, 달을 넘겨 보기 전까지는 남은 일이 없는 것처럼 보인다.
  */
  it('달로 자르지 않는다 — 다음 달 일정도 해야 할 것에 남는다', () => {
    mount({ items: [mirrored(task()), mirrored(task({ id: 'far', title: '먼 달', startDate: '2026-12-01' }))] });
    expect(screen.getByText('병원 예약')).toBeInTheDocument();
    expect(screen.getByText('먼 달')).toBeInTheDocument();
  });

  it('날짜가 없는 항목도 남는다 — 사라지면 못 찾는다', () => {
    mount({ items: [newLocalItem('u1', ME, { title: '언젠가 같이' })], cursor: new Date(2027, 0, 1) });
    expect(screen.getByText('언젠가 같이')).toBeInTheDocument();
    expect(screen.getByText('날짜 없음')).toBeInTheDocument();
  });

  /*
    완료는 접어 둔다. 남은 일 위에 끝낸 일이 쌓이면 목록으로 쓸 수 없다 —
    다만 개수는 적어서, 어디로 갔는지 찾을 수 있게 한다.
  */
  it('완료한 것은 접히고 개수로 남는다', () => {
    mount({ items: [applyOverrides(mirrored(task()), { status: 'done' }, ME)] });
    expect(screen.queryByText('병원 예약')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /완료 1/ }));
    expect(screen.getByText('병원 예약')).toBeInTheDocument();
  });

  it('공유 화면에서 고친 항목에 표시를 남긴다', () => {
    mount({ items: [applyOverrides(mirrored(task()), { title: '병원 전화하기' }, ME)] });
    expect(screen.getByText('병원 전화하기')).toBeInTheDocument();
    // 양방향이라 누가 고쳤는지가 남는다.
    expect(screen.getByText('내가 고침')).toBeInTheDocument();
  });

  it('공유 화면에서만 만든 항목은 그렇게 적는다', () => {
    mount({ items: [newLocalItem('local-1', ME, { title: '토요일 같이 장보기', startDate: TODAY })] });
    expect(screen.getByText('같이 보기 전용')).toBeInTheDocument();
    expect(screen.queryByText(/고침/)).not.toBeInTheDocument();
  });

  it('감춘 항목은 기본으로 보이지 않고, 눌러서 볼 수 있다', () => {
    const hidden = { ...mirrored(task()), hiddenBy: [ME] };
    mount({ items: [hidden] });
    expect(screen.queryByText('병원 예약')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '감춘 항목 1개 보기' }));
    expect(screen.getByText('병원 예약')).toBeInTheDocument();
    expect(screen.getByText('나에게만 감춤')).toBeInTheDocument();
  });

  /*
    체크박스는 상태 override 를 쓴다. 콜백이 받는 것은 `SharedTodoItem` 이고,
    그 안의 `source` 는 손대지 않은 그대로다 — 원본으로 흐를 값이 없다.
  */
  it('완료 체크는 override 만 바꾼다', () => {
    const onSaveItem = vi.fn();
    mount({ items: [mirrored(task())], onSaveItem });

    fireEvent.click(screen.getByRole('button', { name: '병원 예약 완료' }));

    expect(onSaveItem).toHaveBeenCalledTimes(1);
    const saved = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    expect(saved.overrides.status).toBe('done');
    expect(saved.source?.status).toBe('planned');
    expect(saved.source?.title).toBe('병원 예약');
  });

  /*
    원본 상태가 '예정' 이므로, 완료를 풀면 override 는 **지워진다** — 그 필드는 다시
    원본을 따라간다. 값을 남기면 그 뒤 원본의 상태 변경이 공유 화면에 영영 닿지 않는다.
  */
  it('다시 누르면 예정으로 돌아가고, 상태는 다시 원본을 따라간다', () => {
    const onSaveItem = vi.fn();
    const done = applyOverrides(mirrored(task()), { status: 'done' }, ME);
    mount({ items: [done], onSaveItem });

    // 완료한 항목은 접힌 자리에 있다.
    fireEvent.click(screen.getByRole('button', { name: /완료 1/ }));
    fireEvent.click(screen.getByRole('button', { name: '병원 예약 완료' }));
    const saved = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    expect(sharedView(saved).status).toBe('planned');
    expect('status' in saved.overrides).toBe(false);
  });
});

describe('항목 편집', () => {
  /*
    제목을 눌러서 연다. 체크박스도 제목을 접근성 이름으로 쓰고 있어 역할로 고르면
    둘이 걸린다 — 사람이 누르는 자리(제목 글자)를 그대로 누른다.
  */
  function open(title: string) {
    fireEvent.click(screen.getByText(title));
    return screen.getByRole('dialog', { name: '같이 보기 항목' });
  }

  it('원본을 고치지 않는다는 것을 편집 화면이 말한다', () => {
    mount({ items: [mine(task())] });
    const dialog = open('병원 예약');
    expect(within(dialog).getByText(/내 TODO 에 반영되지 않고/)).toBeInTheDocument();
  });

  it('상대가 올린 항목은 상대의 원본이라고 적는다', () => {
    mount({ items: [mirrored(task())] });
    const dialog = open('병원 예약');
    expect(within(dialog).getByText(/상대의 원본에 반영되지 않고/)).toBeInTheDocument();
  });

  it('색을 고르면 색만 override 가 된다', () => {
    const onSaveItem = vi.fn();
    mount({ items: [mirrored(task())], onSaveItem });
    const dialog = open('병원 예약');

    fireEvent.click(within(dialog).getByRole('button', { name: '핑크' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));

    const saved = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    expect(Object.keys(saved.overrides)).toEqual(['color']);
    expect(saved.overrides.color).toBe('pink');
    // 원본 색은 그대로다.
    expect(saved.source?.color).toBe('blue');
  });

  it('제목만 고치면 제목만 override 가 된다', () => {
    const onSaveItem = vi.fn();
    mount({ items: [mirrored(task())], onSaveItem });
    const dialog = open('병원 예약');

    fireEvent.change(within(dialog).getByPlaceholderText('제목'), { target: { value: '병원 전화하기' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));

    const saved = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    expect(Object.keys(saved.overrides)).toEqual(['title']);
    expect(saved.overrides.title).toBe('병원 전화하기');
  });

  it('제목이 비어 있으면 저장하지 않는다', () => {
    const onSaveItem = vi.fn();
    mount({ items: [mirrored(task())], onSaveItem });
    const dialog = open('병원 예약');

    fireEvent.change(within(dialog).getByPlaceholderText('제목'), { target: { value: '  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));

    expect(onSaveItem).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();
  });

  it('고친 자리가 있으면 원본대로 되돌릴 수 있다', () => {
    const onSaveItem = vi.fn();
    mount({ items: [applyOverrides(mirrored(task()), { title: '병원 전화하기' }, ME)], onSaveItem });
    const dialog = open('병원 전화하기');

    fireEvent.click(within(dialog).getByRole('button', { name: /원본대로 되돌리기/ }));

    const saved = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    expect(saved.overrides).toEqual({});
    expect(saved.source?.title).toBe('병원 예약');
  });

  it('고친 자리가 없으면 되돌리기를 주지 않는다', () => {
    mount({ items: [mirrored(task())] });
    const dialog = open('병원 예약');
    expect(within(dialog).queryByRole('button', { name: /원본대로 되돌리기/ })).not.toBeInTheDocument();
  });

  /*
    감추기로는 모자란 자리가 있다.

    상대에게 보이기 싫은 항목이 올라가 있을 때 필요한 것은 내 화면에서 접는 것이 아니라
    상대 화면에서 없애는 것이다. 그래서 내가 올린 항목의 자리에는 '공유에서 내리기' 가
    있어야 하고, 내릴 수 없는 남의 항목에만 감추기가 남는다.
  */
  it('내가 올린 항목은 감추기가 아니라 공유에서 내린다', () => {
    const onUnshareItem = vi.fn();
    const onSaveItem = vi.fn();
    const onDeleteItem = vi.fn();
    mount({ items: [mine(task())], onUnshareItem, onSaveItem, onDeleteItem });
    const dialog = open('병원 예약');

    expect(within(dialog).queryByRole('button', { name: /감추기/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /삭제/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /공유에서 내리기/ }));

    expect(onUnshareItem.mock.calls[0]![0].id).toBe('task-a');
    expect(onSaveItem).not.toHaveBeenCalled();
    expect(onDeleteItem).not.toHaveBeenCalled();
  });

  it('상대가 올린 항목은 삭제도 내리기도 못 하고 내 화면에서만 감춘다', () => {
    const onSaveItem = vi.fn();
    const onDeleteItem = vi.fn();
    const onUnshareItem = vi.fn();
    mount({ items: [mirrored(task())], onSaveItem, onDeleteItem, onUnshareItem });
    const dialog = open('병원 예약');

    expect(within(dialog).queryByRole('button', { name: /삭제/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /공유에서 내리기/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /내 화면에서만 감추기/ }));

    expect(onDeleteItem).not.toHaveBeenCalled();
    expect(onUnshareItem).not.toHaveBeenCalled();
    const saved = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    // 내 uid 만 들어간다 — 상대 화면은 그대로다.
    expect(saved.hiddenBy).toEqual([ME]);
    expect(saved.source?.title).toBe('병원 예약');
  });

  it('공유 화면에서만 만든 항목은 지울 수 있다', () => {
    const onDeleteItem = vi.fn();
    mount({ items: [newLocalItem('local-1', ME, { title: '장보기', startDate: TODAY })], onDeleteItem });
    const dialog = open('장보기');

    fireEvent.click(within(dialog).getByRole('button', { name: /삭제/ }));
    expect(onDeleteItem).toHaveBeenCalledTimes(1);
  });

  it('새 항목은 공유 화면 전용으로 만든다', () => {
    const onSaveItem = vi.fn();
    mount({ onSaveItem });

    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    const dialog = screen.getByRole('dialog', { name: '같이 보기 새 항목' });
    expect(within(dialog).getByText(/같이 보기에만 만들 항목/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByPlaceholderText('제목'), { target: { value: '토요일 같이 장보기' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));

    const saved = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    expect(saved.localOnly).toBe(true);
    expect(saved.sourceEntryId).toBe(null);
    expect(saved.source).toBe(null);
    expect(saved.createdBy).toBe(ME);
    expect(saved.overrides.title).toBe('토요일 같이 장보기');
    // 날짜는 비어 있어도 된다. '언제' 가 아직 없는 일도 해야 하는 일이다.
    expect(saved.overrides.startDate ?? '').toBe('');
    expect(saved.overrides.color).toBe('blue');
  });
});

/*
  이 앱은 캘린더다. 공유 화면만 리스트 하나로 두면 항목이 쌓이는 순간 못 쓰게 된다.
  달력은 `MonthCalendar` 를 그대로 쓰므로, 여기서 확인하는 것은 **넘기는 값**이다 —
  공유 항목이 그 달의 바로 뜨는가, 누르면 원래 항목으로 돌아오는가.
*/
describe('달력', () => {
  it('그 달의 항목을 달력에 그린다', () => {
    mount({ view: 'calendar', items: [mirrored(task())] });
    expect(screen.getByText('병원 예약')).toBeInTheDocument();
    // 요일 머리글이 있으면 월 그리드가 그려진 것이다.
    expect(screen.getByText('월')).toBeInTheDocument();
  });

  it('항목의 색으로 그린다 — 전부 같은 색이면 달력이 아니다', () => {
    mount({ view: 'calendar', items: [mirrored(task({ color: 'pink' }))] });
    const bar = screen.getByText('병원 예약').closest('[style]');
    expect(bar?.getAttribute('style')).toContain('#ec4899');
  });

  it('다른 달을 보고 있으면 그 항목은 달력에 없다', () => {
    mount({ view: 'calendar', items: [mirrored(task())], cursor: new Date(2026, 10, 1) });
    expect(screen.queryByText('병원 예약')).not.toBeInTheDocument();
  });

  it('항목을 누르면 편집 시트가 열린다', () => {
    mount({ view: 'calendar', items: [mirrored(task())] });
    fireEvent.click(screen.getByText('병원 예약'));
    expect(screen.getByRole('dialog', { name: '같이 보기 항목' })).toBeInTheDocument();
  });

  it('빈 날을 누르면 그 날짜로 새 항목을 만든다', () => {
    const onSaveItem = vi.fn();
    mount({ view: 'calendar', onSaveItem });

    fireEvent.click(screen.getByRole('button', { name: '2026-09-10 상세 보기' }));
    const dialog = screen.getByRole('dialog', { name: '같이 보기 새 항목' });
    fireEvent.change(within(dialog).getByPlaceholderText('제목'), { target: { value: '같이 저녁' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }));

    const saved = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    expect(saved.localOnly).toBe(true);
    expect(saved.overrides.startDate).toBe('2026-09-10');
  });

  it('달을 넘길 수 있다', () => {
    const onCursorChange = vi.fn();
    mount({ view: 'calendar', onCursorChange });
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    const next = onCursorChange.mock.calls[0]![0] as Date;
    expect(next.getMonth()).toBe(9);
  });

  it('리스트로 바꿀 수 있다', () => {
    const onViewChange = vi.fn();
    mount({ view: 'calendar', onViewChange });
    fireEvent.click(screen.getByRole('button', { name: /리스트/ }));
    expect(onViewChange).toHaveBeenCalledWith('list');
  });

  it('날짜가 없는 항목은 달력에 꽂지 않고, 몇 건인지 적는다', () => {
    mount({ view: 'calendar', items: [newLocalItem('u1', ME, { title: '언젠가 같이' })] });
    expect(screen.queryByText('언젠가 같이')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /날짜가 없는 항목 1건/ })).toBeInTheDocument();
  });
});

/*
  고정메모는 **별도 시스템이 아니다.** 메모 글 하나를 세우면 보드 위에 한 줄로 뜬다.
  그래서 이 자리의 시험은 '메모 탭에서 글을 쓰고 고정하는가' 다.
*/
describe('메모', () => {
  const openNotes = () => fireEvent.click(screen.getByRole('tab', { name: '메모' }));

  const note = (over: Partial<P['notes'][number]> = {}): P['notes'][number] => ({
    id: 'n1', title: '제주도 준비', body: '렌터카 확인\n호텔 체크인 15:00',
    pinned: false, authorUid: ME, createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '', ...over,
  });

  it('글을 쓰면 본문과 함께 저장한다', () => {
    const onSaveNote = vi.fn();
    mount({ onSaveNote });
    openNotes();

    fireEvent.click(screen.getByRole('button', { name: '글쓰기' }));
    fireEvent.change(screen.getByPlaceholderText('제목 (선택)'), { target: { value: '여행 전에 읽어줘' } });
    fireEvent.change(screen.getByRole('textbox', { name: '본문' }), {
      target: { value: '일정 너무 빡빡하게 안 잡았으면 좋겠어' },
    });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    const saved = onSaveNote.mock.calls[0]![0] as P['notes'][number];
    expect(saved.title).toBe('여행 전에 읽어줘');
    expect(saved.body).toBe('일정 너무 빡빡하게 안 잡았으면 좋겠어');
    expect(saved.pinned).toBe(false);
    expect(saved.authorUid).toBe(ME);
  });

  it('본문이 비면 글을 만들지 않는다', () => {
    const onSaveNote = vi.fn();
    mount({ onSaveNote });
    openNotes();
    fireEvent.click(screen.getByRole('button', { name: '글쓰기' }));
    fireEvent.change(screen.getByPlaceholderText('제목 (선택)'), { target: { value: '제목만' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSaveNote).not.toHaveBeenCalled();
  });

  it('제목이 없으면 본문 첫 줄을 제목 자리에 쓴다', () => {
    mount({ notes: [note({ title: null })] });
    openNotes();
    expect(screen.getByText('렌터카 확인')).toBeInTheDocument();
  });

  it('고정하면 보드 위에 한 줄로 뜬다', () => {
    mount({ notes: [note({ pinned: true })] });
    // 탭을 열지 않아도 보인다 — 보드 공통 자리다.
    expect(screen.getByText('제주도 준비')).toBeInTheDocument();
    expect(screen.getByText(/렌터카 확인 · 호텔 체크인 15:00/)).toBeInTheDocument();
  });

  it('고정 줄을 누르면 메모 탭이 열린다', () => {
    mount({ notes: [note({ pinned: true })] });
    fireEvent.click(screen.getByText('제주도 준비'));
    expect(screen.getByRole('tab', { name: '메모' })).toHaveAttribute('aria-selected', 'true');
  });

  it('고정을 누르면 그 글만 올린다', () => {
    const onPinNote = vi.fn();
    mount({ notes: [note()], onPinNote });
    openNotes();
    fireEvent.click(screen.getByRole('button', { name: '위에 고정' }));
    expect(onPinNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), true);
  });

  /*
    옛 고정메모는 조용히 옮기지 않는다. 사용자가 적은 글이 본인도 모르게 다른 자리로
    가면 안 되고, 두 곳에 같은 글이 남아도 어느 것이 진짜인지 알 수 없다.
  */
  it('옛 고정메모가 있으면 옮길 자리를 준다', () => {
    const onAdoptLegacyMemo = vi.fn();
    mount({ legacyMemo: '토요일 장보기', onAdoptLegacyMemo });
    openNotes();
    expect(screen.getByText('토요일 장보기')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '메모로 옮기기' }));
    expect(onAdoptLegacyMemo).toHaveBeenCalled();
  });
});

describe('D-Day', () => {
  const dday = (over: Partial<P['ddays'][number]> = {}) => ({
    id: 'd1', title: '우리 여행', date: '2026-10-16', order: 0,
    createdBy: ME, createdAt: '', updatedAt: '', ...over,
  });

  /** 관리는 보드 공통 줄을 눌러서 편다 — 자리를 상시로 쓰지 않는다. */
  const openPanel = () => fireEvent.click(screen.getByRole('button', { name: 'D-Day 관리' }));

  it('대표 한 건을 보드 위에 적고 남은 날을 센다', () => {
    mount({ ddays: [dday()] });
    expect(screen.getByText('D-23')).toBeInTheDocument();
    expect(screen.getByText('10월 16일')).toBeInTheDocument();
  });

  /*
    대표는 **앞으로 다가오는 것**이다. 지난 것을 위에 띄우면 보드가 늘 어제를 가리킨다.
  */
  it('대표는 다가오는 것으로 고른다', () => {
    mount({ ddays: [dday({ id: 'd2', title: '1주년', date: '2026-09-11' }), dday()] });
    expect(screen.getByText('우리 여행')).toBeInTheDocument();
    expect(screen.queryByText('1주년')).not.toBeInTheDocument();
  });

  it('오늘이면 D-Day, 지났으면 D+N', () => {
    mount({ ddays: [dday({ date: TODAY }), dday({ id: 'd2', title: '1주년', date: '2026-09-11' })] });
    expect(screen.getByText('D-Day')).toBeInTheDocument();
    openPanel();
    expect(screen.getByText('D+12')).toBeInTheDocument();
  });

  it('펼치면 두 건만 보이고 나머지는 접힌다', () => {
    mount({
      ddays: [
        dday({ id: 'd1', title: '여행' }),
        dday({ id: 'd2', title: '기념일' }),
        dday({ id: 'd3', title: '시험' }),
      ],
    });
    openPanel();
    expect(screen.queryByText('시험')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /1개 더 보기/ }));
    expect(screen.getByText('시험')).toBeInTheDocument();
  });

  it('제목과 날짜만 받아 저장한다', () => {
    const onSaveDday = vi.fn();
    mount({ onSaveDday });

    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /D-Day 추가/ }));
    fireEvent.change(screen.getByPlaceholderText('제목 (우리 여행)'), { target: { value: '우리 여행' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    const saved = onSaveDday.mock.calls[0]![0] as { title: string; date: string };
    expect(saved.title).toBe('우리 여행');
    // 기본 날짜는 prop 으로 받은 오늘이다. 시계를 직접 읽지 않는다.
    expect(saved.date).toBe(TODAY);
    // 'D-23' 같은 문자열은 저장하지 않는다.
    expect(Object.keys(saved).sort()).toEqual([
      'createdAt', 'createdBy', 'date', 'id', 'order', 'title', 'updatedAt',
    ]);
  });

  it('제목이 없으면 만들지 않는다', () => {
    const onSaveDday = vi.fn();
    mount({ onSaveDday });
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /D-Day 추가/ }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSaveDday).not.toHaveBeenCalled();
  });
});

/*
  둘 다 올린다. 초대받은 사람에게 "여기에 오는 것은 보낸 사람의 TODO 다" 라고 적으면
  거짓이 되고, 자기가 적은 것이 상대에게 보이는 줄 모르는 채로 쓰게 된다.
*/
describe('초대받은 사람의 화면', () => {
  it('둘 다 올린다고 적는다', () => {
    mount({ myUid: ME, partner: 'owner' });
    expect(screen.getByText(/두 사람이 적은 오늘 이후의 할 일/)).toBeInTheDocument();
  });

  it('상대가 고친 것은 상대 이름으로 적는다', () => {
    mount({
      myUid: ME,
      items: [applyOverrides(mirrored(task()), { title: '병원 전화하기' }, OWNER)],
    });
    expect(screen.getByText('owner가 고침')).toBeInTheDocument();
  });

  it('내가 감춘 것은 상대 화면에서 보인다', () => {
    // 같은 항목을 상대(OWNER) 눈으로 그린다 — hiddenBy 에 내 uid 만 들어 있다.
    mount({ myUid: OWNER, items: [{ ...mirrored(task()), hiddenBy: [ME] }] });
    expect(screen.getByText('병원 예약')).toBeInTheDocument();
    expect(screen.queryByText('나에게만 감춤')).not.toBeInTheDocument();
  });

  it('보드를 만든 사람과 같은 자리에서 같은 것을 한다', () => {
    // 상대에게도 달력·리스트·추가·설정이 그대로 있다. 읽기 전용 화면이 아니다.
    mount({ myUid: ME, items: [mirrored(task())] });
    expect(screen.getByRole('button', { name: '추가' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '공유 설정' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '병원 예약 완료' })).toBeInTheDocument();
  });
});

/*
  함께 할 것은 일정과 **다른 자리**다. 일정은 둘이 실제로 해야 하는 것이고, 여기는
  언젠가 같이 하고 싶은 것이다. 목록 이름을 미리 만들어 두지 않는다 — 칸에 맞는 것만
  적게 되고, 맞지 않는 것은 아예 안 적는다.
*/
describe('함께 할 것', () => {
  const openWish = () => fireEvent.click(screen.getByRole('tab', { name: '함께 할 것' }));

  const list = (over: Partial<P['collections'][number]> = {}): P['collections'][number] => ({
    id: 'c1', title: '갈 곳', order: 0, createdBy: ME, createdAt: '', updatedAt: '', ...over,
  });
  const wish = (over: Partial<P['collectionItems'][number]> = {}): P['collectionItems'][number] => ({
    id: 'i1', collectionId: 'c1', title: '에버랜드', completed: false, completedAt: null,
    order: 0, createdBy: ME, createdAt: '', updatedAt: '', ...over,
  });

  it('기본 목록을 만들어 두지 않는다', () => {
    mount();
    openWish();
    expect(screen.getByText('아직 목록이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByText('게임')).not.toBeInTheDocument();
  });

  it('목록을 만들면 이름 그대로 저장한다', () => {
    const onSaveCollection = vi.fn();
    mount({ onSaveCollection });
    openWish();

    fireEvent.click(screen.getByRole('button', { name: /목록 만들기/ }));
    fireEvent.change(screen.getByPlaceholderText('목록 이름 (갈 곳)'), { target: { value: '보고 싶은 것' } });
    fireEvent.click(screen.getByRole('button', { name: '만들기' }));

    expect(onSaveCollection.mock.calls[0]![0].title).toBe('보고 싶은 것');
  });

  it('진행을 n/m 으로 적는다', () => {
    mount({
      collections: [list()],
      collectionItems: [wish({ id: 'a', completed: true }), wish({ id: 'b', title: '제주도' })],
    });
    openWish();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('완료를 누르면 그 항목만 바뀐다', () => {
    const onSaveCollectionItem = vi.fn();
    mount({ collections: [list()], collectionItems: [wish()], onSaveCollectionItem });
    openWish();

    fireEvent.click(screen.getByRole('button', { name: '에버랜드 완료' }));
    const saved = onSaveCollectionItem.mock.calls[0]![0];
    expect(saved.completed).toBe(true);
    expect(saved.completedAt).not.toBe(null);
  });

  /*
    일정으로 만들어도 원래 항목은 **완료하지 않는다.** 날짜를 잡은 것과 다녀온 것은
    다르다. 만들어지는 것은 공유 화면 전용 일정이고 날짜는 비어 있다.
  */
  it('일정으로 만들면 공유 일정이 늘고 원래 항목은 그대로다', () => {
    const onSaveItem = vi.fn();
    const onSaveCollectionItem = vi.fn();
    mount({ collections: [list()], collectionItems: [wish()], onSaveItem, onSaveCollectionItem });
    openWish();

    fireEvent.click(screen.getByRole('button', { name: '에버랜드 일정으로 만들기' }));

    const made = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    expect(made.localOnly).toBe(true);
    expect(made.overrides.title).toBe('에버랜드');
    expect(made.overrides.startDate ?? '').toBe('');
    // 원래 항목은 완료되지 않는다.
    expect(onSaveCollectionItem).not.toHaveBeenCalled();
  });

  it('항목을 지우는 것과 목록을 지우는 것은 다른 길이다', () => {
    const onDeleteItem = vi.fn();
    const onDeleteCollection = vi.fn();
    mount({
      collections: [list()], collectionItems: [wish()],
      onDeleteCollectionItem: onDeleteItem, onDeleteCollection,
    });
    openWish();

    fireEvent.click(screen.getByRole('button', { name: '에버랜드 삭제' }));
    expect(onDeleteItem).toHaveBeenCalled();
    expect(onDeleteCollection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '갈 곳 목록 삭제' }));
    expect(onDeleteCollection).toHaveBeenCalled();
  });
});

/*
  탭은 정확히 셋이다. 일정과 TODO 를 나누지 않는다 — 공유 보드에서 "해야 하는 것" 은
  하나이고, 두 자리로 나누면 어디에 적어야 하는지가 매번 애매해진다.
*/
describe('2차 탭', () => {
  it('일정 · 함께 할 것 · 메모 셋뿐이다', () => {
    mount();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['일정', '함께 할 것', '메모']);
  });

  it('일정이 기본이다', () => {
    mount();
    expect(screen.getByRole('tab', { name: '일정' })).toHaveAttribute('aria-selected', 'true');
  });
});
