/**
 * 예정을 고치면 연결을 잃는 확정 거래 — 이중 계산 재현과 수정.
 *
 * 재현(검토 커밋 1e6912a): 매월 25일 월세 500,000 → 10/25 회차를 510,000 으로 확정 →
 * 반복 시작일을 26일로 수정 → 10/26 예정 500,000 과 실제 510,000 이 함께 세어져
 * 잔고 2,000,000 기준 한도가 1,490,000 에서 990,000 으로 떨어졌다.
 */
import { describe, expect, it } from 'vitest';
import {
  confirmOccurrence, conflictingConfirmations, lostConfirmations, planScheduleChanged,
  reflectedAfterRename, repairLink,
} from './confirm';
import { newEntry, newMoney, withDerived } from './entry';
import { confirmedSetOf } from './ledger';
import { materialize } from './recurrence';
import { headlineLimit } from './tide';
import type { Account } from './types';

const TODAY = '2026-10-25';
const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 2_000_000, currency: 'KRW',
  asOf: '2026-10-24', checkedAt: '2026-10-24T21:00:00.000Z', reflectedEntryIds: [],
  order: 0, createdAt: '', updatedAt: '', ...over,
});
const rent = newEntry('money', {
  id: 'rent', title: '월세', startDate: '2026-01-25',
  recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
  money: newMoney({ type: 'expense', amountMinor: 500_000 }),
});
const confirmed = (() => {
  const r = confirmOccurrence(rent, '2026-10-25', { amountMinor: 510_000 });
  if (!r.ok) throw new Error(r.reason);
  return r.entry;
})();
const moved = withDerived({ ...rent, startDate: '2026-01-26' });
let seq = 0;
const newId = () => `fresh-${++seq}`;

describe('재현', () => {
  it('확정 직후 한도는 1,490,000 이다', () => {
    expect(headlineLimit([account()], [rent, confirmed], TODAY)).toBe(1_490_000);
  });

  it('고치기만 하고 연결을 그대로 두면 10/26 예정과 실제가 함께 세어져 990,000 이 된다', () => {
    expect(headlineLimit([account()], [moved, confirmed], TODAY)).toBe(990_000);
  });
});

describe('연결을 잃는 확정 거래 찾기', () => {
  it('일정이 바뀐 편집만 확인한다 — 금액 · 제목만 고치면 아니다', () => {
    expect(planScheduleChanged(rent, moved)).toBe(true);
    expect(planScheduleChanged(rent, { ...rent, title: '집세', money: { ...rent.money!, amountMinor: 520_000 } })).toBe(false);
    expect(planScheduleChanged(confirmed, { ...confirmed, startDate: '2026-10-27' })).toBe(false); // 실제 거래는 예정이 아니다
  });

  it('10/25 확정은 새 규칙에 없다 — 이을 후보는 10/26', () => {
    const lost = lostConfirmations(moved, [confirmed]);
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ from: '2026-10-25', candidate: '2026-10-26' });
  });

  it('새 규칙에도 있는 회차의 확정은 건드리지 않는다', () => {
    const until = withDerived({ ...rent, recurrence: { ...rent.recurrence!, until: '2026-12-31' } });
    expect(lostConfirmations(until, [confirmed])).toEqual([]);
  });

  it('이미 다른 거래가 확정한 회차는 후보가 되지 않는다 — 두 거래가 한 회차를 가리키지 않는다', () => {
    const oct26 = confirmOccurrence(moved, '2026-10-26');
    if (!oct26.ok) throw new Error();
    const lost = lostConfirmations(moved, [confirmed, oct26.entry]);
    expect(lost).toHaveLength(1);
    // 10/26 은 이미 다른 거래 몫이고, 다음 회차(11/26)는 반 칸 밖이라 제안하지 않는다.
    expect(lost[0]!.candidate).toBeNull();
  });

  it('앞뒤 어느 회차인지 애매하면 후보를 지어내지 않는다 — 끊는 것만 고를 수 있다', () => {
    // 25일 → 10일: 10/10 은 15일 앞, 11/10 은 16일 뒤. 어느 쪽의 월세인지 정할 수 없다.
    expect(lostConfirmations(withDerived({ ...rent, startDate: '2026-01-10' }), [confirmed])[0]!.candidate).toBeNull();
    // 25일 → 11일(14일 앞)은 그 달 회차로 읽힌다.
    expect(lostConfirmations(withDerived({ ...rent, startDate: '2026-01-11' }), [confirmed])[0]!.candidate).toBe('2026-10-11');
  });

  it('반복이 아니던 예정의 날짜를 옮기면 새 날짜가 후보다', () => {
    const once = newEntry('money', { id: 'once', title: '보험', startDate: '2026-10-25', money: newMoney({ amountMinor: 30_000 }) });
    const c = confirmOccurrence(once, '2026-10-25');
    if (!c.ok) throw new Error();
    const lost = lostConfirmations(withDerived({ ...once, startDate: '2026-10-28' }), [c.entry]);
    expect(lost[0]).toMatchObject({ from: '2026-10-25', candidate: '2026-10-28' });
  });

  it('반복을 끝내 회차가 사라지면 이을 곳이 없다', () => {
    const ended = withDerived({ ...rent, recurrence: { ...rent.recurrence!, until: '2026-09-30' } });
    expect(lostConfirmations(ended, [confirmed])[0]!.candidate).toBeNull();
  });
});

