/**
 * 거래를 적을 때 "이 잔고에 이미 반영됨" — 판정과 금액.
 */
import { describe, expect, it } from 'vitest';
import { newEntry, newMoney } from './entry';
import { applyReflectChoice, reflectChoiceFor } from './ledger';
import { headlineLimit } from './tide';
import type { Account, MoneyFields } from './types';

const TODAY = '2026-10-13';
const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: TODAY, checkedAt: `${TODAY}T09:00:00.000Z`, reflectedEntryIds: [],
  order: 0, createdAt: '', updatedAt: '', ...over,
});
const tx = (m: Partial<MoneyFields> = {}, date = TODAY, id = 'lunch') =>
  newEntry('money', { id, title: '점심', startDate: date, money: newMoney({ status: 'actual', amountMinor: 12_000, ...m }) });

describe('고를 수 있는가', () => {
  it('계좌 하나 · 잔고를 적은 날의 거래 — 고를 수 있고, 새 거래는 미선택', () => {
    expect(reflectChoiceFor(tx(), [account()])).toMatchObject({ kind: 'ok', checked: false });
  });

  it('이미 목록에 있으면 그 상태를 보여 준다 (보존)', () => {
    expect(reflectChoiceFor(tx(), [account({ reflectedEntryIds: ['lunch'] })])).toMatchObject({ kind: 'ok', checked: true });
  });

  it('고를 일이 없는 경우 — 예정, 카드 사용, 기준일이 아닌 날, 잔고 없음', () => {
    expect(reflectChoiceFor(tx({ status: 'planned' }), [account()]).kind).toBe('none');
    expect(reflectChoiceFor(tx({ flow: 'cardSpend' }), [account()]).kind).toBe('none');
    expect(reflectChoiceFor(tx({}, '2026-10-12'), [account()]).kind).toBe('none');
    expect(reflectChoiceFor(tx(), []).kind).toBe('none');
  });

  it('계좌가 여럿이면 대상 계좌를 정해야 한다', () => {
    const accounts = [account(), account({ id: 'a2', name: '생활비 통장' })];
    expect(reflectChoiceFor(tx(), accounts).kind).toBe('needs-account');
    expect(reflectChoiceFor(tx({ accountId: 'a2' }), accounts)).toMatchObject({ kind: 'ok', account: { id: 'a2' } });
    // 고른 계좌의 기준일이 다른 날이면 고를 일이 없다.
    const other = [account(), account({ id: 'a2', asOf: '2026-10-01' })];
    expect(reflectChoiceFor(tx({ accountId: 'a2' }), other).kind).toBe('none');
  });
});

describe('고른 대로 목록을 고친다', () => {
  it('켜면 넣고, 끄면 뺀다. 같으면 쓸 것이 없다', () => {
    const [on] = applyReflectChoice([account()], 'lunch', 'a1', true);
    expect(on!.reflectedEntryIds).toEqual(['lunch']);
    expect(applyReflectChoice([on!], 'lunch', 'a1', true)).toEqual([]);
    expect(applyReflectChoice([on!], 'lunch', 'a1', false)[0]!.reflectedEntryIds).toEqual([]);
  });

  it('다른 계좌로 옮겨 고르면 앞 계좌에서는 뺀다 — 한 거래가 두 잔고에 들지 않는다', () => {
    const accounts = [account({ reflectedEntryIds: ['lunch', 'x'] }), account({ id: 'a2' })];
    const changed = applyReflectChoice(accounts, 'lunch', 'a2', true);
    expect(changed.map((a) => [a.id, a.reflectedEntryIds])).toEqual([['a1', ['x']], ['a2', ['lunch']]]);
  });
});

describe('한도', () => {
  it('잔고를 적은 뒤에 쓴 돈(미선택)은 한도에서 빠지고, 이미 반영된 돈(선택)은 다시 빠지지 않는다', () => {
    const e = tx();
    expect(headlineLimit([account()], [e], TODAY)).toBe(988_000);
    const [reflected] = applyReflectChoice([account()], e.id, 'a1', true);
    expect(headlineLimit([reflected!], [e], TODAY)).toBe(1_000_000);
  });
});
