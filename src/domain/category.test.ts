/**
 * 카테고리 · 카테고리 예산 — 보관 · 정렬 · 기본 예산의 비소급.
 */
import { describe, expect, it } from 'vitest';
import {
  categoryBudgetId, defaultCategories, findCategoryByName, moveCategory, newCategory,
  pickableCategories, resolveCategoryBudget, setDefaultBudget, setPeriodBudget, DEFAULT_CATEGORIES,
} from './category';

describe('카테고리', () => {
  it('기본 카테고리는 id 가 정해져 있다 — 두 번 만들어도 같은 문서다', () => {
    const a = defaultCategories('t1').map((c) => c.id);
    const b = defaultCategories('t2').map((c) => c.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(DEFAULT_CATEGORIES.length);
    expect(defaultCategories('').some((c) => c.kind === 'income')).toBe(true);
  });

  it('고를 수 있는 것은 그 흐름의 보관하지 않은 것뿐이다', () => {
    const list = [
      newCategory('expense', '식비', 1, 'a'),
      { ...newCategory('expense', '옛 카테고리', 0, 'b'), archived: true },
      newCategory('income', '급여', 0, 'c'),
      newCategory('expense', '교통', 0, 'd'),
    ];
    expect(pickableCategories(list, 'expense').map((c) => c.id)).toEqual(['d', 'a']);
    expect(pickableCategories(list, 'income').map((c) => c.id)).toEqual(['c']);
  });

  it('공백 · 대소문자만 다른 이름은 같은 것으로 본다', () => {
    const list = [newCategory('expense', '카페  간식', 0, 'a'), newCategory('income', 'Bonus', 0, 'b')];
    expect(findCategoryByName(list, 'expense', ' 카페 간식 ')?.id).toBe('a');
    expect(findCategoryByName(list, 'income', 'bonus')?.id).toBe('b');
    expect(findCategoryByName(list, 'expense', 'bonus')).toBeNull();
  });

  it('순서를 옮기면 바뀐 것만 돌려준다', () => {
    const list = [
      newCategory('expense', 'A', 0, 'a'), newCategory('expense', 'B', 1, 'b'),
      newCategory('expense', 'C', 2, 'c'), newCategory('income', 'X', 0, 'x'),
    ];
    const moved = moveCategory(list, 'c', -1, 'now');
    expect(moved.map((c) => [c.id, c.order])).toEqual([['c', 1], ['b', 2]]);
    expect(moveCategory(list, 'a', -1)).toEqual([]);
  });
});

describe('카테고리 예산', () => {
  it('id 는 카테고리 · 범위 · 기간으로 정해진다', () => {
    expect(categoryBudgetId('food', 'default', '2026-09')).toBe('food~default~2026-09');
    expect(setPeriodBudget('food', '2026-09', 1).id).toBe('food~period~2026-09');
  });

  it('기본 예산은 그 기간부터 다음 기본 예산 전까지 적용된다', () => {
    const rows = [setDefaultBudget('food', '2026-03', 300_000), setDefaultBudget('food', '2026-09', 400_000)];
    expect(resolveCategoryBudget(rows, 'food', '2026-02')).toEqual({ source: 'none', amountMinor: null });
    expect(resolveCategoryBudget(rows, 'food', '2026-03').amountMinor).toBe(300_000);
    expect(resolveCategoryBudget(rows, 'food', '2026-08').amountMinor).toBe(300_000);
    expect(resolveCategoryBudget(rows, 'food', '2026-09').amountMinor).toBe(400_000);
    expect(resolveCategoryBudget(rows, 'food', '2027-05').amountMinor).toBe(400_000);
  });

  it('기본 예산을 바꿔도 앞 기간은 소급되지 않는다', () => {
    const before = [setDefaultBudget('food', '2026-01', 300_000)];
    const after = [...before, setDefaultBudget('food', '2026-10', 500_000)];
    for (const k of ['2026-01', '2026-05', '2026-09']) {
      expect(resolveCategoryBudget(after, 'food', k).amountMinor).toBe(resolveCategoryBudget(before, 'food', k).amountMinor);
    }
    expect(resolveCategoryBudget(after, 'food', '2026-10').amountMinor).toBe(500_000);
  });

  it('기간 예산이 기본 예산보다 앞선다. null 은 "이 기간은 예산 없음" 이다', () => {
    const rows = [
      setDefaultBudget('food', '2026-01', 300_000),
      setPeriodBudget('food', '2026-07', 600_000),
      setPeriodBudget('food', '2026-08', null),
    ];
    expect(resolveCategoryBudget(rows, 'food', '2026-07')).toMatchObject({ source: 'period', amountMinor: 600_000 });
    expect(resolveCategoryBudget(rows, 'food', '2026-08')).toMatchObject({ source: 'period', amountMinor: null });
    expect(resolveCategoryBudget(rows, 'food', '2026-09').amountMinor).toBe(300_000);
  });

  it('기본 예산을 끈 뒤로는 예산이 없다', () => {
    const rows = [setDefaultBudget('food', '2026-01', 300_000), setDefaultBudget('food', '2026-06', null)];
    expect(resolveCategoryBudget(rows, 'food', '2026-05').amountMinor).toBe(300_000);
    expect(resolveCategoryBudget(rows, 'food', '2026-06')).toMatchObject({ source: 'default', amountMinor: null });
  });

  it('다른 카테고리의 예산은 섞이지 않는다', () => {
    const rows = [setDefaultBudget('cafe', '2026-01', 50_000)];
    expect(resolveCategoryBudget(rows, 'food', '2026-05').source).toBe('none');
  });
});
