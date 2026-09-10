/**
 * 배선 회귀 테스트 — 실제 전달 경로.
 *
 * 도메인 함수만 테스트하면 "계산에 원본을 넘긴다" 는 규칙을 App 이 지키는지는 알 수 없다.
 * 여기서는 App 이 실제로 넘기는 props 그대로 컴포넌트를 렌더링해서, 화면에 뜨는 숫자가
 * 맞는지 그리고 달력을 넘겨도 그 숫자가 그대로인지를 본다.
 *
 * 지키려는 것 두 가지.
 *   1. 금액 계산에는 `materialize()` 결과가 아니라 원본이 들어간다
 *   2. 한도·다음 입금일·정산은 보고 있는 달과 무관하다
 */
import { render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { entryFromDoc, entryToDoc } from '../data/converters';
import { monthWindow, tideWindow } from '../data/repo';
import { endOfMonth, startOfMonth, toISO } from '../domain/date';
import { newEntry, setRecurrence } from '../domain/entry';
import { applyFilters, emptyFilters } from '../domain/filters';
import { materialize } from '../domain/recurrence';
import { TideInputError } from '../domain/tide';
import type { Account, Entry, MoneyType } from '../domain/types';
import { DialogHost } from '../ui/Dialog';
import { MonthCalendar } from '../ui/MonthCalendar';
import { TideBar } from '../ui/TideBar';
import { TodayPanel } from '../ui/TodayPanel';

/** 화면이 오늘로 삼는 날. 오늘은 App 이 재어서 prop 으로 내려 준다(`useToday`). */
const TODAY = '2026-09-10';

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0));
});
afterAll(() => { vi.useRealTimers(); });
afterEach(cleanup);

const money = (
  type: MoneyType, amountMinor: number, startDate: string,
  extra: { endDate?: string; title?: string } = {},
): Entry =>
  newEntry('money', {
    title: extra.title ?? '',
    startDate,
    endDate: extra.endDate ?? null,
    money: { type, amountMinor, currency: 'KRW', linkedEntryId: null },
  });

/** Firestore 왕복을 거친 모양. 앱이 실제로 손에 쥐는 값이다. */
const stored = (e: Entry): Entry => entryFromDoc(e.id, entryToDoc(e));

/** 급여(매월 25일) + 주간 지출(매주 화). 재현 사례와 같은 모양이다. */
const RAW: Entry[] = [
  setRecurrence(money('income', 3_000_000, '2026-09-25', { title: '급여' }), {
    freq: 'monthly', interval: 1, until: null, count: null,
  }),
  setRecurrence(money('expense', 10_000, '2026-09-01', { title: '주간 장보기' }), {
    freq: 'weekly', interval: 1, until: null, count: null,
  }),
].map(stored);

const ACCOUNTS: Account[] = [{
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: TODAY, checkedAt: `${TODAY}T00:00:00.000Z`,
  order: 0, createdAt: '', updatedAt: '',
}];

/**
 * App 이 커서 달마다 만드는 화면용 목록.
 * 달을 넘길 때마다 길이가 달라지는 바로 그 값이다.
 */
function shownFor(cursor: Date): Entry[] {
  return materialize(RAW, toISO(startOfMonth(cursor)), toISO(endOfMonth(cursor)));
}

const wrap = (node: React.ReactNode) => render(<DialogHost>{node}</DialogHost>);

const SEPTEMBER = new Date(2026, 8, 1);
const NEXT_JUNE = new Date(2027, 5, 1);

