/**
 * 가계부 달력의 지난 날 · 오늘 셀 요약.
 *
 * 실제 거래를 막대로 하나씩 늘어놓지 않는다. 총수입 · 총지출 · 주요 거래 한 건 · 나머지 건수만
 * 적고, 높이는 거래 수와 무관하게 늘 같다(`SUMMARY_HEIGHT`). 전체 내역은 눌러서 날짜 상세에서 본다.
 *
 * 색만으로 뜻을 전하지 않는다 — 금액에는 늘 부호(+ / −)가 붙고, 주요 거래의 성격(카드 ·
 * 대출상환 …)은 이름이나 표식으로 적는다.
 */
import type { DaySummary } from '../domain/daySummary';
import { compactAmount } from '../domain/money';
import { summaryLabel } from './ledgerView';

export function CalendarDaySummary({ summary: s, top, onOpen }: {
  summary: DaySummary;
  /** 셀 위에서부터의 자리(px). 오늘 칸은 남은 예정 막대 아래에 선다. */
  top: number;
  onOpen: () => void;
}) {
  const count = s.rest > 0 ? (s.major ? `외 ${s.rest}건` : `거래 ${s.rest}건`) : '';
  return (
    <button
      type="button"
      className="cal-sum"
      style={{ top }}
      aria-label={summaryLabel(s)}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      {s.income > 0 && <span className="cal-sum-l in num">+{compactAmount(s.income)}</span>}
      {s.outflow > 0 && <span className="cal-sum-l out num">−{compactAmount(s.outflow)}</span>}
      {s.major && (
        <span className={'cal-sum-l major' + (s.major.why === 'pinned' ? ' pinned' : '')}>
          {s.major.tag && <i className="cal-sum-tag">{s.major.tag}</i>}
          <span className="cal-sum-n">{s.major.label}</span>
          <span className="cal-sum-a num">{compactAmount(s.major.amount)}</span>
        </span>
      )}
      {(count || s.unconfirmed > 0) && (
        <span className="cal-sum-l more">
          {count && <span className="cal-sum-n">{count}</span>}
          {s.unconfirmed > 0 && <i className="cal-sum-plan">예정 {s.unconfirmed}</i>}
        </span>
      )}
    </button>
  );
}
