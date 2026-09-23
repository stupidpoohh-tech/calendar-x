/**
 * 같이 보기 화면.
 *
 * ── 위계 ────────────────────────────────────────────────────────
 *
 *   ← 내 TODO
 *   같이 보기 · {보드}
 *   [D-Day]      ← 두 건까지. 나머지는 접힌다
 *   📌 고정메모   ← 한 건
 *   TODO         ← 이 화면의 본문
 *
 * D-Day 와 고정메모는 TODO 보다 부가 기능이라 자리를 크게 쓰지 않는다. 캘린더X 의
 * 조용한 톤을 그대로 쓰고, 공유 기능 때문에 화면을 새로 디자인하지 않는다.
 *
 * ── 이 화면의 편집은 공유 자료만 바꾼다 ─────────────────────────
 *
 * 콜백은 전부 `SharedTodoItem` · `SharedDday` · 문자열을 받는다. `Entry` 를 다루는
 * 함수가 props 에 없으므로, 여기서 개인 TODO 를 고칠 방법이 없다.
 */
import { useMemo, useState } from 'react';
import { fmtDayShort } from '../domain/date';
import { uid as newId } from '../domain/entry';
import {
  applyOverrides, isOverridden, newLocalItem, setHidden, sharedSortKey, sharedTitle, sharedView,
} from '../domain/shared';
import type { SharedBoard, SharedDday, SharedTodoItem } from '../domain/types';
import { Icon } from './Icon';
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
  onBack: () => void;
  onOpenInvite: () => void;
  onSaveItem: (item: SharedTodoItem) => void;
  onDeleteItem: (item: SharedTodoItem) => void;
  onSaveMemo: (text: string) => void;
  onSaveDday: (d: SharedDday) => void;
  onDeleteDday: (d: SharedDday) => void;
}

interface Group { date: string; items: SharedTodoItem[] }

export function SharedScreen({
  board, partner, myUid, items, ddays, memoText, contentReady, todayISO,
  onBack, onOpenInvite, onSaveItem, onDeleteItem, onSaveMemo, onSaveDday, onDeleteDday,
}: Props) {
  const [editing, setEditing] = useState<{ item: SharedTodoItem; mode: 'create' | 'edit' } | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const hiddenCount = items.filter((i) => i.hidden).length;

  const groups = useMemo<Group[]>(() => {
    const shown = items.filter((i) => showHidden || !i.hidden);
    const sorted = [...shown].sort((a, b) => sharedSortKey(a).localeCompare(sharedSortKey(b)));
    const map = new Map<string, SharedTodoItem[]>();
    for (const item of sorted) {
      const key = sharedView(item).startDate || '미정';
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()].map(([date, list]) => ({ date, items: list }));
  }, [items, showHidden]);

  /*
    상세를 열어 두는 동안에도 상대의 수정이 들어온다. 열었던 항목의 **id 로** 최신
    스냅샷을 다시 찾아 넘긴다 — 처음 받은 값을 들고 있으면 저장할 때 상대의 수정을
    덮는다. 항목이 사라졌으면 상세도 닫는다.
  */
  const editingNow = editing
    ? (editing.mode === 'create'
        ? editing.item
        : items.find((i) => i.id === editing.item.id) ?? null)
    : null;

  const startCreate = () => {
    setEditing({
      mode: 'create',
      item: newLocalItem(newId(), myUid, { title: '', startDate: todayISO }),
    });
  };

  const toggleStatus = (item: SharedTodoItem) => {
    const done = sharedView(item).status === 'done';
    // 상태도 override 다. 여기서 원본의 상태를 바꾸지 않는다.
    onSaveItem(applyOverrides(item, { status: done ? 'planned' : 'done' }));
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

      <div className="sh-listh">
        <h2 className="sh-listt">TODO</h2>
        {contentReady && <span className="sh-n">{groups.reduce((n, g) => n + g.items.length, 0)}</span>}
        <div className="spacer" />
        {hiddenCount > 0 && (
          <button className="sh-ghost" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? '감춘 항목 숨기기' : `감춘 항목 ${hiddenCount.toLocaleString('ko-KR')}개 보기`}
          </button>
        )}
        <button className="add-btn sm" onClick={startCreate}>
          <Icon.Plus size={14} /><span className="lbl">추가</span>
        </button>
      </div>

      {/* 아직 한 건도 못 받았으면 "없다" 고 말하지 않는다. */}
      {!contentReady ? (
        <p className="sh-empty">불러오는 중입니다.</p>
      ) : groups.length === 0 ? (
        <div className="empty">
          <p className="empty-t">같이 볼 TODO 가 아직 없습니다.</p>
          <p className="empty-s">내 TODO 에 적은 할 일이 여기에 따라옵니다. 이 화면에서만 쓸 항목은 '추가' 로 만듭니다.</p>
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
                    <li key={item.id} className={'lst-row' + (item.hidden ? ' sh-hidden' : '')}>
                      <div className="sh-row">
                        <button
                          className="tp-check"
                          aria-pressed={done}
                          aria-label={`${v.title || '(제목 없음)'} 완료`}
                          onClick={() => toggleStatus(item)}
                        >
                          {done && <Icon.Check size={11} />}
                        </button>
                        <button className="sh-row-main" onClick={() => setEditing({ item, mode: 'edit' })}>
                          <span className={'sh-row-t' + (done ? ' done' : '')}>
                            {sharedTitle(item)}
                            {v.recurring && <Icon.Repeat size={11} />}
                          </span>
                          <span className="sh-row-m">
                            {v.startTime && <span>{v.startTime}</span>}
                            {item.localOnly && <span className="sh-tag local">같이 보기 전용</span>}
                            {isOverridden(item) && <span className="sh-tag">공유 화면에서 수정됨</span>}
                            {item.hidden && <span className="sh-tag">감춤</span>}
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
          mode={editing?.mode ?? 'edit'}
          onSave={(next) => { onSaveItem(next); setEditing(null); }}
          onHide={(item) => { onSaveItem(setHidden(item, !item.hidden)); setEditing(null); }}
          onDelete={(item) => { onDeleteItem(item); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
