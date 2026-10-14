import { useMemo, useRef } from 'react';
import { colorHex, MONEY_TYPE_BY_ID } from '../domain/constants';
import { isWeekend, monthGrid, normalizeDate, toISO, weekdayLabels, ymOf } from '../domain/date';
import { displayTitle, effectiveEndDate, isDone } from '../domain/entry';
import { compactAmount, formatAmount } from '../domain/money';
import { calendarAmountOn, type CalendarAmount } from '../domain/layout';
import { calcScopeOf, type Reservations } from '../domain/tide';
import type { Account, Budget, Entry, LensId, WeekStart, YearMonth } from '../domain/types';
import { Icon } from './Icon';
import { isRecoveryEntry } from '../domain/recovery';
import { daySummary, type DaySummary } from '../domain/daySummary';
import { isActual } from '../domain/ledger';
import { CalendarDaySummary } from './CalendarDaySummary';
import { SUMMARY_HEIGHT } from './ledgerView';

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
  /**
   * 가계부 달력의 지난 날 요약. 주면 오늘 이전(오늘 포함)의 **실제 거래**를 막대로 늘어놓지
   * 않고 셀마다 요약 한 칸으로 적는다 — 현금흐름 보기에서만 준다. 다른 렌즈 · 같이 보기 달력은
   * 이 값을 받지 않아 지금 그대로다.
   *
   * `entries` 는 저장된 원본(반복을 펼치지 않은 목록, 필터 이전)이다. 합계는 필터와 무관하다.
   * `ready` 가 아니면 셀에 아무 숫자도 적지 않는다 — 덜 받은 목록의 합을 0원처럼 내지 않는다.
   */
  ledgerSummary?: { entries: readonly Entry[]; ready: boolean };
  /**
   * 생활비 주머니 막대 — **`Budget` 에서** 그린다. 입출금 `Entry` 가 아니므로 예상 잔고 · 요약 ·
   * 한도 계산에 들어가지 않고, 누르면 거래 창이 아니라 `onPocketClick(budget.id)` 로 간다. 여러 주에
   * 걸쳐 끊겨 그려져도 조각마다 같은 id 다. 현금흐름 달력만 준다.
   */
  pockets?: readonly Budget[];
  onPocketClick?: (budgetId: string) => void;
  /**
   * 셀에 적는 금액의 기준(설정 > 캘린더 표시). 주지 않으면 예상 잔고다. 계산은 바뀌지 않고
   * 어느 숫자를 보여 줄지만 고른다(`calendarAmountOn`). 가용 · 생활비 잔여는 `reservations` 를 본다.
   */
  amountMode?: CalendarAmount;
  reservations?: Reservations;
}

const AMOUNT_NAME: Record<CalendarAmount, string> = {
  balance: '전체 보유액', projected: '예상 잔고', available: '가용 잔액', pocket: '생활비 잔여',
};

/** 한 주에 놓는 막대 하나 — 입출금 · 할 일(`Entry`) 또는 생활비 주머니(`Budget`). */
type BarItem =
  | { kind: 'entry'; entry: Entry }
  | { kind: 'pocket'; budget: Budget };

