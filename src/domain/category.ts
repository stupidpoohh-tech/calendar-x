/**
 * 카테고리와 카테고리 예산.
 *
 * ── 카테고리는 지우지 않는다 ──────────────────────────────────
 *
 * 거래가 `money.categoryId` 로 카테고리를 가리킨다. 카테고리를 지우면 그 거래들이
 * 미분류로 떨어지고 지난 결산이 조용히 바뀐다. 그래서 지우는 대신 **보관**한다 — 새
 * 입력에서 고르는 자리에서만 빠지고, 지난 기록 · 통계에는 이름 그대로 남는다.
 *
 * ── 카테고리 예산은 생활비 주머니가 아니다 ──────────────────────
 *
 * 생활비 주머니(`Budget`)는 한도에서 미리 빠지는 돈이다. 카테고리 예산은 "식비에 얼마
 * 쓰기로 했고 실제로 얼마 썼나" 를 비교하는 결산용이고, 한도 계산에 들어가지 않는다.
 * 둘을 합치면 같은 돈이 주머니로 한 번, 카테고리 예산으로 또 한 번 빠진다.
 *
 * ── 기본 예산은 소급되지 않는다 ────────────────────────────────
 *
 * 기본 예산을 바꾸면 **그 기간부터** 적용되는 default 줄을 하나 더 쓴다. 앞 기간들은
 * 앞의 default 를 그대로 본다. 특정 기간만 다르게 하려면 period 줄을 쓴다.
 */
import { DEFAULT_CURRENCY } from './constants';
import type { Category, CategoryBudget, PeriodKey } from './types';

/**
 * 처음 쓰는 사람에게 제안하는 기본 카테고리.
 *
 * id 가 정해져 있다 — 두 기기에서 동시에 "기본 카테고리 만들기" 를 눌러도 같은 문서로
 * 모인다. 이름 · 순서 · 보관은 사용자가 마음대로 바꾼다.
 */
export const DEFAULT_CATEGORIES: readonly Pick<Category, 'id' | 'kind' | 'name'>[] = [
  { id: 'default-food', kind: 'expense', name: '식비' },
  { id: 'default-cafe', kind: 'expense', name: '카페 · 간식' },
  { id: 'default-transport', kind: 'expense', name: '교통' },
  { id: 'default-living', kind: 'expense', name: '생활용품' },
  { id: 'default-housing', kind: 'expense', name: '주거 · 통신' },
  { id: 'default-health', kind: 'expense', name: '의료 · 건강' },
  { id: 'default-culture', kind: 'expense', name: '문화 · 여가' },
  { id: 'default-shopping', kind: 'expense', name: '쇼핑' },
  { id: 'default-social', kind: 'expense', name: '경조사 · 선물' },
  { id: 'default-finance', kind: 'expense', name: '금융 · 이자' },
  { id: 'default-etc-out', kind: 'expense', name: '기타 지출' },
  { id: 'default-salary', kind: 'income', name: '급여' },
  { id: 'default-side', kind: 'income', name: '부수입' },
  { id: 'default-etc-in', kind: 'income', name: '기타 수입' },
];

export function defaultCategories(now = new Date().toISOString()): Category[] {
  return DEFAULT_CATEGORIES.map((c, i) => ({
    ...c, order: i, archived: false, createdAt: now, updatedAt: now,
  }));
}

export function newCategory(
  kind: Category['kind'], name: string, order: number, id: string,
  now = new Date().toISOString(),
): Category {
  return { id, kind, name: name.trim(), order, archived: false, createdAt: now, updatedAt: now };
}

