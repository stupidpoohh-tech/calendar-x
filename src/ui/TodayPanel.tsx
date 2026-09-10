/**
 * 오늘 하나로 보기.
 *
 * 이 서비스의 컨셉은 "같은 캘린더 축에서 세 가지를 관리한다"였지만, 이전 구조는 탭 3개가
 * 서로 완전히 격리된 3개의 캘린더였다. 탭을 바꾸지 않으면 오늘 할 일과 오늘 나갈 돈을
 * 같이 볼 수 없었다. 이 패널이 그 세 축을 한 줄에 올린다.
 *
 * 전체 렌즈의 요약 카드는 이것 하나다. 잔고·대출·고정 메모가 아래에 따로 서 있으면
 * 모바일에서 캘린더가 화면 두 번 아래로 밀린다. 잔고는 이 카드 안으로 들어왔고,
 * 대출과 고정 메모는 각자의 렌즈로 갔다.
 */
import { useMemo, useState } from 'react';
import { MONEY_TYPE_BY_ID } from '../domain/constants';
import { headlineLimit, horizonOf } from '../domain/tide';
import type { Account } from '../domain/types';
import { addDaysISO, fmtDayShort } from '../domain/date';
import { displayTitle, effectiveEndDate, isDone, newEntry } from '../domain/entry';
import { formatAmount } from '../domain/money';
import type { Entry, TaskStatus } from '../domain/types';
import { BalanceInput, BalanceNote, useBalanceEditor } from './balanceEditor';
import { Icon } from './Icon';

interface Props {
  todayISO: string;
  /** 화면에 그릴 목록. 반복이 펼쳐져 있고 필터 이전이다. */
  entries: readonly Entry[];
  /**
   * 금액 계산용 원본. 반복을 펼치지 않은 목록이라야 한다.
   * 펼친 목록을 넣으면 tide 가 한 번 더 전개해 같은 입출금을 여러 번 센다.
   */
  tideEntries: readonly Entry[];
  accounts: readonly Account[];
  /** 잔고를 한 번도 입력하지 않았으면 tide 값을 0으로 단정하지 않는다. */
  hasBalance: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  moneyCollapsed: boolean;
  onToggleMoneyCollapsed: () => void;
  onEntryClick: (e: Entry) => void;
  onStatusChange: (e: Entry, status: TaskStatus) => void;
  onPromote: (e: Entry) => void;
  onQuickIdea: (e: Entry) => void;
  onSaveAccount: (a: Account) => void;
}

function occursOnDay(e: Entry, iso: string): boolean {
  return e.startDate <= iso && effectiveEndDate(e) >= iso;
}

