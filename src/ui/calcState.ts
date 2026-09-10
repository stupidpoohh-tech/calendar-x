/**
 * 금액 계산용 자료가 손에 들어왔는가.
 *
 * 오프라인 지속성 때문에 첫 스냅샷은 대개 로컬 캐시에서 오고, 캐시가 비어 있으면
 * **빈 목록**이 온다. 그것을 "예정된 입출금이 없다" 로 읽으면 한도가 잔고 그대로 떴다가
 * 잠시 뒤 값이 튄다. 조회가 실패했을 때는 더 나쁘다 — 0원이 오류를 감춘다.
 *
 * 그래서 카드는 자료가 없는 동안 숫자를 지어내지 않고, 무엇을 기다리는지 적는다.
 */
export type CalcState = 'ready' | 'loading' | 'error';

/** 카드 머리글에 접었을 때 적을 한 마디. */
export function calcHeadline(state: Exclude<CalcState, 'ready'>): string {
  return state === 'error' ? '불러오지 못함' : '불러오는 중';
}

/** 카드 안쪽에 적을 이유. */
export function calcNotice(state: Exclude<CalcState, 'ready'>): string {
  return state === 'error'
    ? '예정 입출금을 불러오지 못했습니다. 지어낸 숫자를 보여 주지 않기 위해 한도를 비워 둡니다.'
    : '예정 입출금을 불러오는 중입니다.';
}
