/**
 * 금액 계산용 자료가 손에 들어왔는가, 그리고 그것을 얼마나 믿을 수 있는가.
 *
 * ── 왜 네 갈래인가 ──────────────────────────────────────────────
 *
 * 오프라인 지속성 때문에 첫 스냅샷은 대개 로컬 캐시에서 오고, 캐시가 비어 있으면
 * **빈 목록**이 온다. "예정된 입출금이 없다" 와 "아직 서버 것을 못 받았다" 가 같은 값으로
 * 도착하는 셈이다. 그것을 자료 없음으로 읽으면 한도가 잔고 그대로 떴다가 잠시 뒤 값이 튄다.
 *
 * 그렇다고 오프라인에서 화면을 통째로 막지는 않는다. 캐시에 자료가 있으면 그 값으로
 * 보여 주되, **캐시 기준이고 완전하지 않을 수 있다**는 사실을 함께 적는다.
 *
 *   loading      아직 한 건이라도 못 받았다
 *   error        조회가 실패했다 (0원으로 감추지 않는다)
 *   unconfirmed  받기는 받았는데 전부 캐시에서 왔고 전부 비어 있다 —
 *                "없음" 을 확정할 수 없다
 *   ready        숫자를 보여 준다. `fromCache` 면 완전성 한계를 함께 적는다
 */
export type CalcState =
  | { kind: 'ready'; fromCache: boolean; pending: boolean }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unconfirmed' };

export const CALC_READY: CalcState = { kind: 'ready', fromCache: false, pending: false };
export const CALC_LOADING: CalcState = { kind: 'loading' };
export const CALC_ERROR: CalcState = { kind: 'error' };
export const CALC_UNCONFIRMED: CalcState = { kind: 'unconfirmed' };

/** 구독 상태에서 화면이 쓸 갈래를 뽑는다. */
export function calcStateOf(feed: {
  status: 'loading' | 'cache' | 'live' | 'error';
  ready: boolean; empty: boolean; fromCache: boolean; pending: boolean;
}): CalcState {
  if (feed.status === 'error') return CALC_ERROR;
  if (!feed.ready) return CALC_LOADING;
  // 캐시가 비어 있는 것은 자료 없음이 아니다. 그 위에 숫자를 세우지 않는다.
  if (feed.fromCache && feed.empty) return CALC_UNCONFIRMED;
  return { kind: 'ready', fromCache: feed.fromCache, pending: feed.pending };
}

/** 카드 머리글에 접었을 때 적을 한 마디. */
export function calcHeadline(state: Exclude<CalcState, { kind: 'ready' }>): string {
  if (state.kind === 'error') return '불러오지 못함';
  if (state.kind === 'unconfirmed') return '확인 전';
  return '불러오는 중';
}

/** 숫자를 낼 수 없을 때 그 자리에 적을 이유. */
export function calcNotice(state: Exclude<CalcState, { kind: 'ready' }>): string {
  if (state.kind === 'error') {
    return '예정 입출금을 불러오지 못했습니다. 지어낸 숫자를 보여 주지 않기 위해 한도를 비워 둡니다.';
  }
  if (state.kind === 'unconfirmed') {
    return '이 기기에 저장된 자료가 비어 있어 "예정 없음" 인지 "아직 못 받았는지" 를 가릴 수 없습니다. '
      + '연결되면 서버 자료를 받아 한도를 냅니다.';
  }
  return '예정 입출금을 불러오는 중입니다.';
}

/**
 * 숫자는 내되 완전하지 않을 수 있을 때 덧붙이는 한 줄.
 * 확정 상태면 null — 평소에는 아무 말도 하지 않는다.
 */
export function calcCaveat(state: CalcState): string | null {
  if (state.kind !== 'ready') return null;
  if (state.fromCache) {
    return '이 기기에 저장된 자료 기준입니다. 다른 기기에서 적은 것은 아직 빠져 있을 수 있습니다.';
  }
  if (state.pending) return '아직 서버가 확인하지 않은 변경이 섞여 있습니다.';
  return null;
}

/** 통화가 섞여 있어 계산 자체가 성립하지 않을 때. */
export function mixedCurrencyNotice(currencies: readonly string[]): string {
  return `통화가 섞여 있습니다 (${currencies.join(' · ')}). `
    + '이 앱은 한 번에 한 통화만 다룹니다 — 환율 변환을 하지 않으므로 '
    + '서로 다른 통화의 금액을 더하지 않습니다.';
}
