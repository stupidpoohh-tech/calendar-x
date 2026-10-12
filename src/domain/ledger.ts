/**
 * 원장 — 예정과 실제 거래를 한 모델 위에서 가르는 규칙들.
 *
 * ── 왜 이 파일이 따로 있는가 ──────────────────────────────────
 *
 * 가계부 항목은 원래 전부 "예정" 이었다. 잔고를 옮겨 적으면 그 사이 변동 지출이 정산된
 * 것으로 보고, 지나간 지출은 적지 않았다 (`tide.ts` 머리 주석). 실제 거래를 기록하려면
 * 같은 `Entry{kind:'money'}` 위에 세 가지를 얹어야 한다.
 *
 *   1. 예정인가 실제인가                (`status`)
 *   2. 현금이 움직이는가 · 소비인가       (`flow`)
 *   3. 실제 거래가 어느 예정 회차를 확정했는가 (`plannedRef`)
 *
 * 새 필드는 모두 선택이다. 그 필드가 없던 시절의 문서 · 백업 · 테스트 자료가 그대로
 * 들어오므로, **읽을 때는 반드시 이 파일의 접근자를 거친다.** 없으면 예정 · 일반으로
 * 읽혀 지금까지와 똑같이 계산된다.
 *
 * 이 파일은 `recurrence` · `tide` · `budget` 을 import 하지 않는다. 그쪽이 이쪽을 쓴다.
 */
import { MONEY_TYPE_BY_ID } from './constants';
import { normalizeDate } from './date';
import type {
  Account, DateISO, Entry, MoneyFields, MoneyFlow, MoneyStatus, MoneyType,
} from './types';

// ---------- 접근자 ----------

export const MONEY_STATUSES: readonly MoneyStatus[] = ['planned', 'actual'];

export const MONEY_FLOWS: readonly MoneyFlow[] = [
  'normal', 'loanPrincipal', 'loanInterest', 'transfer', 'cardSpend', 'cardPayment',
];

/** 나가는 돈에만 붙을 수 있는 성격. 들어오는 카드 사용 · 들어오는 대출 이자는 뜻이 없다. */
export const OUTFLOW_ONLY_FLOWS: readonly MoneyFlow[] = [
  'loanPrincipal', 'loanInterest', 'cardSpend', 'cardPayment',
];

export function moneyStatusOf(m: Pick<MoneyFields, 'status'> | null | undefined): MoneyStatus {
  return m?.status === 'actual' ? 'actual' : 'planned';
}

export function moneyFlowOf(m: Pick<MoneyFields, 'flow'> | null | undefined): MoneyFlow {
  const f = m?.flow;
  return f && (MONEY_FLOWS as readonly string[]).includes(f) ? f : 'normal';
}

/** 실제로 일어난 가계부 거래인가. */
export function isActual(e: Pick<Entry, 'kind' | 'money'>): boolean {
  return e.kind === 'money' && moneyStatusOf(e.money) === 'actual';
}

/** 예정 가계부 항목인가. 가계부가 아니면 false. */
export function isPlanned(e: Pick<Entry, 'kind' | 'money'>): boolean {
  return e.kind === 'money' && moneyStatusOf(e.money) === 'planned';
}

// ---------- 현금 부호 · 통계 분류 ----------

/**
 * 현금흐름에서의 부호. 잔고를 늘리면 +1, 줄이면 −1, 건드리지 않으면 0.
 *
 * 기본은 종류(`type`)의 부호 그대로다 — legacy 종류도 지금까지와 같은 뜻을 지킨다.
 * 예외는 **카드 사용** 하나다. 그날 현금은 나가지 않고, 나중에 카드 대금(`cardPayment`)
 * 으로 한 번에 나간다. 둘 다 −1 로 세면 같은 돈이 두 번 빠진다.
 */
export function cashSignOf(e: Pick<Entry, 'kind' | 'money'>): -1 | 0 | 1 {
  if (e.kind !== 'money' || !e.money) return 0;
  if (moneyFlowOf(e.money) === 'cardSpend') return 0;
  return MONEY_TYPE_BY_ID[e.money.type]?.sign ?? 0;
}

