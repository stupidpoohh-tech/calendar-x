/**
 * 카드대금 (Financial Core P4) — 현금흐름 카드 안의 한 줄(`CardLine`)과 그 줄이 여는 창(`CardSheet`).
 *
 * 카드로 쓴 돈은 쓴 날 소비로 세고, 결제일에 대금으로 현금이 나간다. 그 사이의 미결제는 가용 한도에서 미리 빠진다.
 * 이 창은 카드마다 미결제 · 이번 결제 · 결제일을 보여 주고, 펼치면 청구 회차(이용 기간 · 청구 · 납부 · 남음)와
 * 그 회차의 사용 · 대금을 보여 준다. 숫자는 저장하지 않고 거래에서 센다(`card.ts`).
 *
 * 별도 대시보드 · 탭을 만들지 않는다. 대금 기록 · 예정 대금은 원래 있는 거래 창을 미리 채워 연다.
 */
import { useEffect, useState } from 'react';
import {
  activeCards, archivedCards, cardProblem, cardState, cycleByKey, describeCycle, fmtMonthDay, newCard, suspectCardPayments,
  type CardState, type CycleState,
} from '../domain/card';
import { fmtDayShort } from '../domain/date';
import { formatAmount } from '../domain/money';
import type { Account, Card, DateISO, Entry } from '../domain/types';
import { Icon } from './Icon';

const NO_ENTRIES: readonly Entry[] = [];
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** 현금흐름 카드 안의 한 줄. 카드가 없으면 '카드 등록' 하나만 얇게. */
export function CardLine({ cards, cardEntries, plans = NO_ENTRIES, todayISO, onOpen }: {
  cards: readonly Card[];
  cardEntries: readonly Entry[];
  /** 계산용 원본 목록. 카드에 연결되지 않은 예정 카드대금(중복 가능성)을 센다. */
  plans?: readonly Entry[];
  todayISO: DateISO;
  onOpen: () => void;
}) {
  const suspects = activeCards(cards).length > 0 ? suspectCardPayments(plans, todayISO).length : 0;
  const states = activeCards(cards).map((c) => cardState(c, cardEntries, todayISO));
  // 보관한 카드에도 빚이 남아 있으면 미결제에 넣는다 — 보관은 고르는 자리에서 빼는 것일 뿐이다.
  const archivedDebt = archivedCards(cards)
    .reduce((t, c) => t + cardState(c, cardEntries, todayISO).outstandingMinor, 0);
  const outstanding = states.reduce((t, s) => t + s.outstandingMinor, 0) + archivedDebt;
  const overdue = states.some((s) => s.overdue.length > 0);
  const next = states.map((s) => s.next).filter((c): c is CycleState => !!c)
    .sort((a, b) => a.payDate.localeCompare(b.payDate))[0];
  return (
    <div className="debt cd-line">
      <button className="debt-h" onClick={onOpen} aria-label="카드대금 열기">
        <Icon.Chevron size={13} dir="right" />
        <span className="debt-h-t">카드대금</span>
        <span className={'debt-h-n num' + (overdue ? ' bp-over' : '')}>
          {cards.length === 0
            ? '카드 등록'
            : <>미결제 {formatAmount(outstanding)}{next && ` · ${md(next.payDate)} 결제 ${formatAmount(next.remainingMinor)}`}{overdue && ' · 결제일 지남'}{suspects > 0 && ` · 확인 ${suspects}건`}</>}
        </span>
      </button>
    </div>
  );
}

interface SheetProps {
  cards: readonly Card[];
  cardEntries: readonly Entry[];
  accounts: readonly Account[];
  todayISO: DateISO;
  onClose: () => void;
  onSaveCard: (c: Card) => void;
  /** 연결된 거래가 있으면 부르는 쪽이 지우지 않고 보관을 권한다. */
  onDeleteCard: (c: Card) => void;
  onEntryClick: (e: Entry) => void;
  /** 대금을 거래 창으로 적는다. 실제(오늘) 또는 예정(결제일). 금액 · 회차를 미리 채운다. */
  onRecordPayment: (c: Card, cycle: CycleState, planned: boolean) => void;
  /** 계산용 원본 목록 — 카드에 연결되지 않은 예정 카드대금을 찾는다. */
  plans?: readonly Entry[];
  /** 사용자가 고른 예정을 그 카드의 대금으로 잇는다. 자동으로 부르지 않는다. */
  onLinkPlanned?: (e: Entry, c: Card) => void;
}

