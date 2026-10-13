import { colorHex, MONEY_TYPE_BY_ID, STATUS_BY_ID } from '../domain/constants';
import { fmtDayFull } from '../domain/date';
import type { DaySummary } from '../domain/daySummary';
import { displayTitle, isDone } from '../domain/entry';
import { cashSignOf, isActual } from '../domain/ledger';
import { flowBadge } from '../domain/ledgerStats';
import { formatAmount, formatSigned } from '../domain/money';
import { entriesOn, netOf, type BalanceView } from '../domain/tide';
import type { Category, Entry } from '../domain/types';
import { Icon } from './Icon';

/**
 * 가계부 달력에서 연 날짜 상세. 달력 셀이 요약만 적으므로 여기서는 소액까지 **빠짐없이**
 * 보여 준다 — 실제 총수입 · 총지출 · 순현금흐름, 거래마다 금액 · 카테고리 · 유형 · 실제/예정,
 * 그리고 '달력에 표시' 고르기.
 */
export interface DaySheetLedger {
  /** 그 날의 요약. 자료를 다 받기 전이면 null — 합계를 0원으로 적지 않는다. */
  summary: DaySummary | null;
  categories: readonly Category[];
  onToggleHighlight: (e: Entry) => void;
  /** 오늘 · 앞날의 예상 잔고와 생활비 외 가용. 낼 수 없으면 null — 지어내지 않는다. */
  balance?: BalanceView | null;
}

interface Props {
  dateISO: string;
  todayISO: string;
  entries: readonly Entry[];
  /** 이 날의 가계부 원본 발생분 (반복·기간 전개된 것 포함). tide 순액을 표시한다. */
  moneyEntries: readonly Entry[];
  onClose: () => void;
  onEntryClick: (e: Entry) => void;
  onAdd: () => void;
  /** 가계부 달력에서 열었을 때만 준다. */
  ledger?: DaySheetLedger;
}