/**
 * 결산 · 통계에서 이 거래가 들어갈 자리.
 *
 *   income        수입
 *   consumption   소비 — 일반 지출 · 카드 사용
 *   financeCost   금융비용 — 대출 이자
 *   principal     대출 원금 상환 — 현금은 나가지만 소비가 아니다
 *   transfer      저축 · 이체 — 소비도 수입도 아니다
 *   cardPayment   카드 대금 — 사용한 날 이미 소비로 셌으므로 또 세지 않는다
 *   none          현금도 소비도 아니다 (legacy `save` · `free`)
 *   unclassified  legacy `repay` · `priority` · `living` — 무엇인지 코드로 정할 수 없다
 *
 * legacy 종류를 추정하지 않는다. `repay` 가 원금인지 이자인지, `priority` 가 대출 상환인지
 * 일반 지출인지는 저장된 값에 없다. 확정할 때 사용자가 고르게 한다 (`confirm.ts`).
 */
export type LedgerClass =
  | 'income' | 'consumption' | 'financeCost' | 'principal' | 'transfer'
  | 'cardPayment' | 'none' | 'unclassified';

const LEGACY_UNCLASSIFIED: readonly MoneyType[] = ['repay', 'priority', 'living'];

export function ledgerClassOf(e: Pick<Entry, 'kind' | 'money'>): LedgerClass | null {
  if (e.kind !== 'money' || !e.money) return null;
  const flow = moneyFlowOf(e.money);
  switch (flow) {
    case 'cardSpend': return 'consumption';
    case 'cardPayment': return 'cardPayment';
    case 'loanPrincipal': return 'principal';
    case 'loanInterest': return 'financeCost';
    case 'transfer': return 'transfer';
    case 'normal': break;
  }
  const type = e.money.type;
  if (type === 'income') return 'income';
  if (type === 'expense') return 'consumption';
  if (LEGACY_UNCLASSIFIED.includes(type)) return 'unclassified';
  return 'none';
}

// ---------- 예정 회차 확정 ----------

/** 확정 회차를 가리키는 키. 예정 원본 id 와 회차 날짜로 정해진다. */
export function confirmedKey(entryId: string, date: DateISO): string {
  return `${entryId}|${date}`;
}

/**
 * 이미 실제 거래로 확정된 예정 회차들.
 *
 * 연결은 **실제 거래 쪽에만** 있다 (`money.plannedRef`). 예정 문서와 반복 규칙은
 * 확정할 때 건드리지 않으므로, 이 집합에서 빠지는 순간(실제 거래를 지우는 순간) 그
 * 회차는 예정으로 돌아온다.
 *
 * 계산과 화면은 같은 목록에서 이 집합을 만들어 그 회차를 건너뛴다. 목록이 그 실제
 * 거래를 담고 있어야 하므로, 실제 거래의 `ymSpan` 에는 회차의 달도 들어 있다
 * (`entry.ts` 의 `withDerived`).
 */
export function confirmedSetOf(entries: readonly Entry[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (!isActual(e)) continue;
    const ref = e.money?.plannedRef;
    const date = normalizeDate(ref?.date);
    if (ref && typeof ref.entryId === 'string' && ref.entryId && date) {
      out.add(confirmedKey(ref.entryId, date));
    }
  }
  return out;
}

export const EMPTY_CONFIRMED: ReadonlySet<string> = new Set();

/**
 * 회차를 확정한 실제 거래의 문서 id.
 *
 * **같은 회차는 언제나 같은 id 다.** 두 번 확정해도, 두 기기에서 동시에 확정해도 문서는
 * 하나로 모인다 — 중복 거래가 생길 자리가 없다. 오프라인에서도 평범한 저장으로 지킨다.
 *
 * 구분자는 `~` 다. `@` 를 쓰면 `baseIdOf()` 가 그것을 반복 전개분으로 읽어 예정 원본 id
 * 로 바꾸고, 편집·삭제가 실제 거래가 아니라 **예정 시리즈**를 향한다 (`App.tsx` 의
 * openEdit · handleDelete).
 */
export const CONFIRM_SEP = '~';

export function confirmedEntryId(planId: string, date: DateISO): string {
  return `${planId}${CONFIRM_SEP}${date}`;
}

// ---------- 잔고 반영 판정 ----------

