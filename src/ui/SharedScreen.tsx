/**
 * 같이 보기 화면.
 *
 * ── 위계 ────────────────────────────────────────────────────────
 *
 *   캘린더 | 리스트 | 노트              ← 탭. **셸이 최상단에 그린다**
 *   👤   👥                             ← 공간
 *   ← 나                                같이 보기 · {보드}
 *   [대표 D-Day]  📌 고정된 노트        ← 보드 공통. 한 줄
 *                본문
 *
 * 탭 줄이 이 화면에 없는 이유는 **렌즈와 같은 자리를 쓰기 때문**이다. 두 공간이 탭을
 * 각각 다른 높이에 그리면 공간을 옮길 때마다 본문이 위아래로 튀고, 화면에 탭처럼
 * 생긴 줄이 둘이 된다.
 *
 * ── 세 탭이 각각 무엇인가 ───────────────────────────────────────
 *
 *   캘린더  둘이 **실제로 해야 하는 것.** 날짜가 있든 없든 여기 있다
 *   리스트  **언젠가** 같이 하고 싶은 것. 날짜도 마감도 없다
 *   노트    게시판처럼 쌓이는 글. 고정 노트도 이 중 하나다
 *
 * 해야 할 것을 두 탭으로 나누지 않는다. 공유 보드에서 "해야 하는 것" 은 하나이고,
 * 두 자리로 나누면 어디에 적어야 하는지가 매번 애매해진다.
 *
 * ── 캘린더 탭은 리스트가 기본, 달력도 남긴다 ────────────────────
 *
 * 둘이 보는 목록은 "지금 뭐가 남았나" 가 먼저라 리스트가 기본이다. 다만 이 앱은
 * 캘린더이고 날짜가 붙은 항목은 달력에서 봐야 읽히므로, 달력 보기를 토글로 남긴다.
 * **달력은 `MonthCalendar` 를 그대로 쓴다** — 월 그리드 · 기간 바 · "항목을 숨기지
 * 않는다" 가 전부 거기 있고, 공유용으로 하나 더 그리면 두 달력이 서서히 달라진다.
 *
 * ── 이 화면의 편집은 공유 자료만 바꾼다 ─────────────────────────
 *
 * 콜백은 전부 공유 타입을 받는다. 달력이 돌려주는 `Entry` 는 id 로 원래 항목을 되찾는
 * 데만 쓰고, 그대로 저장하는 길은 없다.
 */
import { useMemo, useState } from 'react';
import { colorHex } from '../domain/constants';
import { ddayCount, fmtDdayDate } from '../domain/dday';
import { fmtDayShort, fmtMonthTitle } from '../domain/date';
import { uid as newId } from '../domain/entry';
import {
  applyOverrides, isHiddenFor, isOverridden, newLocalItem, noteSummary, noteTitle,
  pinnedNote, scheduleGroups, setHiddenFor, sharedTitle, sharedView, shortName,
} from '../domain/shared';
import type {
  Entry, SharedBoard, SharedCollection, SharedCollectionItem, SharedDday, SharedNote,
  SharedTabId, SharedTodoItem, ViewId, WeekStart, YearMonth,
} from '../domain/types';
import { Icon } from './Icon';
import { MonthCalendar } from './MonthCalendar';
import { SharedCollections } from './SharedCollections';
import { SharedDdayPanel } from './SharedDdayPanel';
import { SharedItemSheet } from './SharedItemSheet';
import { SharedNotes } from './SharedNotes';