describe('며칠 버티나 카드 — 계산 입력은 커서와 무관하다', () => {
  it.each([
    ['이번 달을 보고 있을 때', SEPTEMBER],
    ['아홉 달 뒤를 보고 있을 때', NEXT_JUNE],
  ])('%s 같은 한도와 같은 다음 입금일을 보여 준다', (_label, cursor) => {
    // 화면용 목록은 커서마다 다르다. 계산 입력(RAW)은 그대로다.
    expect(shownFor(cursor).length).toBeGreaterThan(0);

    wrap(
      <TideBar
        todayISO={TODAY}
        accounts={ACCOUNTS}
        entries={RAW}
        hasBalance
        onSaveAccount={() => {}}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    );

    const card = screen.getByLabelText('며칠 버티나');
    // 잔고 1,000,000 − 주간 지출 09-15 · 09-22 두 번 = 980,000
    expect(within(card).getByLabelText('잔고 고치기')).toHaveTextContent('980,000');
    // 다음 입금은 급여일(09-25), 한도의 끝은 그 전날.
    expect(card).toHaveTextContent('다음 입금');
    expect(card).toHaveTextContent('25일');
  });

  it('화면용 목록을 계산에 넘기면 렌더링이 실패한다 — 부풀린 숫자를 내지 않는다', () => {
    // 예전 배선(entries={materialized})을 그대로 재현한다.
    const shown = shownFor(SEPTEMBER);
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => wrap(
      <TideBar
        todayISO={TODAY}
        accounts={ACCOUNTS}
        entries={shown}
        hasBalance
        onSaveAccount={() => {}}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    )).toThrow(TideInputError);
    boom.mockRestore();
  });
});

describe('오늘 카드 — 표시용과 계산용을 따로 받는다', () => {
  it('반복 항목을 오늘 목록에 보여 주면서 한도는 원본으로 잰다', () => {
    const shown = shownFor(SEPTEMBER);

    wrap(
      <TodayPanel
        todayISO={TODAY}
        entries={shown}
        tideEntries={RAW}
        accounts={ACCOUNTS}
        hasBalance
        collapsed={false}
        onToggleCollapsed={() => {}}
        moneyCollapsed={false}
        onToggleMoneyCollapsed={() => {}}
        onEntryClick={() => {}}
        onStatusChange={() => {}}
        onPromote={() => {}}
        onQuickIdea={() => {}}
        onSaveAccount={() => {}}
      />,
    );

    const panel = screen.getByLabelText('오늘');
    expect(within(panel).getByLabelText('잔고 고치기')).toHaveTextContent('980,000');
  });

  it('계산용 자리에 화면용 목록을 넣으면 실패한다', () => {
    const shown = shownFor(SEPTEMBER);
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => wrap(
      <TodayPanel
        todayISO={TODAY}
        entries={shown}
        tideEntries={shown}
        accounts={ACCOUNTS}
        hasBalance
        collapsed={false}
        onToggleCollapsed={() => {}}
        moneyCollapsed={false}
        onToggleMoneyCollapsed={() => {}}
        onEntryClick={() => {}}
        onStatusChange={() => {}}
        onPromote={() => {}}
        onQuickIdea={() => {}}
        onSaveAccount={() => {}}
      />,
    )).toThrow(TideInputError);
    boom.mockRestore();
  });
});

