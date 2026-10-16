import { useMemo, useState } from 'react';
import type { StoreState } from '../app/useStore';
import { addDaysISO, fmtDayShort } from '../domain/date';
import { displayTitle, effectiveEndDate, isDone } from '../domain/entry';
import { dashboardEntries } from '../domain/dashboard';
import { calcScopeOf, headlineLimit, horizonOf } from '../domain/tide';
import { formatAmount } from '../domain/money';
import type { Entry, LensId, TaskStatus } from '../domain/types';
import { calcCaveat, calcNotice, calcScopeNotice, calcStateOf } from './calcState';
import { Icon } from './Icon';
import '../styles/dashboard.css';

interface Props {
  today: string;
  store: StoreState;
  showMoney: boolean;
  showNotes: boolean;
  demo: boolean;
  onNavigate: (lens: LensId) => void;
  onEntry: (entry: Entry) => void;
  onPromote: (entry: Entry) => void;
  onStatus: (entry: Entry, status: TaskStatus) => void;
  onCreate: (kind: 'task' | 'idea', date: string) => void;
}

export function Dashboard({ today, store, showMoney, showNotes, demo, onNavigate, onEntry, onPromote, onStatus, onCreate }: Props) {
  const [picked, setPicked] = useState(today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(today, i));
  const selected = days.includes(picked) ? picked : today;
  const { tasks, notes } = useMemo(() => dashboardEntries(store.entries, today), [store.entries, today]);
  const displayState = calcStateOf(store.dashboardFeed ?? store.display);
  const ready = displayState.kind === 'ready';
  const todayTasks = tasks.filter(e => e.startDate <= today && effectiveEndDate(e) >= today);
  const done = todayTasks.filter(isDone).length;
  const selectedTasks = tasks.filter(e => e.startDate <= selected && effectiveEndDate(e) >= selected)
    .sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || (a.startTime ?? '00:00').localeCompare(b.startTime ?? '00:00'));
  const calc = calcStateOf(store.calc);
  const finance = useMemo(() => {
    if (!showMoney || calc.kind !== 'ready') return null;
    const reservations = { budgets: store.budgets, reserves: store.reserves, reserveUsage: store.reserveUsage, cards: store.cards, cardEntries: store.cardLinked };
    const scope = calcScopeOf(store.accounts, store.tideEntries, reservations);
    if (!scope.ok) return { notice: calcScopeNotice(scope) };
    if (!store.accounts.length) return { notice: '현재 잔고를 입력하면 앞으로 쓸 수 있는 한도를 확인할 수 있습니다.' };
    return { amount: headlineLimit(store.accounts, store.tideEntries, today, reservations), horizon: horizonOf(store.tideEntries, today) };
  }, [showMoney, calc.kind, store.accounts, store.tideEntries, store.budgets, store.reserves, store.reserveUsage, store.cards, store.cardLinked, today]);
  const displayNotice = displayState.kind === 'error' ? '일정을 불러오지 못했습니다. 연결 상태를 확인해 주세요.'
    : displayState.kind === 'unconfirmed' ? '저장된 일정이 비어 있습니다. 서버 연결 후 다시 확인합니다.' : '일정을 불러오는 중입니다.';

  return <div className="dashboard">
    <header className="dash-welcome">
      <div><p className="dash-kicker">MY DAY {demo && <span>미리보기 데이터</span>}</p><h1>오늘을 한눈에</h1><p>{today.slice(0, 4)}년 {today.slice(5, 7).replace(/^0/, '')}월 {fmtDayShort(today)} · 중요한 일부터 차근차근 확인하세요.</p></div>
      <button className="dash-primary" onClick={() => onCreate('task', today)}><Icon.Plus size={16} />새 일정</button>
    </header>
    <div className="dash-metrics">
      <div className="dash-metric" data-tone="blue"><span className="dash-icon"><Icon.Check size={22} /></span><div><span>오늘 남은 할 일</span><strong>{ready ? todayTasks.length - done : '—'}<small>개</small></strong><p>{ready ? `${todayTasks.length}개 중 ${done}개 완료` : '자료 확인 중'}</p></div></div>
      <button className="dash-metric" data-tone="green" onClick={() => onNavigate('task')}><span className="dash-icon"><Icon.Calendar size={22} /></span><div><span>앞으로 7일</span><strong>{ready ? tasks.filter(e => !isDone(e)).length : '—'}<small>개</small></strong><p>진행할 일정 · 캘린더 열기 →</p></div></button>
      {showNotes && <button className="dash-metric" data-tone="amber" onClick={() => onNavigate('idea')}><span className="dash-icon"><Icon.List size={22} /></span><div><span>이번 달 노트</span><strong>{ready ? notes.length : '—'}<small>개</small></strong><p>아이디어 이어 쓰기 →</p></div></button>}
    </div>
    {!ready && <p className="dash-notice" role="status">{displayNotice}</p>}
    {ready && calcCaveat(displayState) && <p className="dash-notice" role="status">{calcCaveat(displayState)}</p>}
    <div className="dash-grid">
      <section className="dash-card dash-agenda" aria-label="7일 일정">
        <header className="dash-card-head"><div><p className="dash-kicker">SCHEDULE</p><h2>이번 주의 흐름</h2></div><button className="dash-link" onClick={() => onNavigate('task')}>캘린더 <Icon.ArrowUpRight size={15} /></button></header>
        <div className="dash-week" role="group" aria-label="오늘부터 7일 날짜 선택">
          {days.map((day, i) => <button key={day} aria-pressed={selected === day} aria-label={`${fmtDayShort(day)}${i === 0 ? ' 오늘' : ''}`} onClick={() => setPicked(day)}><span>{i === 0 ? '오늘' : fmtDayShort(day).split('(')[1]?.replace(')', '')}</span><strong>{Number(day.slice(-2))}</strong><i className={ready && tasks.some(e => e.startDate <= day && effectiveEndDate(e) >= day && !isDone(e)) ? 'has-items' : ''} /></button>)}
        </div>
        <div className="dash-agenda-title"><h3>{selected === today ? '오늘 일정' : fmtDayShort(selected)}</h3><span>{ready ? `${selectedTasks.length}개` : '확인 중'}</span><button className="dash-link" onClick={() => onCreate('task', selected)} aria-label="선택한 날짜에 일정 추가"><Icon.Plus size={16} />추가</button></div>
        {ready && (selectedTasks.length ? <ul className="dash-agenda-list">{selectedTasks.map(e => <li key={e.id} className={isDone(e) ? 'is-done' : ''}>
          <button className="dash-check" aria-label={`${displayTitle(e)} ${isDone(e) ? '완료 해제' : '완료로 표시'}`} aria-pressed={isDone(e)} onClick={() => onStatus(e, isDone(e) ? 'planned' : 'done')}>{isDone(e) && <Icon.Check size={14} />}</button>
          <button className="dash-entry" onClick={() => onEntry(e)}><span className="dash-time">{e.startTime ?? '종일'}</span><div><strong>{displayTitle(e)}</strong>{(e.location || e.task?.important || effectiveEndDate(e) > e.startDate) && <small>{[e.task?.important ? '중요' : '', e.location, effectiveEndDate(e) > e.startDate ? `${e.startDate.slice(5)} ~ ${effectiveEndDate(e).slice(5)}` : ''].filter(Boolean).join(' · ')}</small>}</div><Icon.Chevron size={14} /></button>
        </li>)}</ul> : <div className="dash-empty"><Icon.Calendar size={30} /><strong>비워 둔 하루입니다</strong><p>새 일정을 추가하거나 여유 시간으로 남겨 두세요.</p></div>)}
        {ready && todayTasks.length > 0 && <div className="dash-progress"><span>오늘의 완료 {done} / {todayTasks.length}</span><progress aria-label="오늘 할 일 완료" value={done} max={todayTasks.length} /></div>}
      </section>
      <div className="dash-secondary">
        {showMoney && <section className="dash-card dash-finance" aria-label="현금흐름 요약">
          <header className="dash-card-head"><div><p className="dash-kicker">CASH FLOW</p><h2>생활비 외 가용</h2></div><span className="dash-icon" data-tone="green"><Icon.Wallet size={22} /></span></header>
          {calc.kind !== 'ready' ? <p className="dash-notice">{calcNotice(calc)}</p> : finance && 'amount' in finance ? <><strong className={'dash-amount' + (finance.amount! < 0 ? ' negative' : '')}>{formatAmount(finance.amount!)}<small>원</small></strong><p>{finance.horizon?.nextIncome ? `${finance.horizon.nextIncome.slice(5).replace('-', '/')} 다음 입금 전날까지` : '앞으로 30일 기준'}</p><div className="dash-money-explain"><span>예정 입출금 반영</span><span>생활비 · 세이브 확보</span><span>카드 미결제 반영</span></div></> : <p className="dash-notice">{finance?.notice}</p>}
          {calcCaveat(calc) && <p className="dash-notice">{calcCaveat(calc)}</p>}
          <button className="dash-finance-link" onClick={() => onNavigate('money')}>현금흐름 자세히 보기 <Icon.ArrowUpRight size={16} /></button>
        </section>}
        {showNotes && <section className="dash-card dash-notes" aria-label="이번 달 최근 노트">
          <header className="dash-card-head"><div><p className="dash-kicker">NOTES</p><h2>다시 펼쳐 볼 생각</h2></div><button className="dash-link" onClick={() => onNavigate('idea')}>노트 <Icon.ArrowUpRight size={15} /></button></header>
          {ready && (notes.length ? <ul>{notes.slice(0, 3).map(e => <li key={e.id}><button onClick={() => onEntry(e)}><span className="dash-note-mark"><Icon.List size={18} /></span><div><strong>{displayTitle(e)}</strong><small>{e.startDate.slice(5).replace('-', '/')} · 이번 달 노트</small></div></button><button className="dash-promote" aria-label={`${displayTitle(e)} 할 일로 옮기기`} onClick={() => onPromote(e)}><Icon.ArrowUpRight size={16} /></button></li>)}</ul> : <p className="dash-notice">이번 달에 적은 노트가 없습니다. 떠오른 생각을 남겨 보세요.</p>)}
          <button className="dash-note-add" onClick={() => onCreate('idea', today)}><Icon.Plus size={15} />새 노트 남기기</button>
        </section>}
      </div>
    </div>
  </div>;
}
