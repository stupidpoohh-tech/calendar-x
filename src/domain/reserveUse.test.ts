/**
 * Financial Core P3 — 세이브와 실제 지출의 연결.
 *
 * 세이브는 가상 봉투다. 지출은 원장에 한 번만 적히고, 세이브는 그 지출을 가리킬 뿐이다. 세이브의 원본 금액
 * (`amountMinor`)은 깎지 않고, 사용액 = 연결된 **실제** 일반 지출의 합, 남은 금액 = 확보액 − 사용액으로 센다.
 *
 * 불변식: 같은 지출을 세이브에 걸어도 확인 잔고 · 예상 잔고는 걸지 않았을 때와 같다. 바뀌는 것은 세이브의
 * 보호 금액(남은 금액)과 그만큼의 가용 한도뿐이다.
 */
import { describe, expect, it } from 'vitest';
import { entryFromDoc, entryToDoc } from '../data/converters';
import {
  countsAsReserveUse, newReserve, protectedReserveTotal, reserveLinkable, reserveLinkedEntries,
  reserveRemaining, reserveUsageOf, unlinkedSpendingFor, defaultPocketFor, newBudget,
} from './budget';
import { confirmOccurrence } from './confirm';
import { newEntry, newMoney, setRecurrence } from './entry';
import { totalsOf, actualsIn } from './ledgerStats';
import { confirmedBalance, limitOn, projectedBalanceOn } from './tide';
import type { Account, Entry, MoneyFields, Reserve } from './types';

const TODAY = '2026-10-16';
const LATER = '2026-10-20';
const TRAVEL = 'travel';
const BEAUTY = 'beauty';

const acct = (balanceMinor: number, p: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW', asOf: TODAY,
  checkedAt: `${TODAY}T09:00:00+09:00`, reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '', ...p,
});
const save = (id: string, amountMinor: number, p: Partial<Reserve> = {}) => newReserve({ id, name: id, amountMinor, ...p });
const spend = (id: string, amountMinor: number, m: Partial<MoneyFields> = {}, date = TODAY): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor, ...m }),
});
const plan = (id: string, amountMinor: number, date: string, m: Partial<MoneyFields> = {}): Entry => newEntry('money', {
  id, title: id, startDate: date, money: newMoney({ type: 'expense', amountMinor, ...m }),
});
/** 저장을 거친 모양 — 정규화(어긋난 연결 걷기)까지 본다. */
const stored = (e: Entry): Entry => entryFromDoc(e.id, entryToDoc(e));

function numbers(accounts: Account[], entries: Entry[], reserves: Reserve[]) {
  const usage = reserveUsageOf(entries);
  return {
    confirmed: confirmedBalance(accounts),
    projected: projectedBalanceOn(accounts, entries, LATER, TODAY),
    available: limitOn(accounts, entries, LATER, TODAY, { reserves, reserveUsage: usage }),
    usage,
  };
}

describe('A~E — 연결 · 해제 · 금액 수정 · 삭제 · 세이브 바꾸기', () => {
  const travel = save(TRAVEL, 300_000);
  const beauty = save(BEAUTY, 100_000);
  const lodging = spend('lodging', 200_000, { reserveId: TRAVEL });

  it('A — 300,000 세이브에 200,000 실제 지출을 걸면 사용 200,000 · 남음 100,000, 지출은 한 번만 적힌다', () => {
    const usage = reserveUsageOf([lodging]);
    expect(usage.get(TRAVEL)).toBe(200_000);
    expect(reserveRemaining(travel, usage)).toBe(100_000);
    expect(travel.amountMinor).toBe(300_000);
    // 소비 통계에도 한 번만.
    expect(totalsOf(actualsIn([lodging], TODAY, TODAY)).consumption).toBe(200_000);
    expect(reserveLinkedEntries(TRAVEL, [lodging, lodging]).map((e) => e.id)).toEqual(['lodging']);
  });

  it('B — 연결을 풀면 지출은 그대로 남고 세이브는 300,000 으로 돌아온다', () => {
    const unlinked = { ...lodging, money: { ...lodging.money!, reserveId: null } };
    expect(reserveRemaining(travel, reserveUsageOf([unlinked]))).toBe(300_000);
    expect(unlinked.money.amountMinor).toBe(200_000);
  });

  it('C — 금액을 200,000 → 150,000 으로 고치면 사용 150,000 · 남음 150,000', () => {
    const edited = { ...lodging, money: { ...lodging.money!, amountMinor: 150_000 } };
    expect(reserveRemaining(travel, reserveUsageOf([edited]))).toBe(150_000);
  });

  it('D — 지출을 지우면 사용액에서 빠진다', () => {
    expect(reserveRemaining(travel, reserveUsageOf([]))).toBe(300_000);
  });

  it('E — 여행 → 미용으로 옮기면 여행은 300,000 그대로, 미용은 −100,000 (지출 금액은 그대로)', () => {
    const moved = { ...lodging, money: { ...lodging.money!, reserveId: BEAUTY } };
    const usage = reserveUsageOf([moved]);
    expect(reserveRemaining(travel, usage)).toBe(300_000);
    expect(reserveRemaining(beauty, usage)).toBe(-100_000);
    expect(moved.money.amountMinor).toBe(200_000);
  });
});

