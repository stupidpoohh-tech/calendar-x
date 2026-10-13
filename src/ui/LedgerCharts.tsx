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
import {
  actualsIn, averagedPeriods, categoryTrends, periodSeries, pieSlices, totalsOf, type PeriodSeries, type PieSlice,
} from '../domain/ledgerStats';
import { compactAmount, formatAmount, formatSigned } from '../domain/money';
import {
  periodName, periodRange, periodsBetween, shiftPeriodKey, type Period,
} from '../domain/period';
import type { Category, Entry, PeriodKey } from '../domain/types';

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
          기간 이름은 날이 더 많이 든 달입니다. 지출 = 소비 + 대출 이자. 대금 = 대출 원금.
          수지 = 수입 − 지출 − 대금. 이체 · 카드 대금은 넣지 않습니다(카드는 쓴 날 지출로 셉니다).
        </caption>
        <thead>
          <tr><th scope="col">기간</th><th scope="col">수입</th><th scope="col">지출</th><th scope="col">대금</th><th scope="col">수지</th></tr>
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
              <td className="num">{formatAmount(s.totals.repayment)}</td>
              <td className={'num ' + (s.totals.net < 0 ? 'minus' : '')}>{formatSigned(s.totals.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 모서리가 없는 막대 조각 — 누적 막대의 아래 칸. */
function rectPath(x: number, w: number, y0: number, h: number): string {
  if (h <= 0) return '';
  return `M${x},${y0}V${y0 - h}H${x + w}V${y0}Z`;
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
  // 오른쪽 막대는 지출(아래) + 대금(위) 누적이다 — 수지가 수입 − 지출 − 대금이므로 두 막대의 키 차이가 곧 수지다.
  const max = Math.max(1, ...series.map((s) => Math.max(s.totals.income, s.totals.spending + s.totals.repayment)));
  const GAP = 2;
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
        <span><i className="sw pay" />대금</span>
        <span className="led-sub num">최고 {compactAmount(max)}원</span>
      </figcaption>
      <div className="led-chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="정산 기간별 수입, 지출과 대금" preserveAspectRatio="none">
          <line x1={pad.l} x2={W - pad.r} y1={y0} y2={y0} className="led-axis" />
          <line x1={pad.l} x2={W - pad.r} y1={pad.t} y2={pad.t} className="led-grid" />
          {series.map((s, i) => {
            const cx = pad.l + band * i + band / 2;
            const dim = s.phase !== 'past';
            return (
              <g key={s.period.key} className={dim ? 'dim' : undefined}>
                <path className="bar in" d={barPath(cx - barW - 1, barW, y0, scale(s.totals.income))} />
                {s.totals.repayment > 0 ? (
                  <>
                    <path className="bar out" d={rectPath(cx + 1, barW, y0, scale(s.totals.spending))} />
                    <path
                      className="bar pay"
                      d={barPath(cx + 1, barW, y0 - scale(s.totals.spending) - (s.totals.spending > 0 ? GAP : 0), scale(s.totals.repayment))}
                    />
                  </>
                ) : (
                  <path className="bar out" d={barPath(cx + 1, barW, y0, scale(s.totals.spending))} />
                )}
                {/* 막대보다 넓은 자리를 잡는다 — 얇은 막대를 겨냥하지 않아도 된다. */}
                <rect
                  x={pad.l + band * i} y={pad.t} width={band} height={y0 - pad.t} className="hit"
                  tabIndex={0} aria-label={`${periodName(s.period.key)} 수입 ${formatAmount(s.totals.income)}원 지출 ${formatAmount(s.totals.spending)}원 대금 ${formatAmount(s.totals.repayment)}원`}
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
            <span><i className="sw pay" />대금 <b className="num">{formatAmount(hovered.totals.repayment)}</b></span>
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

// ---------- 통계 · 카테고리 ----------

/** 고리 한 조각. 각도는 12시 방향에서 시계 방향, 라디안. */
function ringPath(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  const pt = (rad: number, a: number) => `${cx + rad * Math.sin(a)},${cy - rad * Math.cos(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(R, a0)}A${R},${R} 0 ${large} 1 ${pt(R, a1)}L${pt(r, a1)}A${r},${r} 0 ${large} 0 ${pt(r, a0)}Z`;
}

function CategoryPie({ slices, total }: { slices: readonly PieSlice[]; total: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const C = 60; const R = 56; const r = 36;
  let at = 0;
  const arcs = slices.map((s) => {
    const a0 = at;
    at += (s.value / total) * Math.PI * 2;
    return { ...s, a0, a1: at };
  });
  const hovered = arcs.find((a) => a.key === hover) ?? null;
  return (
    <figure className="led-pie">
      <svg viewBox="0 0 120 120" role="img" aria-label="카테고리별 소비 비중">
        {arcs.length === 1 ? (
          <path className="slice" data-slot={arcs[0]!.slot ?? 'rest'}
            d={`${ringPath(C, C, R, r, 0, Math.PI)}${ringPath(C, C, R, r, Math.PI, Math.PI * 2)}`} />
        ) : arcs.map((a) => (
          <path
            key={a.key} className={'slice' + (hover && hover !== a.key ? ' dim' : '')}
            data-slot={a.slot ?? 'rest'} d={ringPath(C, C, R, r, a.a0, a.a1)}
            tabIndex={0} aria-label={`${a.name} ${formatAmount(a.value)}원 ${pct(a.value, total)}`}
            onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(a.key)} onBlur={() => setHover(null)}
          />
        ))}
      </svg>
      {/* 가운데 글자는 SVG 밖에 둔다 — 글씨 크기 설정을 따라야 한다. */}
      <div className="led-pie-c" aria-hidden="true">
        <span>{hovered ? hovered.name : '소비'}</span>
        <b className="num">{formatAmount(hovered ? hovered.value : total)}</b>
        {hovered && <span className="num">{pct(hovered.value, total)}</span>}
      </div>
    </figure>
  );
}

const pct = (v: number, total: number) => `${total > 0 ? Math.round((v / total) * 1000) / 10 : 0}%`;

export function LedgerStats({ entries, settleDay, todayISO, period, categories }: {
  entries: readonly Entry[];
  settleDay: number;
  todayISO: string;
  period: Period;
  categories: readonly Category[];
}) {
  // 고른 기간까지 열두 기간 — 막대와 월평균의 창이다. 월별 추이와 같은 창이라 두 화면의 평균이 맞는다.
  const periods = useMemo(
    () => periodsBetween(shiftPeriodKey(period.key, -11), period.key, settleDay),
    [period.key, settleDay],
  );
  const last = periods.length - 1;
  const totals = useMemo(() => totalsOf(actualsIn(entries, period.start, period.end)), [entries, period.start, period.end]);
  const trends = useMemo(
    () => categoryTrends(entries, periods, categories, 'consumption', todayISO),
    [entries, periods, categories, todayISO],
  );
  const finance = useMemo(
    () => categoryTrends(entries, periods, categories, 'finance', todayISO),
    [entries, periods, categories, todayISO],
  );
  const counted = useMemo(() => averagedPeriods(periods, todayISO), [periods, todayISO]);
  const averagedOver = counted.filter(Boolean).length;
  const financePer = periods.map((_, i) => finance.reduce((t, f) => t + (f.perPeriod[i] ?? 0), 0));
  const financeNow = financePer[last] ?? 0;
  const financeAvg = averagedOver > 0
    ? Math.round(financePer.reduce((a, v, i) => (counted[i] ? a + v : a), 0) / averagedOver)
    : null;

  // 이 기간에 쓴 카테고리만, 이 기간 금액 순으로.
  const rows = trends
    .map((t) => ({ ...t, now: t.perPeriod[last] ?? 0 }))
    .filter((t) => t.now > 0)
    .sort((a, b) => b.now - a.now);
  const slices = pieSlices(rows.map((t) => ({ key: t.categoryId || '__none', name: t.name, value: t.now })));
  const slotOf = new Map(slices.map((s) => [s.key, s.slot]));
  const peak = Math.max(1, ...rows.flatMap((t) => t.perPeriod));

  return (
    <div className="led-body">
      <div className="led-totals">
        <div><span>소비</span><b className="num minus">{formatAmount(totals.consumption)}</b></div>
        <div><span>금융비용</span><b className="num">{formatAmount(totals.financeCost)}</b></div>
        <div><span>수입</span><b className="num plus">{formatAmount(totals.income)}</b></div>
        <p className="led-note">
          줄의 큰 숫자는 이 기간에 쓴 돈입니다. 월평균 = 고른 기간까지 열두 기간 중 끝난 기간의 합 ÷ 끝난
          기간 수({averagedOver}개) — 진행 중인 기간은 넣지 않고, 기록이 없는 끝난 기간은 0원으로 셉니다.
          대출 원금 · 이체 · 카드 대금은 소비가 아니고, 대출 이자는 금융비용으로 따로 적습니다.
        </p>
      </div>

      {rows.length === 0 && financeNow === 0 ? (
        <p className="led-empty">{periodName(period.key)}에 기록한 소비가 없습니다.</p>
      ) : (
        <>
          {totals.consumption > 0 && (
            <div className="led-pie-wrap">
              <CategoryPie slices={slices} total={totals.consumption} />
              <ul className="led-pie-legend" aria-label="소비 비중">
                {slices.map((s) => (
                  <li key={s.key}>
                    <i className="sw" data-slot={s.slot ?? 'rest'} />
                    <span className="led-pie-n">{s.name}</span>
                    <span className="num">{pct(s.value, totals.consumption)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="led-stats" aria-label="카테고리별 소비">
            {rows.map((t) => {
              const key = t.categoryId || '__none';
              return (
                <StatRow
                  key={key} name={t.name} slot={slotOf.has(key) ? (slotOf.get(key) ?? 'rest') : 'rest'}
                  now={t.now} share={totals.consumption > 0 ? t.now / totals.consumption : 0}
                  average={t.average} perPeriod={t.perPeriod} peak={peak} periods={periods}
                />
              );
            })}
            {financeNow > 0 && (
              <StatRow
                name="금융비용 (대출 이자)" now={financeNow} share={null} average={financeAvg}
                perPeriod={financePer} peak={Math.max(1, ...financePer)} periods={periods} finance
              />
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function StatRow({ name, slot, now, share, average, perPeriod, peak, periods, finance = false }: {
  name: string; slot?: number | 'rest'; now: number; share: number | null; average: number | null;
  perPeriod: readonly number[]; peak: number; periods: readonly Period[]; finance?: boolean;
}) {
  const last = perPeriod.length - 1;
  return (
    <li className={'led-stat' + (finance ? ' finance' : '')}>
      <div className="led-stat-h">
        <span className="led-stat-n">{slot != null && <i className="sw" data-slot={slot} />}{name}</span>
        <span className="num">{formatAmount(now)}</span>
      </div>
      <div className="led-stat-s num">
        {share != null && <span>소비의 {Math.round(share * 1000) / 10}%</span>}
        <span>월평균 {average == null ? '—' : formatAmount(average)}</span>
      </div>
      {/* 열두 기간 막대. 고른 기간(맨 오른쪽)만 진하게 — 한 계열이라 범례가 없다. */}
      <svg className="led-spark" viewBox="0 0 120 24" preserveAspectRatio="none" role="img"
           aria-label={`${name} 기간별 소비`}>
        {perPeriod.map((v, i) => {
          const w = 120 / perPeriod.length;
          const h = (v / peak) * 22;
          return (
            <path key={i} className={'bar seq' + (i === last ? '' : ' past')} d={barPath(i * w + 1, w - 2, 24, h, 2)}>
              <title>{`${periods[i] ? periodName(periods[i]!.key) : ''} ${formatAmount(v)}원`}</title>
            </path>
          );
        })}
      </svg>
    </li>
  );
}