/**
 * 실제 거래가 지금 잔고에 이미 들어 있는가.
 *
 *   in         들어 있다 — 한도에서 또 빼면 두 번 빠진다
 *   out        아직 안 들어 있다 — 한도에서 뺀다
 *   ambiguous  계좌가 여럿이고 어느 계좌의 거래인지 몰라 판정할 수 없다
 *
 * ── 한 계좌 안에서의 규칙 ────────────────────────────────────
 *
 *   거래일 < 기준일                     → in
 *   거래일 = 기준일, 목록에 있다          → in   (`reflectedEntryIds`)
 *   거래일 = 기준일, 목록에 없다          → out
 *   거래일 > 기준일                     → out
 *
 * 같은 날은 날짜로도 생성 시각으로도 가를 수 없다 — 오전 8시에 산 커피를 오후 3시에
 * 적을 수 있다. 그래서 잔고를 적을 때 고른 목록만 믿는다. 고르지 않은 것을 "반영됐다"
 * 고 보지 않는다.
 *
 * ── 계좌가 여럿일 때 ──────────────────────────────────────────
 *
 * 어느 계좌의 거래인지는 다음 순서로 정한다.
 *   1. `money.accountId` 가 있고 그 계좌가 있으면 그 계좌
 *   2. 어느 계좌의 반영 목록에 들어 있으면 그 계좌 (사용자가 "이 잔고에 들어 있다" 고 고른 것)
 *   3. 모르면 **모든 계좌에서 판정해 결과가 같을 때만** 그 결과를 쓴다
 *
 * 3번에서 결과가 갈리면 `ambiguous` 다. 기준일이 9/1 인 계좌와 9/10 인 계좌가 있고
 * 9/5 거래의 계좌를 모르면, 9/10 계좌의 것이면 이미 들어 있고 9/1 계좌의 것이면 아니다.
 * 넘겨짚지 않고 그렇다고 말한다 — 화면은 금액을 확정하지 않는다 (`tide.calcScopeOf`).
 */
export type BalanceInclusion = 'in' | 'out' | 'ambiguous';

export function balanceInclusion(
  e: Pick<Entry, 'id' | 'startDate' | 'money'>, accounts: readonly Account[],
): BalanceInclusion {
  if (accounts.length === 0) return 'out';
  const date = normalizeDate(e.startDate);

  const inAccount = (a: Account): boolean => {
    const asOf = normalizeDate(a.asOf);
    if (!asOf || !date) return false;
    if (date < asOf) return true;
    return date === asOf && (a.reflectedEntryIds ?? []).includes(e.id);
  };

  const assigned = e.money?.accountId
    ? accounts.find((a) => a.id === e.money?.accountId)
    : undefined;
  const reflectedIn = accounts.find(
    (a) => normalizeDate(a.asOf) === date && (a.reflectedEntryIds ?? []).includes(e.id),
  );
  const owner = assigned ?? reflectedIn;
  if (owner) return inAccount(owner) ? 'in' : 'out';

  let sawIn = false;
  let sawOut = false;
  for (const a of accounts) {
    if (inAccount(a)) sawIn = true; else sawOut = true;
  }
  if (sawIn && sawOut) return 'ambiguous';
  return sawIn ? 'in' : 'out';
}

/**
 * 잔고 반영 여부를 판정할 수 없는 실제 거래.
 *
 * 현금이 움직이지 않는 거래(카드 사용)는 한도와 무관하므로 세지 않는다.
 */
export function ambiguousActuals(
  accounts: readonly Account[], entries: readonly Entry[],
): Entry[] {
  if (accounts.length < 2) return [];
  return entries.filter((e) =>
    isActual(e) && cashSignOf(e) !== 0 && balanceInclusion(e, accounts) === 'ambiguous');
}

/**
 * 이 계좌의 오늘 잔고에 들어 있을 수 있는 실제 거래 — 잔고를 적을 때 고르는 목록.
 *
 * 다른 계좌로 정한 거래, 계좌를 정하지 않았지만 다른 계좌의 오늘 목록에 이미 골라진 거래는
 * 빠진다(그 계좌의 것이다). 현금이 움직이지 않는 거래(카드 사용)도 빠진다.
 */
export function reflectableOn(
  account: Account | null, accounts: readonly Account[], entries: readonly Entry[], today: string,
): Entry[] {
  if (!account) return [];
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.id) || !isActual(e) || cashSignOf(e) === 0 || e.startDate !== today) return false;
    const owner = e.money?.accountId;
    const known = owner ? accounts.some((a) => a.id === owner) : false;
    if (known && owner !== account.id) return false;
    // 계좌를 정하지 않은 거래가 다른 계좌의 오늘 잔고에 이미 들어 있다고 골라져 있으면 그 계좌의 것이다.
    if (!known && accounts.some((a) => a.id !== account.id && a.asOf === today
      && (a.reflectedEntryIds ?? []).includes(e.id))) return false;
    seen.add(e.id);
    return true;
  });
}
