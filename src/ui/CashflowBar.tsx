/**
 * 현금흐름 요약과 일별 예상 잔고.
 *
 * 이전 가계부 화면에는 수동 입력한 잔고 숫자 하나와 흩어진 예정 항목만 있었다.
 * 둘을 합쳐 "이 달 말에 얼마가 남는가", "언제 바닥나는가"를 계산하는 코드가 없었다.
 * 이 컴포넌트가 그 답을 화면 맨 위에 올린다.
 */
import { useId, useMemo } from 'react';
import type { CashflowResult } from '../domain/cashflow';
import { fmtDayShort } from '../domain/date';
import { formatAmount } from '../domain/money';
import { Icon } from './Icon';

interface Props {
  result: CashflowResult;
  monthLabel: string;
  /** 잔고 입력 전에는 예측을 그리지 않는다. 0원은 사실이 아니라 미입력이다. */
  hasBalance: boolean;
  onPointClick?: (dateISO: string) => void;
}

export function CashflowBar({ result, monthLabel, hasBalance, onPointClick }: Props) {
  const gradientId = useId();
  const { points, openingMinor, closingMinor, totalInMinor, totalOutMinor, low, firstShortfall } = result;

  const chart = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.balanceMinor);
    const max = Math.max(...values, openingMinor, 0);
    const min = Math.min(...values, openingMinor, 0);
    const range = max - min || 1;
    const W = 100;
    const H = 40;

    const x = (i: number) => (points.length === 1 ? 0 : (i / (points.length - 1)) * W);
    const y = (v: number) => H - ((v - min) / range) * H;

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.balanceMinor).toFixed(2)}`).join(' ');
    const area = `${line} L${W},${H} L0,${H} Z`;
    const zeroY = y(0);
    const lastPoint = points[points.length - 1];

    return {
      line, area, W, H,
      zeroY: zeroY >= 0 && zeroY <= H ? zeroY : null,
      endX: x(points.length - 1),
      endY: lastPoint ? y(lastPoint.balanceMinor) : H,
      shortfallX: firstShortfall ? x(points.findIndex((p) => p.date === firstShortfall.date)) : null,
    };
  }, [points, openingMinor, firstShortfall]);

  const negative = closingMinor < 0;

  if (!hasBalance) {
    return (
      <section className="cf" aria-label="현금흐름 예측">
        <p className="cf-empty">
          잔고를 입력하면 예정 입출금과 합쳐 <b>이 달 말 예상 잔고</b>와
          <b> 잔고가 바닥나는 날</b>을 여기에 그립니다.
        </p>
      </section>
    );
  }

  return (
    <section className="cf" aria-label="현금흐름 예측">
      <div className="cf-top">
        <div className="cf-lead">
          <span className="cf-lead-l">{monthLabel} 말 예상 잔고</span>
          <strong className={'cf-lead-v num' + (negative ? ' bad' : '')}>
            ₩ {formatAmount(closingMinor)}
          </strong>
          <span className="cf-lead-d num">
            시작 ₩ {formatAmount(openingMinor)}
            <span className={closingMinor >= openingMinor ? ' up' : ' down'}>
              {closingMinor >= openingMinor ? '▲' : '▼'} {formatAmount(Math.abs(closingMinor - openingMinor))}
            </span>
          </span>
        </div>

        <dl className="cf-stats">
          <div><dt>들어올 돈</dt><dd className="num plus">+{formatAmount(totalInMinor)}</dd></div>
          <div><dt>나갈 돈</dt><dd className="num minus">−{formatAmount(totalOutMinor)}</dd></div>
          {result.totalReservedMinor > 0 && (
            <div><dt>세이브</dt><dd className="num">{formatAmount(result.totalReservedMinor)}</dd></div>
          )}
          {low && (
            <div>
              <dt>최저점</dt>
              <dd className={'num' + (low.balanceMinor < 0 ? ' minus' : '')}>
                {formatAmount(low.balanceMinor)}<small> · {low.date.slice(5)}</small>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {chart && (
        <svg className="cf-chart" viewBox={`0 0 ${chart.W} ${chart.H}`} preserveAspectRatio="none" role="img"
             aria-label={`일별 예상 잔고 추이. 시작 ${formatAmount(openingMinor)}원, 마감 ${formatAmount(closingMinor)}원.`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--cf-line)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--cf-line)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {chart.zeroY !== null && (
            <line x1="0" y1={chart.zeroY} x2={chart.W} y2={chart.zeroY} className="cf-zero" />
          )}
          <path d={chart.area} fill={`url(#${gradientId})`} />
          <path d={chart.line} className="cf-line" />
          {chart.shortfallX !== null && (
            <line x1={chart.shortfallX} y1="0" x2={chart.shortfallX} y2={chart.H} className="cf-short" />
          )}
          <circle cx={chart.endX} cy={chart.endY} r="1.6" className="cf-dot" />
        </svg>
      )}

      {firstShortfall && (
        <button
          className="cf-warn"
          onClick={() => onPointClick?.(firstShortfall.date)}
          type="button"
        >
          <Icon.Alert size={13} />
          <span>
            <b>{fmtDayShort(firstShortfall.date)}</b>에 잔고가 ₩ {formatAmount(firstShortfall.balanceMinor)}로 떨어집니다.
          </span>
          <Icon.Chevron size={13} />
        </button>
      )}

      {points.length === 0 && (
        <p className="cf-empty">잔고를 입력하고 예정 입출금을 더하면 이 달의 흐름이 여기에 그려집니다.</p>
      )}
    </section>
  );
}
