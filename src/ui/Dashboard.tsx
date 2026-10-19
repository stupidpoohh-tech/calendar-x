import { useMemo, useState } from 'react';
import type { StoreState } from '../app/useStore';
import { addDaysISO, endOfMonth, fmtDayShort, monthGrid, parseDate, toISO, weekdayIndex } from '../domain/date';
import { displayTitle, effectiveEndDate, isDone } from '../domain/entry';
import { dashboardCashDays, dashboardEntries, dashboardSpending } from '../domain/dashboard';
import { COLORS, colorHex } from '../domain/constants';
import { formatAmount } from '../domain/money';
import type { ColorId, Entry, LensId, TaskStatus, WeekStart } from '../domain/types';
import { calcCaveat, calcStateOf } from './calcState';
import { Icon } from './Icon';
import { DashboardCalendar, DashboardCashSummary } from './DashboardCalendar';
import '../styles/dashboard.css';

interface Props {
  today: string; cursor: Date; onCursorChange: (date: Date) => void; weekStart: WeekStart; query: string;
  store: StoreState; showMoney: boolean; showNotes: boolean; demo: boolean;
  onNavigate: (lens: LensId) => void;
  onEntry: (entry: Entry) => void; onStatus: (entry: Entry, status: TaskStatus) => void;
  onCreate: (kind: 'task' | 'idea', date: string) => void;
}
type View = 'day' | 'week' | 'month' | 'list';
const VIEWS: { id: View; label: string }[] = [{ id: 'day', label: '일' }, { id: 'week', label: '주' }, { id: 'month', label: '월' }, { id: 'list', label: '목록' }];

