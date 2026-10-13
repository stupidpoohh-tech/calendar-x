import { describe, expect, it } from 'vitest';
import { confirmOccurrence } from './confirm';
import { daySummary, MAJOR_THRESHOLD, pickMajor } from './daySummary';
import { newEntry, newMoney } from './entry';
import type { Entry, MoneyFields } from './types';

const D = '2026-08-05';
let seq = 0;
const tx = (amount: number, m: Partial<MoneyFields> = {}, over: Partial<Entry> = {}) => {
  seq += 1;
  return newEntry('money', {
    id: `t${seq}`, title: over.title ?? `거래${seq}`, startDate: D,
    money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }), ...over,
  });
};
const plan = (amount: number, over: Partial<Entry> = {}, m: Partial<MoneyFields> = {}) => newEntry('money', {
  id: `p${++seq}`, title: '예정', startDate: D, money: newMoney({ type: 'expense', amountMinor: amount, ...m }), ...over,
});

describe('하루 요약 — 표시', () => {
  it('거래가 없는 날은 모두 0, 주요 거래 없음', () => {
    expect(daySummary([], D)).toMatchObject({ income: 0, outflow: 0, major: null, rest: 0, unconfirmed: 0, actuals: [] });
  });

  it('소액 1건 — 주요 거래 없이 거래 1건', () => {
    const s = daySummary([tx(3_000)], D);
    expect(s).toMatchObject({ outflow: 3_000, major: null, rest: 1 });
  });

  it('소액 20건 이상 — 합계만 크고, 건수로 압축된다', () => {
    const list = Array.from({ length: 25 }, () => tx(3_000));
    const s = daySummary(list, D);
    expect(s).toMatchObject({ outflow: 75_000, major: null, rest: 25 });
  });

  it('수입만 · 지출만 · 둘 다', () => {
    expect(daySummary([tx(520_000, { type: 'income' })], D)).toMatchObject({ income: 520_000, outflow: 0 });
    expect(daySummary([tx(276_000)], D)).toMatchObject({ income: 0, outflow: 276_000 });
    const both = daySummary([tx(520_000, { type: 'income' }), tx(180_000, {}, { title: '병원' }), tx(96_000)], D);
    expect(both).toMatchObject({ income: 520_000, outflow: 276_000, rest: 2 });
    expect(both.major).toMatchObject({ label: '병원', amount: 180_000, why: 'consumption' });
  });

  it('10만 원 이상 여러 건 — 큰 것 하나만, 나머지는 건수', () => {
    const s = daySummary([tx(120_000), tx(320_000, {}, { title: '여행' }), tx(150_000)], D);
    expect(s.major).toMatchObject({ label: '여행', amount: 320_000 });
    expect(s.rest).toBe(2);
  });

  it('직접 고른 거래가 기준 미만이어도 자동 선정보다 앞선다', () => {
    const s = daySummary([tx(320_000, {}, { title: '여행' }), tx(5_000, { highlight: true }, { title: '꽃' })], D);
    expect(s.major).toMatchObject({ label: '꽃', amount: 5_000, why: 'pinned' });
    expect(s.rest).toBe(1);
  });

  it('직접 고른 것이 둘이면 큰 것 하나만', () => {
    const s = daySummary([tx(5_000, { highlight: true }), tx(9_000, { highlight: true }, { title: '큰 것' })], D);
    expect(s.major?.label).toBe('큰 것');
  });

  it('주요 소비가 없으면 금융 거래를 성격 이름으로 — 소비와 헷갈리지 않게', () => {
    expect(pickMajor([tx(450_000, { flow: 'loanPrincipal' }, { title: '대출' })])).toMatchObject({ label: '대출상환', why: 'finance' });
    expect(pickMajor([tx(300_000, { flow: 'cardPayment' })])).toMatchObject({ label: '카드대금' });
    expect(pickMajor([tx(120_000, { flow: 'loanInterest' })])).toMatchObject({ label: '대출이자' });
    // 소비가 있으면 소비가 앞선다.
    expect(pickMajor([tx(450_000, { flow: 'loanPrincipal' }), tx(100_000, {}, { title: '병원' })])?.label).toBe('병원');
  });

  it('이체 · 수입은 자동 주요 거래가 아니다', () => {
    expect(pickMajor([tx(1_000_000, { flow: 'transfer' }), tx(3_000_000, { type: 'income' })])).toBeNull();
  });

  it('기준은 10만 원 이상', () => {
    expect(MAJOR_THRESHOLD).toBe(100_000);
    expect(pickMajor([tx(99_999)])).toBeNull();
    expect(pickMajor([tx(100_000)])).not.toBeNull();
  });

  it('지난 날에 남은 미확정 예정은 실제 건수 · 합계에 들지 않고 따로 센다', () => {
    const s = daySummary([tx(10_000), plan(50_000)], D);
    expect(s).toMatchObject({ outflow: 10_000, rest: 1, unconfirmed: 1 });
  });
});

