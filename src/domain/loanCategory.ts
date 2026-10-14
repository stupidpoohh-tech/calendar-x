/**
 * 예전 '대출' 카테고리 지출 → 흐름 '대출'(대출 원금) 일괄 정리. 사용자가 미리보기를 보고 고를 때만 돈다.
 *
 * 대출은 이제 카테고리가 아니라 흐름이다(`ui/ledgerFlows.ts`). 그 전에 지출 · 일반 유형으로 '대출'
 * 카테고리를 붙여 적은 거래는 지금도 **소비**로 셈한다 — 분석의 소비 · 카테고리 예산의 사용이 그만큼
 * 크다. 이관한 거래는 처음부터 대출 원금이라 해당하지 않는다.
 *
 * 바꾸는 것은 `money.flow` 한 칸(normal → loanPrincipal)이다. 현금 부호는 둘 다 −1 이라 잔고 · 예상
 * 잔고 · 한도는 그대로이고, 결산에서 소비 → 대금(원금)으로 자리만 옮긴다(`ledgerClassOf`).
 * 카테고리는 지우지 않는다 — 이관한 대출 거래와 같은 모양(대출 카테고리 + 대출 원금)이 된다.
 *
 * 옮기지 않는 것
 *   생활비에 걸린 것   대출은 생활비에 걸지 않는다. 옮기려면 연결을 풀어야 하고, 그러면 주머니 숫자 ·
 *                     한도가 바뀐다. 따로 보여 주고 거래를 열어 고르게 한다
 *   예전 유형 · 종류   카드 사용 · 이체 · repay 등. 무엇이었는지 코드로 단정하지 않는다
 *   이미 대출          그대로
 */
import { isLoanCategory } from './category';
import { withDerived } from './entry';
import { moneyFlowOf } from './ledger';
import type { Category, Entry } from './types';

export interface LoanCategoryScan {
  /** 옮길 수 있는 것 — 지출 · 일반 유형 · 생활비 연결 없음. */
  convert: Entry[];
  /** 생활비에 걸려 있어 이 도구로 옮기지 않는 것. */
  pocketLinked: Entry[];
  /** 예전 유형 · 예전 종류라 건드리지 않는 것. */
  other: Entry[];
  /** 이미 대출(원금)인 것의 수. */
  alreadyLoan: number;
}

export function scanLoanCategoryEntries(entries: readonly Entry[], categories: readonly Category[]): LoanCategoryScan {
  const ids = new Set(categories.filter(isLoanCategory).map((c) => c.id));
  const out: LoanCategoryScan = { convert: [], pocketLinked: [], other: [], alreadyLoan: 0 };
  const seen = new Set<string>();
  for (const e of entries) {
    const m = e.money;
    if (e.kind !== 'money' || !m || e.virtual || seen.has(e.id) || !m.categoryId || !ids.has(m.categoryId)) continue;
    seen.add(e.id);
    const flow = moneyFlowOf(m);
    if (m.type === 'expense' && flow === 'loanPrincipal') { out.alreadyLoan++; continue; }
    if (m.type !== 'expense' || flow !== 'normal') { out.other.push(e); continue; }
    if (m.budgetId) { out.pocketLinked.push(e); continue; }
    out.convert.push(e);
  }
  const byDate = (a: Entry, b: Entry) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title);
  out.convert.sort(byDate);
  out.pocketLinked.sort(byDate);
  out.other.sort(byDate);
  return out;
}

/** 흐름만 대출(원금)로. 생활비 외 표식은 대출에 뜻이 없어 끈다. */
export function toLoanFlow(e: Entry, now: string): Entry {
  return withDerived({ ...e, updatedAt: now, money: { ...e.money!, flow: 'loanPrincipal', outsidePocket: false } });
}

/** 되돌리기 — 방금 옮긴 것만 일반 지출로. */
export function toNormalFlow(e: Entry, now: string): Entry {
  return withDerived({ ...e, updatedAt: now, money: { ...e.money!, flow: 'normal' } });
}
