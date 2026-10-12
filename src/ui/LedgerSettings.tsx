/**
 * 설정 — 가계부. 정산 시작일과 카테고리.
 *
 * ── 정산 시작일을 바꾸면 ──────────────────────────────────────
 *
 * 모든 기간(지난 기간 포함)의 경계가 새 시작일로 다시 계산된다. 거래는 하나도 바뀌지
 * 않고 어느 기간에 묶이는지만 바뀐다. 기간별 예산은 기간 이름(시작하는 달)을 따라가므로
 * 지워지지 않는다. 그 사실을 고르는 자리 바로 아래에 적는다.
 *
 * ── 카테고리는 지우지 않는다 ──────────────────────────────────
 *
 * 지우면 그 카테고리의 지난 거래가 미분류로 떨어진다. 보관만 있다 — 새 입력에서 빠지고
 * 지난 기록에는 이름 그대로 남는다. 보관한 것은 다시 꺼낼 수 있다.
 */
import { useState } from 'react';
import { findCategoryByName, moveCategory, newCategory, sortCategories } from '../domain/category';
import { uid as newId } from '../domain/entry';
import { periodOf, periodRange } from '../domain/period';
import type { Category } from '../domain/types';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';

interface Props {
  todayISO: string;
  settleDay: number;
  onSettleDay: (day: number) => void;
  categories: readonly Category[];
  categoriesReady: boolean;
  onSaveCategory: (c: Category) => void;
  onSaveCategories: (list: Category[]) => void;
  onSeedCategories: () => void;
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function LedgerSettings({
  todayISO, settleDay, onSettleDay, categories, categoriesReady,
  onSaveCategory, onSaveCategories, onSeedCategories,
}: Props) {
  const [kind, setKind] = useState<Category['kind']>('expense');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState('');

  const now = periodOf(todayISO, settleDay);
  const mine = sortCategories(categories.filter((c) => c.kind === kind));
  const active = mine.filter((c) => !c.archived);
  const archived = mine.filter((c) => c.archived);

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    const same = findCategoryByName(categories, kind, name);
    if (same) {
      // 같은 이름을 두 번 만들지 않는다. 보관해 둔 것이면 다시 꺼낸다.
      if (same.archived) {
        onSaveCategory({ ...same, archived: false, updatedAt: new Date().toISOString() });
        setNotice(`보관해 둔 '${same.name}'을(를) 다시 꺼냈습니다.`);
      } else {
        setNotice(`'${same.name}'은(는) 이미 있습니다.`);
      }
      setDraft('');
      return;
    }
    const order = mine.reduce((m, c) => Math.max(m, c.order), -1) + 1;
    onSaveCategory(newCategory(kind, name.slice(0, 100), order, newId()));
    setDraft('');
    setNotice('');
  };

  const rename = () => {
    if (!editing) return;
    const c = categories.find((x) => x.id === editing.id);
    const name = editing.name.trim();
    setEditing(null);
    if (!c || !name || name === c.name) return;
    const same = findCategoryByName(categories, c.kind, name);
    if (same && same.id !== c.id) { setNotice(`'${same.name}'은(는) 이미 있습니다.`); return; }
    onSaveCategory({ ...c, name: name.slice(0, 100), updatedAt: new Date().toISOString() });
  };

  const move = (id: string, by: -1 | 1) => {
    const changed = moveCategory(active, id, by);
    if (changed.length > 0) onSaveCategories(changed);
  };

  return (
    <div className="set-grp">
      <h3 className="set-gt">가계부</h3>

      <div className="set-row-inline">
        <label htmlFor="settle-day">정산 시작일</label>
        <select
          id="settle-day" className="mod-input led-day"
          value={settleDay} onChange={(e) => onSettleDay(Number(e.target.value))}
        >
          {DAYS.map((d) => <option key={d} value={d}>매월 {d}일</option>)}
        </select>
      </div>
      <p className="set-note">
        지금 기간: <b className="num">{periodRange(now)}</b>.
        {settleDay >= 29 && ' 그 날이 없는 달은 말일부터 시작합니다.'}
        {' '}바꾸면 지난 기간의 결산도 새 시작일로 다시 묶입니다. 거래와 기간별 예산은 그대로 남습니다.
      </p>

      <div className="set-row-inline">
        <span>카테고리</span>
        <div className="seg" role="tablist" aria-label="카테고리 흐름">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k} role="tab" aria-selected={kind === k}
              className={'seg-btn' + (kind === k ? ' on' : '')}
              onClick={() => { setKind(k); setShowArchived(false); setEditing(null); }}
            >
              {k === 'expense' ? '지출' : '수입'}
            </button>
          ))}
        </div>
      </div>

      {categoriesReady && categories.length === 0 && (
        <button className="btn" onClick={onSeedCategories}>기본 카테고리 만들기</button>
      )}
      {!categoriesReady && <p className="set-note">카테고리를 불러오는 중입니다.</p>}

      <ul className="led-cats" aria-label={kind === 'expense' ? '지출 카테고리' : '수입 카테고리'}>
        {active.map((c, i) => (
          <li key={c.id} className="led-cat">
            {editing?.id === c.id ? (
              <input
                className="mod-input" autoFocus value={editing.name} maxLength={100}
                aria-label="카테고리 이름"
                onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                onKeyDown={(e) => {
                  if (isComposingEnter(e)) return;
                  if (e.key === 'Enter') rename();
                  if (e.key === 'Escape') setEditing(null);
                }}
                onBlur={rename}
              />
            ) : (
              <button className="led-cat-n" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={`${c.name} 이름 바꾸기`}>
                {c.name}
              </button>
            )}
            <button className="ico-btn sm" disabled={i === 0} onClick={() => move(c.id, -1)} aria-label={`${c.name} 위로`}>
              <Icon.Chevron size={13} dir="up" />
            </button>
            <button className="ico-btn sm" disabled={i === active.length - 1} onClick={() => move(c.id, 1)} aria-label={`${c.name} 아래로`}>
              <Icon.Chevron size={13} dir="down" />
            </button>
            <button
              className="led-cat-a"
              onClick={() => onSaveCategory({ ...c, archived: true, updatedAt: new Date().toISOString() })}
            >
              보관
            </button>
          </li>
        ))}
      </ul>

      <div className="led-add">
        <input
          className="mod-input" placeholder={kind === 'expense' ? '새 지출 카테고리' : '새 수입 카테고리'}
          value={draft} maxLength={100} aria-label="새 카테고리 이름"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e)) add(); }}
        />
        <button className="btn" onClick={add} disabled={!draft.trim()}>추가</button>
      </div>
      {notice && <p className="set-note" role="status">{notice}</p>}

      {archived.length > 0 && (
        <>
          <button className="set-redo" onClick={() => setShowArchived((x) => !x)} aria-expanded={showArchived}>
            보관한 카테고리 {archived.length}개
          </button>
          {showArchived && (
            <ul className="led-cats">
              {archived.map((c) => (
                <li key={c.id} className="led-cat archived">
                  <span className="led-cat-n">{c.name}</span>
                  <button
                    className="led-cat-a"
                    onClick={() => onSaveCategory({
                      ...c, archived: false, order: active.length, updatedAt: new Date().toISOString(),
                    })}
                  >
                    다시 꺼내기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="set-note">
        카테고리는 지우지 않고 보관합니다. 보관하면 새 입력에서만 빠지고, 지난 거래와 통계에는 그대로 남습니다.
      </p>
    </div>
  );
}
