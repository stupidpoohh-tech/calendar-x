import { useState } from 'react';
import type { FeedState } from '../app/useStore';
import { MONTH_NOTE_MAX } from '../data/converters';
import type { MonthNote, YearMonth } from '../domain/types';

interface Props {
  /** 보고 있는 달. 커서를 옮기면 그 달의 글로 바뀐다. */
  month: YearMonth;
  note: MonthNote | null;
  /** 월별 메모 구독의 상태. 받기 전에는 고치지 못한다. */
  feed: FeedState;
  onSave: (n: MonthNote) => void;
}

export function monthLabelOf(month: YearMonth): string {
  const [y, m] = month.split('-');
  return y && m ? `${y}년 ${Number(m)}월` : month;
}

/**
 * 월별 메모 — 노트 화면 맨 위의 한 장.
 *
 * 칸이 둘인 이유는 쓰는 때가 다르기 때문이다. **목표**는 달을 시작하며 적고 **결과**는 달을
 * 끝내며 적는다. 한 칸이면 나중에 둘을 가를 수 없고, 목표를 지우고 결과를 덮어쓰게 된다.
 * 좁은 화면에서도 좌 · 우를 유지한다 — 위아래로 쌓으면 '왼쪽이 목표' 라는 약속이 깨진다.
 *
 * 구독이 아직 오지 않았거나 캐시가 비어 "없음" 을 확정할 수 없으면 고치지 못한다. 그 사이
 * 빈 칸으로 열어 저장하면 서버에 있는 글을 빈 글로 덮는다 (기간 메모와 같은 규칙).
 *
 * 글이지 계산이 아니다 — 한도 · 예상 잔고 · 결산 어디에도 들어가지 않는다.
 */
export function MonthNotePanel({ month, note, feed, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState('');
  const [result, setResult] = useState('');

  const known = feed.ready && !(feed.empty && feed.fromCache);
  const savedGoal = note?.goal ?? '';
  const savedResult = note?.result ?? '';
  const has = !!(savedGoal || savedResult);

  const open = () => { setGoal(savedGoal); setResult(savedResult); setEditing(true); };
  const save = () => {
    const g = goal.replace(/\s+$/, '');
    const r = result.replace(/\s+$/, '');
    setEditing(false);
    // 바꾸지 않았으면 쓰지 않는다. 둘 다 비었고 저장된 글도 없으면 빈 문서를 만들지 않는다.
    if (g === savedGoal && r === savedResult) return;
    if (!g && !r && !note) return;
    const now = new Date().toISOString();
    onSave({ id: month, month, goal: g, result: r, createdAt: note?.createdAt || now, updatedAt: now });
  };

  return (
    <section className="mnote" aria-labelledby="mnote-h">
      <div className="mnote-h">
        <h3 className="mnote-t" id="mnote-h">
          {monthLabelOf(month)} <span className="mnote-sub">메모</span>
        </h3>
        {!editing && known && (
          <button className="btn sm" onClick={open}>{has ? '고치기' : '적기'}</button>
        )}
      </div>

      {editing ? (
        <>
          <div className="mnote-cols">
            <label className="mnote-col">
              <span className="mnote-cap">목표</span>
              <textarea
                className="mod-input mnote-in" rows={4} autoFocus maxLength={MONTH_NOTE_MAX}
                placeholder="이 달에 하려는 것"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <label className="mnote-col">
              <span className="mnote-cap">결과</span>
              <textarea
                className="mod-input mnote-in" rows={4} maxLength={MONTH_NOTE_MAX}
                placeholder="실제로 어떻게 되었는지"
                value={result}
                onChange={(e) => setResult(e.target.value)}
              />
            </label>
          </div>
          <div className="mnote-a">
            <button className="btn" onClick={() => setEditing(false)}>취소</button>
            <button className="btn primary" onClick={save}>저장</button>
          </div>
        </>
      ) : !known ? (
        <p className="mnote-note" role="status">
          {feed.status === 'error'
            ? '메모를 불러오지 못했습니다. 연결을 확인한 뒤 다시 열어 주세요.'
            : '메모를 불러오는 중입니다.'}
        </p>
      ) : (
        <div className="mnote-cols">
          <div className="mnote-col">
            <span className="mnote-cap">목표</span>
            {savedGoal
              ? <p className="mnote-body">{savedGoal}</p>
              : <p className="mnote-empty">이 달에 하려는 것을 적어 두세요.</p>}
          </div>
          <div className="mnote-col">
            <span className="mnote-cap">결과</span>
            {savedResult
              ? <p className="mnote-body">{savedResult}</p>
              : <p className="mnote-empty">달을 마치며 적습니다.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