export function CardSheet({ onClose, ...panel }: SheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="카드대금" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-h">
          <div>
            <div className="sheet-eyebrow">결제일에 나갈 돈</div>
            <h2 className="sheet-t">카드대금</h2>
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>
        <div className="sheet-b">
          <CardPanel {...panel} />
        </div>
      </div>
    </div>
  );
}

function CardPanel({
  cards, cardEntries, accounts, todayISO, onSaveCard, onDeleteCard, onEntryClick, onRecordPayment,
  plans = NO_ENTRIES, onLinkPlanned,
}: Omit<SheetProps, 'onClose'>) {
  const [draft, setDraft] = useState<Card | null>(
    () => (cards.length === 0 ? newCard({ name: '', accountId: accounts[0]?.id ?? null }) : null),
  );
  const [openId, setOpenId] = useState<string | null>(() => activeCards(cards)[0]?.id ?? null);
  const [showArchived, setShowArchived] = useState(false);
  const active = activeCards(cards);
  const archived = archivedCards(cards);

  const save = (c: Card) => {
    onSaveCard({ ...c, name: c.name.trim(), updatedAt: new Date().toISOString() });
    setDraft(null);
    setOpenId(c.id);
  };

  const suspects = active.length > 0 ? suspectCardPayments(plans, todayISO) : [];

  return (
    <div className="bp bare">
      <div className="debt-b">
        {/*
          카드를 등록하기 전부터 적어 둔 예정 카드대금. 카드 미결제와 따로 빠져 같은 돈이 두 번 빠질 수 있다.
          자동으로 바꾸지 않는다 — 카드에 이을지 사용자가 고른다. 잇지 않을 예정이면 그 줄을 눌러 고치거나 지운다.
        */}
        {suspects.length > 0 && (
          <div className="cd-suspect" role="group" aria-label="카드에 연결되지 않은 예정 카드대금">
            <p className="bp-note">
              카드에 연결되지 않은 예정 카드대금이 {suspects.length}건 있습니다. 같은 대금을 카드 미결제가 이미 지키고 있다면
              한도에서 두 번 빠집니다. 카드에 이으면 그 회차의 대금으로 한 번만 셉니다.
            </p>
            <ul className="bp-ul">
              {suspects.map((e) => (
                <li key={e.id} className="cd-suspect-i">
                  <button className="bp-li planned" onClick={() => onEntryClick(e)}>
                    <span className="bp-li-d num">{e.recurrence ? `매월 ${Number(e.startDate.slice(8, 10))}일` : fmtMonthDay(e.startDate)}</span>
                    <span className="bp-li-t">{e.title.trim() || '(제목 없음)'}</span>
                    <span className="bp-li-a num">{formatAmount(Math.abs(e.money?.amountMinor ?? 0))}</span>
                  </button>
                  {onLinkPlanned && active.map((c) => (
                    <button key={c.id} className="chip" onClick={() => onLinkPlanned(e, c)} aria-label={`${e.title.trim() || '예정'}을(를) ${c.name} 대금으로 잇기`}>
                      {c.name}에 잇기
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}
        {active.map((c) => (
          draft?.id === c.id ? (
            <CardForm key={c.id} draft={draft} accounts={accounts} onDraft={setDraft} onCancel={() => setDraft(null)} onSave={save}
              onArchive={() => { save({ ...c, archivedAt: new Date().toISOString() }); setDraft(null); }} />
          ) : (
            <CardBlock
              key={c.id} state={cardState(c, cardEntries, todayISO)} accounts={accounts}
              open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              onEdit={() => setDraft(c)} onDelete={() => onDeleteCard(c)}
              onEntryClick={onEntryClick} onRecordPayment={onRecordPayment}
            />
          )
        ))}

        {draft && !cards.some((c) => c.id === draft.id) ? (
          <CardForm draft={draft} accounts={accounts} onDraft={setDraft} onCancel={() => setDraft(null)}
            onSave={(c) => save({ ...c, order: cards.length })} />
        ) : (
          <button className="debt-add" onClick={() => setDraft(newCard({ name: '', accountId: accounts[0]?.id ?? null }))}>
            + 카드 등록
          </button>
        )}

        {archived.length > 0 && (
          <div className="rv-arch">
            <button className="rv-arch-h" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
              <Icon.Chevron size={12} dir={showArchived ? 'down' : 'right'} />
              보관한 카드 {archived.length}장
            </button>
            {showArchived && archived.map((c) => {
              const st = cardState(c, cardEntries, todayISO);
              return (
                <div key={c.id} className="debt-i">
                  <span className="debt-i-main rv-arch-i">
                    <span className="debt-n">{c.name}</span>
                    <span className="debt-d num">
                      {st.outstandingMinor > 0 ? `미결제 ${formatAmount(st.outstandingMinor)}원 — 가용 한도에서 계속 빠집니다` : '미결제 없음'}
                    </span>
                  </span>
                  <button className="chip" onClick={() => onSaveCard({ ...c, archivedAt: null, updatedAt: new Date().toISOString() })}>보관 해제</button>
                </div>
              );
            })}
          </div>
        )}

        <p className="bp-note">
          카드로 쓴 돈은 쓴 날 소비로 세고, 현금은 결제일에 대금으로 나갑니다. 아직 내지 않은 미결제는 가용 한도에서 미리
          빠지고, 적지 않은 대금은 결제일의 예상 잔고에서 빠집니다. 대금을 적으면 그 회차의 미결제가 줄어듭니다.
          휴일로 출금일이 밀리면 '예정 대금 적기' 로 날짜를 고쳐 적으세요.
        </p>
      </div>
    </div>
  );
}

function CardBlock({
  state, accounts, open, onToggle, onEdit, onDelete, onEntryClick, onRecordPayment,
}: {
  state: CardState;
  accounts: readonly Account[];
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEntryClick: (e: Entry) => void;
  onRecordPayment: (c: Card, cycle: CycleState, planned: boolean) => void;
}) {
  const { card, cycles, outstandingMinor, next, overdue } = state;
  const [cycleOpen, setCycleOpen] = useState<string | null>(null);
  // 갚을 차례인 회차 — 지난 것이 먼저, 없으면 이번 결제.
  const due = overdue[0] ?? next;
  const account = card.accountId ? accounts.find((a) => a.id === card.accountId) : null;
  const shown = [...cycles].reverse().slice(0, 8);
  return (
    <div className="bp-i" data-focus={card.id}>
      <div className="debt-i">
        <button className="debt-i-main" onClick={onToggle} aria-expanded={open}>
          <span className="debt-n">{card.name}</span>
          <span className="debt-d num">
            미결제 {formatAmount(outstandingMinor)}원
            {next && <> · 이번 결제 {formatAmount(next.remainingMinor)} ({fmtMonthDay(next.payDate)}{next.closed ? '' : ' · 이용 중 · 예상'})</>}
          </span>
          <span className="debt-d">{describeCycle(card)}{account ? ` · ${account.name}` : ''}</span>
          {overdue.length > 0 && (
            <span className="debt-d bp-over">
              결제일이 지난 회차 {overdue.length}건 · {formatAmount(overdue.reduce((t, c) => t + c.remainingMinor, 0))}원 — 냈으면 대금을 적어 주세요
            </span>
          )}
        </button>
        <button className="bp-e" onClick={onEdit} aria-label={`${card.name} 고치기`}><Icon.Settings size={12} /></button>
        <button className="debt-x" onClick={onDelete} aria-label={`${card.name} 삭제`}><Icon.X size={12} /></button>
      </div>
      {open && (
        <div className="rv-detail">
          {due && (
            <div className="cd-actions">
              <button className="btn primary sm" onClick={() => onRecordPayment(card, due, false)}>
                {md(due.payDate)} 결제분 대금 기록
              </button>
              <button className="chip" onClick={() => onRecordPayment(card, due, true)}>예정 대금 적기</button>
            </div>
          )}
          {shown.length === 0 && <p className="bp-empty">아직 이 카드로 적은 거래가 없습니다. 지출을 적을 때 결제수단에서 고릅니다.</p>}
          {shown.length > 0 && (
            <ul className="bp-ul cd-cycles" aria-label={`${card.name} 청구 회차`}>
              {shown.map((c) => (
                <li key={c.key}>
                  <button className="bp-li cd-cy" onClick={() => setCycleOpen(cycleOpen === c.key ? null : c.key)} aria-expanded={cycleOpen === c.key}>
                    <span className="bp-li-d num">{md(c.payDate)} 결제</span>
                    <span className="bp-li-t num">
                      {md(c.start)}~{md(c.close)} · 청구 {formatAmount(c.billedMinor)}{c.closed ? '' : '(예상)'} · 납부 {formatAmount(c.paidMinor)}
                      {c.overpaidMinor > 0 && ` · 더 낸 몫 ${formatAmount(c.overpaidMinor)}`}
                    </span>
                    <span className={'bp-li-a num' + (c.overdue ? ' bp-over' : '')}>남음 {formatAmount(c.remainingMinor)}</span>
                  </button>
                  {cycleOpen === c.key && <CycleDetail card={card} cycle={c} onEntryClick={onEntryClick} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CycleDetail({ card, cycle, onEntryClick }: { card: Card; cycle: CycleState; onEntryClick: (e: Entry) => void }) {
  const rows = [...cycle.spends.map((e) => ({ e, kind: '사용' })), ...cycle.payments.map((e) => ({ e, kind: '대금' }))];
  const range = cycleByKey(card, cycle.key);
  return (
    <div className="cd-cy-b">
      <p className="bp-note num">
        이용 {fmtMonthDay(range.start)} ~ {fmtMonthDay(range.close)} · 결제 {fmtMonthDay(range.payDate)}
        {!cycle.closed && ' · 아직 이용 기간이라 청구 금액이 늘 수 있습니다'}
      </p>
      {rows.length === 0 ? <p className="bp-empty">이 회차의 거래가 없습니다.</p> : (
        <ul className="bp-ul" aria-label={`${md(cycle.payDate)} 결제 회차 거래`}>
          {rows.map(({ e, kind }) => {
            const actual = e.money?.status === 'actual';
            return (
              <li key={e.id}>
                <button className={'bp-li' + (actual ? '' : ' planned')} onClick={() => onEntryClick(e)}>
                  <span className="bp-li-d num">{fmtDayShort(e.startDate)}</span>
                  <span className="bp-li-t">
                    <i className={'bp-st' + (actual ? '' : ' plan')}>{actual ? kind : `예정 ${kind}`}</i>
                    {e.title.trim() || (kind === '대금' ? '카드 대금' : '(내역 없음)')}
                  </span>
                  <span className="bp-li-a num">{formatAmount(Math.abs(e.money?.amountMinor ?? 0))}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

function CardForm({ draft, accounts, onDraft, onCancel, onSave, onArchive }: {
  draft: Card;
  accounts: readonly Account[];
  onDraft: (c: Card) => void;
  onCancel: () => void;
  onSave: (c: Card) => void;
  onArchive?: () => void;
}) {
  const problem = cardProblem(draft);
  const [tried, setTried] = useState(false);
  const day = (d: number) => (d === 31 ? '말일' : `${d}일`);
  return (
    <div className="debt-f" data-focus={draft.id}>
      <label className="mod-lbl" htmlFor="card-name">카드 이름</label>
      <input
        id="card-name" className="mod-input" placeholder="예: 생활 카드" value={draft.name} autoFocus
        onChange={(e) => onDraft({ ...draft, name: e.target.value })}
      />
      <div className="cd-f-row">
        <label>
          <span className="mod-lbl">이용 마감</span>
          <select className="mod-input" aria-label="이용 마감일" value={draft.closeDay}
            onChange={(e) => onDraft({ ...draft, closeDay: Number(e.target.value) })}>
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>매월 {day(d)}</option>)}
          </select>
        </label>
        <label>
          <span className="mod-lbl">결제하는 달</span>
          <select className="mod-input" aria-label="결제하는 달" value={draft.payMonthOffset}
            onChange={(e) => onDraft({ ...draft, payMonthOffset: Number(e.target.value) })}>
            <option value={0}>마감한 그 달</option>
            <option value={1}>다음 달</option>
            <option value={2}>다다음 달</option>
          </select>
        </label>
        <label>
          <span className="mod-lbl">결제일</span>
          <select className="mod-input" aria-label="결제일" value={draft.payDay}
            onChange={(e) => onDraft({ ...draft, payDay: Number(e.target.value) })}>
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>{day(d)}</option>)}
          </select>
        </label>
      </div>
      {accounts.length > 0 && (
        <label>
          <span className="mod-lbl">결제 계좌</span>
          <select className="mod-input" aria-label="결제 계좌" value={draft.accountId ?? ''}
            onChange={(e) => onDraft({ ...draft, accountId: e.target.value || null })}>
            <option value="">정하지 않음</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <p className="bp-note">
        {problem ? (tried ? problem : '카드사 명세서의 이용 기간 · 결제일을 그대로 적습니다.') : `${describeCycle(draft)} — 카드사 명세서의 이용 기간과 같은지 확인해 주세요.`}
      </p>
      <div className="debt-f-a">
        {onArchive && <button className="btn ghost sm rv-arch-b" onClick={onArchive}>보관</button>}
        <button className="btn ghost sm" onClick={onCancel}>취소</button>
        <button className="btn primary sm" onClick={() => { setTried(true); if (!problem) onSave(draft); }}>저장</button>
      </div>
    </div>
  );
}
