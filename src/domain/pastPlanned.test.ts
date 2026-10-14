/**
 * 지난 미확정 예정 정리 — 누가 후보이고, 누가 확인이 필요하고, 누가 막히고, 누가 아예 빠지는가.
 * 숫자가 바뀌는 항목은 고를 수 없어야 한다.
 */
import { describe, expect, it } from 'vitest';
import { newBudget } from './budget';
import { newEntry, newMoney } from './entry';
import { discardableOnDay, impactOfRemoving, pastPlanTotals, scanPastPlanned } from './pastPlanned';
import type { Account, Entry, MoneyFields } from './types';

const TODAY = '2026-10-13';
// 잔고 기준일 10/10 → 경계는 min(10/10, 어제 10/12) = 10/10.
const acct: Account = {
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW', asOf: '2026-10-10',
  checkedAt: '2026-10-10T09:00:00+09:00', reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '',
};
const plan = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}, over: Partial<Entry> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ type: 'expense', amountMinor: amount, ...m }), ...over });
const actual = (id: string, date: string, amount: number, m: Partial<MoneyFields> = {}): Entry =>
  newEntry('money', { id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }) });

const active = newBudget({ id: 'b1', name: '10월 생활비', startDate: '2026-10-01', endDate: '2026-10-31', amountMinor: 200_000 });
const entries: Entry[] = [
  plan('p1', '2026-09-15', 50_000),
  plan('p2', '2026-10-05', 100_000, { type: 'income' }),
  plan('p3', '2026-10-11', 30_000),                           // 기준일 뒤 → 숫자가 바뀐다
  plan('p4', TODAY, 10_000),                                  // 오늘
  plan('p5', '2026-10-20', 10_000),                           // 앞날
  plan('r1', '2026-01-25', 70_000, {}, { recurrence: { freq: 'monthly', interval: 1, until: null, count: null } }),
  plan('c1', '2026-09-25', 40_000),                           // 확정한 예정
  actual('c1~2026-09-25', '2026-09-26', 41_000, { plannedRef: { entryId: 'c1', date: '2026-09-25' } }),
  plan('s1', '2026-09-01', 300_000, { type: 'living' }, { endDate: '2026-09-30' }),
  plan('l1', '2026-09-10', 20_000, { type: 'save' }),
  plan('pb', '2026-10-05', 30_000, { budgetId: 'b1' }),       // 진행 중 생활비에 걸린 예정
  actual('a2', '2026-09-01', 9_000),
];
const res = { budgets: [active], reserves: [] };
const scan = scanPastPlanned(entries, [acct], TODAY, res);
const group = (g: string) => scan.items.filter((i) => i.group === g).map((i) => i.entry.id);

describe('가르기', () => {
  it('후보 — 한 번짜리 · 지난 · 확정 안 함 · 숫자 그대로', () => {
    expect(group('candidate')).toEqual(['p1', 'p2']);
  });

  it('확인 필요 — 기간 예정 · 예전 종류', () => {
    expect(group('review')).toEqual(['s1', 'l1']);
    expect(scan.items.find((i) => i.entry.id === 's1')!.reason).toBe('기간 예정입니다');
  });

  it('막힘 — 기준일 뒤의 예정, 진행 중 생활비에 걸린 예정', () => {
    expect(group('blocked').sort()).toEqual(['p3', 'pb']);
    expect(scan.items.find((i) => i.entry.id === 'pb')!.reason).toContain('생활비');
  });

  it('제외 — 실제 거래 · 반복 원본 · 오늘 · 앞날 · 확정한 예정은 목록에 없다', () => {
    const ids = scan.items.map((i) => i.entry.id);
    for (const id of ['a2', 'c1~2026-09-25', 'r1', 'p4', 'p5', 'c1']) expect(ids).not.toContain(id);
    expect(scan.excluded).toEqual({ recurring: 1, confirmed: 1, todayOrLater: 2 });
    expect(scan.boundary).toBe('2026-10-10');
  });

  it('비어 있으면 비어 있다', () => {
    expect(scanPastPlanned([actual('x', '2026-09-01', 1)], [acct], TODAY).items).toEqual([]);
  });

  it('끝난 생활비에 걸린 예정도 생활비 숫자(예정 사용)가 바뀌므로 막는다', () => {
    const ended = newBudget({ id: 'b0', startDate: '2026-08-01', endDate: '2026-08-31', amountMinor: 100_000 });
    const s = scanPastPlanned([plan('pe', '2026-08-10', 5_000, { budgetId: 'b0' })], [acct], TODAY, { budgets: [ended] });
    expect(s.items[0]!.group).toBe('blocked');
  });

  it('잔고가 없으면 계산하는 숫자가 없다 — 막힘 없이 후보', () => {
    const s = scanPastPlanned([plan('q', '2026-10-11', 1)], [], TODAY);
    expect(s.items[0]!.group).toBe('candidate');
  });
});

describe('합계 · 영향', () => {
  it('고른 것의 건수 · 수입 · 지출 · 기간', () => {
    const t = pastPlanTotals(scan.items.filter((i) => i.group !== 'blocked'));
    expect(t).toEqual({ count: 4, income: 100_000, incomeCount: 1, outflow: 370_000, outflowCount: 3, from: '2026-09-01', to: '2026-10-05' });
  });

  it('후보를 모두 지워도 한도 · 예상 잔고 · 생활비가 같다', () => {
    const r = impactOfRemoving(entries, [acct], TODAY, res, new Set(group('candidate')));
    expect(r.same).toBe(true);
  });

  it('막힌 것을 넣으면 달라진다 — 지우지 않는다', () => {
    expect(impactOfRemoving(entries, [acct], TODAY, res, new Set(['p3'])).same).toBe(false);
    const withPocket = impactOfRemoving(entries, [acct], TODAY, res, new Set(['pb']));
    expect(withPocket.same).toBe(false);
    expect(withPocket.after.headline - withPocket.before.headline).toBe(-30_000);
  });
});

describe('날짜 상세에서 정리할 수 있는 예정', () => {
  it('한 번짜리만 — 반복 회차 · 기간 · 예전 종류 · 실제 · 생활비에 걸린 것은 아니다', () => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(discardableOnDay(byId.get('p1')!)).toBe(true);
    expect(discardableOnDay(byId.get('r1')!)).toBe(false);
    expect(discardableOnDay({ ...byId.get('r1')!, id: 'r1@2026-09-25', recurrence: null, isRecurring: true })).toBe(false);
    expect(discardableOnDay(byId.get('s1')!)).toBe(false);
    expect(discardableOnDay(byId.get('l1')!)).toBe(false);
    expect(discardableOnDay(byId.get('a2')!)).toBe(false);
    expect(discardableOnDay(byId.get('pb')!)).toBe(false);
  });
});
