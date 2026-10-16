/**
 * 흐름 — 수입 · 지출 · 대출 세 가지.
 *
 * 예전에는 흐름(수입 · 지출) 아래에 거래 유형(일반 · 카드 사용 · 카드 대금 · 대출 원금 · 대출 이자 ·
 * 이체)과 결제수단 칸이 따로 있었고, '대출' 은 지출 카테고리 가운데 하나였다. 실제로 쓰는 구분은
 * 들어온 돈 · 나간 돈 · 빚 갚은 돈 셋이라, 대출을 카테고리에서 꺼내 흐름으로 올리고 나머지 칸은
 * 입력에서 뺐다.
 *
 * 대출은 저장할 때 `type: 'expense'` + `flow: 'loanPrincipal'` 이다 — 이관이 카테고리 '대출' 을
 * 대출 원금으로 세던 것과 같은 뜻이고, 계산(`cashSignOf` · `ledgerClassOf`)은 그대로다.
 *
 * **예전 유형은 지우지 않는다.** 카드 사용 · 카드 대금 · 대출 이자 · 이체로 저장된 거래는 지금도 그
 * 뜻으로 계산된다. 편집 화면은 그 유형을 '(예전)' 칩으로 보여 주고, 세 흐름 가운데 하나를 눌렀을
 * 때만 바꾼다 — 다른 칸을 고치려다 유형이 조용히 바뀌지 않게.
 */
import type { Card, MoneyFields, MoneyFlow } from '../domain/types';

/** 예전 유형의 이름. 내역의 작은 글씨 · 편집 화면의 '(예전)' 칩이 같은 말을 쓴다. */
export const FLOW_LABEL: Record<MoneyFlow, string> = {
  normal: '일반',
  cardSpend: '카드 사용',
  cardPayment: '카드 대금',
  loanPrincipal: '대출',
  loanInterest: '대출 이자',
  transfer: '이체 · 저축',
};

export function flowLabel(flow: MoneyFlow): string {
  return FLOW_LABEL[flow] ?? '일반';
}

export type FlowPick = 'income' | 'expense' | 'loan';

export const FLOW_PICKS: readonly { id: FlowPick; label: string }[] = [
  { id: 'income', label: '수입' },
  { id: 'expense', label: '지출' },
  { id: 'loan', label: '대출' },
];

/** 지금 값이 세 흐름 가운데 무엇인가. 예전 종류 · 예전 유형이면 null. */
export function flowPickOf(m: Pick<MoneyFields, 'type' | 'flow' | 'cardId'> | null | undefined): FlowPick | null {
  if (!m) return null;
  const flow = m.flow ?? 'normal';
  if (m.type === 'income') return flow === 'normal' ? 'income' : null;
  if (m.type !== 'expense') return null;
  if (flow === 'normal') return 'expense';
  // 등록한 카드로 쓴 돈은 지출이다(P4). 결제수단 줄이 카드를 보여 준다. 카드가 없는 예전 카드 사용은 '(예전)' 이다.
  if (flow === 'cardSpend' && m.cardId) return 'expense';
  if (flow === 'loanPrincipal') return 'loan';
  return null;
}

/**
 * 흐름을 고른 결과. 들어오는 돈은 생활비에서도 대출에서도 나가지 않고, 대출은 생활비에 걸지
 * 않는다(사용처는 하나다). 대출에는 카테고리를 붙이지 않는다 — 대출이 카테고리였던 자리를
 * 흐름이 대신한다. 카테고리를 흐름마다 지킬지는 부르는 쪽이 정한다(카테고리 목록을 안다).
 */
export function flowPickPatch(pick: FlowPick): Partial<MoneyFields> {
  switch (pick) {
    case 'income': return { type: 'income', flow: 'normal', budgetId: null, debtId: null, outsidePocket: false, cardId: null, cardCycle: null };
    case 'expense': return { type: 'expense', flow: 'normal', cardId: null, cardCycle: null };
    case 'loan': return {
      type: 'expense', flow: 'loanPrincipal', budgetId: null, outsidePocket: false, categoryId: null, cardId: null, cardCycle: null,
    };
  }
}

/**
 * 카드에 걸린 카드 대금의 이름(P4) — '카드 대금 · 생활 카드'. 흐름 칩 줄이 '(예전)' 없이 보여 준다.
 * 카드가 없는 예전 대금은 null(예전 유형으로 보인다).
 */
export function cardPaymentLabel(m: Pick<MoneyFields, 'type' | 'flow' | 'cardId'> | null | undefined, cards: readonly Card[]): string | null {
  if (!m || m.type !== 'expense' || m.flow !== 'cardPayment' || !m.cardId) return null;
  const c = cards.find((x) => x.id === m.cardId);
  return `카드 대금 · ${c ? c.name : '지워진 카드'}`;
}
