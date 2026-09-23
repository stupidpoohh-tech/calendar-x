/**
 * 같이 보기 화면.
 *
 * ── 위계 ────────────────────────────────────────────────────────
 *
 *   ← 내 TODO
 *   같이 보기 · {보드}
 *   [D-Day]      ← 두 건까지. 나머지는 접힌다
 *   📌 고정메모   ← 한 건
 *   TODO         ← 이 화면의 본문. 달력이거나 리스트다
 *
 * D-Day 와 고정메모는 TODO 보다 부가 기능이라 자리를 크게 쓰지 않는다. 캘린더X 의
 * 조용한 톤을 그대로 쓰고, 공유 기능 때문에 화면을 새로 디자인하지 않는다.
 *
 * ── 달력이 기본이다 ─────────────────────────────────────────────
 *
 * 이 앱은 캘린더다. 공유 화면만 리스트 하나로 두면 항목이 쌓이는 순간 못 쓰게 된다 —
 * 230건을 세로로 늘어놓으면 이번 주에 무엇이 있는지 볼 수 없다. 달력·리스트 토글과
 * 달 이동을 개인 화면과 같은 모양으로 둔다.
 *
 * **달력은 `MonthCalendar` 를 그대로 쓴다.** 월 그리드 · 기간 바 · "항목을 숨기지
 * 않는다"(개수에 따라 바 높이를 압축) 가 전부 거기 있고, 공유용으로 하나 더 그리면
 * 두 달력이 서서히 달라진다. 공유 항목을 **화면용 `Entry`** 로 옮겨 넘긴다
 * (`asDisplayEntries`) — 저장 경로에 닿지 않는 표시 전용 값이다.
 *
 * ── 이 화면의 편집은 공유 자료만 바꾼다 ─────────────────────────
 *
 * 콜백은 전부 `SharedTodoItem` · `SharedDday` · 문자열을 받는다. 달력이 돌려주는
 * `Entry` 는 id 로 원래 항목을 되찾는 데만 쓰고, 그대로 저장하는 길은 없다.
 */
import { useMemo, useState } from 'react';
import { colorHex } from '../domain/constants';
import { fmtDayShort, fmtMonthTitle, ymOfDate } from '../domain/date';
import { uid as newId } from '../domain/entry';
import {
  applyOverrides, isHiddenFor, isOverridden, newLocalItem, setHiddenFor,
  sharedSortKey, sharedTitle, sharedView, shortName,
} from '../domain/shared';
import type {
  Entry, SharedBoard, SharedDday, SharedTodoItem, ViewId, WeekStart, YearMonth,
} from '../domain/types';
import { Icon } from './Icon';
import { MonthCalendar } from './MonthCalendar';
import { SharedDdayPanel } from './SharedDdayPanel';
import { SharedItemSheet } from './SharedItemSheet';
import { SharedMemo } from './SharedMemo';

interface Props {
  board: SharedBoard;
  partner: string | null;
  myUid: string;
  items: readonly SharedTodoItem[];
  ddays: readonly SharedDday[];
  memoText: string;
  contentReady: boolean;
  todayISO: string;
  /** 보고 있는 달. 개인 화면과 **같은 커서**라 돌아가도 그 달에 있다. */
  cursor: Date;
  onCursorChange: (next: Date) => void;
  view: ViewId;
  onViewChange: (next: ViewId) => void;
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
  onSaveMemo: (text: string) => void;
  onSaveDday: (d: SharedDday) => void;
  onDeleteDday: (d: SharedDday) => void;
}

interface Group { date: string; items: SharedTodoItem[] }

/** 달력은 금액을 그리지 않는다. 공유 자료에 돈이 오지 않으므로 빈 값을 넘긴다. */
const NO_MONTHS: YearMonth[] = [];
const NO_ACCOUNTS: [] = [];
const NO_ENTRIES: Entry[] = [];

