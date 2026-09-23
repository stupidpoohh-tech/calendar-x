/**
 * 공유 메모 — 게시판처럼 글이 쌓인다.
 *
 * 용도를 가르지 않는다. 편지 · 준비물 · 예약 정보 · 서로에게 남기는 말이 같은 구조를
 * 쓴다. 분류(편지 · 일기 · 여행)를 만들면 적을 때마다 어디에 적어야 하는지를 고민하게
 * 되고, 그러면 결국 안 적는다.
 *
 * ── 고정메모는 별도 시스템이 아니다 ─────────────────────────────
 *
 * 글 하나를 `pinned` 로 세우면 보드 위에 한 줄로 뜬다. 살아 있는 고정은 하나다 —
 * 새로 고정하면 앞의 것이 풀린다 (`repinNotes`). 여럿을 고정할 수 있게 하면 보드 위
 * 한 줄에 무엇을 적을지가 매번 애매해진다.
 *
 * 복잡한 에디터를 만들지 않는다. 제목(선택)과 본문 한 칸이다.
 */
import { useState } from 'react';
import { newNote, noteTitle, shortName, sortNotes } from '../domain/shared';
import { uid as newId } from '../domain/entry';
import type { SharedNote } from '../domain/types';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';

interface Props {
  myUid: string;
  memberNames: Record<string, string>;
  notes: readonly SharedNote[];
  onSave: (n: SharedNote) => void;
  onDelete: (n: SharedNote) => void;
  /** 고정을 옮긴다. 바뀐 글들을 한꺼번에 받는다 — 앞의 고정이 함께 풀린다. */
  onPin: (n: SharedNote, pinned: boolean) => void;
  /**
   * 구조가 바뀌기 전의 고정메모. 있으면 "메모로 옮기기" 한 줄을 띄운다.
   * 조용히 옮기지 않는다 — 사용자가 적은 글이 본인도 모르게 다른 자리로 가면 안 된다.
   */
  legacyMemo: string;
  onAdoptLegacyMemo: () => void;
}

interface Draft { id: string | null; title: string; body: string }

export function SharedNotes({
  myUid, memberNames, notes, onSave, onDelete, onPin, legacyMemo, onAdoptLegacyMemo,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const sorted = sortNotes(notes);

  const authorLabel = (uid: string): string =>
    (uid === myUid ? '나' : shortName(memberNames[uid] ?? ''));

  const commit = () => {
    if (!draft) return;
    const body = draft.body.trim();
    // 본문이 비면 글이 아니다. 제목만 있는 빈 카드를 만들지 않는다.
    if (!body) { setDraft(null); return; }
    const now = new Date().toISOString();
    if (draft.id) {
      const prev = notes.find((n) => n.id === draft.id);
      if (prev) {
        onSave({ ...prev, title: draft.title.trim() || null, body, updatedAt: now });
      }
    } else {
      onSave(newNote(newId(), myUid, draft.title, body, now));
    }
    setDraft(null);
  };

  return (
    <div className="shn">
      <div className="shn-top">
        {!draft && (
          <button className="add-btn" onClick={() => setDraft({ id: null, title: '', body: '' })}>
            <Icon.Plus size={15} /><span className="lbl">글쓰기</span>
          </button>
        )}
      </div>

      {legacyMemo.trim() && (
        <div className="shn-legacy">
          <p className="shn-legacy-t">예전 고정메모가 남아 있습니다.</p>
          <p className="shn-legacy-b">{legacyMemo}</p>
          <button className="btn sm" onClick={onAdoptLegacyMemo}>메모로 옮기기</button>
        </div>
      )}

      {draft && (
        <div className="shn-form">
          <input
            className="shn-in t"
            value={draft.title}
            placeholder="제목 (선택)"
            autoFocus
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => {
              if (isComposingEnter(e)) return;
              if (e.key === 'Escape') setDraft(null);
            }}
          />
          <textarea
            className="shn-in b"
            aria-label="본문"
            value={draft.body}
            rows={6}
            placeholder={'여행 전에 읽어줘\n\n이번 여행은 일정 너무 빡빡하게 안 잡았으면 좋겠어'}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            onKeyDown={(e) => {
              // 여러 줄 글이므로 Enter 는 줄바꿈이다. 확정은 버튼과 Escape 로만.
              if (isComposingEnter(e)) return;
              if (e.key === 'Escape') setDraft(null);
            }}
          />
          <div className="shn-actions">
            <button className="btn sm" onClick={() => setDraft(null)}>취소</button>
            <button className="btn primary sm" onClick={commit}>저장</button>
          </div>
        </div>
      )}

      {sorted.length === 0 && !draft && !legacyMemo.trim() && (
        <div className="empty">
          <p className="empty-t">아직 적어 둔 글이 없습니다.</p>
          <p className="empty-s">
            준비물 · 예약 정보 · 서로에게 남기는 말을 여기에 적습니다.
            한 건을 고정하면 보드 위에 한 줄로 뜹니다.
          </p>
        </div>
      )}

      {sorted.map((n) => (
        <article className={'shn-card' + (n.pinned ? ' pinned' : '')} key={n.id}>
          <header className="shn-h">
            {n.pinned && <Icon.Pin size={12} />}
            <h3 className="shn-t">{noteTitle(n)}</h3>
            <button
              className={'ico-btn sm' + (n.pinned ? ' on' : '')}
              onClick={() => onPin(n, !n.pinned)}
              aria-pressed={n.pinned}
              aria-label={n.pinned ? '고정 해제' : '위에 고정'}
              title={n.pinned ? '고정 해제' : '위에 고정'}
            >
              <Icon.Pin size={13} />
            </button>
            <button
              className="shn-edit"
              onClick={() => setDraft({ id: n.id, title: n.title ?? '', body: n.body })}
              aria-label={`${noteTitle(n)} 편집`}
            >
              편집
            </button>
            <button
              className="ico-btn sm"
              onClick={() => onDelete(n)}
              aria-label={`${noteTitle(n)} 삭제`}
            >
              <Icon.Trash size={13} />
            </button>
          </header>
          <p className="shn-b">{n.body}</p>
          <footer className="shn-f">
            {authorLabel(n.authorUid)} · {n.createdAt.slice(0, 10)}
          </footer>
        </article>
      ))}
    </div>
  );
}
