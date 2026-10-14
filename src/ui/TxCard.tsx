/**
 * 줄을 누르면 그 아래 펼쳐지는 거래 카드 — 분석의 카테고리 줄과 예산의 카테고리 줄이 같이 쓴다.
 * 합계가 무엇으로 이루어졌는지 다른 보기로 옮겨 가지 않고 본다. 거래를 누르면 그 거래 창을 연다.
 */
import type { ReactNode } from 'react';
import { formatAmount } from '../domain/money';
import type { Entry } from '../domain/types';

const dayOf = (iso: string, withYear: boolean) => {
  const d = new Date(`${iso}T00:00:00`);
  const md = `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일 (${'일월화수목금토'[d.getDay()]})`;
  return withYear ? `${iso.slice(2, 4)}년 ${md}` : md;
};

export function TxCard({ label, scope = '이 기간', entries, fallbackTitle, onEntryClick, children }: {
  /** 카드 이름(접근성). 예: '식비 거래'. */
  label: string;
  /** 머리 줄의 범위 글자. */
  scope?: string;
  entries: readonly Entry[];
  /** 내역이 빈 거래의 이름. */
  fallbackTitle: string;
  onEntryClick?: (e: Entry) => void;
  /** 카드 아래에 덧붙일 것(예산 고치기 등). */
  children?: ReactNode;
}) {
  const sorted = [...entries].sort((a, b) =>
    b.startDate.localeCompare(a.startDate) || Math.abs(b.money?.amountMinor ?? 0) - Math.abs(a.money?.amountMinor ?? 0));
  // 해를 넘는 목록(1년 보기)이면 날짜에 해를 붙인다.
  const years = new Set(sorted.map((e) => e.startDate.slice(0, 4)));
  return (
    <div className="led-stat-d" role="region" aria-label={label}>
      <div className="led-stat-dh num">
        <span>{scope} {sorted.length.toLocaleString('ko-KR')}건</span>
        <span>합계 {formatAmount(sorted.reduce((a, e) => a + Math.abs(e.money?.amountMinor ?? 0), 0))}</span>
      </div>
      {sorted.length === 0 ? (
        <p className="led-note">{scope}에 거래가 없습니다.</p>
      ) : (
        <ul>
          {sorted.map((e) => (
            <li key={e.id}>
              <button className="led-stat-dr" onClick={() => onEntryClick?.(e)} disabled={!onEntryClick}>
                <span className="led-stat-dd num">{dayOf(e.startDate, years.size > 1)}</span>
                <span className="led-stat-dt">{e.title.trim() || fallbackTitle}</span>
                <span className="num">{formatAmount(Math.abs(e.money?.amountMinor ?? 0))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}
