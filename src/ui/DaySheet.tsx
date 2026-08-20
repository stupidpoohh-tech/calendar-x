import { colorHex, MONEY_TYPE_BY_ID, STATUS_BY_ID } from '../domain/constants';
import { fmtDayFull } from '../domain/date';
import { displayTitle, isDone } from '../domain/entry';
import { formatAmount, formatSigned } from '../domain/money';
import type { CashflowPoint } from '../domain/cashflow';
import type { Entry } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  dateISO: string;
  todayISO: string;
  entries: readonly Entry[];
  /** 그날의 예상 잔고. 가계부 데이터가 있을 때만 넘어온다. */
  cashflow: CashflowPoint | null;
  onClose: () => void;
  onEntryClick: (e: Entry) => void;
  onAdd: () => void;
}

export function DaySheet({ dateISO, todayISO, entries, cashflow, onClose, onEntryClick, onAdd }: Props) {
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

        {cashflow && (
          <div className={'sheet-cf' + (cashflow.balanceMinor < 0 ? ' bad' : '')}>
            <span>예상 잔고</span>
            <strong className="num">₩ {formatAmount(cashflow.balanceMinor)}</strong>
            {cashflow.deltaMinor !== 0 && (
              <span className={'num ' + (cashflow.deltaMinor > 0 ? 'plus' : 'minus')}>
                {formatSigned(cashflow.deltaMinor)}
              </span>
            )}
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
