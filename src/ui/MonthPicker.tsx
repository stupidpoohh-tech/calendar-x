import { useState } from 'react';
import { Icon } from './Icon';

interface Props {
  cursor: Date;
  onPick: (year: number, month: number) => void;
  onClose: () => void;
}

const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export function MonthPicker({ cursor, onPick, onClose }: Props) {
  const [year, setYear] = useState(cursor.getFullYear());
  const [month, setMonth] = useState(cursor.getMonth());

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="myp" role="dialog" aria-modal="true" aria-label="년월 선택" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-h">
          <div>
            <div className="sheet-eyebrow">빠른 이동</div>
            <h2 className="sheet-t">{year}년 {month + 1}월</h2>
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>

        <div className="myp-y">
          <button className="ico-btn" onClick={() => setYear((y) => y - 1)} aria-label="이전 해"><Icon.Chevron size={16} dir="left" /></button>
          <span className="myp-y-n num">{year}</span>
          <button className="ico-btn" onClick={() => setYear((y) => y + 1)} aria-label="다음 해"><Icon.Chevron size={16} /></button>
        </div>

        <div className="myp-m">
          {MONTHS.map((label, i) => (
            <button key={label} className={'myp-mo' + (i === month ? ' on' : '')} onClick={() => setMonth(i)}>
              {label}
            </button>
          ))}
        </div>

        <footer className="myp-f">
          <button className="btn" onClick={() => { const t = new Date(); setYear(t.getFullYear()); setMonth(t.getMonth()); }}>오늘</button>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={() => onPick(year, month)}>이동</button>
        </footer>
      </div>
    </div>
  );
}
