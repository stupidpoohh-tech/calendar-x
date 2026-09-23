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

const mirrored = (e: Entry): SharedTodoItem =>
  withSource(null, e.id, sourceOf(e), OWNER, '2026-09-01T00:00:00.000Z');

function mount(over: {
  items?: SharedTodoItem[];
  ddays?: Parameters<typeof SharedScreen>[0]['ddays'];
  memoText?: string;
  contentReady?: boolean;
  partner?: string | null;
  myUid?: string;
  board?: SharedBoard;
  /** 기본은 리스트다. 달력은 별도 describe 에서 따로 본다. */
  view?: 'calendar' | 'list';
  cursor?: Date;
  onSaveItem?: (i: SharedTodoItem) => void;
  onDeleteItem?: (i: SharedTodoItem) => void;
  onSaveMemo?: (t: string) => void;
  onSaveDday?: Parameters<typeof SharedScreen>[0]['onSaveDday'];
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
    memoText: over.memoText ?? '',
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
    onDeleteItem: over.onDeleteItem ?? vi.fn(),
    onSaveMemo: over.onSaveMemo ?? vi.fn(),
    onSaveDday: over.onSaveDday ?? vi.fn(),
    onDeleteDday: vi.fn(),
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

  it('보고 있는 달의 것만 그린다 — 리스트가 몇 백 줄이 되지 않는다', () => {
    mount({ items: [mirrored(task()), mirrored(task({ id: 'far', title: '먼 달', startDate: '2026-12-01' }))] });
    expect(screen.getByText('병원 예약')).toBeInTheDocument();
    expect(screen.queryByText('먼 달')).not.toBeInTheDocument();
  });

  it('날짜가 없는 항목은 어느 달에서도 남겨 둔다 — 사라지면 못 찾는다', () => {
    mount({ items: [newLocalItem('u1', ME, { title: '언젠가 같이' })], cursor: new Date(2027, 0, 1) });
    expect(screen.getByText('언젠가 같이')).toBeInTheDocument();
    expect(screen.getByText('날짜 미정')).toBeInTheDocument();
  });

  it('공유 화면에서 고친 항목에 표시를 남긴다', () => {
    mount({ items: [applyOverrides(mirrored(task()), { title: '병원 전화하기' })] });
    expect(screen.getByText('병원 전화하기')).toBeInTheDocument();
    expect(screen.getByText('공유 화면에서 수정됨')).toBeInTheDocument();
  });

  it('공유 화면에서만 만든 항목은 그렇게 적는다', () => {
    mount({ items: [newLocalItem('local-1', ME, { title: '토요일 같이 장보기', startDate: TODAY })] });
    expect(screen.getByText('같이 보기 전용')).toBeInTheDocument();
    expect(screen.queryByText('공유 화면에서 수정됨')).not.toBeInTheDocument();
  });

  it('감춘 항목은 기본으로 보이지 않고, 눌러서 볼 수 있다', () => {
    const hidden = { ...mirrored(task()), hidden: true };
    mount({ items: [hidden] });
    expect(screen.queryByText('병원 예약')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '감춘 항목 1개 보기' }));
    expect(screen.getByText('병원 예약')).toBeInTheDocument();
    expect(screen.getByText('감춤')).toBeInTheDocument();
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
    const done = applyOverrides(mirrored(task()), { status: 'done' });
    mount({ items: [done], onSaveItem });

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
    mount({ items: [mirrored(task())] });
    const dialog = open('병원 예약');
    expect(within(dialog).getByText(/내 TODO 에 반영되지 않고/)).toBeInTheDocument();
  });

  it('색을 고르면 색만 override 가 된다', () => {
    const onSaveItem = vi.fn();
    mount({ items: [mirrored(task())], onSaveItem });
    const dialog = open('병원 예약');

    fireEvent.click(within(dialog).getByRole('button', { name: '아이리스' }));
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
    mount({ items: [applyOverrides(mirrored(task()), { title: '병원 전화하기' })], onSaveItem });
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

  it('원본이 있는 항목은 삭제가 아니라 감추기다', () => {
    const onSaveItem = vi.fn();
    const onDeleteItem = vi.fn();
    mount({ items: [mirrored(task())], onSaveItem, onDeleteItem });
    const dialog = open('병원 예약');

    expect(within(dialog).queryByRole('button', { name: /삭제/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /같이 보기에서 감추기/ }));

    expect(onDeleteItem).not.toHaveBeenCalled();
    const saved = onSaveItem.mock.calls[0]![0] as SharedTodoItem;
    expect(saved.hidden).toBe(true);
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
    expect(saved.overrides.startDate).toBe(TODAY);
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
    expect(bar?.getAttribute('style')).toContain('#a06dac');
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

describe('고정메모', () => {
  it('없으면 추가하라고만 적는다', () => {
    mount();
    expect(screen.getByRole('button', { name: /고정메모 추가/ })).toBeInTheDocument();
  });

  it('적으면 본문을 저장한다', () => {
    const onSaveMemo = vi.fn();
    mount({ onSaveMemo });

    fireEvent.click(screen.getByRole('button', { name: /고정메모 추가/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '토요일 장보기\n영화 예매' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSaveMemo).toHaveBeenCalledWith('토요일 장보기\n영화 예매');
  });

  it('있으면 본문을 보여 주고 편집으로 고친다', () => {
    const onSaveMemo = vi.fn();
    mount({ memoText: '토요일 장보기', onSaveMemo });
    expect(screen.getByText('토요일 장보기')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '편집' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '영화 예매 확인' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSaveMemo).toHaveBeenCalledWith('영화 예매 확인');
  });

  it('바뀐 것이 없으면 저장하지 않는다', () => {
    const onSaveMemo = vi.fn();
    mount({ memoText: '토요일 장보기', onSaveMemo });
    fireEvent.click(screen.getByRole('button', { name: '편집' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSaveMemo).not.toHaveBeenCalled();
  });
});

describe('D-Day', () => {
  const dday = (over: Partial<Parameters<typeof SharedScreen>[0]['ddays'][number]> = {}) => ({
    id: 'd1', title: '우리 여행', date: '2026-10-16', order: 0,
    createdBy: ME, createdAt: '', updatedAt: '', ...over,
  });

  it('오늘 기준으로 남은 날을 센다', () => {
    mount({ ddays: [dday()] });
    expect(screen.getByText('D-23')).toBeInTheDocument();
    expect(screen.getByText('10월 16일')).toBeInTheDocument();
  });

  it('오늘이면 D-Day, 지났으면 D+N', () => {
    mount({ ddays: [dday({ date: TODAY }), dday({ id: 'd2', title: '1주년', date: '2026-09-11' })] });
    expect(screen.getByText('D-Day')).toBeInTheDocument();
    expect(screen.getByText('D+12')).toBeInTheDocument();
  });

  it('많으면 두 건만 보이고 나머지는 접힌다', () => {
    mount({
      ddays: [
        dday({ id: 'd1', title: '여행' }),
        dday({ id: 'd2', title: '기념일' }),
        dday({ id: 'd3', title: '시험' }),
      ],
    });
    expect(screen.queryByText('시험')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /1개 더 보기/ }));
    expect(screen.getByText('시험')).toBeInTheDocument();
  });

  it('제목과 날짜만 받아 저장한다', () => {
    const onSaveDday = vi.fn();
    mount({ onSaveDday });

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
    fireEvent.click(screen.getByRole('button', { name: /D-Day 추가/ }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(onSaveDday).not.toHaveBeenCalled();
  });
});
