/**
 * 생활비 예산과 세이브.
 *
 * ── 왜 종류가 아니라 문서인가 ───────────────────────────────────
 *
 * 예전에는 둘 다 `MoneyType` 값이었다 (`living` · `save`). 그래서 생활비 70만을 적고
 * 그 안에서 점심 1만 2천을 적으면 71만 2천이 나가는 것으로 세어졌다 — 예산은 나가는
 * 돈의 **상한**인데 항목이 하나 더 늘어난 셈이었다. 지금 생활비는 주머니 하나이고,
 * 지출은 그 주머니를 **가리킨다** (`money.budgetId`).
 *
 * 현금흐름 보기의 '생활비 · 세이브' 창(`PocketSheet`) 안에 펼쳐 둔다(`bare`). 카드의 확보 줄과
 * 달력의 생활비 막대가 **같은 이 조각**을 연다 — 고르는 자리가 둘이어도 고치는 화면은 하나다.
 * 카테고리 예산(예산 보기)과는 섞지 않는다. 그쪽은 결산용이고 이것은 한도를 예약하는 돈이다.
 */

/** 창을 열 때 무엇을 펼쳐 둘지. 생활비 · 세이브 하나를 열거나 새로 만들기를 바로 연다. */
export type PocketFocus =
  | { kind: 'budget'; id: string }
  | { kind: 'reserve'; id: string }
  | { kind: 'newBudget' }
  | { kind: 'newReserve' }
  | { kind: 'list' };
import { useEffect, useRef, useState } from 'react';
import {
  budgetEnded, budgetStates, newBudget, newReserve, spendingIn, unlinkedSpendingFor, type BudgetState,
} from '../domain/budget';
import { fmtDayShort } from '../domain/date';
import { formatAmount, minorToInput, parseAmountToMinor } from '../domain/money';
import type { Account, Budget, Entry, Reserve } from '../domain/types';
import { Icon } from './Icon';
import { PICKER } from './pickerField';