export function TodayPanel({
  todayISO, entries, tideEntries, accounts, hasBalance,
  collapsed, onToggleCollapsed, moneyCollapsed, onToggleMoneyCollapsed,
  onEntryClick, onStatusChange, onPromote, onQuickIdea, onSaveAccount,
}: Props) {
  const [idea, setIdea] = useState('');
  // 정산은 계산이다. 원본을 넘긴다.
  const editor = useBalanceEditor(accounts, tideEntries, onSaveAccount);

  const weekEndISO = addDaysISO(todayISO, 6);

  const { tasks, ideas, money, upcoming } = useMemo(() => {
    const today = entries.filter((e) => occursOnDay(e, todayISO));
    return {
      tasks: today.filter((e) => e.kind === 'task').sort(byTime),
      ideas: today.filter((e) => e.kind === 'idea').sort(byTime),
      money: today.filter((e) => e.kind === 'money').sort(byTime),
      upcoming: entries
        .filter((e) => e.startDate > todayISO && e.startDate <= weekEndISO)
        .sort(byTime)
        .slice(0, 6),
    };
  }, [entries, todayISO, weekEndISO]);

  // '오늘 마감 예상' 대신 tide-over 규칙 — 다음 입금까지 남는 한도.
  const horizon = useMemo(() => horizonOf(tideEntries, todayISO), [tideEntries, todayISO]);
  const tideLimit = useMemo(
    () => hasBalance ? headlineLimit(accounts, tideEntries, todayISO) : null,
    [hasBalance, accounts, tideEntries, todayISO],
  );

  const submitIdea = () => {
    const text = idea.trim();
    if (!text) return;
    onQuickIdea(newEntry('idea', { title: text, startDate: todayISO }));
    setIdea('');
  };

  const doneCount = tasks.filter(isDone).length;

  return (
    <section className={'tp' + (collapsed ? ' collapsed' : '')} aria-label="오늘">
      {/*
        머리글 전체가 접기 버튼이다. 접었을 때도 요약 줄은 남는다 — 접는 값이
        '캘린더를 빨리 본다' 인데, 접자마자 세 질문의 답이 사라지면 손해가 더 크다.
      */}
      <button
        type="button"
        className="tp-h"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? '오늘 펼치기' : '오늘 접기'}
      >
        <span className="tp-h-main">
          <h2 className="tp-t">오늘 <span className="tp-d">{fmtDayShort(todayISO)}</span></h2>
          <span className="tp-sum">
            할 일 {doneCount}/{tasks.length}
            {money.length > 0 && ` · 가계부 ${money.length}건`}
            {ideas.length > 0 && ` · 아이디어 ${ideas.length}건`}
            {collapsed && tideLimit != null && ` · ₩ ${formatAmount(tideLimit)}`}
          </span>
        </span>
        <Icon.Chevron size={14} dir={collapsed ? 'right' : 'down'} />
      </button>

      {!collapsed && (
        <>
          <div className="tp-cols">
            {/* ---- 할 일 ---- */}
            <div className="tp-col" data-axis="task">
              <h3 className="tp-ct">할 일</h3>
              {tasks.length === 0 ? (
                <p className="tp-empty">오늘 잡힌 일이 없습니다.</p>
              ) : (
                <ul className="tp-ul">
                  {tasks.map((e) => (
                    <li key={e.id} className={'tp-task' + (isDone(e) ? ' done' : '')}>
                      <button
                        className="tp-check"
                        aria-label={isDone(e) ? '완료 해제' : '완료로 표시'}
                        aria-pressed={isDone(e)}
                        onClick={() => onStatusChange(e, isDone(e) ? 'planned' : 'done')}
                      >
                        {isDone(e) && <Icon.Check size={11} />}
                      </button>
                      <button className="tp-task-t" onClick={() => onEntryClick(e)}>
                        {e.startTime && <span className="tp-time num">{e.startTime}</span>}
                        <span>{displayTitle(e)}</span>
                        {e.task?.urgent && <Icon.Flame size={11} filled fillColor="#ef4444" stroke="#ef4444" />}
                        {e.task?.important && <Icon.Star size={11} filled fillColor="#f59e0b" stroke="#f59e0b" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ---- 아이디어 ---- */}
            <div className="tp-col" data-axis="idea">
              <h3 className="tp-ct">아이디어</h3>
              <ul className="tp-ul">
                {ideas.map((e) => (
                  <li key={e.id} className="tp-idea">
                    <button className="tp-idea-t" onClick={() => onEntryClick(e)}>{displayTitle(e)}</button>
                    {/* 축 간 전환. 이전 구조에서는 탭이 곧 컬렉션이라 불가능했다. */}
                    <button className="tp-promote" onClick={() => onPromote(e)} title="할 일로 옮기기">
                      <Icon.ArrowUpRight size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <input
                className="tp-capture" value={idea} placeholder="떠오른 것 적어 두기"
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') { e.preventDefault(); submitIdea(); }
                }}
              />
            </div>

            {/* ---- 가계부 ---- */}
            <div className={'tp-col' + (moneyCollapsed ? ' collapsed' : '')} data-axis="money">
              <button
                type="button"
                className="tp-ct tp-ct-toggle"
                onClick={onToggleMoneyCollapsed}
                aria-expanded={!moneyCollapsed}
                aria-label={moneyCollapsed ? '가계부 펼치기' : '가계부 접기'}
              >
                <span>가계부</span>
                <Icon.Chevron size={11} dir={moneyCollapsed ? 'right' : 'down'} />
              </button>
              {!moneyCollapsed && (
                <>
                  {/* 금액은 하나만. 누르면 그 자리에서 잔고를 고친다. */}
                  {editor.editing ? (
                    <BalanceInput editor={editor} size="sm" />
                  ) : tideLimit != null ? (
                    <button
                      type="button"
                      className={'tp-bal' + (tideLimit < 0 ? ' bad' : '')}
                      onClick={editor.start}
                      aria-label="잔고 고치기"
                    >
                      <span className="tp-bal-l">
                        {horizon.nextIncome
                          ? `다음 입금 전날까지`
                          : '앞으로 30일 · 이 돈으로'}
                      </span>
                      <strong className="num">₩ {formatAmount(tideLimit)}</strong>
                    </button>
                  ) : (
                    <p className="tp-empty">잔고를 적으면 다음 입금까지 남는 한도가 여기 뜹니다.</p>
                  )}
                  {!editor.editing && <BalanceNote editor={editor} />}
                  <ul className="tp-ul">
                    {money.map((e) => {
                      const type = e.money ? MONEY_TYPE_BY_ID[e.money.type] : null;
                      return (
                        <li key={e.id} className="tp-money">
                          <button className="tp-money-t" onClick={() => onEntryClick(e)}>
                            <span className="tp-dot" style={{ background: type?.color }} />
                            <span>{e.title || type?.label}</span>
                            {e.money && type && (
                              <span className={'num ' + (type.sign > 0 ? 'plus' : type.sign < 0 ? 'minus' : '')}>
                                {formatAmount(e.money.amountMinor)}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>

          {upcoming.length > 0 && (
            <div className="tp-next">
              <h3 className="tp-ct">이번 주</h3>
              <ul className="tp-next-ul">
                {upcoming.map((e) => (
                  <li key={e.id}>
                    <button onClick={() => onEntryClick(e)}>
                      <span className="tp-next-d num">{e.startDate.slice(5).replace('-', '/')}</span>
                      <span className="tp-next-k" data-kind={e.kind} />
                      <span className="tp-next-t">{displayTitle(e)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function byTime(a: Entry, b: Entry): number {
  return `${a.startTime ?? '99:99'}`.localeCompare(`${b.startTime ?? '99:99'}`);
}
