/**
 * 함께 할 것.
 *
 * 일정과 다른 자리다. 일정은 **둘이 실제로 해야 하는 것**이고, 여기는 **언젠가 같이
 * 하고 싶은 것**이다. 그래서 날짜도 마감도 우선순위도 없고, 있는 것은 목록과
 * 하나씩 지워 가는 체크뿐이다.
 *
 * ── 목록 이름을 하드코딩하지 않는다 ─────────────────────────────
 *
 * '게임' · '갈 곳' 은 예시일 뿐이다. 무엇을 모을지는 쓰는 사람이 정한다 — 미리 만들어
 * 두면 그 칸에 맞는 것만 적게 되고, 맞지 않는 것은 아예 안 적는다.
 *
 * ── 일정으로 만들어도 원래 항목은 완료하지 않는다 ───────────────
 *
 * 날짜를 잡은 것과 다녀온 것은 다르다. 완료는 실제로 해 본 뒤에 사람이 누른다.
 */
import { useState } from 'react';
import {
  collectionProgress, itemsOfCollection, newCollection, newCollectionItem, toggleCollectionItem,
} from '../domain/shared';
import { uid as newId } from '../domain/entry';
import type { SharedCollection, SharedCollectionItem } from '../domain/types';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';

interface Props {
  myUid: string;
  collections: readonly SharedCollection[];
  items: readonly SharedCollectionItem[];
  onSaveCollection: (c: SharedCollection) => void;
  onDeleteCollection: (c: SharedCollection) => void;
  onSaveItem: (i: SharedCollectionItem) => void;
  onDeleteItem: (i: SharedCollectionItem) => void;
  /** 이 항목을 공유 일정으로 올린다. 원래 항목은 그대로 남는다. */
  onPromote: (i: SharedCollectionItem) => void;
}

export function SharedCollections({
  myUid, collections, items, onSaveCollection, onDeleteCollection,
  onSaveItem, onDeleteItem, onPromote,
}: Props) {
  const [newListTitle, setNewListTitle] = useState('');
  const [adding, setAdding] = useState(false);
  /** 지금 항목을 적고 있는 목록. 목록마다 입력칸을 따로 열어 두지 않는다. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);

  const addList = () => {
    const title = newListTitle.trim();
    if (!title) { setAdding(false); setNewListTitle(''); return; }
    onSaveCollection(newCollection(newId(), myUid, title, collections.length));
    setNewListTitle('');
    setAdding(false);
  };

  const addItem = (c: SharedCollection) => {
    const title = (drafts[c.id] ?? '').trim();
    if (!title) return;
    const order = itemsOfCollection(items, c.id).length;
    onSaveItem(newCollectionItem(newId(), c.id, myUid, title, order));
    setDrafts((d) => ({ ...d, [c.id]: '' }));
  };

  return (
    <div className="shc">
      {collections.length === 0 && !adding && (
        <div className="empty">
          <p className="empty-t">아직 목록이 없습니다.</p>
          <p className="empty-s">
            둘이 언젠가 같이 하고 싶은 것을 모으는 자리입니다.
            게임 · 갈 곳 · 보고 싶은 것처럼 이름은 직접 정합니다.
          </p>
        </div>
      )}

      {collections.map((c) => {
        const listItems = itemsOfCollection(items, c.id);
        const { done, total } = collectionProgress(items, c.id);
        return (
          <section className="shc-g" key={c.id}>
            <header className="shc-gh">
              {renaming === c.id ? (
                <input
                  className="shc-in"
                  defaultValue={c.title}
                  autoFocus
                  onKeyDown={(e) => {
                    if (isComposingEnter(e)) return;
                    if (e.key === 'Escape') setRenaming(null);
                    if (e.key !== 'Enter') return;
                    const title = e.currentTarget.value.trim();
                    if (title) onSaveCollection({ ...c, title, updatedAt: new Date().toISOString() });
                    setRenaming(null);
                  }}
                  onBlur={() => setRenaming(null)}
                />
              ) : (
                <button className="shc-t" onClick={() => setRenaming(c.id)}>{c.title || '(이름 없음)'}</button>
              )}
              <span className="shc-n">{done}/{total}</span>
              <button
                className="ico-btn sm"
                onClick={() => onDeleteCollection(c)}
                aria-label={`${c.title} 목록 삭제`}
              >
                <Icon.Trash size={13} />
              </button>
            </header>

            <ul className="shc-ul">
              {listItems.map((i) => (
                <li className={'shc-li' + (i.completed ? ' done' : '')} key={i.id}>
                  <button
                    className="tp-check"
                    aria-pressed={i.completed}
                    aria-label={`${i.title} 완료`}
                    onClick={() => onSaveItem(toggleCollectionItem(i))}
                  >
                    {i.completed && <Icon.Check size={11} />}
                  </button>
                  <span className="shc-li-t">{i.title || '(제목 없음)'}</span>
                  <button
                    className="shc-act"
                    onClick={() => onPromote(i)}
                    aria-label={`${i.title} 일정으로 만들기`}
                    title="일정으로 만들기"
                  >
                    <Icon.Calendar size={13} />
                  </button>
                  <button
                    className="shc-act"
                    onClick={() => onDeleteItem(i)}
                    aria-label={`${i.title} 삭제`}
                  >
                    <Icon.X size={12} />
                  </button>
                </li>
              ))}
            </ul>

            <div className="shc-add">
              <input
                className="shc-in"
                value={drafts[c.id] ?? ''}
                placeholder="추가"
                aria-label={`${c.title} 에 추가`}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                onKeyDown={(e) => {
                  // 조합 중 Enter 는 글자를 확정하는 것이다. 없으면 적은 것이 사라진다.
                  if (isComposingEnter(e)) return;
                  if (e.key === 'Enter') { e.preventDefault(); addItem(c); }
                }}
              />
            </div>
          </section>
        );
      })}

      {adding ? (
        <div className="shc-add new">
          <input
            className="shc-in"
            value={newListTitle}
            placeholder="목록 이름 (갈 곳)"
            autoFocus
            onChange={(e) => setNewListTitle(e.target.value)}
            onKeyDown={(e) => {
              if (isComposingEnter(e)) return;
              if (e.key === 'Enter') { e.preventDefault(); addList(); }
              if (e.key === 'Escape') { setAdding(false); setNewListTitle(''); }
            }}
          />
          <button className="btn primary sm" onClick={addList}>만들기</button>
          <button className="btn sm" onClick={() => { setAdding(false); setNewListTitle(''); }}>취소</button>
        </div>
      ) : (
        <button className="shc-new" onClick={() => setAdding(true)}>
          <Icon.Plus size={13} />목록 만들기
        </button>
      )}
    </div>
  );
}