interface Props {
  budgets: readonly Budget[];
  reserves: readonly Reserve[];
  /**
   * 예산에 걸린 지출을 찾을 **원본** 목록. 계산용 목록을 그대로 받는다.
   *
   * 화면용으로 펼친 목록(`materialize()` 결과)을 넘기면 반복 발생분이 섞여
   * 같은 지출이 여러 번 세어진다. 예산에 반복 항목을 걸 수 없는 이유이기도 하다.
   */
  entries: readonly Entry[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** 접는 머리 없이 늘 펼친 구역으로 그린다. 제목은 부르는 쪽이 단다. */
  bare?: boolean;
  /** 오늘. 종료일이 지난 주머니에 "끝남 — 남은 돈은 예약하지 않음" 을 적는다. */
  todayISO?: string;
  /** 실제 지출이 이미 잔고에 들어갔는지 가르는 데 쓴다. 없으면 반영 여부를 적지 않는다. */
  accounts?: readonly Account[];
  onSaveBudget: (b: Budget) => void;
  onDeleteBudget: (b: Budget) => void;
  onSaveReserve: (r: Reserve) => void;
  onDeleteReserve: (r: Reserve) => void;
  onEntryClick?: (e: Entry) => void;
  /** 사용처를 정하지 않은 실제 지출을 이 주머니에 건다. 여러 건을 한 번에. */
  onLinkEntries?: (es: Entry[], b: Budget) => void;
  /** 그 지출을 "생활비 외" 로 명시한다. 미결정 목록에서 빠진다. */
  onMarkOutside?: (e: Entry) => void;
  /** 처음 열 때 펼쳐 둘 것. 그 줄로 스크롤한다. */
  focus?: PocketFocus;
}

export function BudgetPanel({
  budgets, reserves, entries, collapsed: collapsedPref, onToggleCollapsed, bare = false, todayISO, accounts,
  onSaveBudget, onDeleteBudget, onSaveReserve, onDeleteReserve, onEntryClick, onLinkEntries, onMarkOutside, focus,
}: Props) {
  const [draft, setDraft] = useState<Budget | null>(() => (focus?.kind === 'newBudget' ? newBudget() : null));
  const [amountText, setAmountText] = useState('');
  const [openId, setOpenId] = useState<string | null>(focus?.kind === 'budget' ? focus.id : null);
  const [reserveDraft, setReserveDraft] = useState<Reserve | null>(() => {
    if (focus?.kind === 'newReserve') return newReserve();
    if (focus?.kind === 'reserve') return reserves.find((r) => r.id === focus.id) ?? null;
    return null;
  });
  const [reserveText, setReserveText] = useState(() => {
    const r = focus?.kind === 'reserve' ? reserves.find((x) => x.id === focus.id) : null;
    return r?.amountMinor ? minorToInput(r.amountMinor, r.currency) : '';
  });
  const root = useRef<HTMLDivElement>(null);
  // 연 줄로 한 번 스크롤한다 — 생활비가 여럿이면 고른 것이 창 아래에 묻힐 수 있다.
  useEffect(() => {
    const key = focus && 'id' in focus ? focus.id : focus?.kind;
    if (!key) return;
    root.current?.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [focus]);

  const collapsed = bare ? false : collapsedPref;
  const states = budgetStates(budgets, entries, { accounts, today: todayISO });
  const reservedMinor = reserves.reduce((t, r) => t + r.amountMinor, 0);

  const startEdit = (b: Budget) => {
    setDraft(b);
    setAmountText(b.amountMinor ? minorToInput(b.amountMinor, b.currency) : '');
  };

  const commitBudget = () => {
    if (!draft) return;
    const amountMinor = parseAmountToMinor(amountText, draft.currency) ?? 0;
    const name = draft.name.trim() || '생활비';
    // 기간이 뒤집혀 있으면 어떤 지출도 품지 못한다. 시작일로 맞춘다.
    const endDate = draft.endDate < draft.startDate ? draft.startDate : draft.endDate;
    onSaveBudget({
      ...draft, name, endDate,
      amountMinor: Math.abs(amountMinor),
      updatedAt: new Date().toISOString(),
    });
    setDraft(null);
  };

  const startReserve = (r: Reserve) => {
    setReserveDraft(r);
    setReserveText(r.amountMinor ? minorToInput(r.amountMinor, r.currency) : '');
  };

  const commitReserve = () => {
    if (!reserveDraft) return;
    onSaveReserve({
      ...reserveDraft,
      name: reserveDraft.name.trim() || '세이브',
      amountMinor: Math.abs(parseAmountToMinor(reserveText, reserveDraft.currency) ?? 0),
      updatedAt: new Date().toISOString(),
    });
    setReserveDraft(null);
  };

  const summary = [
    budgets.length > 0 && `생활비 ${budgets.length}건`,
    reservedMinor > 0 && `세이브 ${formatAmount(reservedMinor)}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className={'bp' + (bare ? ' bare' : '')} ref={root}>
      {!bare && (
        <button className="debt-h" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
          <Icon.Chevron size={13} dir={collapsed ? 'right' : 'down'} />
          <span className="debt-h-t">생활비 · 세이브</span>
          {summary && <span className="debt-h-n num">{summary}</span>}
        </button>
      )}

      {collapsed && states.length > 0 && (
        <div className="bp-compact">
          {states.map(({ budget, actualMinor, remainingMinor }) => (
            <p key={budget.id}>
              <span>{budget.name}</span>
              <span className="num">사용 {formatAmount(actualMinor)} · 남음 {formatAmount(remainingMinor)} {budget.currency}</span>
            </p>
          ))}
        </div>
      )}
      {!collapsed && (
        <div className="debt-b">
          {states.map((s) => (
            draft?.id === s.budget.id ? (
              <BudgetForm
                key={s.budget.id} focusKey={s.budget.id} draft={draft} amountText={amountText}
                onDraft={setDraft} onAmount={setAmountText}
                onCancel={() => setDraft(null)} onSave={commitBudget}
              />
            ) : (
              <BudgetRow
                key={s.budget.id}
                focusKey={s.budget.id}
                state={s}
                open={openId === s.budget.id}
                entries={entries}
                onToggle={() => setOpenId(openId === s.budget.id ? null : s.budget.id)}
                onEdit={() => startEdit(s.budget)}
                onDelete={() => onDeleteBudget(s.budget)}
                onEntryClick={onEntryClick}
                onLinkEntries={onLinkEntries}
                onMarkOutside={onMarkOutside}
                ended={todayISO !== undefined && budgetEnded(s.budget, todayISO)}
              />
            )
          ))}

          {draft && !budgets.some((b) => b.id === draft.id) ? (
            <BudgetForm
              focusKey="newBudget"
              draft={draft} amountText={amountText}
              onDraft={setDraft} onAmount={setAmountText}
              onCancel={() => setDraft(null)} onSave={commitBudget}
            />
          ) : (
            <button className="debt-add" onClick={() => startEdit(newBudget())}>
              + 생활비 만들기
            </button>
          )}

          <hr className="bp-sep" />

          {reserves.map((r) => (
            reserveDraft?.id === r.id ? (
              <ReserveForm
                key={r.id} focusKey={r.id} draft={reserveDraft} amountText={reserveText}
                onDraft={setReserveDraft} onAmount={setReserveText}
                onCancel={() => setReserveDraft(null)} onSave={commitReserve}
              />
            ) : (
              <div key={r.id} className="debt-i">
                <button className="debt-i-main" onClick={() => startReserve(r)}>
                  <span className="debt-n">{r.name}</span>
                  <span className="debt-d num">{formatAmount(r.amountMinor)}원 · 한도에서 빠짐</span>
                </button>
                <button className="debt-x" onClick={() => onDeleteReserve(r)} aria-label={`${r.name} 삭제`}>
                  <Icon.X size={12} />
                </button>
              </div>
            )
          ))}

          {reserveDraft && !reserves.some((r) => r.id === reserveDraft.id) ? (
            <ReserveForm
              focusKey="newReserve"
              draft={reserveDraft} amountText={reserveText}
              onDraft={setReserveDraft} onAmount={setReserveText}
              onCancel={() => setReserveDraft(null)} onSave={commitReserve}
            />
          ) : (
            <button className="debt-add" onClick={() => startReserve(newReserve())}>
              + 세이브 추가
            </button>
          )}

          <p className="bp-note">
            세이브는 잔고에서 빠지지 않습니다. 통장에는 그대로 있고, 쓸 수 있는 한도에서만 빠집니다.
          </p>
        </div>
      )}
    </div>
  );
}

function BudgetRow({
  state, open, entries, onToggle, onEdit, onDelete, onEntryClick, onLinkEntries, onMarkOutside, ended = false, focusKey,
}: {
  ended?: boolean;
  focusKey?: string;
  state: BudgetState;
  open: boolean;
  entries: readonly Entry[];
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEntryClick?: (e: Entry) => void;
  onLinkEntries?: (es: Entry[], b: Budget) => void;
  onMarkOutside?: (e: Entry) => void;
}) {
  const {
    budget, actualMinor, plannedMinor, unsettledMinor, remainingMinor, remainingWithPlannedMinor,
    overspentMinor, plannedOverMinor, count,
  } = state;
  // 총 예산이 0이면 비율을 낼 수 없다. 막대를 그리지 않는다. 막대는 실제로 쓴 돈만 채운다.
  const ratio = budget.amountMinor > 0
    ? Math.min(1, actualMinor / budget.amountMinor)
    : 0;
  const linked = open ? spendingIn(budget, entries) : [];
  const loose = unlinkedSpendingFor(budget, entries);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const chosen = loose.filter((e) => picked.has(e.id));
  const chosenSum = chosen.reduce((t, e) => t + Math.abs(e.money?.amountMinor ?? 0), 0);
  const afterLink = budget.amountMinor - actualMinor - chosenSum;
  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="bp-i" data-focus={focusKey}>
      <div className="debt-i">
        <button className="debt-i-main" onClick={onToggle} aria-expanded={open}>
          <span className="debt-n">{budget.name}</span>
          <span className="debt-d num">
            {fmtDayShort(budget.startDate)} – {fmtDayShort(budget.endDate)} · 생활비 {formatAmount(budget.amountMinor)}원
          </span>
          <span className={'bp-bar' + (overspentMinor > 0 ? ' over' : '')}>
            <span className="bp-bar-f" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
          {/*
            실제 사용 · 남은 생활비 · 예정은 다른 숫자다. 예정은 쓴 돈에 넣지 않는다 — 다음 주에
            잡아 둔 장보기가 이미 쓴 돈처럼 보이면 남은 생활비가 실제보다 작게 읽힌다.
          */}
          <span className="bp-stats num">
            <span>실제 사용 <b>{formatAmount(actualMinor)}</b></span>
            {overspentMinor > 0
              ? <span>남은 생활비 <b>0</b> · <b className="bp-over">초과 {formatAmount(overspentMinor)}</b></span>
              : <span>남은 생활비 <b>{formatAmount(remainingMinor)}</b></span>}
            {plannedMinor > 0 && (
              <span>
                예정 사용 <b>{formatAmount(plannedMinor)}</b>
                {plannedOverMinor > overspentMinor
                  ? <> · <b className="bp-over">예정까지 쓰면 {formatAmount(plannedOverMinor)} 초과</b></>
                  : <> · 예정 반영 시 남음 {formatAmount(remainingWithPlannedMinor)}</>}
              </span>
            )}
            {unsettledMinor > 0 && <span>잔고에 아직 안 들어간 사용 {formatAmount(unsettledMinor)}</span>}
            {count > 0 && <span className="bp-count">연결 {count}건</span>}
          </span>
          {ended && (
            <span className="debt-d">끝남 — 남은 생활비는 더 이상 가용 한도에서 빼 두지 않습니다. 아직 잔고에 안 들어간 지출만 셉니다.</span>
          )}
        </button>
        <button className="bp-e" onClick={onEdit} aria-label={`${budget.name} 고치기`}>
          <Icon.Settings size={12} />
        </button>
        <button className="debt-x" onClick={onDelete} aria-label={`${budget.name} 삭제`}>
          <Icon.X size={12} />
        </button>
      </div>

      {open && (
        linked.length > 0 ? (
          <ul className="bp-ul" aria-label={`${budget.name} 연결 거래`}>
            {linked.map((e) => {
              const actual = e.money?.status === 'actual';
              return (
                <li key={e.id}>
                  <button className={'bp-li' + (actual ? '' : ' planned')} onClick={() => onEntryClick?.(e)}>
                    <span className="bp-li-d num">{fmtDayShort(e.startDate)}</span>
                    <span className="bp-li-t">
                      <i className={'bp-st' + (actual ? '' : ' plan')}>{actual ? '실제' : '예정'}</i>
                      {e.title.trim() || '(제목 없음)'}
                    </span>
                    <span className="bp-li-a num">{formatAmount(Math.abs(e.money?.amountMinor ?? 0))}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="bp-empty">아직 이 생활비에서 쓴 것이 없습니다.</p>
        )
      )}
      {/*
        기간 안의 실제 일반 지출 가운데 사용처를 **정하지 않은** 것. "생활비 외" 로 명시한 것은
        여기 없다. 자동으로 걸지 않는다 — 금액만으로 생활비인지 알 수 없다. 사용자가 고른다.
      */}
      {loose.length > 0 && !open && (
        <button className="bp-loose" onClick={onToggle}>
          이 기간에 사용처를 정하지 않은 지출 {loose.length}건 · 확인
        </button>
      )}
      {loose.length > 0 && open && (
        <div className="bp-loose-l">
          <p className="bp-note">
            사용처를 정하지 않은 지출 {loose.length}건 — 생활비에서 쓴 것은 골라 연결하고, 아니면 &lsquo;생활비 외&rsquo; 로 두세요.
          </p>
          <ul className="bp-ul" aria-label="사용처를 정하지 않은 지출">
            {loose.map((e) => (
              <li key={e.id} className="bp-loose-i">
                <label className="bp-pick">
                  <input
                    type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)}
                    aria-label={`${e.title.trim() || '지출'} ${fmtDayShort(e.startDate)} 고르기`}
                  />
                </label>
                <button className="bp-li" onClick={() => onEntryClick?.(e)}>
                  <span className="bp-li-d num">{fmtDayShort(e.startDate)}</span>
                  <span className="bp-li-t">{e.title.trim() || '(내역 없음)'}</span>
                  <span className="bp-li-a num">{formatAmount(Math.abs(e.money?.amountMinor ?? 0))}</span>
                </button>
                {onMarkOutside && (
                  <button className="chip" onClick={() => onMarkOutside(e)}>생활비 외</button>
                )}
              </li>
            ))}
          </ul>
          {onLinkEntries && chosen.length > 0 && (
            <div className="bp-apply" role="group" aria-label="연결 미리보기">
              <p className="num">
                {chosen.length}건 · {formatAmount(chosenSum)}원을 &lsquo;{budget.name}&rsquo; 에 연결 —
                남은 생활비 {formatAmount(remainingMinor)} → <b className={afterLink < 0 ? 'bp-over' : ''}>
                  {afterLink < 0 ? `초과 ${formatAmount(-afterLink)}` : formatAmount(afterLink)}
                </b>
              </p>
              <button
                className="btn primary sm"
                onClick={() => { onLinkEntries(chosen, budget); setPicked(new Set()); }}
              >
                {chosen.length}건 연결
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BudgetForm({
  draft, amountText, onDraft, onAmount, onCancel, onSave, focusKey,
}: {
  focusKey?: string;
  draft: Budget;
  amountText: string;
  onDraft: (b: Budget) => void;
  onAmount: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="debt-f" data-focus={focusKey}>
      <input
        className="mod-input" placeholder="이름 (예: 9월 생활비)" value={draft.name} autoFocus
        onChange={(e) => onDraft({ ...draft, name: e.target.value })}
        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') onSave(); }}
      />
      <div className="debt-grid">
        <label>시작일
          <input
            type="date" className="mod-input" {...PICKER} value={draft.startDate}
            onChange={(e) => onDraft({ ...draft, startDate: e.target.value || draft.startDate })}
          />
        </label>
        <label>종료일
          <input
            type="date" className="mod-input" {...PICKER} value={draft.endDate} min={draft.startDate}
            onChange={(e) => onDraft({ ...draft, endDate: e.target.value || draft.endDate })}
          />
        </label>
        <label>총 예산
          <input
            className="mod-input num" inputMode="numeric" value={amountText} placeholder="0"
            onChange={(e) => onAmount(e.target.value)}
            onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') onSave(); }}
          />
        </label>
      </div>
      <div className="debt-f-a">
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" onClick={onSave}>저장</button>
      </div>
    </div>
  );
}

function ReserveForm({
  draft, amountText, onDraft, onAmount, onCancel, onSave, focusKey,
}: {
  focusKey?: string;
  draft: Reserve;
  amountText: string;
  onDraft: (r: Reserve) => void;
  onAmount: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="debt-f" data-focus={focusKey}>
      <input
        className="mod-input" placeholder="이름 (예: 비상금)" value={draft.name} autoFocus
        onChange={(e) => onDraft({ ...draft, name: e.target.value })}
        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') onSave(); }}
      />
      <input
        className="mod-input num" inputMode="numeric" value={amountText} placeholder="0"
        aria-label="세이브 금액"
        onChange={(e) => onAmount(e.target.value)}
        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') onSave(); }}
      />
      <div className="debt-f-a">
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" onClick={onSave}>저장</button>
      </div>
    </div>
  );
}
