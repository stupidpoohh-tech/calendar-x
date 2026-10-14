/**
 * 가계부 달력의 지난 날 요약 — 막대 대신 요약 칸, 오늘은 실제 요약 + 남은 예정 막대, 앞날은 막대.
 * 다른 렌즈 달력(ledgerSummary 를 받지 않는)은 지금 그대로다.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { daySummary } from '../domain/daySummary';
import { newEntry, newMoney } from '../domain/entry';
import { materialize } from '../domain/recurrence';
import type { Entry, MoneyFields } from '../domain/types';
import { DaySheet } from './DaySheet';
import { MonthCalendar } from './MonthCalendar';

afterEach(cleanup);

const TODAY = '2026-10-13';
let n = 0;
const tx = (date: string, amount: number, m: Partial<MoneyFields> = {}, title = `거래${++n}`): Entry => newEntry('money', {
  id: `t${++n}`, title, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }),
});
const plan = (date: string, amount: number, title = `예정${++n}`): Entry => newEntry('money', {
  id: `p${++n}`, title, startDate: date, money: newMoney({ type: 'expense', amountMinor: amount }),
});

function mount(raw: Entry[], opts: { ready?: boolean; summary?: boolean; lens?: 'money' | 'task' } = {}) {
  const onDayOpen = vi.fn();
  const shown = materialize(raw, '2026-09-28', '2026-11-08');
  render(
    <MonthCalendar
      cursor={new Date(2026, 9, 1)} onCursorChange={vi.fn()}
      entries={shown} tideEntries={[]} tideMonths={[]} accounts={[]} hasBalance={false}
      lens={opts.lens ?? 'money'} weekStart="mon" todayISO={TODAY}
      onEntryClick={vi.fn()} onDayOpen={onDayOpen} onDayCreate={vi.fn()}
      ledgerSummary={opts.summary === false ? undefined : { entries: raw, ready: opts.ready ?? true }}
    />,
  );
  return { onDayOpen };
}

const sums = () => [...document.querySelectorAll('.cal-sum')] as HTMLElement[];
const bars = () => [...document.querySelectorAll('.cal-bar')] as HTMLElement[];

describe('지난 날 — 막대 대신 요약', () => {
  it('소액 25건은 막대 25개가 아니라 요약 한 칸 · 거래 25건', () => {
    mount(Array.from({ length: 25 }, () => tx('2026-10-05', 3_000)));
    expect(bars()).toHaveLength(0);
    expect(sums()).toHaveLength(1);
    expect(sums()[0]!.textContent).toContain('−7.5만');
    expect(sums()[0]!.textContent).toContain('거래 25건');
  });

  it('수입 · 지출 · 주요 거래 · 외 N건', () => {
    mount([
      tx('2026-10-05', 520_000, { type: 'income' }),
      tx('2026-10-05', 180_000, {}, '병원'),
      ...Array.from({ length: 6 }, () => tx('2026-10-05', 16_000)),
    ]);
    const s = sums()[0]!;
    expect(s.textContent).toContain('+52만');
    expect(s.textContent).toContain('−27.6만');
    expect(s.textContent).toContain('병원');
    // 수입 · 병원 · 소액 6건 = 8건, 주요 거래 하나를 뺀 7건.
    expect(s.textContent).toContain('외 7건');
    expect(s.getAttribute('aria-label')).toContain('수입 520,000원');
  });

  it('직접 고른 거래가 자동 선정보다 앞선다', () => {
    mount([tx('2026-10-05', 300_000, {}, '여행'), tx('2026-10-05', 25_000, { highlight: true }, '꽃다발')]);
    expect(sums()[0]!.querySelector('.cal-sum-l.major')!.textContent).toContain('꽃다발');
  });

  it('카드 사용은 주요 소비로 뜨지만 현금 지출 줄은 없다', () => {
    mount([tx('2026-10-05', 200_000, { flow: 'cardSpend' }, '가전')]);
    const s = sums()[0]!;
    expect(s.querySelector('.cal-sum-l.out')).toBeNull();
    expect(s.textContent).toContain('가전');
  });

  it('지난 날의 미확정 예정은 달력에 적지 않는다 — 막대도 표식도 없다', () => {
    mount([plan('2026-10-12', 70_000)]);
    expect(bars()).toHaveLength(0);
    expect(sums()).toHaveLength(0);
    expect(document.querySelector('.cal-sum-plan')).toBeNull();
  });

  it('실제 거래가 있는 지난 날도 요약만 — 예정 건수를 덧붙이지 않는다', () => {
    mount([tx('2026-10-12', 5_000), plan('2026-10-12', 70_000)]);
    expect(sums()).toHaveLength(1);
    expect(sums()[0]!.textContent).toBe('−5천거래 1건');
    expect(sums()[0]!.querySelector('.cal-sum-plan')).toBeNull();
  });

  it('요약 칸을 누르면 그 날짜 상세를 연다', () => {
    const { onDayOpen } = mount([tx('2026-10-05', 3_000)]);
    fireEvent.click(sums()[0]!);
    expect(onDayOpen).toHaveBeenCalledWith('2026-10-05');
  });

  it('거래 수와 무관하게 지난 주의 높이가 같다', () => {
    mount([...Array.from({ length: 60 }, () => tx('2026-10-05', 1_000)), tx('2026-10-08', 1_000)]);
    const weeks = [...document.querySelectorAll('.cal-week')] as HTMLElement[];
    // 10/5 가 든 주(60건)와 10/8 이 든 주(1건)가 같은 주이고, 9/28 주(0건)와 같은 높이다.
    expect(weeks[0]!.style.minHeight).toBe(weeks[1]!.style.minHeight);
  });

  it('자료를 다 받기 전에는 아무 숫자도 적지 않는다 — 0원으로 지어내지 않는다', () => {
    mount([tx('2026-10-05', 3_000)], { ready: false });
    expect(sums()).toHaveLength(0);
    expect(bars()).toHaveLength(0);
  });
});

describe('오늘 · 앞날', () => {
  it('오늘은 실제 요약 + 남은 예정 막대, 예정을 요약에서 또 세지 않는다', () => {
    mount([tx(TODAY, 12_000, {}, '점심'), plan(TODAY, 50_000, '헬스장')]);
    expect(bars().map((b) => b.title)).toEqual(['헬스장 · 50,000']);
    expect(sums()).toHaveLength(1);
    expect(sums()[0]!.textContent).toContain('−1.2만');
    expect(sums()[0]!.querySelector('.cal-sum-plan')).toBeNull();
  });

  it('확정한 반복 회차는 막대로 다시 뜨지 않는다', () => {
    const sub = newEntry('money', {
      id: 'sub', title: '구독', startDate: '2026-09-13',
      recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
      money: newMoney({ type: 'expense', amountMinor: 17_000 }),
    });
    const paid = newEntry('money', {
      id: 'sub~2026-10-13', title: '구독', startDate: TODAY,
      money: newMoney({ status: 'actual', type: 'expense', amountMinor: 17_000, plannedRef: { entryId: 'sub', date: TODAY } }),
    });
    mount([sub, paid]);
    expect(bars()).toHaveLength(0);
    expect(sums()[0]!.textContent).toContain('−1.7만');
  });

  it('앞날 예정은 지금처럼 막대', () => {
    mount([plan('2026-10-20', 300_000, '카드대금'), plan('2026-10-25', 3_200_000, '월급')]);
    expect(bars().map((b) => b.title)).toEqual(['카드대금 · 300,000', '월급 · 3,200,000']);
    expect(sums()).toHaveLength(0);
  });

  it('지난 날에서 오늘로 걸친 기간 예정은 오늘부터 그린다', () => {
    mount([newEntry('money', {
      id: 'span', title: '생활비', startDate: '2026-10-01', endDate: '2026-10-31',
      money: newMoney({ type: 'living', amountMinor: 600_000 }),
    })]);
    const first = bars()[0]!;
    // 10/13(화)은 그 주의 두 번째 칸 — 왼쪽이 1/7 지점이다.
    expect(first.style.left).toMatch(/^calc\(14\.28\d*% \+ 3px\)$/);
  });
});

describe('다른 달력은 그대로', () => {
  it('요약을 받지 않으면 지난 날 실제 거래도 막대로 그린다', () => {
    mount([tx('2026-10-05', 3_000), tx('2026-10-05', 4_000)], { summary: false });
    expect(bars()).toHaveLength(2);
    expect(sums()).toHaveLength(0);
  });
});

describe('가계부 날짜 상세', () => {
  const day = '2026-10-09';
  const list = [
    tx(day, 180_000, {}, '병원'),
    ...Array.from({ length: 55 }, () => tx(day, 1_000)),
    tx(day, 200_000, { flow: 'cardSpend' }, '가전'),
  ];

  function open(summary = daySummary(list, day)) {
    const onToggleHighlight = vi.fn();
    const onEntryClick = vi.fn();
    render(
      <DaySheet
        dateISO={day} todayISO={TODAY} entries={list} moneyEntries={list}
        onClose={vi.fn()} onEntryClick={onEntryClick} onAdd={vi.fn()}
        ledger={{ summary, categories: [], onToggleHighlight }}
      />,
    );
    return { onToggleHighlight, onEntryClick };
  }

  it('소액까지 빠짐없이, 금액 · 실제 표시, 실제 현금흐름 합계', () => {
    open();
    const rows = within(screen.getByRole('list', { name: '이 날의 거래' })).getAllByRole('listitem');
    expect(rows).toHaveLength(57);
    const sum = screen.getByLabelText('이 날의 실제 현금흐름');
    // 카드 사용 200,000 은 현금 지출에 없다.
    expect(sum.textContent).toContain('−235,000');
    expect(sum.textContent).toContain('실제 거래 57건');
    expect(screen.getByText('달력에 표시 중')).toBeInTheDocument();
  });

  it('달력에 표시를 고르고, 거래를 눌러 고친다', () => {
    const { onToggleHighlight, onEntryClick } = open();
    fireEvent.click(screen.getByRole('button', { name: '가전 달력에 표시' }));
    expect(onToggleHighlight).toHaveBeenCalledWith(expect.objectContaining({ title: '가전' }));
    fireEvent.click(screen.getAllByRole('button', { name: /병원/ })[0]!);
    expect(onEntryClick).toHaveBeenCalledWith(expect.objectContaining({ title: '병원' }));
  });

  it('자료를 다 받기 전이면 합계를 적지 않는다', () => {
    open(null as never);
    expect(screen.queryByLabelText('이 날의 실제 현금흐름')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('불러오는 중');
  });
});

describe('지난 날 상세 — 실제 거래가 먼저, 미확정 예정은 접힌 구역', () => {
  const day = '2026-10-09';
  const paid = tx(day, 12_000, {}, '점심');
  const once = plan(day, 70_000, '병원 예약');
  const rec = newEntry('money', {
    id: 'gym', title: '헬스장', startDate: '2026-09-09',
    recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
    money: newMoney({ type: 'expense', amountMinor: 50_000 }),
  });
  const shown = [paid, once, ...materialize([rec], day, day)];

  function open(actions = true) {
    const planActions = { canConfirm: vi.fn(() => true), onConfirm: vi.fn(), onDiscard: vi.fn() };
    render(
      <DaySheet
        dateISO={day} todayISO={TODAY} entries={shown} moneyEntries={shown}
        onClose={vi.fn()} onEntryClick={vi.fn()} onAdd={vi.fn()}
        ledger={{ summary: daySummary([paid, once, rec], day), categories: [], onToggleHighlight: vi.fn(), planActions: actions ? planActions : undefined }}
      />,
    );
    return planActions;
  }

  it('거래 목록에는 실제 거래만, 예정은 "미확정 예정 N건" 아래로', () => {
    open();
    const rows = within(screen.getByRole('list', { name: '이 날의 거래' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('점심')]);
    const pend = screen.getByRole('list', { name: '이 날의 미확정 예정' });
    expect(pend.closest('details')!.open).toBe(false);
    expect(pend.closest('details')!.querySelector('summary')!.textContent).toContain('미확정 예정 2건');
    expect(within(pend).getAllByRole('listitem')).toHaveLength(2);
    // 합계는 실제 거래만.
    expect(screen.getByLabelText('이 날의 실제 현금흐름').textContent).toContain('−12,000');
  });

  it('한 번짜리는 확정 · 정리, 반복 회차는 확정만 — 이 회차만 지울 수 없다고 적는다', () => {
    const a = open();
    const oneOff = screen.getByRole('group', { name: '병원 예약 처리' });
    fireEvent.click(within(oneOff).getByRole('button', { name: '실제 거래로 확정' }));
    expect(a.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: once.id }), day);
    fireEvent.click(within(oneOff).getByRole('button', { name: '정리' }));
    expect(a.onDiscard).toHaveBeenCalledWith(expect.objectContaining({ id: once.id }));

    const recurring = screen.getByRole('group', { name: '헬스장 처리' });
    expect(within(recurring).queryByRole('button', { name: '정리' })).toBeNull();
    expect(screen.getByText('반복 — 이 회차만 지울 수 없습니다')).toBeInTheDocument();
  });

  it('확정할 수 없는 종류(기간 · 예전)에는 확정 단추가 없다', () => {
    const a = open();
    a.canConfirm.mockReturnValue(false);
    cleanup();
    const span = newEntry('money', {
      id: 'liv', title: '생활비', startDate: '2026-10-01', endDate: '2026-10-10',
      money: newMoney({ type: 'living', amountMinor: 300_000 }),
    });
    render(
      <DaySheet
        dateISO={day} todayISO={TODAY} entries={[span]} moneyEntries={[span]}
        onClose={vi.fn()} onEntryClick={vi.fn()} onAdd={vi.fn()}
        ledger={{ summary: daySummary([span], day), categories: [], onToggleHighlight: vi.fn(), planActions: { canConfirm: () => false, onConfirm: vi.fn(), onDiscard: vi.fn() } }}
      />,
    );
    expect(screen.getByText('이 날의 실제 거래는 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('확정할 수 없는 종류')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '실제 거래로 확정' })).toBeNull();
    expect(screen.queryByRole('button', { name: '정리' })).toBeNull();
  });

  it('오늘 · 앞날은 지금처럼 한 목록이다', () => {
    const fut = plan('2026-10-20', 30_000, '카드대금');
    render(
      <DaySheet
        dateISO="2026-10-20" todayISO={TODAY} entries={[fut]} moneyEntries={[fut]}
        onClose={vi.fn()} onEntryClick={vi.fn()} onAdd={vi.fn()}
        ledger={{ summary: daySummary([fut], '2026-10-20'), categories: [], onToggleHighlight: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('list', { name: '이 날의 미확정 예정' })).toBeNull();
    expect(screen.getByRole('list', { name: '이 날의 거래' }).textContent).toContain('카드대금');
  });
});
