/**
 * 원장 규칙 — 예정과 실제 거래, 현금 부호, 회차 확정, 잔고 반영 판정.
 */
import { describe, expect, it } from 'vitest';
import { newEntry, newMoney } from './entry';
import {
  ambiguousActuals, balanceInclusion, cashSignOf, confirmedEntryId, confirmedKey,
  confirmedSetOf, isActual, isPlanned, ledgerClassOf, moneyFlowOf, moneyStatusOf,
} from './ledger';
import { baseIdOf } from './recurrence';
import type { Account, Entry, MoneyFields } from './types';

const money = (m: Partial<MoneyFields>, over: Partial<Entry> = {}): Entry =>
  newEntry('money', { id: 'm1', startDate: '2026-09-10', money: newMoney({ amountMinor: 10_000, ...m }), ...over });

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-09-10', checkedAt: '2026-09-10T09:00:00.000Z', reflectedEntryIds: [],
  order: 0, createdAt: '', updatedAt: '', ...over,
});

describe('접근자 — 필드가 없던 시절의 자료', () => {
  it('상태 · 흐름이 없으면 예정 · 일반이다', () => {
    const legacy = { type: 'expense', amountMinor: 1, currency: 'KRW', linkedEntryId: null } as MoneyFields;
    expect(moneyStatusOf(legacy)).toBe('planned');
    expect(moneyFlowOf(legacy)).toBe('normal');
    expect(moneyStatusOf(null)).toBe('planned');
  });

  it('모르는 흐름은 일반으로 읽는다', () => {
    expect(moneyFlowOf({ flow: 'refund' as never })).toBe('normal');
  });

  it('가계부가 아니면 예정도 실제도 아니다', () => {
    const task = newEntry('task');
    expect(isActual(task)).toBe(false);
    expect(isPlanned(task)).toBe(false);
    expect(isPlanned(money({}))).toBe(true);
    expect(isActual(money({ status: 'actual' }))).toBe(true);
  });
});

describe('현금 부호', () => {
  it('종류의 부호를 따른다 — legacy 도 지금까지와 같다', () => {
    expect(cashSignOf(money({ type: 'income' }))).toBe(1);
    expect(cashSignOf(money({ type: 'expense' }))).toBe(-1);
    expect(cashSignOf(money({ type: 'repay' }))).toBe(-1);
    expect(cashSignOf(money({ type: 'save' }))).toBe(0);
  });

  it('카드 사용은 현금을 움직이지 않는다 — 대금에서 한 번만 나간다', () => {
    expect(cashSignOf(money({ flow: 'cardSpend' }))).toBe(0);
    expect(cashSignOf(money({ flow: 'cardPayment' }))).toBe(-1);
  });

  it('대출 원금 · 이자는 둘 다 현금이 나간다', () => {
    expect(cashSignOf(money({ flow: 'loanPrincipal' }))).toBe(-1);
    expect(cashSignOf(money({ flow: 'loanInterest' }))).toBe(-1);
  });
});

describe('통계 분류', () => {
  it('흐름이 먼저 정한다', () => {
    expect(ledgerClassOf(money({ flow: 'cardSpend' }))).toBe('consumption');
    expect(ledgerClassOf(money({ flow: 'cardPayment' }))).toBe('cardPayment');
    expect(ledgerClassOf(money({ flow: 'loanPrincipal' }))).toBe('principal');
    expect(ledgerClassOf(money({ flow: 'loanInterest' }))).toBe('financeCost');
    expect(ledgerClassOf(money({ flow: 'transfer' }))).toBe('transfer');
  });

  it('legacy 상환 · 우선 · 생활비는 추정하지 않는다', () => {
    for (const type of ['repay', 'priority', 'living'] as const) {
      expect(ledgerClassOf(money({ type }))).toBe('unclassified');
    }
    expect(ledgerClassOf(money({ type: 'save' }))).toBe('none');
    expect(ledgerClassOf(newEntry('idea'))).toBeNull();
  });
});