interface Placed {
  item: BarItem;
  lane: number;
  from: number;
  to: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

const itemStart = (it: BarItem) => normalizeDate(it.kind === 'entry' ? it.entry.startDate : it.budget.startDate);
const itemEnd = (it: BarItem) => (it.kind === 'entry' ? effectiveEndDate(it.entry) : normalizeDate(it.budget.endDate));

/**
 * 겹치지 않는 가장 위쪽 레인에 배치한다.
 *
 * `floor` 를 주면 그 날 앞으로는 막대를 그리지 않는다(가계부 요약 모드 — 지난 날은 요약 칸이
 * 차지한다). 그 날에 걸친 기간 항목은 그 날부터 그린다.
 */
function placeWeek(
  items: readonly BarItem[], weekISO: readonly string[], floor?: string,
): { placed: Placed[]; laneCount: number } {
  const first = weekISO[0] ?? '';
  const last = weekISO[6] ?? '';
  const startOf = (it: BarItem) => {
    const start = itemStart(it);
    return floor && start < floor ? floor : start;
  };

  const visible = items.filter((it) => {
    const start = startOf(it);
    return start <= last && itemEnd(it) >= first && itemEnd(it) >= start;
  });

  // 생활비 주머니가 맨 위 — 그 아래 막대들이 어느 기간 안에 있는지 읽힌다.
  // 기간이 긴 항목을 위로 올려야 바가 계단처럼 흩어지지 않는다.
  visible.sort((a, b) => {
    const pocketOrder = Number(b.kind === 'pocket') - Number(a.kind === 'pocket');
    if (pocketOrder) return pocketOrder;
    if (a.kind === 'pocket' || b.kind === 'pocket') return itemStart(a).localeCompare(itemStart(b));
    const ea = a.entry;
    const eb = b.entry;
    const recoveryOrder = Number(isRecoveryEntry(ea)) - Number(isRecoveryEntry(eb));
    if (recoveryOrder) return recoveryOrder;
    const aSpan = effectiveEndDate(ea) > ea.startDate ? 0 : 1;
    const bSpan = effectiveEndDate(eb) > eb.startDate ? 0 : 1;
    if (aSpan !== bSpan) return aSpan - bSpan;
    const aKey = `${ea.startDate}T${ea.startTime ?? '00:00'}`;
    const bKey = `${eb.startDate}T${eb.startTime ?? '00:00'}`;
    return aKey.localeCompare(bKey);
  });

  const lanes: { from: number; to: number }[][] = [];
  const placed: Placed[] = visible.map((item) => {
    const start = startOf(item);
    const end = itemEnd(item);
    const rawFrom = weekISO.indexOf(start);
    const rawTo = weekISO.indexOf(end);
    const from = start < first ? 0 : Math.max(0, rawFrom);
    const to = end > last ? 6 : (rawTo < 0 ? from : rawTo);

    let lane = 0;
    while (lanes[lane]?.some((r) => !(to < r.from || from > r.to))) lane++;
    (lanes[lane] ??= []).push({ from, to });

    return { item, lane, from, to, continuesLeft: start < first, continuesRight: end > last };
  });

  return { placed, laneCount: lanes.length };
}

const isRecoveryItem = (it: BarItem) => it.kind === 'entry' && isRecoveryEntry(it.entry);

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
  cursor, onCursorChange, entries, tideEntries,
  tideMonths, accounts, hasBalance, lens, weekStart, todayISO,
  onEntryClick, onDayOpen, onDayCreate, ledgerSummary, pockets, onPocketClick,
  amountMode = 'projected', reservations,
}: Props) {
  const grid = useMemo(() => monthGrid(cursor, weekStart), [cursor, weekStart]);
  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, i) => grid.slice(i * 7, i * 7 + 7)),
    [grid],
  );
  const labels = weekdayLabels(weekStart);
  const curMonth = cursor.getMonth();

  /*
    날짜별 **예상 잔고** — 확인 잔고에 그 날까지 적어 둔 현금 입출금을 더한 값
    (`projectedBalanceOn`). 생활비 · 세이브는 빼지 않는다 — 내부 배분이지 출금이 아니다.

    예전에는 여기 가용 한도(`limitOn`, 생활비 · 세이브를 뺀 값)를 적었다. 잔고 250,000 ·
    생활비 200,000 이면 셀마다 50,000 이 떠, 생활비를 만들기만 해도 통장에서 돈이 빠진
    것처럼 읽혔다. 쓸 수 있는 돈은 카드와 날짜 상세가 따로 적는다.

    오늘 이전은 적지 않는다(지난 날은 현금흐름 요약이 차지한다).

    설정에서 기준을 바꾸면(`amountMode`) 같은 자리에 전체 보유액 · 가용 잔액 · 생활비 잔여를 적는다.
    셋 다 카드 · 날짜 상세가 쓰는 함수 그대로라 새 숫자를 지어내지 않는다. 기본은 예상 잔고다.
  */
  /*
    통화가 섞이면 최소 단위가 달라 애초에 더할 수 없다. 카드가 숫자를 내지 않는 상태에서
    달력만 셀마다 금액을 적으면, 카드가 거절한 바로 그 숫자를 달력이 지어내는 꼴이 된다.
    계좌를 모르는 실제 거래가 있을 때도 같다 (`calcScopeOf`).
  */
  const scope = useMemo(() => calcScopeOf(accounts, tideEntries), [accounts, tideEntries]);

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
      const v = calendarAmountOn(amountMode, accounts, tideEntries, iso, todayISO, reservations);
      if (v !== null) map.set(iso, v);
    }
    return map;
  }, [showLimits, grid, accounts, tideEntries, tideMonths, todayISO, amountMode, reservations]);
  const amountName = AMOUNT_NAME[amountMode];

  /*
    가계부 요약 모드. 지난 날 · 오늘의 실제 거래와 지난 날의 예정은 막대가 아니라 요약 칸이다.
    막대로 남는 것은 오늘 · 앞날의 예정뿐이고, 오늘에 걸친 기간 예정은 오늘부터 그린다.
  */
  const summaryMode = ledgerSummary !== undefined;
  const barEntries = useMemo(() => (summaryMode
    ? entries.filter((e) => {
      if (e.kind !== 'money') return true;
      if (isActual(e)) return normalizeDate(e.startDate) > todayISO;
      return effectiveEndDate(e) >= todayISO;
    })
    : entries), [summaryMode, entries, todayISO]);
  const barItems = useMemo<BarItem[]>(() => [
    ...(pockets ?? []).map((budget) => ({ kind: 'pocket' as const, budget })),
    ...barEntries.map((entry) => ({ kind: 'entry' as const, entry })),
  ], [pockets, barEntries]);
  const summaries = useMemo(() => {
    if (!ledgerSummary?.ready) return null;
    const map = new Map<string, DaySummary>();
    for (const d of grid) {
      const iso = toISO(d);
      if (iso > todayISO) continue;
      const s = daySummary(ledgerSummary.entries, iso);
      /*
        셀에는 실제 거래만 요약한다. 오늘의 남은 예정은 막대로 그리고, **지난 날의 미확정 예정은
        셀에 적지 않는다** — 날짜가 지난 예정이 '예정 N' 으로 쌓여 실제 요약과 섞였다. 숨기는 것은
        표시뿐이다: 예정 자체는 그대로이고, 계산(예상 잔고 · 한도)도 그대로 그것을 센다. 그 날의
        미확정 예정은 날짜 상세의 접힌 구역에서 확정 · 열기 · 정리한다.
      */
      const day = { ...s, unconfirmed: 0 };
      if (day.actuals.length === 0 && day.unconfirmed === 0) continue;
      map.set(iso, day);
    }
    return map;
  }, [ledgerSummary, grid, todayISO]);

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
        const { placed, laneCount } = placeWeek(barItems, weekISO, summaryMode ? todayISO : undefined);
        const { height, gap, showText } = barMetrics(laneCount);
        // Recovery remains readable even when ordinary events compress to strips.
        const laneHeights = Array.from({ length: laneCount }, (_, lane) =>
          placed.some((p) => p.lane === lane && isRecoveryItem(p.item)) ? Math.max(height, 18) : height);
        const laneOffsets: number[] = [];
        let contentHeight = 0;
        for (const laneHeight of laneHeights) {
          laneOffsets.push(contentHeight);
          contentHeight += laneHeight + (gap - height);
        }
        const topOffset = 32;
        // 한도 숫자는 바 아래 한 줄을 차지한다. 한도가 뜨는 주에만 그만큼을 더한다 —
        // 오늘 이전 주까지 키워 두면 지나간 자리에 빈 줄만 남는다.
        const weekHasLimit = limits !== null && weekISO.some((iso) => limits.has(iso));
        /*
          요약 칸의 자리. 지난 날 칸에는 막대가 없으므로 날짜 바로 아래(topOffset)에 서고,
          오늘 칸은 남은 예정 막대 아래에 선다. 요약 칸의 높이는 거래 수와 무관하게 늘 같다.
        */
        const summaryTop = (col: number) => {
          const used = placed.filter((p) => p.from <= col && p.to >= col).map((p) => p.lane);
          if (used.length === 0) return topOffset;
          const lane = Math.max(...used);
          return topOffset + (laneOffsets[lane] ?? 0) + (laneHeights[lane] ?? height) + 4;
        };
        // 지난 날이 하나라도 있는 주는 요약 한 칸만큼을 늘 잡아 둔다 — 거래가 없거나 아직 받는
        // 중이어도 높이가 같아, 자료가 도착할 때 달력이 위아래로 튀지 않는다.
        const pastWeek = summaryMode && (weekISO[0] ?? '') < todayISO;
        const summaryBottom = Math.max(
          pastWeek ? topOffset + SUMMARY_HEIGHT : 0,
          ...weekISO.map((iso, col) => (summaries?.has(iso) ? summaryTop(col) + SUMMARY_HEIGHT : 0)),
        );
        const minHeight = Math.max(topOffset + contentHeight + 8, summaryBottom + 4) + (weekHasLimit ? 15 : 0);

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
                    {summaries?.has(iso) && (
                      <CalendarDaySummary
                        summary={summaries.get(iso)!}
                        top={summaryTop(week.indexOf(d))}
                        onOpen={() => onDayOpen(iso)}
                      />
                    )}
                    {limits?.has(iso) && (
                      <span
                        className={'cal-limit num' + ((limits.get(iso) ?? 0) < 0 ? ' bad' : '')}
                        aria-label={`${iso} ${amountName} ${(limits.get(iso) ?? 0).toLocaleString('ko-KR')}원`}
                      >
                        {compactAmount(limits.get(iso) ?? 0)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="cal-bars" style={{ top: topOffset }}>
              {placed.map(({ item, lane, from, to, continuesLeft, continuesRight }) => {
                if (item.kind === 'pocket') {
                  const b = item.budget;
                  const label = b.name.includes('생활비') ? b.name : `생활비 · ${b.name}`;
                  return (
                    <button
                      key={`pocket:${b.id}`}
                      className={'cal-bar pocket' + (continuesLeft ? ' cont-l' : '') + (continuesRight ? ' cont-r' : '')}
                      style={{
                        top: laneOffsets[lane],
                        height,
                        left: `calc(${(from / 7) * 100}% + 3px)`,
                        width: `calc(${((to - from + 1) / 7) * 100}% - 6px)`,
                      }}
                      title={`${label} · ${formatAmount(b.amountMinor)} · ${b.startDate} ~ ${b.endDate}`}
                      aria-label={`생활비 ${b.name} ${formatAmount(b.amountMinor)}원 열기`}
                      onClick={(e) => { e.stopPropagation(); onPocketClick?.(b.id); }}
                    >
                      {showText && (
                        <span className="cal-bar-in">
                          <span className="cal-bar-x">{label} {formatAmount(b.amountMinor)}</span>
                        </span>
                      )}
                    </button>
                  );
                }
                const entry = item.entry;
                const hex = colorHex(entry.color);
                const money = entry.kind === 'money' ? entry.money : null;
                const accent = money ? MONEY_TYPE_BY_ID[money.type].color : hex;
                return (
                  <button
                    key={entry.id}
                    className={
                      'cal-bar'
                      + (isRecoveryEntry(entry) ? ' recovery-text' : '')
                      + (isDone(entry) ? ' done' : '')
                      + (continuesLeft ? ' cont-l' : '')
                      + (continuesRight ? ' cont-r' : '')
                    }
                    style={{
                      top: laneOffsets[lane],
                      height: isRecoveryEntry(entry) ? Math.max(height, 18) : height,
                      left: `calc(${(from / 7) * 100}% + 3px)`,
                      width: `calc(${((to - from + 1) / 7) * 100}% - 6px)`,
                      ['--bar' as string]: accent,
                    }}
                    title={displayTitle(entry)}
                    onClick={(e) => { e.stopPropagation(); onEntryClick(entry); }}
                  >
                    {(showText || isRecoveryEntry(entry)) && (
                      <span className="cal-bar-in">
                        {lens === 'all' && !isRecoveryEntry(entry) && <KindDot kind={entry.kind} />}
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