describe('하루 요약 — 계산', () => {
  it('카드 사용은 주요 소비로 뜰 수 있지만 그날 현금 지출에 더하지 않는다', () => {
    const s = daySummary([tx(200_000, { flow: 'cardSpend' }, { title: '가전' })], D);
    expect(s.outflow).toBe(0);
    expect(s.major).toMatchObject({ label: '가전', tag: '카드', sign: 0 });
    expect(s.rest).toBe(0);
  });

  it('카드 대금 납부일에는 현금이 나간다', () => {
    expect(daySummary([tx(300_000, { flow: 'cardPayment' })], D).outflow).toBe(300_000);
  });

  it('대출 원금은 현금 지출이다(소비 통계와 다르다) · 이체도 현금이 나간다', () => {
    expect(daySummary([tx(450_000, { flow: 'loanPrincipal' }), tx(100_000, { flow: 'transfer' })], D).outflow).toBe(550_000);
  });

  it('현금이 움직이지 않는 거래도 건수에서 빠지지 않는다', () => {
    const s = daySummary([tx(30_000, { type: 'free' })], D);
    expect(s).toMatchObject({ income: 0, outflow: 0, rest: 1 });
  });

  it('반복 예정을 확정하면 그 회차는 미확정으로 세지 않는다 — 다른 날 확정해도', () => {
    const rent = newEntry('money', {
      id: 'rent', title: '월세', startDate: '2026-07-05',
      recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
      money: newMoney({ type: 'expense', amountMinor: 500_000 }),
    });
    expect(daySummary([rent], D).unconfirmed).toBe(1);
    // 8/5 회차를 8/7 에 냈다. 8/5 의 예정은 사라지고, 실제 거래는 8/7 에 선다.
    const r = confirmOccurrence(rent, D, { date: '2026-08-07', amountMinor: 510_000 });
    if (!r.ok) throw new Error(r.reason);
    const paid = r.entry;
    expect(daySummary([rent, paid], D)).toMatchObject({ unconfirmed: 0, rest: 0, outflow: 0 });
    expect(daySummary([rent, paid], '2026-08-07')).toMatchObject({ outflow: 510_000, unconfirmed: 0 });
  });

  it('여러 계좌의 거래도 하루 합에 모두 든다', () => {
    const s = daySummary([tx(10_000, { accountId: 'a' }), tx(20_000, { accountId: 'b' })], D);
    expect(s.outflow).toBe(30_000);
  });

  it('다른 날 거래는 들지 않는다', () => {
    expect(daySummary([tx(10_000, {}, { startDate: '2026-08-04' })], D).rest).toBe(0);
  });

  it('50건 이상도 합 · 건수가 맞는다', () => {
    const list = Array.from({ length: 60 }, (_, i) => tx(1_000 + i));
    const s = daySummary(list, D);
    expect(s.rest).toBe(60);
    expect(s.outflow).toBe(60 * 1_000 + (59 * 60) / 2);
  });
});
