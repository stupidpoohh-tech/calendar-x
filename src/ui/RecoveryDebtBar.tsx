/**
 * 밀린 회복 줄.
 *
 * 빚이 0이면 렌더링하지 않는다. 정상 상태에서 회복 기능은 화면에 없어야 한다 —
 * 필요한 순간에만 회복 일정 1건이 나타나거나, 놓쳤다면 이 한 줄이 나타난다.
 * 그래서 별도의 회복 대시보드를 두지 않고, 여기서 바로 다시 잡을 수 있게 한다.
 */
import { useState } from 'react';
import { addDaysISO } from '../domain/date';
import { debtLabel, recoveryWindow } from '../domain/recovery';
import type { RecoveryRule, TimeHM } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  rule: RecoveryRule;
  todayISO: string;
  onSchedule: (dateISO: string, time: TimeHM | null) => void;
}

export function RecoveryDebtBar({ rule, todayISO, onSchedule }: Props) {
  const window = recoveryWindow(rule.window);
  const [open, setOpen] = useState(false);
  // 오늘 저녁은 이미 지났을 수 있다. 내일을 기본값으로 두는 편이 손이 덜 간다.
  const [date, setDate] = useState(() => addDaysISO(todayISO, 1));
  const [time, setTime] = useState(window.startTime ?? '');

  if (rule.debtCount <= 0) return null;

  return (
    <section className="rdebt" aria-label="밀린 회복">
      <button
        type="button"
        className="rdebt-h"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
      >
        <span className="rdebt-dot" aria-hidden="true" />
        <strong>{debtLabel(rule.debtCount)}</strong>
        <span className="rdebt-cta">다시 잡기</span>
        <Icon.Chevron size={12} dir={open ? 'down' : 'right'} />
      </button>

      {open && (
        <div className="rdebt-b">
          <div className="rdebt-f">
            <input
              type="date" className="mod-input" value={date} min={todayISO}
              onChange={(e) => setDate(e.target.value || todayISO)}
              aria-label="회복할 날짜"
            />
            <input
              type="time" className="mod-input time" value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="회복할 시각"
            />
            <button
              className="btn primary"
              onClick={() => { onSchedule(date, time || null); setOpen(false); }}
            >
              회복 다시 잡기
            </button>
          </div>
          {/* 기본 메모와 기본 OFF 항목은 자동으로 붙는다. 다시 고르라고 묻지 않는다. */}
          <p className="rdebt-note">기본 메모와 끌 항목이 그대로 적용됩니다. 회차에서 고칠 수 있습니다.</p>
        </div>
      )}
    </section>
  );
}