describe('F — 예정과 실제', () => {
  const travel = save(TRAVEL, 300_000);

  it('예정에 걸어 둔 연결은 사용액이 아니다', () => {
    const p = plan('hotel', 200_000, LATER, { reserveId: TRAVEL });
    expect(countsAsReserveUse(p)).toBe(false);
    expect(reserveRemaining(travel, reserveUsageOf([p]))).toBe(300_000);
  });

  it('확정하면 실제 거래가 연결을 이어받아 한 번만 센다 — 확정을 지우면 돌아온다', () => {
    const p = plan('hotel', 200_000, TODAY, { reserveId: TRAVEL });
    const r = confirmOccurrence(p, TODAY);
    if (!r.ok) throw new Error(r.reason);
    expect(r.entry.money?.reserveId).toBe(TRAVEL);
    expect(reserveUsageOf([p, r.entry]).get(TRAVEL)).toBe(200_000);
    expect(reserveUsageOf([p]).get(TRAVEL)).toBeUndefined();
  });

  it('확정하면서 다른 세이브 · 생활비로 바꿀 수 있다 — 사용처는 하나다', () => {
    const p = plan('hotel', 200_000, TODAY, { reserveId: TRAVEL });
    const toBeauty = confirmOccurrence(p, TODAY, { reserveId: BEAUTY });
    expect(toBeauty.ok && toBeauty.entry.money?.reserveId).toBe(BEAUTY);
    const toPocket = confirmOccurrence(p, TODAY, { budgetId: 'b1' });
    expect(toPocket.ok && toPocket.entry.money).toMatchObject({ reserveId: null, budgetId: 'b1' });
  });
});

describe('G — 확인 잔고 경계: 이중 차감 없음', () => {
  const travel = save(TRAVEL, 300_000);

  it('잔고 반영 전 — 예상 잔고는 걸지 않았을 때와 같고, 가용은 그대로 700,000', () => {
    const linked = numbers([acct(1_000_000)], [spend('lodging', 200_000, { reserveId: TRAVEL })], [travel]);
    const plain = numbers([acct(1_000_000)], [spend('lodging', 200_000)], [travel]);
    expect(linked.confirmed).toBe(plain.confirmed);
    expect(linked.projected).toBe(plain.projected);
    expect(linked.projected).toBe(800_000);
    // 1,000,000 − 지출 200,000 − 남은 세이브 100,000. 세이브에서 쓴 돈이라 자유 자금은 그대로다.
    expect(linked.available).toBe(700_000);
    // 걸지 않으면 세이브 300,000 이 그대로 묶인 채 지출이 따로 빠진다.
    expect(plain.available).toBe(500_000);
  });

  it('잔고 반영 후 — 잔고를 800,000 으로 다시 적어도 가용은 700,000, 두 번 빠지지 않는다', () => {
    const e = spend('lodging', 200_000, { reserveId: TRAVEL });
    const after = numbers([acct(800_000, { reflectedEntryIds: ['lodging'] })], [e], [travel]);
    expect(after.projected).toBe(800_000);
    expect(after.available).toBe(700_000);
    // 다음 날로 넘어가 기준일 앞의 거래가 된 경우도 같다.
    const nextDay = numbers([acct(800_000, { asOf: '2026-10-17', checkedAt: '2026-10-17T09:00:00+09:00' })], [e], [travel]);
    expect(nextDay.available).toBe(700_000);
  });

  it('세이브를 만들기 전과 비교 — 세이브에서 쓴 지출은 자유 자금을 줄이지 않는다', () => {
    const before = numbers([acct(1_000_000)], [], [travel]);
    expect(before.available).toBe(700_000);
  });
});

