/** 거래 유형의 이름과 설명. 입력 칸과 내역 화면이 같은 말을 쓴다. */
import { OUTFLOW_ONLY_FLOWS } from '../domain/ledger';
import type { MoneyFlow } from '../domain/types';

/** 흐름별로 고를 수 있는 거래 유형. 카드 · 대출은 나가는 돈에만 뜻이 있다. */
export const FLOW_OPTIONS: readonly { id: MoneyFlow; label: string; hint: string }[] = [
  { id: 'normal', label: '일반', hint: '현금 · 체크카드 · 계좌이체로 바로 나가거나 들어온 돈' },
  { id: 'cardSpend', label: '카드 사용', hint: '신용카드로 쓴 돈. 소비로 세고, 현금은 카드 대금 날에 나갑니다' },
  { id: 'cardPayment', label: '카드 대금', hint: '카드값 결제. 쓴 날 이미 소비로 셌으므로 소비에 다시 넣지 않습니다' },
  { id: 'loanPrincipal', label: '대출 원금', hint: '빚이 줄어드는 돈. 현금은 나가지만 소비가 아닙니다' },
  { id: 'loanInterest', label: '대출 이자', hint: '금융비용. 소비와 따로 집계합니다' },
  { id: 'transfer', label: '이체 · 저축', hint: '내 계좌 사이의 이동. 수입도 소비도 아닙니다' },
];

export function flowLabel(flow: MoneyFlow): string {
  return FLOW_OPTIONS.find((f) => f.id === flow)?.label ?? '일반';
}

export function flowsFor(type: 'income' | 'expense'): typeof FLOW_OPTIONS {
  return type === 'income'
    ? FLOW_OPTIONS.filter((f) => !(OUTFLOW_ONLY_FLOWS as readonly MoneyFlow[]).includes(f.id))
    : FLOW_OPTIONS;
}
