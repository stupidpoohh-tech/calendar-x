import { useMemo, useRef } from 'react';
import { colorHex, MONEY_TYPE_BY_ID } from '../domain/constants';
import { isWeekend, monthGrid, normalizeDate, toISO, weekdayLabels, ymOf } from '../domain/date';
import { displayTitle, effectiveEndDate, isDone } from '../domain/entry';
import { compactAmount } from '../domain/money';
import { currencyScopeOf, limitOn } from '../domain/tide';
import type { Account, Entry, LensId, WeekStart, YearMonth } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  cursor: Date;
  onCursorChange: (next: Date) => void;
  entries: readonly Entry[];
  /**
   * 한도 계산용 **원본**. `entries` 는 필터가 걸린 데다 반복이 펼쳐진 목록이라 쓸 수 없다 —
   * 필터로 항목을 가렸다고 한도가 늘면 안 되고, 펼친 발생분을 넣으면 tide 가 한 번 더
   * 전개해 같은 입출금을 여러 번 센다.
   */
  tideEntries: readonly Entry[];
  /**
   * `tideEntries` 가 실제로 덮는 달.
   *
   * 한도는 (오늘, d] 를 더한 값이라 그 사이의 모든 달이 있어야 한다. 자료가 없는 달의
   * 셀에는 숫자를 적지 않는다 — 빠진 예정을 0으로 세면 그럴듯하게 틀린 값이 나온다.
   */
  tideMonths: readonly YearMonth[];
  accounts: readonly Account[];
  hasBalance: boolean;
  lens: LensId;
  weekStart: WeekStart;
  todayISO: string;
  onEntryClick: (e: Entry) => void;
  onDayOpen: (iso: string) => void;
  onDayCreate: (iso: string) => void;
}

