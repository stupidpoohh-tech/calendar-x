/**
 * 같이 보기 고정메모.
 *
 * 개인 고정 메모(`Pin`)와 **다른 자료다.** 뜻이 다르고(내 기준값 vs 둘의 공동 메모),
 * 경로가 다르고(`sharedBoards/{id}/pins` vs `users/{uid}/pins`), 권한이 다르다.
 * 연결하면 한쪽을 고칠 때 다른 쪽이 따라 바뀌어야 하는지가 매번 애매해진다.
 *
 * 보드당 **한 건**이다. 메모 관리 시스템으로 키우지 않는다 — 여러 줄은 메모 안에서
 * 줄바꿈으로 적는다.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';

interface Props {
  text: string;
  onSave: (text: string) => void;
}

export function SharedMemo({ text, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  /*
    편집 중이 아닐 때만 상대의 수정을 받아 온다. 편집 중에 덮으면 지금 적고 있는 내용이
    사라진다 — 같은 순간에 둘이 적으면 마지막 저장이 남는 것이 이 기능의 규칙이다.
  */
  useEffect(() => { if (!editing) setDraft(text); }, [text, editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() === text.trim()) return;
    onSave(draft);
  };

  if (!editing && !text.trim()) {
    return (
      <button className="shm-add" onClick={() => { setDraft(''); setEditing(true); }}>
        <Icon.Plus size={12} />고정메모 추가
      </button>
    );
  }

  return (
    <div className="shm">
      <div className="shm-h">
        <Icon.Pin size={12} />
        <span className="shm-l">고정메모</span>
        {!editing && (
          <button className="shm-edit" onClick={() => setEditing(true)}>편집</button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className="shm-in"
            value={draft}
            rows={4}
            autoFocus
            placeholder={'이번 주 같이 할 것\n- 토요일 장보기'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 여러 줄 메모이므로 Enter 는 줄바꿈이다. 확정은 버튼과 Escape 로만 한다.
              if (isComposingEnter(e)) return;
              if (e.key === 'Escape') { setDraft(text); setEditing(false); }
            }}
          />
          <div className="shm-actions">
            <button className="btn sm" onClick={() => { setDraft(text); setEditing(false); }}>취소</button>
            <button className="btn primary sm" onClick={commit}>저장</button>
          </div>
        </>
      ) : (
        <p className="shm-b">{text}</p>
      )}
    </div>
  );
}