describe('회차 확정', () => {
  it('같은 회차는 언제나 같은 id 다', () => {
    expect(confirmedEntryId('rent', '2026-09-25')).toBe('rent~2026-09-25');
    expect(confirmedEntryId('rent', '2026-09-25')).toBe(confirmedEntryId('rent', '2026-09-25'));
  });

  it('확정 id 는 반복 전개분으로 읽히지 않는다 — 편집이 예정 시리즈로 가지 않는다', () => {
    const id = confirmedEntryId('rent', '2026-09-25');
    expect(baseIdOf(id)).toBe(id);
  });

  it('실제 거래의 회차 연결만 모은다', () => {
    const set = confirmedSetOf([
      money({ status: 'actual', plannedRef: { entryId: 'rent', date: '2026-09-25' } }, { id: 'x1' }),
      // 예정에 남은 연결은 뜻이 없다.
      money({ plannedRef: { entryId: 'rent', date: '2026-10-25' } }, { id: 'x2' }),
      money({ status: 'actual', plannedRef: { entryId: '', date: '2026-11-25' } }, { id: 'x3' }),
    ]);
    expect([...set]).toEqual([confirmedKey('rent', '2026-09-25')]);
  });
});

describe('잔고 반영 판정', () => {
  const tx = (date: string, over: Partial<MoneyFields> = {}, id = 't1') =>
    money({ status: 'actual', ...over }, { id, startDate: date });

  it('계좌가 없으면 아무것도 반영되지 않았다', () => {
    expect(balanceInclusion(tx('2026-09-01'), [])).toBe('out');
  });

  it('기준일 앞은 들어 있고, 뒤는 아니다', () => {
    expect(balanceInclusion(tx('2026-09-09'), [account()])).toBe('in');
    expect(balanceInclusion(tx('2026-09-11'), [account()])).toBe('out');
  });

  it('같은 날은 고른 것만 들어 있다 — 날짜로도 생성 시각으로도 가르지 않는다', () => {
    expect(balanceInclusion(tx('2026-09-10'), [account()])).toBe('out');
    expect(balanceInclusion(tx('2026-09-10'), [account({ reflectedEntryIds: ['t1'] })])).toBe('in');
  });

  describe('계좌가 여럿일 때', () => {
    const a = account({ id: 'a', asOf: '2026-09-01' });
    const b = account({ id: 'b', asOf: '2026-09-10' });

    it('계좌를 모르고 기준일이 갈리면 판정하지 않는다', () => {
      expect(balanceInclusion(tx('2026-09-05'), [a, b])).toBe('ambiguous');
      expect(ambiguousActuals([a, b], [tx('2026-09-05')]).map((e) => e.id)).toEqual(['t1']);
    });

    it('모든 계좌에서 결과가 같으면 계좌를 몰라도 된다', () => {
      expect(balanceInclusion(tx('2026-08-20'), [a, b])).toBe('in');
      expect(balanceInclusion(tx('2026-09-20'), [a, b])).toBe('out');
    });

    it('계좌가 적혀 있으면 그 계좌로 판정한다', () => {
      expect(balanceInclusion(tx('2026-09-05', { accountId: 'a' }), [a, b])).toBe('out');
      expect(balanceInclusion(tx('2026-09-05', { accountId: 'b' }), [a, b])).toBe('in');
    });

    it('반영 목록에 고른 계좌가 곧 그 거래의 계좌다', () => {
      const b2 = { ...b, reflectedEntryIds: ['t1'] };
      expect(balanceInclusion(tx('2026-09-10'), [a, b2])).toBe('in');
    });

    it('없는 계좌를 가리키면 적혀 있지 않은 것과 같다', () => {
      expect(balanceInclusion(tx('2026-09-05', { accountId: 'gone' }), [a, b])).toBe('ambiguous');
    });

    it('현금이 움직이지 않는 거래는 판정 대상이 아니다', () => {
      expect(ambiguousActuals([a, b], [tx('2026-09-05', { flow: 'cardSpend' })])).toEqual([]);
    });

    it('계좌가 하나면 모호할 일이 없다', () => {
      expect(ambiguousActuals([a], [tx('2026-09-05')])).toEqual([]);
    });
  });
});