export function SharedScreen({
  board, partner, myUid, items, ddays, memoText, contentReady, todayISO,
  cursor, onCursorChange, view, onViewChange, weekStart,
  onBack, onOpenInvite, onSaveItem, onUnshareItem, onDeleteItem,
  onSaveMemo, onSaveDday, onDeleteDday,
}: Props) {
  const [editing, setEditing] = useState<{ item: SharedTodoItem; mode: 'create' | 'edit' } | null>(null);
  const [showHidden, setShowHidden] = useState(false);

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
    리스트는 보고 있는 달만 그린다 — 개인 리스트와 같은 규칙이다. 다만 날짜가 없는
    항목은 어느 달에도 속하지 않으므로 늘 남겨 둔다. 달을 넘길 때마다 사라지면
    영영 못 찾는다.
  */
  const groups = useMemo<Group[]>(() => {
    const ym = ymOfDate(cursor);
    const inMonth = shown.filter((i) => {
      const v = sharedView(i);
      if (!v.startDate) return true;
      return v.startDate.startsWith(ym) || (v.endDate ?? v.startDate) >= `${ym}-01` && v.startDate <= `${ym}-31`;
    });
    const sorted = [...inMonth].sort((a, b) => sharedSortKey(a).localeCompare(sharedSortKey(b)));
    const map = new Map<string, SharedTodoItem[]>();
    for (const item of sorted) {
      const key = sharedView(item).startDate || '미정';
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()].map(([date, list]) => ({ date, items: list }));
  }, [shown, cursor]);

  /*
    상세를 열어 두는 동안에도 상대의 수정이 들어온다. 열었던 항목의 **id 로** 최신
    스냅샷을 다시 찾아 넘긴다 — 처음 받은 값을 들고 있으면 저장할 때 상대의 수정을
    덮는다. 항목이 사라졌으면 상세도 닫는다.
  */
  const editingNow = editing
    ? (editing.mode === 'create' ? editing.item : byId.get(editing.item.id) ?? null)
    : null;

  const startCreate = (dateISO = todayISO) => {
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
    const done = sharedView(item).status === 'done';
    // 상태도 override 다. 여기서 원본의 상태를 바꾸지 않는다.
    onSaveItem(applyOverrides(item, { status: done ? 'planned' : 'done' }, myUid));
  };

  return (
    <section className="sh" aria-label="같이 보기">
      <div className="sh-top">
        <button className="sh-back" onClick={onBack}>
          <Icon.Chevron size={14} dir="left" />내 TODO
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

      <SharedDdayPanel
        ddays={ddays}
        todayISO={todayISO}
        myUid={myUid}
        onSave={onSaveDday}
        onDelete={onDeleteDday}
      />

      <SharedMemo text={memoText} onSave={onSaveMemo} />

      {/* 달 이동과 보기 전환. 개인 화면의 도구줄과 같은 조각을 쓴다. */}
      <div className="toolbar sh-toolbar">
        <div className="tool-l">
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
          {contentReady && <span className="sh-n">{shown.length}</span>}
        </div>

        <div className="tool-r">
          <div className="seg">
            {(['calendar', 'list'] as ViewId[]).map((v) => (
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

      {/* 아직 한 건도 못 받았으면 "없다" 고 말하지 않는다. */}
      {!contentReady ? (
        <p className="sh-empty">불러오는 중입니다.</p>
      ) : view === 'calendar' ? (
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
      ) : groups.length === 0 ? (
        <div className="empty">
          <p className="empty-t">이 달에는 같이 볼 TODO 가 없습니다.</p>
          <p className="empty-s">
            두 사람이 적은 오늘 이후의 할 일이 여기에 따라옵니다.
            이 화면에서만 쓸 항목은 '추가' 로 만듭니다.
          </p>
        </div>
      ) : (
        <div className="lst sh-lst">
          {groups.map((g) => (
            <section className="lst-g" key={g.date}>
              <h3 className={'lst-gh' + (g.date === todayISO ? ' today' : '')}>
                {g.date === '미정' ? '날짜 미정' : fmtDayShort(g.date)}
                {g.date === todayISO && <span className="lst-today">오늘</span>}
              </h3>
              <ul className="lst-ul">
                {g.items.map((item) => {
                  const v = sharedView(item);
                  const done = v.status === 'done';
                  return (
                    <li key={item.id} className={'lst-row' + (isHiddenFor(item, myUid) ? ' sh-hidden' : '')}>
                      <div className="sh-row">
                        <button
                          className="tp-check"
                          aria-pressed={done}
                          aria-label={`${v.title || '(제목 없음)'} 완료`}
                          onClick={() => toggleStatus(item)}
                        >
                          {done && <Icon.Check size={11} />}
                        </button>
                        {/* 달력의 바와 같은 색. 두 화면에서 같은 항목이 같아 보여야 한다. */}
                        <span className="sh-row-bar" style={{ background: colorHex(v.color) }} />
                        <button className="sh-row-main" onClick={() => openItem(item.id)}>
                          <span className={'sh-row-t' + (done ? ' done' : '')}>
                            {sharedTitle(item)}
                            {v.recurring && <Icon.Repeat size={11} />}
                          </span>
                          <span className="sh-row-m">
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
                })}
              </ul>
            </section>
          ))}
        </div>
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
