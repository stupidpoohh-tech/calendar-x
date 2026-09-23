/**
 * 같이 보기 D-Day.
 *
 * 저장하는 것은 제목과 날짜뿐이고, 'D-23' 은 볼 때마다 다시 센다 (`domain/dday.ts`).
 * 오늘은 prop 으로 받는다 — 화면 컴포넌트가 시계를 직접 읽으면 자정을 넘긴 뒤
 * 이 카드만 어제를 가리킨다.
 *
 * TODO 보다 부가 기능이라 자리를 크게 쓰지 않는다. 기본으로 보이는 것은 앞의 두 건이고,
 * 나머지는 '전체 보기' 로 펼친다 — 관리 화면을 따로 만들지 않는다.
 */
import { useState } from 'react';
import { ddayCount, fmtDdayDate } from '../domain/dday';
import { uid as newId } from '../domain/entry';
import { isValidDate } from '../domain/date';
import type { SharedDday } from '../domain/types';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';

/** 기본으로 보여 주는 개수. 나머지는 접힌다. */
const VISIBLE = 2;

interface Props {
  ddays: readonly SharedDday[];
  todayISO: string;
  myUid: string;
  onSave: (d: SharedDday) => void;
  onDelete: (d: SharedDday) => void;
}

export function SharedDdayPanel({ ddays, todayISO: today, myUid, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<SharedDday | null>(null);
  const [expanded, setExpanded] = useState(false);

  const shown = expanded ? ddays : ddays.slice(0, VISIBLE);
  const hiddenCount = ddays.length - shown.length;

  const startNew = () => {
    const now = new Date().toISOString();
    setDraft({
      // 오늘은 prop 으로 받은 값이다. 여기서 시계를 직접 읽으면 자정을 넘긴 뒤
      // 이 칸만 어제를 가리킨다.
      id: newId(), title: '', date: today,
      order: ddays.length, createdBy: myUid, createdAt: now, updatedAt: now,
    });
  };

  const commit = () => {
    if (!draft) return;
    const title = draft.title.trim();
    // 날짜가 없으면 D-Day 가 아니다. 제목만 있는 카드를 만들지 않는다.
    if (!title || !isValidDate(draft.date)) { setDraft(null); return; }
    onSave({ ...draft, title, updatedAt: new Date().toISOString() });
    setDraft(null);
  };

  return (
    <div className="shd">
      {shown.map((d) => {
        const c = ddayCount(d.date, today);
        return (
          <div key={d.id} className="shd-card" data-phase={c.phase}>
            <button
              className="shd-main"
              onClick={() => setDraft(d)}
              aria-label={`${d.title} ${c.label} 고치기`}
            >
              <span className="shd-t">{d.title || '(제목 없음)'}</span>
              <span className="shd-n">{c.label}</span>
              <span className="shd-d">{fmtDdayDate(d.date, today)}</span>
            </button>
            <button className="shd-x" onClick={() => onDelete(d)} aria-label="D-Day 삭제">
              <Icon.X size={11} />
            </button>
          </div>
        );
      })}

      {hiddenCount > 0 && (
        <button className="shd-more" onClick={() => setExpanded(true)}>
          D-Day {hiddenCount.toLocaleString('ko-KR')}개 더 보기
        </button>
      )}
      {expanded && ddays.length > VISIBLE && (
        <button className="shd-more" onClick={() => setExpanded(false)}>접기</button>
      )}

      {draft ? (
        <div className="shd-form">
          <input
            className="shd-in"
            value={draft.title}
            placeholder="제목 (우리 여행)"
            autoFocus
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => {
              // 조합 중 Enter 는 글자를 확정하는 것이다. 이 검사가 없으면 입력이 사라진다.
              if (isComposingEnter(e)) return;
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') setDraft(null);
            }}
          />
          <input
            className="shd-in date"
            type="date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
          <button className="btn primary sm" onClick={commit}>저장</button>
          <button className="btn sm" onClick={() => setDraft(null)}>취소</button>
        </div>
      ) : (
        <button className="shd-add" onClick={startNew}>
          <Icon.Plus size={12} />D-Day 추가
        </button>
      )}
    </div>
  );
}