/** 정렬: 순서 → 이름. */
export function sortCategories(list: readonly Category[]): Category[] {
  return [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'));
}

/**
 * 대출 원금으로 세는 카테고리 이름. 이관이 이 이름의 지출을 대출 원금으로 넣는다.
 *
 * 대출은 이제 카테고리가 아니라 흐름(수입 · 지출 · 대출)이다. 그래서 이 이름의 지출 카테고리는
 * 새 입력에서 고르는 자리에서 빠진다 — 문서는 지우지도 보관하지도 않는다(지난 거래가 가리킨다).
 */
export const LOAN_CATEGORY_NAMES: readonly string[] = ['대출'];

export function isLoanCategory(c: Pick<Category, 'kind' | 'name'>): boolean {
  return c.kind === 'expense' && LOAN_CATEGORY_NAMES.includes(c.name.trim());
}

/** 새 입력에서 고를 수 있는 것 — 그 흐름의, 보관하지 않은 것. 흐름으로 옮긴 '대출' 은 뺀다. */
export function pickableCategories(list: readonly Category[], kind: Category['kind']): Category[] {
  return sortCategories(list.filter((c) => c.kind === kind && !c.archived && !isLoanCategory(c)));
}

/** 같은 흐름 안에서 이름이 같은가. 공백 · 대소문자만 다른 이름은 같은 것으로 본다. */
export function findCategoryByName(
  list: readonly Category[], kind: Category['kind'], name: string,
): Category | null {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const want = norm(name);
  if (!want) return null;
  return list.find((c) => c.kind === kind && norm(c.name) === want) ?? null;
}

/** 순서를 한 칸 옮긴다. 바뀐 카테고리만 돌려준다 — 안 바뀐 것까지 다시 쓰지 않는다. */
export function moveCategory(
  list: readonly Category[], id: string, by: -1 | 1, now = new Date().toISOString(),
): Category[] {
  const target = list.find((c) => c.id === id);
  if (!target) return [];
  const same = sortCategories(list.filter((c) => c.kind === target.kind));
  const from = same.findIndex((c) => c.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= same.length) return [];
  const next = [...same];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  const out: Category[] = [];
  next.forEach((c, i) => { if (c.order !== i) out.push({ ...c, order: i, updatedAt: now }); });
  return out;
}

// ---------- 카테고리 예산 ----------

export function categoryBudgetId(categoryId: string, scope: CategoryBudget['scope'], period: PeriodKey): string {
  return `${categoryId}~${scope}~${period}`;
}

export function newCategoryBudget(
  categoryId: string, scope: CategoryBudget['scope'], period: PeriodKey,
  amountMinor: number | null, now = new Date().toISOString(),
): CategoryBudget {
  return {
    id: categoryBudgetId(categoryId, scope, period),
    categoryId, scope, period, amountMinor,
    currency: DEFAULT_CURRENCY, createdAt: now, updatedAt: now,
  };
}

/**
 * 그 기간 그 카테고리의 예산이 어디서 왔는가.
 *
 *   period   그 기간만의 예산
 *   default  그 기간에 적용되는 기본 예산 (`from` 기간부터)
 *   none     없다
 */
export type ResolvedBudget =
  | { source: 'period'; amountMinor: number | null; row: CategoryBudget }
  | { source: 'default'; amountMinor: number | null; row: CategoryBudget }
  | { source: 'none'; amountMinor: null };

export function resolveCategoryBudget(
  rows: readonly CategoryBudget[], categoryId: string, period: PeriodKey,
): ResolvedBudget {
  let def: CategoryBudget | null = null;
  for (const r of rows) {
    if (r.categoryId !== categoryId) continue;
    if (r.scope === 'period' && r.period === period) {
      return { source: 'period', amountMinor: r.amountMinor, row: r };
    }
    if (r.scope === 'default' && r.period <= period && (!def || r.period > def.period)) def = r;
  }
  return def ? { source: 'default', amountMinor: def.amountMinor, row: def } : { source: 'none', amountMinor: null };
}

/**
 * 기본 예산을 바꾼다 — `from` 기간부터.
 *
 * 앞 기간에는 손대지 않는다. 같은 기간에 이미 default 줄이 있으면 그 줄을 고친다
 * (id 가 같으므로 덮어쓰기 한 번이다).
 */
export function setDefaultBudget(
  categoryId: string, from: PeriodKey, amountMinor: number | null, now = new Date().toISOString(),
): CategoryBudget {
  return newCategoryBudget(categoryId, 'default', from, amountMinor, now);
}

/** 그 기간만 다르게. */
export function setPeriodBudget(
  categoryId: string, period: PeriodKey, amountMinor: number | null, now = new Date().toISOString(),
): CategoryBudget {
  return newCategoryBudget(categoryId, 'period', period, amountMinor, now);
}