interface Placed {
  entry: Entry;
  lane: number;
  from: number;
  to: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

/** 겹치지 않는 가장 위쪽 레인에 배치한다. */
function placeWeek(entries: readonly Entry[], weekISO: readonly string[]): { placed: Placed[]; laneCount: number } {
  const first = weekISO[0] ?? '';
  const last = weekISO[6] ?? '';

  const visible = entries.filter((e) => {
    const start = normalizeDate(e.startDate);
    return start <= last && effectiveEndDate(e) >= first;
  });

  // 기간이 긴 항목을 위로 올려야 바가 계단처럼 흩어지지 않는다.
  visible.sort((a, b) => {
    const aSpan = effectiveEndDate(a) > a.startDate ? 0 : 1;
    const bSpan = effectiveEndDate(b) > b.startDate ? 0 : 1;
    if (aSpan !== bSpan) return aSpan - bSpan;
    const aKey = `${a.startDate}T${a.startTime ?? '00:00'}`;
    const bKey = `${b.startDate}T${b.startTime ?? '00:00'}`;
    return aKey.localeCompare(bKey);
  });

  const lanes: { from: number; to: number }[][] = [];
  const placed: Placed[] = visible.map((entry) => {
    const start = normalizeDate(entry.startDate);
    const end = effectiveEndDate(entry);
    const rawFrom = weekISO.indexOf(start);
    const rawTo = weekISO.indexOf(end);
    const from = start < first ? 0 : Math.max(0, rawFrom);
    const to = end > last ? 6 : (rawTo < 0 ? from : rawTo);

    let lane = 0;
    while (lanes[lane]?.some((r) => !(to < r.from || from > r.to))) lane++;
    (lanes[lane] ??= []).push({ from, to });

    return { entry, lane, from, to, continuesLeft: start < first, continuesRight: end > last };
  });

  return { placed, laneCount: lanes.length };
}

/**
 * 항목을 숨기지 않는다. "+N개 더" 대신 개수에 따라 바 높이를 압축해 전부 보여 준다.
 * 이 프로젝트의 설계 원칙이라 그대로 지킨다.
 */
function barMetrics(laneCount: number) {
  if (laneCount <= 4) return { height: 21, gap: 23, showText: true };
  if (laneCount <= 7) return { height: 14, gap: 16, showText: true };
  return { height: 8, gap: 10, showText: false };
}

export function MonthCalendar({
  cursor, onCursorChange, entries, tideEntries, tideMonths, accounts, hasBalance, lens, weekStart, todayISO,
  onEntryClick, onDayOpen, onDayCreate,
}: Props) {
  const grid = useMemo(() => monthGrid(cursor, weekStart), [cursor, weekStart]);
  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, i) => grid.slice(i * 7, i * 7 + 7)),
    [grid],
  );
  const labels = weekdayLabels(weekStart);
  const curMonth = cursor.getMonth();

  /*
    날짜별 한도. 잔고캘린더가 셀마다 적어 주던 숫자다 — "이 날까지 쓸 수 있는 돈".
    오늘 이전은 적지 않는다. 지나간 발생분은 이미 잔고에 반영돼 있어 한도를
    건드리지 못하므로, 과거 셀에는 잔고가 그대로 반복될 뿐이다.
  */
  /*
    통화가 섞이면 최소 단위가 달라 애초에 더할 수 없다. 카드가 숫자를 내지 않는 상태에서
    달력만 셀마다 금액을 적으면, 카드가 거절한 바로 그 숫자를 달력이 지어내는 꼴이 된다.
  */
  const scope = useMemo(() => currencyScopeOf(accounts, tideEntries), [accounts, tideEntries]);

  const showLimits = lens === 'money' && hasBalance && scope.ok;
  const limits = useMemo(() => {
    if (!showLimits) return null;
    // 계산 창은 연속된 달의 묶음이라, 양 끝이 들어 있으면 사이도 들어 있다.
    const covered = new Set(tideMonths);
    const map = new Map<string, number>();
    for (const d of grid) {
      const iso = toISO(d);
      if (iso < todayISO) continue;
      if (!covered.has(ymOf(iso))) continue;
      map.set(iso, limitOn(accounts, tideEntries, iso, todayISO));
    }
    return map;
  }, [showLimits, grid, accounts, tideEntries, tideMonths, todayISO]);

  const touch = useRef({ x: 0, y: 0 });
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      onCursorChange(new Date(cursor.getFullYear(), cursor.getMonth() + (dx < 0 ? 1 : -1), 1));
    }
  };

  return (
    <div className="cal" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="cal-head">
        {labels.map((l) => (
          <div key={l} className={'cal-dow' + (l === '토' || l === '일' ? ' wknd' : '')}>{l}</div>
        ))}
      </div>

      {weeks.map((week, wi) => {
        const weekISO = week.map(toISO);
        const { placed, laneCount } = placeWeek(entries, weekISO);
        const { height, gap, showText } = barMetrics(laneCount);
        const topOffset = 32;
        // 한도 숫자는 바 아래 한 줄을 차지한다. 한도가 뜨는 주에만 그만큼을 더한다 —
        // 오늘 이전 주까지 키워 두면 지나간 자리에 빈 줄만 남는다.
        const weekHasLimit = limits !== null && weekISO.some((iso) => limits.has(iso));
        const minHeight = topOffset + laneCount * gap + 8 + (weekHasLimit ? 15 : 0);

        return (
          <div className="cal-week" key={weekISO[0] ?? wi} style={{ minHeight }}>
            <div className="cal-cells">
              {week.map((d) => {
                const iso = toISO(d);
                const inMonth = d.getMonth() === curMonth;
                const today = iso === todayISO;
                return (
                  <div
                    key={iso}
                    className={'cal-cell' + (inMonth ? '' : ' out') + (today ? ' today' : '') + (isWeekend(d) ? ' wknd' : '')}
                    onClick={() => onDayCreate(iso)}
                  >
                    <button
                      className={'cal-num' + (today ? ' is-today' : '')}
                      onClick={(e) => { e.stopPropagation(); onDayOpen(iso); }}
                      aria-label={`${iso} 상세 보기`}
                    >
                      {d.getDate()}
                    </button>
                    {inMonth && d.getDate() === 1 && <span className="cal-mtag">{d.getMonth() + 1}월</span>}
                    {limits?.has(iso) && (
                      <span
                        className={'cal-limit num' + ((limits.get(iso) ?? 0) < 0 ? ' bad' : '')}
                        aria-label={`${iso} 한도`}
                      >
                        {compactAmount(limits.get(iso) ?? 0)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="cal-bars" style={{ top: topOffset }}>
              {placed.map(({ entry, lane, from, to, continuesLeft, continuesRight }) => {
                const hex = colorHex(entry.color);
                const money = entry.kind === 'money' ? entry.money : null;
                const accent = money ? MONEY_TYPE_BY_ID[money.type].color : hex;
                return (
                  <button
                    key={entry.id}
                    className={
                      'cal-bar'
                      + (isDone(entry) ? ' done' : '')
                      + (continuesLeft ? ' cont-l' : '')
                      + (continuesRight ? ' cont-r' : '')
                    }
                    style={{
                      top: lane * gap,
                      height,
                      left: `calc(${(from / 7) * 100}% + 3px)`,
                      width: `calc(${((to - from + 1) / 7) * 100}% - 6px)`,
                      ['--bar' as string]: accent,
                    }}
                    title={displayTitle(entry)}
                    onClick={(e) => { e.stopPropagation(); onEntryClick(entry); }}
                  >
                    {showText && (
                      <span className="cal-bar-in">
                        {lens === 'all' && <KindDot kind={entry.kind} />}
                        {entry.startTime && <span className="cal-bar-t">{entry.startTime}</span>}
                        <span className="cal-bar-x">{displayTitle(entry)}</span>
                        {entry.isRecurring && <Icon.Repeat size={9} />}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 'all' 렌즈에서 어느 축의 항목인지 한눈에 구분하는 표시. */
function KindDot({ kind }: { kind: Entry['kind'] }) {
  const glyph = kind === 'task' ? '●' : kind === 'idea' ? '◆' : '▮';
  const label = kind === 'task' ? '할 일' : kind === 'idea' ? '아이디어' : '가계부';
  return <span className="cal-kind" aria-label={label}>{glyph}</span>;
}
