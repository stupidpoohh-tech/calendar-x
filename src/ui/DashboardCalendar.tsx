import { monthGrid, toISO } from '../domain/date';
import { displayTitle, effectiveEndDate, isDone } from '../domain/entry';
import { colorHex } from '../domain/constants';
import { formatAmount } from '../domain/money';
import type { DashboardCashDay } from '../domain/dashboard';
import type { Entry, WeekStart } from '../domain/types';

export function DashboardCashSummary({ cash }: { cash?: DashboardCashDay }) {
  if (!cash) return null;
  if (!cash.supported) return <p className="dash-cash-unknown">다른 통화 · 가계부에서 확인</p>;
  return <div className="dash-cash" tabIndex={0} aria-label="입출금 합계">
    {(cash.income > 0 || cash.outflow > 0) && <div aria-label="실제 입출금">{cash.income > 0 && <span className="dash-in">입금 +{formatAmount(cash.income)}</span>}{cash.outflow > 0 && <span className="dash-out">출금 −{formatAmount(cash.outflow)}</span>}</div>}
    {(cash.plannedIncome > 0 || cash.plannedOutflow > 0) && <div aria-label="예정 입출금">{cash.plannedIncome > 0 && <span className="dash-in">예정 +{formatAmount(cash.plannedIncome)}</span>}{cash.plannedOutflow > 0 && <span className="dash-out">예정 −{formatAmount(cash.plannedOutflow)}</span>}</div>}
  </div>;
}

interface Props {
  cursor: Date; weekStart: WeekStart; today: string; selected: string; entries: Entry[];
  cashDays: Record<string, DashboardCashDay>;
  onSelect: (day: string) => void; onEntry: (entry: Entry) => void;
}

/** A dashboard cell contains every schedule/note plus cash totals, never transaction titles. */
export function DashboardCalendar({ cursor, weekStart, today, selected, entries, cashDays, onSelect, onEntry }: Props) {
  const days = monthGrid(cursor, weekStart);
  const weekdays = weekStart === 'mon' ? ['월', '화', '수', '목', '금', '토', '일'] : ['일', '월', '화', '수', '목', '금', '토'];
  return <div className="dash-month" aria-label="일정·노트·입출금 통합 달력">
    <div className="dash-weekdays">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
    <div className="dash-days">{days.map(date => {
      const day = toISO(date);
      const items = entries.filter(e => e.startDate <= day && effectiveEndDate(e) >= day);
      return <section key={day} aria-label={day} className={'dash-day' + (date.getMonth() !== cursor.getMonth() ? ' is-outside' : '') + (selected === day ? ' is-selected' : '')}>
        <button className="dash-date" aria-label={day + ' 상세 보기'} aria-current={day === today ? 'date' : undefined} aria-pressed={selected === day} onClick={() => onSelect(day)}>{date.getDate()}</button>
        <div className="dash-day-items" tabIndex={items.length ? 0 : undefined} aria-label={day + ' 일정과 노트'}>
          {items.map(e => <button key={e.id} className={'dash-entry' + (isDone(e) ? ' is-done' : '')} onClick={() => onEntry(e)}
            style={{ '--entry-color': colorHex(e.color) } as React.CSSProperties}
            title={(e.kind === 'idea' ? '노트 · ' : '일정 · ') + displayTitle(e) + (e.note ? '\n' + e.note : '')}>
            <span className="dash-entry-kind">{e.kind === 'idea' ? '◇' : e.startTime || '•'}</span><span>{displayTitle(e)}</span>
          </button>)}
        </div>
        <DashboardCashSummary cash={cashDays[day]} />
      </section>;
    })}</div>
  </div>;
}