interface Props {
  board: SharedBoard;
  partner: string | null;
  myUid: string;
  items: readonly SharedTodoItem[];
  ddays: readonly SharedDday[];
  collections: readonly SharedCollection[];
  collectionItems: readonly SharedCollectionItem[];
  notes: readonly SharedNote[];
  /** 구조가 바뀌기 전의 고정메모. 남아 있으면 메모 탭이 옮길 자리를 준다. */
  legacyMemo: string;
  contentReady: boolean;
  todayISO: string;
  /** 보고 있는 달. 개인 화면과 **같은 커서**라 돌아가도 그 달에 있다. */
  cursor: Date;
  onCursorChange: (next: Date) => void;
  view: ViewId;
  onViewChange: (next: ViewId) => void;
  /**
   * 보고 있는 탭.
   *
   * **탭 줄은 이 화면에 없다.** 렌즈와 같은 자리(최상단 한 줄)를 쓰므로 셸이 그린다 —
   * 두 공간이 탭을 각각 다른 높이에 그리면 공간을 옮길 때마다 본문이 위아래로 튄다.
   * 여기서는 받은 값으로 무엇을 그릴지 고르고, 고정 노트 줄이 노트 탭으로 보낸다.
   */
  tab: SharedTabId;
  onTabChange: (next: SharedTabId) => void;
  weekStart: WeekStart;
  onBack: () => void;
  onOpenInvite: () => void;
  onSaveItem: (item: SharedTodoItem) => void;
  /**
   * 내가 올린 항목을 보드에서 내린다 (원본에 '나만 보기' 를 켜고 공유 항목을 지운다).
   *
   * 감추기와 다른 일이다 — 감추기는 내 화면에서만 접는 것이라 상대는 그대로 본다.
   * 상대에게 보이기 싫은 항목에 필요한 것은 이쪽이다.
   */
  onUnshareItem: (item: SharedTodoItem) => void;
  onDeleteItem: (item: SharedTodoItem) => void;
  onSaveDday: (d: SharedDday) => void;
  onDeleteDday: (d: SharedDday) => void;
  onSaveCollection: (c: SharedCollection) => void;
  onDeleteCollection: (c: SharedCollection) => void;
  onSaveCollectionItem: (i: SharedCollectionItem) => void;
  onDeleteCollectionItem: (i: SharedCollectionItem) => void;
  onSaveNote: (n: SharedNote) => void;
  onDeleteNote: (n: SharedNote) => void;
  /** 고정을 옮긴다. 살아 있는 고정은 하나라 앞의 것이 함께 풀린다. */
  onPinNote: (n: SharedNote, pinned: boolean) => void;
  /** 옛 고정메모를 메모 글로 옮긴다. */
  onAdoptLegacyMemo: () => void;
}

/** 달력은 금액을 그리지 않는다. 공유 자료에 돈이 오지 않으므로 빈 값을 넘긴다. */
const NO_MONTHS: YearMonth[] = [];
const NO_ACCOUNTS: [] = [];
const NO_ENTRIES: Entry[] = [];