describe('H — 보호 설정', () => {
  const e = spend('lodging', 200_000, { reserveId: TRAVEL });

  it('보호를 꺼도 사용액 · 남은 금액은 그대로고, 가용 차이는 남은 금액 100,000 이다', () => {
    const on = numbers([acct(1_000_000)], [e], [save(TRAVEL, 300_000)]);
    const off = numbers([acct(1_000_000)], [e], [save(TRAVEL, 300_000, { protected: false })]);
    expect(off.usage.get(TRAVEL)).toBe(200_000);
    expect(off.available - on.available).toBe(100_000);
    expect(off.projected).toBe(on.projected);
  });

  it('보관한 세이브도 사용액은 세지만 보호하지 않는다', () => {
    const archived = save(TRAVEL, 300_000, { archivedAt: 'x' });
    const usage = reserveUsageOf([e]);
    expect(reserveRemaining(archived, usage)).toBe(100_000);
    expect(protectedReserveTotal([archived], usage)).toBe(0);
  });
});

describe('I — 초과 사용', () => {
  it('확보 100,000 · 사용 150,000 → 남음 −50,000, 보호 0 — 초과분이 다른 돈을 늘리지 않는다', () => {
    const travel = save(TRAVEL, 100_000);
    const e = spend('lodging', 150_000, { reserveId: TRAVEL });
    const usage = reserveUsageOf([e]);
    expect(reserveRemaining(travel, usage)).toBe(-50_000);
    expect(protectedReserveTotal([travel], usage)).toBe(0);
    const linked = numbers([acct(1_000_000)], [e], [travel]);
    // 1,000,000 − 150,000 − 0. 세이브 100,000 을 다 쓰고 50,000 을 더 쓴 것이라 자유 자금이 50,000 준다.
    expect(linked.available).toBe(850_000);
    expect(numbers([acct(1_000_000)], [], [travel]).available).toBe(900_000);
  });
});

describe('연결할 수 있는 거래 · 세는 거래', () => {
  it('일반 지출만 — 수입 · 대출 · 이체 · 카드 대금 · 카드 사용 · 반복 · 대출 연결은 아니다', () => {
    expect(reserveLinkable(spend('a', 1))).toBe(true);
    expect(reserveLinkable(plan('p', 1, LATER))).toBe(true);
    for (const m of [
      { type: 'income' as const }, { flow: 'loanPrincipal' as const }, { flow: 'transfer' as const },
      { flow: 'cardPayment' as const }, { flow: 'cardSpend' as const }, { debtId: 'd1' },
    ]) expect(reserveLinkable(spend('x', 1, m))).toBe(false);
    expect(reserveLinkable(setRecurrence(plan('r', 1, LATER), { freq: 'monthly', interval: 1, until: null, count: null }))).toBe(false);
  });

  it('저장할 때 어긋난 연결을 걷는다 — 생활비 · 대출 · 수입 · 카드 사용 · 반복', () => {
    expect(stored(spend('a', 1, { reserveId: TRAVEL })).money?.reserveId).toBe(TRAVEL);
    expect(stored(spend('b', 1, { reserveId: TRAVEL, budgetId: 'b1' })).money?.reserveId).toBeNull();
    expect(stored(spend('c', 1, { reserveId: TRAVEL, debtId: 'd1' })).money?.reserveId).toBeNull();
    expect(stored(spend('d', 1, { reserveId: TRAVEL, type: 'income' })).money?.reserveId).toBeNull();
    expect(stored(spend('e', 1, { reserveId: TRAVEL, flow: 'cardSpend' })).money?.reserveId).toBeNull();
    const rec = setRecurrence(plan('f', 1, LATER, { reserveId: TRAVEL }), { freq: 'monthly', interval: 1, until: null, count: null });
    expect(stored(rec).money?.reserveId).toBeNull();
  });

  it('예전 거래(필드 없음)는 연결 없음 — 사용액 0, 숫자는 P3 이전과 같다', () => {
    const old = entryFromDoc('old', { ...entryToDoc(spend('old', 50_000)), money: { type: 'expense', amountMinor: 50_000, currency: 'KRW', status: 'actual' } });
    expect(old.money?.reserveId).toBeNull();
    const r = save(TRAVEL, 300_000);
    expect(numbers([acct(1_000_000)], [old], [r]).available).toBe(1_000_000 - 50_000 - 300_000);
  });
});

describe('생활비 주머니와의 관계', () => {
  const pocket = newBudget({ id: 'b1', startDate: '2026-10-01', endDate: '2026-10-31', amountMinor: 300_000 });

  it('세이브에 건 지출은 "사용처 미결정" 경고에 뜨지 않고, 주머니 자동 선택이 덮지 않는다', () => {
    const e = spend('lodging', 200_000, { reserveId: TRAVEL });
    expect(unlinkedSpendingFor(pocket, [e])).toEqual([]);
    expect(defaultPocketFor(e, [pocket])).toBeNull();
    expect(unlinkedSpendingFor(pocket, [spend('lunch', 10_000)]).map((x) => x.id)).toEqual(['lunch']);
  });
});