export function DaySheet({ dateISO, todayISO, entries, moneyEntries, onClose, onEntryClick, onAdd, ledger }: Props) {
  if (ledger) {
    return (
      <LedgerDay
        dateISO={dateISO} todayISO={todayISO} entries={entries} ledger={ledger}
        onClose={onClose} onEntryClick={onEntryClick} onAdd={onAdd}
      />
    );
  }
  const dayNet = netOf(entriesOn(moneyEntries, dateISO));
  return (
    <div className="mod-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`${dateISO} 상세`} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-h">
          <div>
            <div className="sheet-eyebrow">{dateISO === todayISO ? '오늘' : '선택한 날'}</div>
            <h2 className="sheet-t">{fmtDayFull(dateISO)}</h2>
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>

        {dayNet !== 0 && (
          <div className={'sheet-cf' + (dayNet < 0 ? ' bad' : '')}>
            <span>이 날 순변동</span>
            <strong className={'num ' + (dayNet > 0 ? 'plus' : 'minus')}>
              {formatSigned(dayNet)}
            </strong>
          </div>
        )}

        <div className="sheet-b">
          {entries.length === 0 ? (
            <p className="sheet-empty">이 날에는 아직 항목이 없습니다.</p>
          ) : (
            <ul className="sheet-ul">
              {entries.map((e) => {
                const type = e.money ? MONEY_TYPE_BY_ID[e.money.type] : null;
                return (
                  <li key={e.id}>
                    <button className="sheet-row" onClick={() => onEntryClick(e)}>
                      <span className="sheet-bar" style={{ background: type?.color ?? colorHex(e.color) }} />
                      <span className="sheet-row-b">
                        <span className={'sheet-row-t' + (isDone(e) ? ' done' : '')}>{displayTitle(e)}</span>
                        <span className="sheet-row-m">
                          {e.startTime && <span>{e.startTime}{e.endTime ? `–${e.endTime}` : ''}</span>}
                          {e.location && <span>@ {e.location}</span>}
                          {e.task && <span><i style={{ background: STATUS_BY_ID[e.task.status].dot }} />{STATUS_BY_ID[e.task.status].label}</span>}
                          {e.tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
                        </span>
                      </span>
                      <span className="sheet-row-r">
                        {e.task?.urgent && <Icon.Flame size={13} filled fillColor="#ef4444" stroke="#ef4444" />}
                        {e.task?.important && <Icon.Star size={13} filled fillColor="#f59e0b" stroke="#f59e0b" />}
                        {e.isRecurring && <Icon.Repeat size={12} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="sheet-f">
          <button className="btn primary" onClick={onAdd}><Icon.Plus size={14} /> 이 날짜에 추가</button>
        </footer>
      </div>
    </div>
  );
}

const amountOf = (e: Entry) => Math.abs(e.money?.amountMinor ?? 0);

function LedgerDay({ dateISO, todayISO, entries, ledger, onClose, onEntryClick, onAdd }: {
  dateISO: string; todayISO: string; entries: readonly Entry[]; ledger: DaySheetLedger;
  onClose: () => void; onEntryClick: (e: Entry) => void; onAdd: () => void;
}) {
  const { summary } = ledger;
  // 실제 거래를 금액 큰 순으로, 그 뒤에 예정.
  const rows = [...entries].sort((a, b) =>
    Number(isActual(b)) - Number(isActual(a)) || amountOf(b) - amountOf(a));
  const shownId = summary?.major?.entry.id ?? null;
  const catName = (id: string | null | undefined) => (id ? ledger.categories.find((c) => c.id === id)?.name : undefined);

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`${dateISO} 거래 상세`} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-h">
          <div>
            <div className="sheet-eyebrow">{dateISO === todayISO ? '오늘' : dateISO < todayISO ? '지난 날' : '앞날'}</div>
            <h2 className="sheet-t">{fmtDayFull(dateISO)}</h2>
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>

        {ledger.balance && (
          <div className="sheet-sum bal" aria-label="이 날의 잔고 보기">
            <div><span>예상 잔고</span><b className={'num' + (ledger.balance.projected < 0 ? ' minus' : '')}>{formatAmount(ledger.balance.projected)}</b></div>
            <div><span>생활비 외 가용</span><b className={'num' + (ledger.balance.available < 0 ? ' minus' : '')}>{formatAmount(ledger.balance.available)}</b></div>
            <div><span>생활비 · 세이브 확보</span><b className="num">{formatAmount(ledger.balance.held)}</b></div>
            <p className="sheet-sum-n">
              확인 잔고 {formatAmount(ledger.balance.confirmed)}원({ledger.balance.asOf} 기준)에 이 날까지 적어 둔 입출금을 더한
              값입니다. 생활비 · 세이브는 통장에서 빠진 돈이 아니라 잔고 안에서 떼어 둔 몫이고, 적지 않은 소비는 들어 있지 않습니다.
            </p>
          </div>
        )}

        {summary ? (
          <div className="sheet-sum" aria-label="이 날의 실제 현금흐름">
            <div><span>실제 수입</span><b className="num plus">+{formatAmount(summary.income)}</b></div>
            <div><span>실제 지출</span><b className="num minus">−{formatAmount(summary.outflow)}</b></div>
            <div>
              <span>순현금흐름</span>
              <b className={'num ' + (summary.income - summary.outflow < 0 ? 'minus' : '')}>
                {formatSigned(summary.income - summary.outflow)}
              </b>
            </div>
            <p className="sheet-sum-n">
              실제 거래 {summary.actuals.length}건 기준 · 카드 사용은 대금 내는 날 지출로 셉니다
              {summary.unconfirmed > 0 && ` · 확정하지 않은 예정 ${summary.unconfirmed}건은 합계에 없습니다`}
            </p>
          </div>
        ) : (
          <p className="sheet-sum-n pad" role="status">거래를 불러오는 중입니다. 다 받기 전에는 합계를 적지 않습니다.</p>
        )}

        <div className="sheet-b">
          {rows.length === 0 ? (
            <p className="sheet-empty">이 날에는 거래가 없습니다.</p>
          ) : (
            <ul className="sheet-ul" aria-label="이 날의 거래">
              {rows.map((e) => {
                const actual = isActual(e);
                const sign = cashSignOf(e);
                const badge = flowBadge(e);
                const cat = catName(e.money?.categoryId);
                const pinned = e.money?.highlight === true;
                return (
                  <li key={e.id} className="sheet-li">
                    <button className={'sheet-row' + (actual ? '' : ' planned')} onClick={() => onEntryClick(e)}>
                      <span className="sheet-bar" style={{ background: e.money ? MONEY_TYPE_BY_ID[e.money.type].color : colorHex(e.color) }} />
                      <span className="sheet-row-b">
                        <span className="sheet-row-t">{e.title.trim() || displayTitle(e)}</span>
                        <span className="sheet-row-m">
                          <span className={'sheet-st' + (actual ? '' : ' plan')}>{actual ? '실제' : '예정'}</span>
                          {cat && <span>{cat}</span>}
                          {badge && <span>{badge}</span>}
                          {e.isRecurring && <span>반복</span>}
                          {shownId === e.id && <span className="sheet-shown">달력에 표시 중</span>}
                        </span>
                      </span>
                      <span className={'sheet-amt num' + (sign > 0 ? ' plus' : sign < 0 ? ' minus' : '')}>
                        {sign > 0 ? '+' : sign < 0 ? '−' : ''}{formatAmount(amountOf(e))}
                      </span>
                    </button>
                    {actual && (
                      <button
                        className={'ico-btn sm sheet-pin' + (pinned ? ' on' : '')}
                        aria-pressed={pinned}
                        aria-label={pinned ? `${e.title || '거래'} 달력 표시 해제` : `${e.title || '거래'} 달력에 표시`}
                        title={pinned ? '달력 표시 해제' : '달력에 표시'}
                        onClick={() => ledger.onToggleHighlight(e)}
                      >
                        <Icon.Star size={15} filled={pinned} fillColor="var(--accent)" stroke={pinned ? 'var(--accent)' : 'currentColor'} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="sheet-f">
          <button className="btn primary" onClick={onAdd}><Icon.Plus size={14} /> 이 날짜에 추가</button>
        </footer>
      </div>
    </div>
  );
}