describe('고르신 대로 고친다', () => {
  it('다시 이으면 id 가 새 회차로 옮겨 가고 한도가 1,490,000 으로 돌아온다', () => {
    const [lost] = lostConfirmations(moved, [confirmed]);
    const fix = repairLink(lost!, 'relink', rent.id, newId);
    expect(fix.removeId).toBe('rent~2026-10-25');
    expect(fix.entry.id).toBe('rent~2026-10-26');
    expect(fix.entry.money!.plannedRef).toEqual({ entryId: 'rent', date: '2026-10-26' });
    // 실제 날짜 · 금액 · 분류는 그대로다.
    expect(fix.entry.startDate).toBe('2026-10-25');
    expect(fix.entry.money!.amountMinor).toBe(510_000);
    expect(headlineLimit([account()], [moved, fix.entry], TODAY)).toBe(1_490_000);
    // 화면에서도 10/26 예정은 빠진다.
    const shown = materialize([moved, fix.entry], '2026-10-01', '2026-10-31');
    expect(shown.filter((e) => e.startDate === '2026-10-26' && e.id.startsWith('rent@'))).toEqual([]);
    expect(confirmedSetOf([fix.entry]).has('rent|2026-10-26')).toBe(true);
  });

  it('끊으면 회차와 무관한 새 id 로 옮기고, 새 회차는 예정으로 다시 센다 (고른 결과)', () => {
    const [lost] = lostConfirmations(moved, [confirmed]);
    const fix = repairLink(lost!, 'unlink', rent.id, newId);
    expect(fix.entry.id).toMatch(/^fresh-/);
    expect(fix.entry.money!.plannedRef).toBeNull();
    expect(fix.entry.money!.status).toBe('actual');
    expect(headlineLimit([account()], [moved, fix.entry], TODAY)).toBe(990_000);
  });

  it('확정 취소는 옮긴 문서를 지우는 것이다 — 그 회차가 예정으로 돌아온다', () => {
    const [lost] = lostConfirmations(moved, [confirmed]);
    const fix = repairLink(lost!, 'relink', rent.id, newId);
    expect(headlineLimit([account()], [moved], TODAY)).toBe(1_500_000);
    expect(confirmedSetOf([moved]).has('rent|2026-10-26')).toBe(false);
    void fix;
  });

  it('잔고 반영 목록의 id 도 함께 바뀐다 — 안 바꾸면 잔고 밖으로 떨어져 한 번 더 빠진다', () => {
    const today = account({ asOf: '2026-10-25', reflectedEntryIds: ['rent~2026-10-25', 'other'] });
    const [lost] = lostConfirmations(moved, [confirmed]);
    const fix = repairLink(lost!, 'relink', rent.id, newId);
    const accounts = reflectedAfterRename([today, account({ id: 'a2' })], new Map([[fix.removeId, fix.entry.id]]));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.reflectedEntryIds).toEqual(['rent~2026-10-26', 'other']);
    const before = headlineLimit([today], [rent, confirmed], TODAY);
    expect(headlineLimit(accounts, [moved, fix.entry], TODAY)).toBe(before);
  });
});

describe('백업 병합에서 같은 회차를 두 번 세지 않는다', () => {
  const [lost] = lostConfirmations(moved, [confirmed]);
  const fixed = repairLink(lost!, 'relink', rent.id, newId).entry;

  it('다시 이은 뒤 옛 백업을 가져와도 옛 사본(10/25)은 넣지 않는다', () => {
    const skip = conflictingConfirmations([moved, fixed], [rent, confirmed]);
    expect([...skip]).toEqual(['rent~2026-10-25']);
  });

  it('끊은 뒤 옛 백업을 가져와도 옛 사본은 넣지 않는다 — 회차가 새 규칙에 없다', () => {
    const unlinked = repairLink(lost!, 'unlink', rent.id, newId).entry;
    expect([...conflictingConfirmations([moved, unlinked], [rent, confirmed])]).toEqual(['rent~2026-10-25']);
  });

  it('빈 계정으로 옮길 때는 그대로 넣는다 — 예정과 확정이 함께 들어온다', () => {
    expect(conflictingConfirmations([], [rent, confirmed]).size).toBe(0);
  });

  it('같은 회차를 다른 id 로 확정한 문서가 이미 있으면 넣지 않는다', () => {
    const other = { ...confirmed, id: 'manual-copy' };
    expect([...conflictingConfirmations([rent, confirmed], [other])]).toEqual(['manual-copy']);
  });

  it('예정을 지웠으면 확정 거래는 그대로 넣는다 — 겹칠 회차가 없다', () => {
    expect(conflictingConfirmations([], [confirmed]).size).toBe(0);
  });
});