export function Dashboard({ today, cursor, onCursorChange, weekStart, query, store, showMoney, showNotes, demo, onNavigate, onEntry, onStatus, onCreate }: Props) {
  const month = toISO(cursor).slice(0, 7);
  const [selection, setSelection] = useState<{ month: string; day: string } | null>(null);
  const selected = selection?.month === month ? selection.day : today.startsWith(month) ? today : month + '-01';
  const [view, setView] = useState<View>('month');
  const [hiddenColors, setHiddenColors] = useState<ColorId[]>([]);
  const { tasks, notes, calendarEntries } = useMemo(() => dashboardEntries(store.entries, cursor, weekStart), [store.entries, cursor, weekStart]);
  const cashDays = useMemo(() => {
    const grid = monthGrid(cursor, weekStart);
    return showMoney ? dashboardCashDays(store.entries, toISO(grid[0]!), toISO(grid[41]!)) : {};
  }, [store.entries, cursor, weekStart, showMoney]);
  const state = calcStateOf(store.dashboardFeed ?? store.display);
  const ready = state.kind === 'ready';
  const matches = (e: Entry) => !hiddenColors.includes(e.color) && [displayTitle(e), e.location, e.note, ...e.tags].filter(Boolean).join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const shown = calendarEntries.filter(e => (showNotes || e.kind !== 'idea') && matches(e));
  const dayTasks = tasks.filter(matches).filter(e => e.startDate <= selected && effectiveEndDate(e) >= selected);
  const agenda = dayTasks.filter(e => !!e.startTime || effectiveEndDate(e) > e.startDate);
  const todos = dayTasks.filter(e => !e.startTime && effectiveEndDate(e) === e.startDate);
  const recentNotes = notes.filter(matches);
  const colors = COLORS.filter(c => tasks.some(e => e.color === c.id) || notes.some(e => e.color === c.id));
  const money = dashboardSpending(store, month);
  const moneyReady = calcStateOf(store.display).kind === 'ready' && calcStateOf(store.ledgerMeta).kind === 'ready';
  const percentage = money.budget.budgeted > 0 ? Math.round(money.budget.actualInBudgeted / money.budget.budgeted * 100) : null;
  const notice = state.kind === 'error' ? '일정을 불러오지 못했습니다. 연결 상태를 확인해 주세요.'
    : state.kind === 'unconfirmed' ? '서버 연결 후 일정을 다시 확인합니다.' : '일정을 불러오는 중입니다.';
  const pick = (day: string) => {
    const nextMonth = day.slice(0, 7);
    if (nextMonth !== month) onCursorChange(parseDate(day)!);
    setSelection({ month: nextMonth, day });
  };
  const goToday = () => { onCursorChange(parseDate(today)!); setSelection({ month: today.slice(0, 7), day: today }); };
  const move = (n: number) => {
    if (view === 'day' || view === 'week') pick(addDaysISO(selected, n * (view === 'day' ? 1 : 7)));
    else onCursorChange(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  };
  const weekFrom = addDaysISO(selected, -weekdayIndex(parseDate(selected)!, weekStart));
  const listDays = view === 'day' ? [selected] : view === 'week' ? Array.from({ length: 7 }, (_, i) => addDaysISO(weekFrom, i))
    : Array.from({ length: endOfMonth(cursor).getDate() }, (_, i) => month + '-' + String(i + 1).padStart(2, '0'));
  const entryButton = (e: Entry) => <button className="ref-event" key={e.id} onClick={() => onEntry(e)} style={{ borderColor: colorHex(e.color) }}>
    <time>{e.kind === 'idea' ? '노트' : e.startTime ?? '종일'}</time><span><strong>{displayTitle(e)}</strong>{e.location && <small>{e.location}</small>}</span>
  </button>;
  return <div className="reference-dashboard">
    <section className="ref-center" aria-label="캘린더 대시보드">
      <header className="ref-toolbar">
        <div className="ref-month-tools"><button aria-label="이전 기간" onClick={() => move(-1)}><Icon.Chevron dir="left" /></button><button aria-label="다음 기간" onClick={() => move(1)}><Icon.Chevron /></button><button className="ref-today" onClick={goToday}>오늘</button><h1>{cursor.getFullYear()}년 {cursor.getMonth() + 1}월</h1></div>
        <div className="ref-toolbar-options">
        <details className="ref-color-filter"><summary><Icon.Filter size={16} /><span>색상</span></summary>
          <div className="ref-calendars">
            <h2>표시할 색상</h2>
            {colors.map(c => <label key={c.id}><span className="ref-swatch" style={{ background: c.hex }} />{c.label}<input type="checkbox" checked={!hiddenColors.includes(c.id)} onChange={() => setHiddenColors(values => values.includes(c.id) ? values.filter(id => id !== c.id) : [...values, c.id])} /></label>)}
            {!colors.length && <p className="ref-muted">일정을 추가하면 사용한 색상이 표시됩니다.</p>}
          </div>
        </details>
        <div className="ref-views" role="group" aria-label="캘린더 보기">{VIEWS.map(v => <button key={v.id} aria-pressed={v.id === view} onClick={() => setView(v.id)}>{v.label}</button>)}</div></div>
      </header>
      {!ready && <p className="ref-notice" role="status">{notice}</p>}
      {ready && calcCaveat(state) && <p className="ref-notice" role="status">{calcCaveat(state)}</p>}
      {query && <p className="ref-search-result">“{query}” 검색 결과 · 현재 표시 기간</p>}
      <p className="ref-calendar-key">{demo && <span>미리보기</span>}<span>● 일정</span>{showNotes && <span>◇ 노트</span>}{showMoney && <span>입금·출금 합계 (원)</span>}<small>많은 항목은 날짜 안에서 스크롤</small></p>
      <div className="ref-calendar">
        {view === 'month' ? <DashboardCalendar cursor={cursor} entries={ready ? shown : []}
          cashDays={ready ? cashDays : {}} weekStart={weekStart} today={today} selected={selected}
          onEntry={onEntry} onSelect={pick} />
          : <div className={'ref-date-list ref-view-' + view}>{listDays.map(day => {
            const entries = shown.filter(e => e.startDate <= day && effectiveEndDate(e) >= day);
            if (view === 'list' && entries.length === 0 && !cashDays[day]) return null;
            return <section key={day}><button className="ref-date-heading" aria-pressed={day === selected} onClick={() => pick(day)}>{Number(day.slice(5, 7))}월 {fmtDayShort(day)}</button>{ready && entries.map(entryButton)}{ready && <DashboardCashSummary cash={cashDays[day]} />}{ready && !entries.length && !cashDays[day] && <p className="ref-muted">등록된 항목 없음</p>}</section>;
          })}{ready && view === 'list' && !shown.some(e => e.startDate <= toISO(endOfMonth(cursor)) && effectiveEndDate(e) >= month + '-01') && !Object.keys(cashDays).some(day => day.startsWith(month)) && <p className="ref-muted">이 달에 표시할 항목이 없습니다.</p>}</div>}
      </div>
    </section>
    <aside className="ref-details" aria-label="선택한 날짜 요약">
      <header className="ref-date-title"><h2>{Number(selected.slice(5, 7))}월 {fmtDayShort(selected)}</h2><button aria-label="선택한 날짜에 일정 추가" onClick={() => onCreate('task', selected)}><Icon.Plus size={22} /></button></header>
      <section className="ref-panel" aria-label="선택한 날 일정"><h2>{selected === today ? '오늘 일정' : '선택한 날 일정'} <small>{ready ? agenda.length : '—'}</small></h2>
        <div className="ref-panel-content" tabIndex={0}>{ready ? agenda.length ? agenda.map(entryButton) : <p className="ref-muted">등록된 일정이 없습니다.</p> : <p className="ref-muted">{notice}</p>}</div>
      </section>
      <section className="ref-panel" aria-label="선택한 날 할 일"><h2>할 일 <small>{ready ? todos.length : '—'}</small></h2>
        <div className="ref-panel-content" tabIndex={0}>{ready && (todos.length ? todos.map(e => <div className={'ref-todo' + (isDone(e) ? ' is-done' : '')} key={e.id}>
          <input type="checkbox" aria-label={displayTitle(e) + ' 완료'} checked={isDone(e)} onChange={() => onStatus(e, isDone(e) ? 'planned' : 'done')} />
          <button onClick={() => onEntry(e)}>{displayTitle(e)}</button>
        </div>) : <p className="ref-muted">등록된 할 일이 없습니다.</p>)}</div>
      </section>
      {showNotes && <section className="ref-panel" aria-label="이번 달 노트"><h2>노트 <small>{ready ? recentNotes.length : '—'}</small><button aria-label="노트 추가" onClick={() => onCreate('idea', selected)}><Icon.Plus size={17} /></button></h2>
        <div className="ref-panel-content" tabIndex={0}>{ready && (recentNotes.length ? recentNotes.map(e => <button key={e.id} className="ref-note" onClick={() => onEntry(e)}><span><Icon.List size={20} /></span><div><strong>{displayTitle(e)}</strong><small>{e.note || e.startDate}</small></div></button>) : <p className="ref-muted">이번 달 노트가 없습니다.</p>)}</div>
      </section>}
      {showMoney && <section className="ref-panel ref-expense" aria-label="월 지출 요약"><h2>{month === today.slice(0, 7) ? '이번 달 지출' : cursor.getMonth() + 1 + '월 지출'}</h2>
        {!moneyReady ? <p className="ref-muted">가계부 자료를 확인하는 중입니다.</p> : !money.supported ? <p className="ref-muted">통화가 다른 내역은 가계부에서 확인해 주세요.</p> : <>
          <strong className="ref-expense-amount">{formatAmount(money.spending)}원</strong>
          {percentage !== null ? <><progress value={Math.min(percentage, 100)} max={100} aria-label="월간 카테고리 예산 사용률" /><div className="ref-budget-caption"><span>월간 예산 {formatAmount(money.budget.budgeted)}원</span><strong>{percentage}%</strong></div>
            {money.budget.actualInBudgeted !== money.spending && <small>예산 사용률은 월간 예산이 있는 항목만 비교합니다.</small>}</> : <p className="ref-muted">설정된 월간 카테고리 예산이 없습니다.</p>}
          <small>{money.period.start.replaceAll('-', '.')} – {money.period.end.replaceAll('-', '.')} · 정산 기간</small>
        </>}
        <button className="ref-text-link" onClick={() => onNavigate('money')}>가계부 보기 <Icon.Chevron size={13} /></button>
      </section>}
    </aside>

  </div>;
}