describe('달력 — 날짜별 한도', () => {
  const renderCalendar = (cursor: Date, tideMonths = tideWindow(TODAY)) => {
    const shown = shownFor(cursor);
    return wrap(
      <MonthCalendar
        cursor={cursor}
        onCursorChange={() => {}}
        entries={applyFilters(shown, 'money', emptyFilters())}
        tideEntries={RAW}
        tideMonths={tideMonths}
        accounts={ACCOUNTS}
        hasBalance
        lens="money"
        weekStart="mon"
        todayISO={TODAY}
        onEntryClick={() => {}}
        onDayOpen={() => {}}
        onDayCreate={() => {}}
      />,
    );
  };

  it('오늘 이후 셀에 한도를 적는다', () => {
    renderCalendar(SEPTEMBER);
    // 09-14: 아직 주간 지출이 지나지 않았다 → 잔고 그대로 100만.
    expect(screen.getByLabelText('2026-09-14 한도')).toHaveTextContent('100만');
    // 09-15: 주간 지출 한 번 → 99만.
    expect(screen.getByLabelText('2026-09-15 한도')).toHaveTextContent('99만');
  });

  it('오늘 이전 셀에는 적지 않는다', () => {
    renderCalendar(SEPTEMBER);
    expect(screen.queryByLabelText('2026-09-09 한도')).toBeNull();
  });

  it('필터로 항목을 가려도 한도는 그대로다', () => {
    const shown = shownFor(SEPTEMBER);
    const hideEverything = { ...emptyFilters(), q: '있을 수 없는 검색어' };
    wrap(
      <MonthCalendar
        cursor={SEPTEMBER}
        onCursorChange={() => {}}
        entries={applyFilters(shown, 'money', hideEverything)}
        tideEntries={RAW}
        tideMonths={tideWindow(TODAY)}
        accounts={ACCOUNTS}
        hasBalance
        lens="money"
        weekStart="mon"
        todayISO={TODAY}
        onEntryClick={() => {}}
        onDayOpen={() => {}}
        onDayCreate={() => {}}
      />,
    );
    expect(screen.getByLabelText('2026-09-15 한도')).toHaveTextContent('99만');
  });

  it('계산 창이 덮지 않는 달에는 숫자를 적지 않는다', () => {
    // 자료가 없는 달에 0을 더해 그럴듯하게 틀린 값을 내지 않는다.
    const farAway = new Date(2028, 0, 1);
    renderCalendar(farAway);
    expect(screen.queryByLabelText('2028-01-15 한도')).toBeNull();
  });
});

describe('구독 창', () => {
  it('계산 창은 오늘 기준이고 커서를 옮겨도 그대로다', () => {
    const a = tideWindow(TODAY);
    const b = tideWindow(TODAY);
    expect(a).toEqual(b);
    expect(a).toContain('2026-09');
    // 화면 창은 커서를 따라 움직인다 — 이 둘이 다른 값이라는 것이 이번 수정의 핵심이다.
    expect(monthWindow('2027-06-01')).not.toEqual(a);
  });

  it('계산 창은 다음 입금 탐색 구간(400일)보다 넓다', () => {
    // 좁으면 실제로 있는 입금을 못 보고 "입금 없음 → 30일 뒤" 로 조용히 물러난다.
    for (const day of ['2026-09-01', '2026-09-30', '2027-02-28']) {
      const months = tideWindow(day);
      const last = months[months.length - 1]!;
      const [y, m] = last.split('-').map(Number) as [number, number];
      const lastDay = new Date(y, m, 0);
      const spanDays = Math.round((lastDay.getTime() - new Date(day).getTime()) / 86_400_000);
      expect(spanDays).toBeGreaterThanOrEqual(400);
    }
  });

  it('계산 창은 array-contains-any 상한(30)을 넘지 않는다', () => {
    expect(tideWindow(TODAY).length).toBeLessThanOrEqual(30);
  });
});

describe('달력 — 통화가 섞이면 셀에도 적지 않는다', () => {
  it('카드가 거절한 숫자를 달력이 지어내지 않는다', () => {
    const mixed: Account[] = [
      ACCOUNTS[0]!,
      { id: 'a2', name: '달러', balanceMinor: 50_000, currency: 'USD',
        asOf: TODAY, checkedAt: `${TODAY}T00:00:00.000Z`, order: 1, createdAt: '', updatedAt: '' },
    ];
    wrap(
      <MonthCalendar
        cursor={SEPTEMBER}
        onCursorChange={() => {}}
        entries={applyFilters(shownFor(SEPTEMBER), 'money', emptyFilters())}
        tideEntries={RAW}
        tideMonths={tideWindow(TODAY)}
        accounts={mixed}
        hasBalance
        lens="money"
        weekStart="mon"
        todayISO={TODAY}
        onEntryClick={() => {}}
        onDayOpen={() => {}}
        onDayCreate={() => {}}
      />,
    );
    expect(screen.queryByLabelText('2026-09-15 한도')).toBeNull();
  });
});
