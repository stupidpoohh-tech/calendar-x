/**
 * 가계부 원장 필드의 저장 형태.
 *
 * 읽기는 방어적이고 쓰기는 늘 채운다. 원장 필드가 없던 시절의 문서는 예정 · 일반으로
 * 읽혀야 지금까지와 같은 한도가 나온다.
 */
import { describe, expect, it } from 'vitest';
import { newEntry, newMoney } from '../domain/entry';
import type { Account } from '../domain/types';
import {
  LEDGER_SCHEMA, accountFromDoc, accountToDoc, entryFromDoc, entryToDoc,
} from './converters';

const legacyMoneyDoc = (over: Record<string, unknown> = {}) => ({
  kind: 'money', title: '월세', note: '', color: 'red', tags: [], location: '',
  startDate: '2026-09-25', startTime: null, endDate: null, endTime: null,
  ymSpan: ['2026-09'], isRecurring: true,
  recurrence: { freq: 'monthly', interval: 1, until: null, count: null },
  task: null,
  money: { type: 'expense', amountMinor: 500_000, currency: 'KRW', linkedEntryId: null },
  recovery: null, createdAt: '', updatedAt: '',
  ...over,
});

describe('entry — 원장 필드가 없던 문서', () => {
  it('예정 · 일반으로 읽고 반복을 그대로 둔다', () => {
    const e = entryFromDoc('rent', legacyMoneyDoc());
    expect(e.money).toMatchObject({
      status: 'planned', flow: 'normal', categoryId: null, method: null,
      accountId: null, plannedRef: null,
    });
    expect(e.isRecurring).toBe(true);
  });

  it('다시 쓰면 원장 필드를 기본값으로 굳히고 판 번호를 붙인다', () => {
    const doc = entryToDoc(entryFromDoc('rent', legacyMoneyDoc()));
    expect(doc.schema).toBe(LEDGER_SCHEMA);
    expect(doc.money).toMatchObject({ status: 'planned', flow: 'normal', plannedRef: null });
    // Firestore 는 undefined 를 받지 않는다.
    expect(Object.values(doc.money as object).includes(undefined)).toBe(false);
  });

  it('할 일 · 아이디어에도 판 번호를 붙인다 — 종류를 바꾸는 쓰기도 새 앱의 쓰기다', () => {
    expect(entryToDoc(newEntry('task')).schema).toBe(LEDGER_SCHEMA);
    expect(entryToDoc(newEntry('task')).money).toBeNull();
  });

  it('메모리의 가계부 필드에 원장 필드가 없어도 채워 쓴다', () => {
    const e = newEntry('money');
    const bare = { ...e, money: { type: 'expense', amountMinor: 1, currency: 'KRW', linkedEntryId: null } } as typeof e;
    expect(entryToDoc(bare).money).toMatchObject({
      status: 'planned', flow: 'normal', categoryId: null, method: null, accountId: null, plannedRef: null,
    });
  });
});

describe('entry — 실제 거래', () => {
  const actualDoc = (money: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => legacyMoneyDoc({
    isRecurring: false, recurrence: null,
    startDate: '2026-10-02', ymSpan: ['2026-09', '2026-10'],
    money: {
      type: 'expense', amountMinor: 500_000, currency: 'KRW', linkedEntryId: null,
      status: 'actual', flow: 'normal', categoryId: 'housing', method: '이체',
      accountId: 'a1', plannedRef: { entryId: 'rent', date: '2026-09-25' },
      ...money,
    },
    ...over,
  });

  it('읽고 다시 써도 같다', () => {
    const e = entryFromDoc('rent~2026-09-25', actualDoc());
    expect(e.money).toMatchObject({
      status: 'actual', categoryId: 'housing', method: '이체', accountId: 'a1',
      plannedRef: { entryId: 'rent', date: '2026-09-25' },
    });
    const back = entryToDoc(e);
    expect(back.money).toMatchObject({
      status: 'actual', categoryId: 'housing', method: '이체', accountId: 'a1',
      plannedRef: { entryId: 'rent', date: '2026-09-25' },
    });
  });

  it('반복 · 기간이 붙어 와도 접는다 — 같은 거래를 여러 번 세지 않는다', () => {
    const e = entryFromDoc('x', actualDoc({}, {
      isRecurring: true, endDate: '2026-10-09',
      recurrence: { freq: 'weekly', interval: 1, until: null, count: null },
    }));
    expect(e.recurrence).toBeNull();
    expect(e.isRecurring).toBe(false);
    expect(e.endDate).toBeNull();
  });

  it('인덱스가 비어 있으면 회차의 달까지 다시 만든다', () => {
    const e = entryFromDoc('x', actualDoc({}, { ymSpan: [] }));
    expect(e.ymSpan).toEqual(['2026-09', '2026-10']);
  });

  it('모르는 흐름은 일반으로, 모양이 틀린 연결은 없는 것으로 읽는다', () => {
    const e = entryFromDoc('x', actualDoc({ flow: 'refund', plannedRef: { entryId: 3, date: 'x' } }));
    expect(e.money?.flow).toBe('normal');
    expect(e.money?.plannedRef).toBeNull();
  });

  it('예정에 붙은 회차 연결은 버린다', () => {
    const e = entryFromDoc('x', actualDoc({ status: 'planned' }));
    expect(e.money?.plannedRef).toBeNull();
    expect(entryToDoc({ ...e, money: { ...e.money!, plannedRef: { entryId: 'r', date: '2026-09-25' } } }).money)
      .toMatchObject({ plannedRef: null });
  });

  it('빈 문자열은 없는 것으로 읽는다', () => {
    const e = entryFromDoc('x', actualDoc({ categoryId: '', method: '', accountId: '' }));
    expect(e.money).toMatchObject({ categoryId: null, method: null, accountId: null });
  });
});

describe('account — 잔고 반영 목록', () => {
  const acct: Account = {
    id: 'a1', name: '주계좌', balanceMinor: 1, currency: 'KRW', asOf: '2026-10-01',
    checkedAt: '2026-10-01T00:00:00.000Z', order: 0, createdAt: '', updatedAt: '',
  };

  it('없던 문서는 빈 목록으로 읽는다', () => {
    const { id: _id, ...raw } = acct;
    expect(accountFromDoc('a1', raw).reflectedEntryIds).toEqual([]);
  });

  it('목록과 판 번호를 함께 쓴다', () => {
    const doc = accountToDoc({ ...acct, reflectedEntryIds: ['t1'] });
    expect(doc.reflectedEntryIds).toEqual(['t1']);
    expect(doc.schema).toBe(LEDGER_SCHEMA);
    expect(accountToDoc(acct).reflectedEntryIds).toEqual([]);
    expect(accountFromDoc('a1', doc).reflectedEntryIds).toEqual(['t1']);
  });
});

it('newMoney 로 만든 실제 거래도 저장 형태가 온전하다', () => {
  const e = newEntry('money', { money: newMoney({ status: 'actual', amountMinor: 1 }) });
  expect(entryToDoc(e).money).toMatchObject({ status: 'actual', plannedRef: null });
});
