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
  reserveFromDoc, reservePatchToDoc, reserveToDoc, annualBudgetFromDoc, annualBudgetToDoc,
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

describe('entry — 생활비 외 지출(outsidePocket)', () => {
  const mk = (extra: Record<string, unknown>) => legacyMoneyDoc({ money: { type: 'expense', amountMinor: 1, currency: 'KRW', linkedEntryId: null, ...extra } });
  it('없던 문서는 미결정(false), 켠 값은 그대로 오간다', () => {
    expect(entryFromDoc('x', legacyMoneyDoc()).money?.outsidePocket).toBe(false);
    const on = entryFromDoc('x', mk({ outsidePocket: true }));
    expect(on.money?.outsidePocket).toBe(true);
    expect((entryToDoc(on).money as Record<string, unknown>).outsidePocket).toBe(true);
    expect(entryFromDoc('x', mk({ outsidePocket: 'yes' })).money?.outsidePocket).toBe(false);
  });

  it('주머니에 걸린 지출에는 쓰지 않는다 — 사용처는 하나다', () => {
    const both = entryFromDoc('x', mk({ outsidePocket: true, budgetId: 'b1' }));
    expect((entryToDoc(both).money as Record<string, unknown>).outsidePocket).toBe(false);
  });
});

describe('entry — 달력에 표시(highlight)', () => {
  it('없던 문서는 false 로 읽고, 켠 값은 그대로 오간다', () => {
    expect(entryFromDoc('rent', legacyMoneyDoc()).money?.highlight).toBe(false);
    const on = entryFromDoc('rent', legacyMoneyDoc({ money: { type: 'expense', amountMinor: 1, currency: 'KRW', linkedEntryId: null, highlight: true } }));
    expect(on.money?.highlight).toBe(true);
    expect((entryToDoc(on).money as Record<string, unknown>).highlight).toBe(true);
  });

  it('참·거짓이 아닌 값은 꺼진 것으로 읽는다 · 메모리에 없어도 undefined 를 쓰지 않는다', () => {
    expect(entryFromDoc('x', legacyMoneyDoc({ money: { type: 'expense', amountMinor: 1, currency: 'KRW', linkedEntryId: null, highlight: 'yes' } })).money?.highlight).toBe(false);
    const e = newEntry('money');
    const bare = { ...e, money: { type: 'expense', amountMinor: 1, currency: 'KRW', linkedEntryId: null } } as typeof e;
    expect((entryToDoc(bare).money as Record<string, unknown>).highlight).toBe(false);
  });
});

describe('세이브 — 보호 · 목표 · 보관 (P1)', () => {
  const legacy = { name: '비상금', amountMinor: 300000, currency: 'KRW', createdAt: 'c', updatedAt: 'u' };

  it('필드가 없는 예전 문서는 보호 켬 · 목표 없음 · 보관 안 함으로 읽는다', () => {
    expect(reserveFromDoc('s1', legacy)).toEqual({
      id: 's1', ...legacy, protected: true, targetAmountMinor: null, targetDate: null, archivedAt: null,
    });
  });

  it('protected 는 false 일 때만 꺼진다 — 모르는 값은 예전처럼 켜진 것으로 읽는다', () => {
    expect(reserveFromDoc('s1', { ...legacy, protected: false }).protected).toBe(false);
    expect(reserveFromDoc('s1', { ...legacy, protected: 'no' }).protected).toBe(true);
    expect(reserveFromDoc('s1', { ...legacy, protected: null }).protected).toBe(true);
  });

  it('목표 · 보관은 형태가 틀리면 없는 것으로 읽는다', () => {
    const r = reserveFromDoc('s1', { ...legacy, targetAmountMinor: -5, targetDate: '2027-3-1', archivedAt: '' });
    expect(r.targetAmountMinor).toBeNull();
    // 패딩 없는 날짜는 앱 전체 규칙대로 맞춰 읽는다.
    expect(r.targetDate).toBe('2027-03-01');
    expect(r.archivedAt).toBeNull();
    expect(reserveFromDoc('s1', { ...legacy, targetAmountMinor: 1.5 }).targetAmountMinor).toBeNull();
  });

  it('저장 형태는 P1 필드를 늘 채우고 판 번호를 붙인다 — 왕복해도 같다', () => {
    const r = reserveFromDoc('s1', {
      ...legacy, protected: false, targetAmountMinor: 1000000, targetDate: '2027-03-01', archivedAt: '2026-10-14T01:00:00.000Z',
    });
    const doc = reserveToDoc(r);
    expect(doc).toMatchObject({ protected: false, targetAmountMinor: 1000000, targetDate: '2027-03-01', schema: 2 });
    expect(reserveFromDoc('s1', doc)).toEqual(r);
    const old = reserveToDoc({ id: 's2', ...legacy });
    expect(old).toMatchObject({ protected: true, targetAmountMinor: null, targetDate: null, archivedAt: null, schema: 2 });
  });

  it('부분 쓰기는 담긴 칸과 판 번호만 쓴다', () => {
    expect(reservePatchToDoc({ protected: false })).toEqual({ protected: false, schema: 2 });
    expect(reservePatchToDoc({ amountMinor: 10, targetDate: null })).toEqual({ amountMinor: 10, targetDate: null, schema: 2 });
  });
});

describe('연간 카테고리 예산 (P2)', () => {
  const raw = {
    categoryId: 'beauty', year: 2027, amountMinor: 600000,
    monthAllocations: { '04': 400000, '10': 200000 }, currency: 'KRW', createdAt: 'c', updatedAt: 'u',
  };

  it('왕복해도 같다', () => {
    const b = annualBudgetFromDoc('beauty~2027', raw);
    expect(b).toEqual({ id: 'beauty~2027', ...raw });
    expect(annualBudgetFromDoc(b.id, annualBudgetToDoc(b))).toEqual(b);
  });

  it('깨진 배분은 그 달만 "배분 없음" 으로 읽는다 — 다른 값은 그대로', () => {
    const b = annualBudgetFromDoc('x', { ...raw, monthAllocations: { '04': 400000, '13': 5, '05': 0, '06': 1.5, '07': '9' } });
    expect(b.monthAllocations).toEqual({ '04': 400000 });
    expect(annualBudgetFromDoc('x', { ...raw, monthAllocations: null }).monthAllocations).toEqual({});
  });
});
