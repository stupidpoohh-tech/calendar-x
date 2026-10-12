/**
 * 가계부 상세 — 월별 추이와 연간 통계.
 *
 * 차트는 두 계열(수입 · 지출)뿐이다. 색은 역할 이름으로 쓰고(`--led-in` · `--led-out`)
 * 다크에서는 다크용 단계로 바꾼다 — 검증기로 두 모드 모두 확인한 값이다. 색만으로 계열을
 * 가르지 않도록 범례가 늘 있고, 같은 숫자를 표로도 적는다.
 *
 * 진행 중인 기간은 흐리게 그리고 "진행 중" 이라 적는다. 덜 끝난 기간의 합계가 끝난
 * 기간과 같은 모양이면 줄어든 것처럼 읽힌다.
 */
import { useMemo, useState } from 'react';
import { actualsIn, categoryTrends, periodSeries, totalsOf, type PeriodSeries } from '../domain/ledgerStats';
import { compactAmount, formatAmount, formatSigned } from '../domain/money';
import {
  periodName, periodRange, periodsBetween, periodsOfYear, shiftPeriodKey, type Period,
} from '../domain/period';
import type { Category, Entry, PeriodKey } from '../domain/types';
import { Icon } from './Icon';

// ---------- 월별 ----------

export function LedgerMonthly({ entries, settleDay, todayISO, period, onPick }: {
  entries: readonly Entry[];
  settleDay: number;
  todayISO: string;
  period: Period;
  onPick: (k: PeriodKey) => void;
}) {
  const periods = useMemo(
    () => periodsBetween(shiftPeriodKey(period.key, -11), period.key, settleDay),
    [period.key, settleDay],
  );
  const series = useMemo(() => periodSeries(entries, periods, todayISO), [entries, periods, todayISO]);
  const hasAny = series.some((s) => s.totals.count > 0);

  return (
    <div className="led-body">
      {hasAny ? <TrendChart series={series} /> : <p className="led-empty">이 열두 기간에 기록한 실제 거래가 없습니다.</p>}

      <table className="led-table">
        <caption className="led-note">
          기간 이름은 날이 더 많이 든 달입니다. 지출 = 소비 + 대출 이자. 대출 원금 · 이체 · 카드 대금은 넣지 않습니다.
        </caption>
        <thead>
          <tr><th scope="col">기간</th><th scope="col">수입</th><th scope="col">지출</th><th scope="col">수지</th></tr>
        </thead>
        <tbody>
          {[...series].reverse().map((s) => (
            <tr key={s.period.key} className={s.phase} onClick={() => onPick(s.period.key)}>
              <th scope="row">
                <button className="led-link" onClick={(e) => { e.stopPropagation(); onPick(s.period.key); }}>
                  {periodName(s.period.key)}
                </button>
                <span className="led-sub num">{periodRange(s.period)}</span>
                {s.phase === 'current' && <span className="led-badge">진행 중</span>}
                {s.phase === 'future' && <span className="led-badge muted">아직</span>}
              </th>
              <td className="num plus">{formatAmount(s.totals.income)}</td>
              <td className="num minus">{formatAmount(s.totals.spending)}</td>
              <td className={'num ' + (s.totals.net < 0 ? 'minus' : '')}>{formatSigned(s.totals.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 위쪽 두 모서리만 둥근 막대. 바닥은 기준선에 붙는다. */
function barPath(x: number, w: number, y0: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  const top = y0 - h;
  return `M${x},${y0}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${y0}Z`;
}

function TrendChart({ series }: { series: readonly PeriodSeries[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 200;
  const pad = { l: 8, r: 8, t: 16, b: 4 };
  const max = Math.max(1, ...series.map((s) => Math.max(s.totals.income, s.totals.spending)));
  const band = (W - pad.l - pad.r) / series.length;
  const barW = Math.max(4, Math.min(18, (band - 10) / 2));
  const y0 = H - pad.b;
  const scale = (v: number) => (v / max) * (y0 - pad.t);
  const hovered = hover != null ? series[hover] : null;

  return (
    <figure className="led-chart">
      <figcaption className="led-legend">
        <span><i className="sw in" />수입</span>
        <span><i className="sw out" />지출</span>
        <span className="led-sub num">최고 {compactAmount(max)}원</span>
      </figcaption>
      <div className="led-chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="정산 기간별 수입과 지출" preserveAspectRatio="none">
          <line x1={pad.l} x2={W - pad.r} y1={y0} y2={y0} className="led-axis" />
          <line x1={pad.l} x2={W - pad.r} y1={pad.t} y2={pad.t} className="led-grid" />
          {series.map((s, i) => {
            const cx = pad.l + band * i + band / 2;
            const dim = s.phase !== 'past';
            return (
              <g key={s.period.key} className={dim ? 'dim' : undefined}>
                <path className="bar in" d={barPath(cx - barW - 1, barW, y0, scale(s.totals.income))} />
                <path className="bar out" d={barPath(cx + 1, barW, y0, scale(s.totals.spending))} />
                {/* 막대보다 넓은 자리를 잡는다 — 얇은 막대를 겨냥하지 않아도 된다. */}
                <rect
                  x={pad.l + band * i} y={pad.t} width={band} height={y0 - pad.t} className="hit"
                  tabIndex={0} aria-label={`${periodName(s.period.key)} 수입 ${formatAmount(s.totals.income)}원 지출 ${formatAmount(s.totals.spending)}원`}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
          {hover != null && (
            <line
              x1={pad.l + band * hover + band / 2} x2={pad.l + band * hover + band / 2}
              y1={pad.t} y2={y0} className="led-cross"
            />
          )}
        </svg>
        {hovered && hover != null && (
          <div
            className="led-tip" role="status"
            style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%` }}
          >
            <b>{periodName(hovered.period.key)}</b>
            <span className="num">{periodRange(hovered.period)}{hovered.phase === 'current' ? ' · 진행 중' : ''}</span>
            <span><i className="sw in" />수입 <b className="num">{formatAmount(hovered.totals.income)}</b></span>
            <span><i className="sw out" />지출 <b className="num">{formatAmount(hovered.totals.spending)}</b></span>
            <span>수지 <b className="num">{formatSigned(hovered.totals.net)}</b></span>
          </div>
        )}
      </div>
      {/* 눈금 글자는 SVG 밖에 둔다 — 폭에 맞춰 늘어나는 SVG 안에서는 글자도 함께 늘어난다. */}
      <div className="led-ticks" style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {series.map((s) => <span key={s.period.key}>{Number(s.period.key.slice(5))}월</span>)}
      </div>
    </figure>
  );
}

// ---------- 통계 ----------

export function LedgerStats({ entries, settleDay, todayISO, year, onYear, categories }: {
  entries: readonly Entry[];
  settleDay: number;
  todayISO: string;
  year: number;
  onYear: (y: number) => void;
  categories: readonly Category[];
}) {
  const periods = useMemo(() => periodsOfYear(year, settleDay), [year, settleDay]);
  const first = periods[0]!;
  const last = periods[periods.length - 1]!;
  const totals = useMemo(() => totalsOf(actualsIn(entries, first.start, last.end)), [entries, first.start, last.end]);
  const trends = useMemo(
    () => categoryTrends(entries, periods, categories, 'consumption', todayISO),
    [entries, periods, categories, todayISO],
  );
  const finance = useMemo(
    () => categoryTrends(entries, periods, categories, 'finance', todayISO),
    [entries, periods, categories, todayISO],
  );
  const financeTotal = finance.reduce((t, f) => t + f.total, 0);
  const financePer = periods.map((_, i) => finance.reduce((t, f) => t + (f.perPeriod[i] ?? 0), 0));
  const averagedOver = trends[0]?.averagedOver ?? finance[0]?.averagedOver ?? 0;
  const peak = Math.max(1, ...trends.flatMap((t) => t.perPeriod));

  return (
    <div className="led-body">
      <div className="led-period">
        <button className="ico-btn sm" onClick={() => onYear(year - 1)} aria-label="이전 해"><Icon.Chevron size={15} dir="left" /></button>
        <div className="led-period-t">
          <strong>{year}년</strong>
          <span className="num">{periodRange({ key: first.key, start: first.start, end: last.end })}</span>
        </div>
        <button className="ico-btn sm" onClick={() => onYear(year + 1)} aria-label="다음 해"><Icon.Chevron size={15} /></button>
      </div>

      <div className="led-totals">
        <div><span>소비</span><b className="num minus">{formatAmount(totals.consumption)}</b></div>
        <div><span>금융비용</span><b className="num">{formatAmount(totals.financeCost)}</b></div>
        <div><span>수입</span><b className="num plus">{formatAmount(totals.income)}</b></div>
        <p className="led-note">
          월평균 = 끝난 정산 기간의 합 ÷ 끝난 기간 수({averagedOver}개). 진행 중이거나 아직 오지 않은 기간은 평균에 넣지 않습니다.
          대출 원금 · 이체 · 카드 대금은 소비가 아니고, 대출 이자는 금융비용으로 따로 적습니다.
        </p>
      </div>

      {trends.length === 0 && financeTotal === 0 ? (
        <p className="led-empty">{year}년에 기록한 소비가 없습니다.</p>
      ) : (
        <ul className="led-stats" aria-label="카테고리별 연간 소비">
          {trends.map((t) => (
            <StatRow
              key={t.categoryId || '__none'} name={t.name} total={t.total}
              share={totals.consumption > 0 ? t.total / totals.consumption : 0}
              average={t.average} perPeriod={t.perPeriod} peak={peak} periods={periods}
            />
          ))}
          {financeTotal > 0 && (
            <StatRow
              name="금융비용 (대출 이자)" total={financeTotal} share={null}
              average={averagedOver > 0
                ? Math.round(financePer.reduce((a, v, i) => (periods[i] && periods[i]!.end < todayISO ? a + v : a), 0) / averagedOver)
                : null}
              perPeriod={financePer} peak={Math.max(1, ...financePer)} periods={periods} finance
            />
          )}
        </ul>
      )}
    </div>
  );
}

function StatRow({ name, total, share, average, perPeriod, peak, periods, finance = false }: {
  name: string; total: number; share: number | null; average: number | null;
  perPeriod: readonly number[]; peak: number; periods: readonly Period[]; finance?: boolean;
}) {
  return (
    <li className={'led-stat' + (finance ? ' finance' : '')}>
      <div className="led-stat-h">
        <span className="led-stat-n">{name}</span>
        <span className="num">{formatAmount(total)}</span>
      </div>
      <div className="led-stat-s num">
        {share != null && <span>소비의 {Math.round(share * 1000) / 10}%</span>}
        <span>월평균 {average == null ? '—' : formatAmount(average)}</span>
      </div>
      {/* 기간별 막대. 한 계열이라 범례가 없다 — 줄 이름이 그것이다. */}
      <svg className="led-spark" viewBox="0 0 120 24" preserveAspectRatio="none" role="img"
           aria-label={`${name} 기간별 소비`}>
        {perPeriod.map((v, i) => {
          const w = 120 / perPeriod.length;
          const h = (v / peak) * 22;
          return (
            <path key={i} className="bar seq" d={barPath(i * w + 1, w - 2, 24, h, 2)}>
              <title>{`${periods[i] ? periodName(periods[i]!.key) : ''} ${formatAmount(v)}원`}</title>
            </path>
          );
        })}
      </svg>
    </li>
  );
}
