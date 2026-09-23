/**
 * 생활비 예산 · 세이브 — 계산 규칙.
 *
 * 지키려는 것 셋.
 *   1. 생활비 잔액 = 총 예산 − 연결된 지출 합. 넘으면 초과로 적는다
 *   2. **같은 돈이 두 번 빠지지 않는다.** 실제 사용액 + 남은 예약 = 총 예산
 *   3. 세이브는 잔고를 건드리지 않고 한도만 깎는다
 *
 * 2번이 이 개편의 이유다. 예전에는 생활비가 기간형 지출이라, 생활비 70만을 적고
 * 그 안에서 1만 2천을 쓰면 71만 2천이 나가는 것으로 세어졌다.
 */
import { describe, expect, it } from 'vitest';
import {
  budgetState, inBudget, newBudget, newReserve, reservedOn, reservedTotal, spendingIn,
} from './budget';
import { localDateOf } from './date';
import { newEntry, newMoney, setRecurrence } from './entry';
import { headlineLimit, limitOn } from './tide';
import type { Account, Budget, Entry, Reserve } from './types';

const TODAY = '2026-09-15';

const account = (p: Partial<Account> = {}): Account => {
  const checkedAt = p.checkedAt ?? '2026-09-15T09:00:00+09:00';
  return {
    id: 'a1', name: '주계좌', balanceMinor: 3_000_000, currency: 'KRW',
    asOf: localDateOf(checkedAt) as Account['asOf'], checkedAt,
    order: 0, createdAt: '', updatedAt: '', ...p,
  };
};

const budget = (p: Partial<Budget> = {}): Budget => newBudget({
  id: 'b1', name: '9월 생활비',
  startDate: '2026-09-01', endDate: '2026-09-30',
  amountMinor: 700_000,
  ...p,
});

const reserve = (p: Partial<Reserve> = {}): Reserve =>
  newReserve({ id: 'r1', name: '비상금', amountMinor: 500_000, ...p });

/** 생활비에서 나간 지출 한 건. */
const spend = (
  id: string, amountMinor: number, startDate: string, budgetId: string | null = 'b1',
): Entry => newEntry('money', {
  id, title: id, startDate,
  money: newMoney({ type: 'expense', amountMinor, budgetId }),
});

const income = (id: string, amountMinor: number, startDate: string): Entry =>
  newEntry('money', {
    id, title: id, startDate,
    money: newMoney({ type: 'income', amountMinor }),
  });

// ---------- 생활비 잔액 ----------