export function SharedScreen({
  board, partner, myUid, items, ddays, collections, collectionItems, notes, legacyMemo,
  contentReady, todayISO, cursor, onCursorChange, view, onViewChange, tab, onTabChange, weekStart,
  onBack, onOpenInvite, onSaveItem, onUnshareItem, onDeleteItem,
  onSaveDday, onDeleteDday,
  onSaveCollection, onDeleteCollection, onSaveCollectionItem, onDeleteCollectionItem,
  onSaveNote, onDeleteNote, onPinNote, onAdoptLegacyMemo,
}: Props) {
  const [editing, setEditing] = useState<{ item: SharedTodoItem; mode: 'create' | 'edit' } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showDdays, setShowDdays] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // 감추기는 사람별이다. 내가 감춘 것만 내 화면에서 빠진다.
  const hiddenCount = items.filter((i) => isHiddenFor(i, myUid)).length;
  const shown = useMemo(
    () => items.filter((i) => showHidden || !isHiddenFor(i, myUid)),
    [items, showHidden, myUid],
  );

  /** 고친 사람을 이름으로. 모르면 이름 없이 "고침" 만 적는다. */
  const editorName = (uid: string): string =>
    (uid === myUid ? '내가' : `${shortName(board.memberNames[uid] ?? '')}가`);

  /** 달력이 돌려준 `Entry` 로 원래 항목을 되찾는다. id 가 같다. */
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const displayEntries = useMemo(() => asDisplayEntries(shown), [shown]);
  /*
    날짜가 없는 항목은 달력에 놓을 자리가 없다. 아무 날에나 꽂지 않고 빼되, 몇 건이
    빠졌는지는 적는다 — 조용히 사라지면 리스트로 바꾸기 전까지 찾을 수 없다.
  */
  const undated = useMemo(() => shown.filter((i) => !sharedView(i).startDate), [shown]);

  /*
    리스트는 달로 자르지 않는다.

    "해야 할 것" 은 이번 달에만 있는 것이 아니다. 달로 자르면 다음 달 일정이 목록에서
    사라져, 달을 넘겨 보기 전까지는 남은 일이 없는 것처럼 보인다. 달 이동은 달력
    보기의 도구이므로 그쪽에서만 쓴다.
  */
  const { todo, done } = useMemo(() => scheduleGroups(shown), [shown]);

  /** 보드 위 한 줄에 띄울 것들. 앞으로 다가오는 D-Day 하나와 고정된 글 하나. */
  const leadDday = useMemo(() => {
    const dated = ddays.filter((d) => d.date);
    return dated.find((d) => d.date >= todayISO) ?? dated[0] ?? null;
  }, [ddays, todayISO]);
  const pinned = useMemo(() => pinnedNote(notes), [notes]);

  /*
    상세를 열어 두는 동안에도 상대의 수정이 들어온다. 열었던 항목의 **id 로** 최신
    스냅샷을 다시 찾아 넘긴다 — 처음 받은 값을 들고 있으면 저장할 때 상대의 수정을
    덮는다. 항목이 사라졌으면 상세도 닫는다.
  */
  const editingNow = editing
    ? (editing.mode === 'create' ? editing.item : byId.get(editing.item.id) ?? null)
    : null;

  /** 날짜는 **비어 있어도 된다.** '언제' 가 아직 없는 일도 해야 하는 일이다. */
  const startCreate = (dateISO = '') => {
    setEditing({
      mode: 'create',
      item: newLocalItem(newId(), myUid, { title: '', startDate: dateISO }),
    });
  };

  const openItem = (id: string) => {
    const item = byId.get(id);
    if (item) setEditing({ item, mode: 'edit' });
  };

  const toggleStatus = (item: SharedTodoItem) => {
    const isDone = sharedView(item).status === 'done';
    // 상태도 override 다. 여기서 원본의 상태를 바꾸지 않는다.
    onSaveItem(applyOverrides(item, { status: isDone ? 'planned' : 'done' }, myUid));
  };

  const row = (item: SharedTodoItem) => {
    const v = sharedView(item);
    const isDone = v.status === 'done';
    return (
      <li key={item.id} className={'lst-row' + (isHiddenFor(item, myUid) ? ' sh-hidden' : '')}>
        <div className="sh-row">
          <button
            className="tp-check"
            aria-pressed={isDone}
            aria-label={`${v.title || '(제목 없음)'} 완료`}
            onClick={() => toggleStatus(item)}
          >
            {isDone && <Icon.Check size={11} />}
          </button>
          {/* 달력의 바와 같은 색. 두 화면에서 같은 항목이 같아 보여야 한다. */}
          <span className="sh-row-bar" style={{ background: colorHex(v.color) }} />
          <button className="sh-row-main" onClick={() => openItem(item.id)}>
            <span className={'sh-row-t' + (isDone ? ' done' : '')}>
              {sharedTitle(item)}
              {v.recurring && <Icon.Repeat size={11} />}
            </span>
            <span className="sh-row-m">
              <span className="sh-when">
                {v.startDate
                  ? (v.startDate === todayISO ? '오늘' : fmtDayShort(v.startDate))
                  : '날짜 없음'}
              </span>
              {v.startTime && <span>{v.startTime}</span>}
              {item.localOnly && <span className="sh-tag local">같이 보기 전용</span>}
              {/* 양방향이라 "수정됨" 만으로는 누가 고쳤는지 알 수 없다. */}
              {isOverridden(item) && (
                <span className="sh-tag">
                  {item.overriddenBy ? `${editorName(item.overriddenBy)} 고침` : '공유 화면에서 수정됨'}
                </span>
              )}
              {isHiddenFor(item, myUid) && <span className="sh-tag">나에게만 감춤</span>}
              {v.important && <Icon.Star size={11} />}
              {v.urgent && <Icon.Flame size={11} />}
            </span>
          </button>
        </div>
      </li>
    );
  };

  return (
    <section className="sh" aria-label="같이 보기">
      <div className="sh-top">
        <button className="sh-back" onClick={onBack}>
          <Icon.Chevron size={14} dir="left" />나
        </button>
        <div className="sh-who">
          <Icon.Users size={13} />
          <span className="sh-name">같이 보기 · {board.name}</span>
          {partner
            ? <span className="sh-partner">{partner}</span>
            : <span className="sh-partner pending">아직 아무도 수락하지 않았습니다</span>}
        </div>
        <button className="ico-btn sm" onClick={onOpenInvite} aria-label="공유 설정">
          <Icon.Settings size={15} />
        </button>
      </div>

      {/*
        보드 공통. 어느 탭에서나 보이지만 **한 줄을 넘지 않는다** — 본문이 밀리면
        무엇을 하는 화면인지가 흐려진다. 관리는 눌러서 펼친다.
      */}
      <div className="sh-common">
        <button
          className={'sh-dd' + (showDdays ? ' on' : '')}
          onClick={() => setShowDdays((v) => !v)}
          aria-expanded={showDdays}
          aria-label="D-Day 관리"
        >
          {leadDday ? (
            <>
              <span className="sh-dd-t">{leadDday.title || '(제목 없음)'}</span>
              <span className="sh-dd-n">{ddayCount(leadDday.date, todayISO).label}</span>
              <span className="sh-dd-d">{fmtDdayDate(leadDday.date, todayISO)}</span>
            </>
          ) : (
            <><Icon.Plus size={12} />D-Day</>
          )}
        </button>

        {pinned && (
          <button className="sh-pinned" onClick={() => onTabChange('notes')}>
            <Icon.Pin size={12} />
            <b>{noteTitle(pinned)}</b>
            <span>{noteSummary(pinned)}</span>
          </button>
        )}
      </div>

      {showDdays && (
        <SharedDdayPanel
          ddays={ddays}
          todayISO={todayISO}
          myUid={myUid}
          onSave={onSaveDday}
          onDelete={onDeleteDday}
        />
      )}

      {/* 아직 한 건도 못 받았으면 "없다" 고 말하지 않는다. */}
      {!contentReady ? (
        <p className="sh-empty">불러오는 중입니다.</p>
      ) : tab === 'list' ? (
        <SharedCollections
          myUid={myUid}
          collections={collections}
          items={collectionItems}
          onSaveCollection={onSaveCollection}
          onDeleteCollection={onDeleteCollection}
          onSaveItem={onSaveCollectionItem}
          onDeleteItem={onDeleteCollectionItem}
          onPromote={(i) => onSaveItem(
            newLocalItem(newId(), myUid, { title: i.title.trim(), status: 'planned' }),
          )}
        />
      ) : tab === 'notes' ? (
        <SharedNotes
          myUid={myUid}
          memberNames={board.memberNames}
          notes={notes}
          onSave={onSaveNote}
          onDelete={onDeleteNote}
          onPin={onPinNote}
          legacyMemo={legacyMemo}
          onAdoptLegacyMemo={onAdoptLegacyMemo}
        />
      ) : (
        <>
          <div className="toolbar sh-toolbar">
            <div className="tool-l">
              {/* 달 이동은 달력의 도구다. 리스트는 달로 자르지 않으므로 띄우지 않는다. */}
              {view === 'calendar' ? (
                <>
                  <button className="ico-btn sm" aria-label="이전 달"
                    onClick={() => onCursorChange(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
                    <Icon.Chevron size={16} dir="left" />
                  </button>
                  <span className="sh-month">{fmtMonthTitle(cursor)}</span>
                  <button className="ico-btn sm" aria-label="다음 달"
                    onClick={() => onCursorChange(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
                    <Icon.Chevron size={16} />
                  </button>
                  <button className="today-btn" onClick={() => onCursorChange(new Date())}>오늘</button>
                </>
              ) : (
                <span className="sh-month">해야 할 것 {todo.length.toLocaleString('ko-KR')}</span>
              )}
            </div>

            <div className="tool-r">
              <div className="seg">
                {(['list', 'calendar'] as ViewId[]).map((v) => (
                  <button
                    key={v}
                    className={'seg-btn' + (view === v ? ' on' : '')}
                    onClick={() => onViewChange(v)}
                    aria-pressed={view === v}
                  >
                    {v === 'calendar' ? <Icon.Calendar size={14} /> : <Icon.List size={14} />}
                    <span className="lbl">{v === 'calendar' ? '캘린더' : '리스트'}</span>
                  </button>
                ))}
              </div>
              {hiddenCount > 0 && (
                <button
                  className={'ico-btn' + (showHidden ? ' on' : '')}
                  onClick={() => setShowHidden((s) => !s)}
                  aria-label={showHidden ? '감춘 항목 숨기기' : `감춘 항목 ${hiddenCount}개 보기`}
                  aria-pressed={showHidden}
                >
                  <Icon.EyeOff size={15} />
                </button>
              )}
              <button className="add-btn" onClick={() => startCreate()}>
                <Icon.Plus size={16} /><span className="lbl">추가</span>
              </button>
            </div>
          </div>

          {view === 'calendar' ? (
            <>
              <MonthCalendar
                cursor={cursor}
                onCursorChange={onCursorChange}
                entries={displayEntries}
                // 공유 자료에 돈은 오지 않는다. 한도 줄이 뜰 조건을 아예 만들지 않는다.
                tideEntries={NO_ENTRIES}
                tideMonths={NO_MONTHS}
                accounts={NO_ACCOUNTS}
                hasBalance={false}
                lens="task"
                weekStart={weekStart}
                todayISO={todayISO}
                onEntryClick={(e) => openItem(e.id)}
                // 빈 자리를 누르면 그 날짜로 새 항목을 만든다. 만드는 것은 시트라
                // 잘못 눌러도 저장되지 않는다.
                onDayOpen={startCreate}
                onDayCreate={startCreate}
              />
              {undated.length > 0 && (
                <button className="sh-undated" onClick={() => onViewChange('list')}>
                  날짜가 없는 항목 {undated.length.toLocaleString('ko-KR')}건 — 리스트에서 봅니다
                </button>
              )}
            </>
          ) : todo.length === 0 && done.length === 0 ? (
            <div className="empty">
              <p className="empty-t">아직 같이 볼 일정이 없습니다.</p>
              <p className="empty-s">
                두 사람이 적은 오늘 이후의 할 일이 여기에 따라옵니다.
                이 화면에서만 쓸 일정은 '추가' 로 만들고, 날짜는 없어도 됩니다.
              </p>
            </div>
          ) : (
            <div className="lst sh-lst">
              <section className="lst-g">
                <h3 className="lst-gh">해야 할 것</h3>
                <ul className="lst-ul">{todo.map(row)}</ul>
              </section>

              {done.length > 0 && (
                <section className="lst-g">
                  <button className="sh-done-h" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                    <Icon.Chevron size={13} dir={showDone ? 'down' : 'right'} />
                    완료 {done.length.toLocaleString('ko-KR')}
                  </button>
                  {showDone && <ul className="lst-ul">{done.map(row)}</ul>}
                </section>
              )}
            </div>
          )}
        </>
      )}

      {editingNow && (
        <SharedItemSheet
          // 항목이 바뀌면 조각을 새로 만든다 — 입력칸이 새 값으로 채워진다.
          key={editingNow.id}
          item={editingNow}
          myUid={myUid}
          hiddenForMe={isHiddenFor(editingNow, myUid)}
          mode={editing?.mode ?? 'edit'}
          onSave={(next) => { onSaveItem(next); setEditing(null); }}
          onUnshare={(item) => { onUnshareItem(item); setEditing(null); }}
          onHide={(item) => {
            onSaveItem(setHiddenFor(item, myUid, !isHiddenFor(item, myUid)));
            setEditing(null);
          }}
          onDelete={(item) => { onDeleteItem(item); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/**
 * 공유 항목을 달력이 그릴 수 있는 **화면용** `Entry` 로 옮긴다.
 *
 * 저장하지 않는다. `MonthCalendar` 는 `Entry` 의 날짜·제목·상태만 보고 그리므로,
 * 표시에 필요한 만큼만 채우고 나머지는 빈 값이다. 돌아오는 길은 `onEntryClick` 의
 * id 하나뿐이고, 그 id 로 진짜 `SharedTodoItem` 을 찾아 연다.
 *
 * `virtual` 은 **세우지 않는다.** 그 표식은 "반복을 펼친 사본" 이라는 뜻이고 tide 가
 * 그것을 보고 계산을 거절하는데, 이 값들은 애초에 tide 로 가지 않는다. 뜻이 다른
 * 표식을 빌려 쓰면 다음 사람이 그 표식을 잘못 읽는다.
 *
 * 반복 항목은 발생분으로 펼치지 않는다 — 원본 한 건에 표식만 붙는다
 * (`recurrence` 는 null 이라 달력이 전개하지도 않는다).
 */
function asDisplayEntries(items: readonly SharedTodoItem[]): Entry[] {
  const out: Entry[] = [];
  for (const item of items) {
    const v = sharedView(item);
    // 날짜가 없으면 달력에 놓을 자리가 없다. 아무 날에나 꽂지 않는다.
    if (!v.startDate) continue;
    out.push({
      id: item.id,
      kind: 'task',
      title: v.title,
      note: v.note,
      color: v.color,
      tags: [],
      location: '',
      startDate: v.startDate,
      startTime: v.startTime,
      endDate: v.endDate,
      endTime: null,
      recurrence: null,
      ymSpan: [],
      isRecurring: v.recurring,
      task: { status: v.status, important: v.important, urgent: v.urgent, order: 0 },
      money: null,
      recovery: null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }
  return out;
}
