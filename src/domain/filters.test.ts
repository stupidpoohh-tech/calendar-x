import { describe, expect, it } from 'vitest';
import { newEntry } from './entry';
import { applyFilters, collectTags, emptyFilters, hasActiveFilter, matchesFilters, matchesLens, normalizeTag } from './filters';
import type { Entry, Filters } from './types';

const f = (p: Partial<Filters> = {}): Filters => ({ ...emptyFilters(), ...p });

const task = (p: Partial<Entry> = {}) => newEntry('task', p);
const idea = (p: Partial<Entry> = {}) => newEntry('idea', p);
const spend = (p: Partial<Entry> = {}) =>
  newEntry('money', { money: { type: 'expense', amountMinor: 1000, currency: 'KRW', linkedEntryId: null }, ...p });

describe('matchesLens', () => {
  it("'all' 은 아무것도 거르지 않는다 — 세 축이 한 화면에 올라오는 근거", () => {
    expect(matchesLens(task(), 'all')).toBe(true);
    expect(matchesLens(idea(), 'all')).toBe(true);
    expect(matchesLens(spend(), 'all')).toBe(true);
  });
  it('렌즈는 kind 로 거른다', () => {
    expect(matchesLens(task(), 'task')).toBe(true);
    expect(matchesLens(task(), 'money')).toBe(false);
  });
});

describe('matchesFilters', () => {
  it('색상으로 거른다', () => {
    expect(matchesFilters(task({ color: 'red' }), f({ colors: new Set(['red']) }))).toBe(true);
    expect(matchesFilters(task({ color: 'blue' }), f({ colors: new Set(['red']) }))).toBe(false);
  });
  it('태그는 하나라도 맞으면 통과한다', () => {
    const e = task({ tags: ['업무', '급함'] });
    expect(matchesFilters(e, f({ tags: new Set(['급함']) }))).toBe(true);
    expect(matchesFilters(e, f({ tags: new Set(['개인']) }))).toBe(false);
  });
  it('검색어는 제목·메모·장소·태그를 훑는다', () => {
    const e = task({ title: '치과', note: '스케일링', location: '강남' });
    expect(matchesFilters(e, f({ q: '스케일' }))).toBe(true);
    expect(matchesFilters(e, f({ q: '강남' }))).toBe(true);
    expect(matchesFilters(e, f({ q: '내과' }))).toBe(false);
  });
  it('가계부 항목은 금액으로도 검색된다', () => {
    expect(matchesFilters(spend({ title: '전기요금' }), f({ q: '전기' }))).toBe(true);
  });
  it('할 일 전용 필터는 할 일에만 적용한다', () => {
    expect(matchesFilters(task({ task: { status: 'done', important: false, urgent: false, order: 0 } }), f({ status: 'done' }))).toBe(true);
    expect(matchesFilters(task({ task: { status: 'planned', important: false, urgent: false, order: 0 } }), f({ status: 'done' }))).toBe(false);
  });
  it('할 일 전용 필터가 켜지면 다른 축은 빠진다 — 필터의 의미를 지킨다', () => {
    expect(matchesFilters(idea(), f({ important: true }))).toBe(false);
    expect(matchesFilters(spend(), f({ status: 'done' }))).toBe(false);
  });
  it('필터가 비어 있으면 다른 축도 통과한다', () => {
    expect(matchesFilters(idea(), f())).toBe(true);
    expect(matchesFilters(spend(), f())).toBe(true);
  });
});

describe('hasActiveFilter', () => {
  it('빈 필터를 알아본다', () => {
    expect(hasActiveFilter(f())).toBe(false);
    expect(hasActiveFilter(f({ q: '  ' }))).toBe(false);
    expect(hasActiveFilter(f({ q: '치과' }))).toBe(true);
    expect(hasActiveFilter(f({ colors: new Set(['red']) }))).toBe(true);
  });
});

describe('applyFilters', () => {
  it('렌즈와 필터를 함께 적용한다', () => {
    const items = [task({ color: 'red' }), task({ color: 'blue' }), idea({ color: 'red' })];
    expect(applyFilters(items, 'task', f({ colors: new Set(['red']) }))).toHaveLength(1);
    expect(applyFilters(items, 'all', f({ colors: new Set(['red']) }))).toHaveLength(2);
  });
});

describe('태그 정리', () => {
  it('앞의 # 과 공백을 걷어낸다', () => {
    expect(normalizeTag('  #업무 ')).toBe('업무');
    expect(normalizeTag('##중요')).toBe('중요');
  });
  it('태그를 가나다순으로 모은다', () => {
    expect(collectTags([task({ tags: ['나'] }), task({ tags: ['가', '나'] })])).toEqual(['가', '나']);
  });
});
