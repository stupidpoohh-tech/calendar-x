import { describe, expect, it } from 'vitest';
import { convertKind, displayTitle, effectiveEndDate, isRanged, newEntry, occursOn, setRecurrence, withDerived } from './entry';
import { formatMoney, formatSigned, parseAmountToMinor } from './money';

describe('newEntry', () => {
  it('kind 별 기본값을 채운다', () => {
    expect(newEntry('task').task).not.toBeNull();
    expect(newEntry('task').money).toBeNull();
    expect(newEntry('money').money?.currency).toBe('KRW');
    expect(newEntry('idea').task).toBeNull();
    expect(newEntry('idea').color).toBe('violet');
  });
  it('ymSpan 을 파생시킨다', () => {
    const e = newEntry('task', { startDate: '2026-01-28', endDate: '2026-02-03' });
    expect(e.ymSpan).toEqual(['2026-01', '2026-02']);
  });
});

describe('withDerived', () => {
  it('종료일이 시작일보다 앞이면 버린다', () => {
    const e = withDerived(newEntry('task', { startDate: '2026-08-10', endDate: '2026-08-01' }));
    expect(e.endDate).toBeNull();
    expect(effectiveEndDate(e)).toBe('2026-08-10');
  });
  it('isRecurring 을 recurrence 에서 파생시킨다', () => {
    const plain = newEntry('task');
    expect(plain.isRecurring).toBe(false);
    const rep = setRecurrence(plain, { freq: 'daily', interval: 1, until: null, count: null });
    expect(rep.isRecurring).toBe(true);
    expect(setRecurrence(rep, null).isRecurring).toBe(false);
  });
  it('패딩 없는 날짜를 정규화해 저장한다', () => {
    expect(withDerived(newEntry('task', { startDate: '2026-5-3' })).startDate).toBe('2026-05-03');
  });
});

describe('isRanged / occursOn', () => {
  const e = newEntry('task', { startDate: '2026-08-03', endDate: '2026-08-06' });
  it('기간형을 구분한다', () => {
    expect(isRanged(e)).toBe(true);
    expect(isRanged(newEntry('task', { startDate: '2026-08-03' }))).toBe(false);
  });
  it('걸쳐 있는 날을 모두 인정한다', () => {
    expect(occursOn(e, '2026-08-03')).toBe(true);
    expect(occursOn(e, '2026-08-05')).toBe(true);
    expect(occursOn(e, '2026-08-06')).toBe(true);
    expect(occursOn(e, '2026-08-07')).toBe(false);
    expect(occursOn(e, '2026-08-02')).toBe(false);
  });
});

describe('convertKind — 축 간 전환', () => {
  it('아이디어를 할 일로 승격하면 할 일 필드가 생긴다', () => {
    const idea = newEntry('idea', { title: '뉴스레터 만들기' });
    const task = convertKind(idea, 'task');
    expect(task.kind).toBe('task');
    expect(task.task?.status).toBe('planned');
    expect(task.title).toBe('뉴스레터 만들기');
    expect(task.id).toBe(idea.id);
  });
  it('아이디어로 되돌리면 기간·시각·반복을 접는다', () => {
    const task = setRecurrence(
      newEntry('task', { startDate: '2026-08-01', endDate: '2026-08-05', startTime: '09:00' }),
      { freq: 'daily', interval: 1, until: null, count: null },
    );
    const idea = convertKind(task, 'idea');
    expect(idea.endDate).toBeNull();
    expect(idea.startTime).toBeNull();
    expect(idea.recurrence).toBeNull();
    expect(idea.isRecurring).toBe(false);
    expect(idea.task).toBeNull();
  });
  it('같은 kind 로 바꾸면 그대로 둔다', () => {
    const e = newEntry('task');
    expect(convertKind(e, 'task')).toBe(e);
  });
});

describe('displayTitle', () => {
  it('제목이 비면 표시를 대신한다', () => {
    expect(displayTitle(newEntry('task'))).toBe('(제목 없음)');
  });
  it('가계부는 금액을 함께 보여 준다', () => {
    const e = newEntry('money', { title: '전기요금', money: { type: 'expense', amountMinor: 45_000, currency: 'KRW', linkedEntryId: null } });
    expect(displayTitle(e)).toBe('전기요금 · 45,000');
  });
  it('라벨이 없으면 유형명을 쓴다', () => {
    const e = newEntry('money', { money: { type: 'income', amountMinor: 2_500_000, currency: 'KRW', linkedEntryId: null } });
    expect(displayTitle(e)).toBe('예상 입금 2,500,000');
  });
});

describe('금액 파싱', () => {
  it('구분자와 단위를 걷어낸다', () => {
    expect(parseAmountToMinor('1,200원')).toBe(1200);
    expect(parseAmountToMinor('  45000 ')).toBe(45000);
    expect(parseAmountToMinor('-3000')).toBe(-3000);
  });
  it('숫자가 없으면 null 을 낸다', () => {
    expect(parseAmountToMinor('')).toBeNull();
    expect(parseAmountToMinor('원')).toBeNull();
    expect(parseAmountToMinor('-')).toBeNull();
  });
  it('소수 통화는 최소 단위로 올린다', () => {
    expect(parseAmountToMinor('12.34', 'USD')).toBe(1234);
    expect(parseAmountToMinor('12', 'USD')).toBe(1200);
  });
  it('KRW 는 소수 자리가 없다', () => {
    expect(formatMoney(45_000)).toContain('45,000');
    expect(formatSigned(-45_000)).toBe('−45,000');
    expect(formatSigned(45_000)).toBe('+45,000');
    expect(formatSigned(0)).toBe('0');
  });
});