describe('생활비 잔액', () => {
  it('70만으로 만들면 그대로 70만이 남는다', () => {
    const s = budgetState(budget(), []);
    expect(s.spentMinor).toBe(0);
    expect(s.remainingMinor).toBe(700_000);
    expect(s.overspentMinor).toBe(0);
    expect(s.count).toBe(0);
  });

  it('1만 2천을 쓰면 68만 8천이 남는다', () => {
    const s = budgetState(budget(), [spend('점심', 12_000, '2026-09-15')]);
    expect(s.spentMinor).toBe(12_000);
    expect(s.remainingMinor).toBe(688_000);
    expect(s.overspentMinor).toBe(0);
  });

  it('여러 지출을 합산한다', () => {
    const s = budgetState(budget(), [
      spend('점심', 12_000, '2026-09-15'),
      spend('커피', 4_500, '2026-09-16'),
      spend('장보기', 63_000, '2026-09-18'),
    ]);
    expect(s.spentMinor).toBe(79_500);
    expect(s.remainingMinor).toBe(620_500);
    expect(s.count).toBe(3);
  });

  it('연결된 지출의 금액을 고치면 잔액이 따라 바뀐다', () => {
    const before = budgetState(budget(), [spend('점심', 12_000, '2026-09-15')]);
    const after = budgetState(budget(), [spend('점심', 30_000, '2026-09-15')]);
    expect(before.remainingMinor).toBe(688_000);
    expect(after.remainingMinor).toBe(670_000);
  });

  it('연결된 지출을 지우면 그만큼 돌아온다', () => {
    const s = budgetState(budget(), [spend('커피', 4_500, '2026-09-16')]);
    expect(budgetState(budget(), []).remainingMinor).toBe(700_000);
    expect(s.remainingMinor).toBe(695_500);
  });

  it('기간 밖 지출은 이 생활비에서 나가지 않는다', () => {
    const outside = spend('추석', 200_000, '2026-10-02');
    expect(inBudget(outside, budget())).toBe(false);
    expect(budgetState(budget(), [outside]).spentMinor).toBe(0);
  });

  it('반복 항목은 생활비에 들어가지 않는다', () => {
    // 주머니 하나에 몇 번 들어갈지가 애매해진다. 일반 지출로 돌려보낸다.
    const repeating = setRecurrence(
      spend('구독', 9_900, '2026-09-05'),
      { freq: 'monthly', interval: 1, until: null, count: null },
    );
    expect(inBudget(repeating, budget())).toBe(false);
  });

  it('초과하면 남음 0 · 초과 금액을 따로 적는다', () => {
    const s = budgetState(budget(), [spend('과지출', 720_000, '2026-09-20')]);
    expect(s.spentMinor).toBe(720_000);
    expect(s.remainingMinor).toBe(0);
    expect(s.overspentMinor).toBe(20_000);
  });

  it('연결된 지출은 날짜 순으로 돌려준다', () => {
    const list = spendingIn(budget(), [
      spend('c', 1_000, '2026-09-20'),
      spend('a', 1_000, '2026-09-05'),
      spend('b', 1_000, '2026-09-12'),
    ]);
    expect(list.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

// ---------- 생활비를 지워도 지출은 남는다 ----------

describe('생활비를 지웠을 때', () => {
  it('연결돼 있던 지출은 사라지지 않고 일반 지출로 돌아간다', () => {
    const entries = [spend('점심', 12_000, '2026-09-15')];
    const accounts = [account()];

    const withBudget = limitOn(accounts, entries, '2026-09-30', TODAY, { budgets: [budget()] });
    const withoutBudget = limitOn(accounts, entries, '2026-09-30', TODAY, { budgets: [] });

    // 예산이 있을 때: 잔고 300만 − 예산 몫 70만 = 230만 (지출은 예산 안에서 세어진다)
    expect(withBudget).toBe(2_300_000);
    // 예산이 없을 때: 지출이 일반 지출로 돌아와 300만 − 1만 2천 = 298만 8천
    expect(withoutBudget).toBe(2_988_000);
  });
});

// ---------- 가용 한도 ----------

describe('가용 한도와 생활비', () => {
  const accounts = [account()]; // 잔고 300만, 오늘 기준

  it('생활비 70만을 만들면 가용이 70만 줄어든다', () => {
    const bare = limitOn(accounts, [], '2026-09-30', TODAY);
    const withBudget = limitOn(accounts, [], '2026-09-30', TODAY, { budgets: [budget()] });
    expect(bare).toBe(3_000_000);
    expect(withBudget).toBe(2_300_000);
  });

  it('예산 안에서 쓰면 가용은 그대로다', () => {
    // 이 한 줄이 이 개편의 전부다. 예전에는 70만 + 1만 2천이 빠졌다.
    const entries = [spend('점심', 12_000, '2026-09-15')];
    const limit = limitOn(accounts, entries, '2026-09-30', TODAY, { budgets: [budget()] });
    expect(limit).toBe(2_300_000);
  });

  it('여러 번 써도 예산을 넘지 않는 한 가용은 그대로다', () => {
    const entries = [
      spend('점심', 12_000, '2026-09-15'),
      spend('커피', 4_500, '2026-09-16'),
      spend('장보기', 63_000, '2026-09-18'),
    ];
    expect(limitOn(accounts, entries, '2026-09-30', TODAY, { budgets: [budget()] }))
      .toBe(2_300_000);
  });

  it('초과분만 추가로 깎인다', () => {
    const entries = [spend('과지출', 720_000, '2026-09-20')];
    // 300만 − max(70만, 72만) = 228만. 초과 2만만큼만 더 빠졌다.
    expect(limitOn(accounts, entries, '2026-09-30', TODAY, { budgets: [budget()] }))
      .toBe(2_280_000);
  });

  it('실제 사용액 + 남은 예약 = 총 예산', () => {
    // §7 의 불변식을 값으로 못박는다. 어느 시점에 보든 이 합은 총 예산이다.
    const entries = [spend('점심', 12_000, '2026-09-15'), spend('커피', 4_500, '2026-09-16')];
    const b = budget();
    const s = budgetState(b, entries);
    const claim = reservedOn([b], [], entries, '2026-09-30', '2026-09-14');
    expect(s.spentMinor + s.remainingMinor).toBe(b.amountMinor);
    // 한도가 잡아 두는 자리도 총 예산 그대로다 (아직 통장에서 안 빠졌으므로).
    expect(claim).toBe(700_000);
  });

  it('일반 지출은 곧바로 가용을 깎는다', () => {
    const entries = [spend('전기요금', 65_000, '2026-09-20', null)];
    expect(limitOn(accounts, entries, '2026-09-30', TODAY, { budgets: [budget()] }))
      .toBe(2_300_000 - 65_000);
  });

  it('예정 입금은 예전과 똑같이 더해진다', () => {
    const entries = [income('급여', 2_500_000, '2026-09-25')];
    expect(limitOn(accounts, entries, '2026-09-30', TODAY, { budgets: [budget()] }))
      .toBe(2_300_000 + 2_500_000);
  });

  it('시작하지 않은 생활비는 아직 자리를 잡지 않는다', () => {
    const next = budget({ id: 'b2', startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(limitOn(accounts, [], '2026-09-20', TODAY, { budgets: [next] })).toBe(3_000_000);
    expect(limitOn(accounts, [], '2026-10-05', TODAY, { budgets: [next] })).toBe(2_300_000);
  });

  it('이미 잔고에 반영된 지출은 예산 몫에서 빠진다', () => {
    /*
      잔고를 1만 2천이 빠진 뒤의 금액으로 다시 적은 상황. 그 지출을 예산 몫에서도
      빼지 않으면 같은 돈이 두 번 빠진다.
    */
    const later = [account({ balanceMinor: 2_988_000, checkedAt: '2026-09-16T09:00:00+09:00' })];
    const entries = [spend('점심', 12_000, '2026-09-15')];
    // 몫 = max(70만, 1만 2천) − 1만 2천 = 68만 8천 → 298만 8천 − 68만 8천 = 230만
    expect(limitOn(later, entries, '2026-09-30', '2026-09-16', { budgets: [budget()] }))
      .toBe(2_300_000);
  });

  it('머리 숫자도 같은 예약을 본다', () => {
    const entries = [income('급여', 2_500_000, '2026-09-25')];
    const head = headlineLimit(accounts, entries, TODAY, { budgets: [budget()] });
    // 끝점은 다음 입금 전날(9/24). 그때까지 입금은 아직이다.
    expect(head).toBe(2_300_000);
  });
});

// ---------- 세이브 ----------

describe('세이브', () => {
  const accounts = [account()];

  it('잔고는 그대로 두고 가용만 깎는다', () => {
    const balance = accounts.reduce((t, a) => t + a.balanceMinor, 0);
    const limit = limitOn(accounts, [], '2026-09-30', TODAY, { reserves: [reserve()] });
    expect(balance).toBe(3_000_000);
    expect(limit).toBe(2_500_000);
  });

  it('세이브를 없애면 가용이 돌아온다', () => {
    expect(limitOn(accounts, [], '2026-09-30', TODAY, { reserves: [] })).toBe(3_000_000);
  });

  it('날짜가 없으므로 언제 보든 같은 금액이 묶여 있다', () => {
    const res = { reserves: [reserve()] };
    expect(limitOn(accounts, [], '2026-09-16', TODAY, res)).toBe(2_500_000);
    expect(limitOn(accounts, [], '2027-03-01', TODAY, res)).toBe(2_500_000);
  });

  it('여러 건이면 합쳐서 빠진다', () => {
    const list = [reserve(), reserve({ id: 'r2', name: '여행', amountMinor: 300_000 })];
    expect(reservedTotal(list)).toBe(800_000);
    expect(limitOn(accounts, [], '2026-09-30', TODAY, { reserves: list })).toBe(2_200_000);
  });

  it('생활비와 함께 있으면 둘 다 빠진다', () => {
    expect(limitOn(accounts, [], '2026-09-30', TODAY, {
      budgets: [budget()], reserves: [reserve()],
    })).toBe(1_800_000);
  });
});

// ---------- 옛 데이터 ----------

describe('옛 데이터', () => {
  const accounts = [account()];

  it('income · expense 는 예전과 똑같이 계산된다', () => {
    const entries = [income('급여', 1_000_000, '2026-09-20'), spend('요금', 50_000, '2026-09-18', null)];
    expect(limitOn(accounts, entries, '2026-09-30', TODAY)).toBe(3_000_000 + 1_000_000 - 50_000);
  });

  it('legacy living 은 예전 그대로 기간형 지출로 센다', () => {
    // 자동으로 예산으로 바꾸지 않는다 — 실제 예산인지 단순 기간 지출인지 가릴 수 없다.
    const legacy = newEntry('money', {
      id: 'old', title: '생활비', startDate: '2026-09-01', endDate: '2026-09-30',
      money: newMoney({ type: 'living', amountMinor: 600_000 }),
    });
    const limit = limitOn(accounts, [legacy], '2026-09-30', TODAY);
    expect(Number.isFinite(limit)).toBe(true);
    expect(limit).toBeLessThan(3_000_000);
  });

  it('legacy save · free 는 잔고에 영향이 없다', () => {
    const saved = newEntry('money', {
      id: 'old-save', title: '세이브', startDate: '2026-09-20',
      money: newMoney({ type: 'save', amountMinor: 200_000 }),
    });
    const free = newEntry('money', {
      id: 'old-free', title: '가용', startDate: '2026-09-20', endDate: '2026-09-30',
      money: newMoney({ type: 'free', amountMinor: 200_000 }),
    });
    expect(limitOn(accounts, [saved, free], '2026-09-30', TODAY)).toBe(3_000_000);
  });

  it('legacy repay · priority 도 그대로 나간다', () => {
    const repay = newEntry('money', {
      id: 'old-repay', title: '학자금', startDate: '2026-09-20',
      money: newMoney({ type: 'repay', amountMinor: 200_000 }),
    });
    const priority = newEntry('money', {
      id: 'old-pri', title: '카드', startDate: '2026-09-21',
      money: newMoney({ type: 'priority', amountMinor: 100_000 }),
    });
    expect(limitOn(accounts, [repay, priority], '2026-09-30', TODAY)).toBe(2_700_000);
  });

  it('새 구조가 섞여 있어도 옛 항목은 건드려지지 않는다', () => {
    const legacySave = newEntry('money', {
      id: 'old-save', title: '세이브', startDate: '2026-09-20',
      money: newMoney({ type: 'save', amountMinor: 200_000 }),
    });
    const entries = [legacySave, spend('점심', 12_000, '2026-09-15')];
    expect(limitOn(accounts, entries, '2026-09-30', TODAY, { budgets: [budget()] }))
      .toBe(2_300_000);
  });
});
