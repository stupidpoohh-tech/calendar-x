/**
 * 신용카드 — 사용 · 청구 회차 · 납부 · 미결제 (Financial Core P4).
 *
 * ── 두 시점 ────────────────────────────────────────────────
 *
 *   쓴 날     소비가 생긴다. 현금은 그대로다 (`ledger.cashSignOf` 가 카드 사용을 0 으로 센다).
 *   결제일    현금이 나간다. 소비는 더하지 않는다 (`ledgerClassOf` 가 카드 대금을 소비 밖에 둔다).
 *
 * 그 사이의 돈이 **미결제**다. 통장에는 아직 있지만 갚아야 할 빚이라, 쓸 수 있는 돈(가용 한도)에서 미리 빠진다.
 *
 * ── 무엇을 저장하고 무엇을 세는가 ─────────────────────────────
 *
 * 저장하는 것은 카드(`cards` 컬렉션)와 거래에 붙은 두 칸뿐이다 — `money.cardId`(어느 카드), 대금의
 * `money.cardCycle`(어느 청구 회차를 갚는가). 청구 금액 · 납부 금액 · 미결제는 **저장하지 않고 거래에서 센다.**
 * 카운터를 두면 거래를 고치거나 지우거나 다시 보내거나 백업에서 되살릴 때마다 어긋날 자리가 생긴다.
 *
 *   청구 금액(회차)   그 회차 이용 기간에 쓴 **실제** 카드 사용의 합
 *   납부 금액(회차)   그 회차를 가리키는 **실제** 카드 대금의 합 — 일부 납부 · 여러 번 납부가 그대로 더해진다
 *   남은 금액(회차)   max(0, 청구 − 납부). 더 낸 몫은 다른 회차로 넘기지 않는다(`overpaidMinor` 로 따로 적는다)
 *   미결제(카드)      회차들의 남은 금액 합
 *
 * 예정 카드 사용은 아직 빚이 아니다(확정해야 센다). 카드가 정해지지 않은 예전 카드 사용 · 대금은 이 계산에
 * 들어오지 않는다 — 그 거래들이 지금까지 받던 계산(사용 0 · 대금 출금)은 그대로다.
 *
 * ── 왜 회차마다 따로 세는가 ──────────────────────────────────
 *
 * 카드를 쓰다가 중간에 등록하면, 등록 전에 쓴 돈은 적혀 있지 않다("과거 지출은 입력하지 않는다"). 그 돈을 갚는
 * 첫 대금을 카드 전체에서 빼면 등록 뒤에 적은 사용까지 갚은 것처럼 보인다. 대금이 가리키는 회차에서만 빼면
 * 적지 않은 회차는 남은 금액 0 에서 멈추고(더 낸 몫), 적어 둔 회차는 그대로 남는다.
 *
 * 이 파일은 `tide` · `budget` · `recurrence` 를 import 하지 않는다. 한도와의 연결은 `tide.ts` 가 맡는다.
 */
import { addDaysISO, normalizeDate, ymOf } from './date';
import { isActual, moneyFlowOf } from './ledger';
import type { Card, DateISO, Entry, YearMonth } from './types';

export const MAX_PAY_MONTH_OFFSET = 2;

/** 그 달에 없는 날은 말일로. `ym` 은 'YYYY-MM'. */
export function dayIn(ym: YearMonth, day: number): DateISO {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const last = new Date(y, m, 0).getDate();
  const d = Math.min(Math.max(1, Math.trunc(day) || 1), last);
  return `${ym}-${String(d).padStart(2, '0')}`;
}

/** 'YYYY-MM' 에 n 달을 더한다. */
export function addMonthsYm(ym: YearMonth, n: number): YearMonth {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const x = new Date(y, m - 1 + n, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}

/** 청구 회차 하나. 열쇠는 결제하는 달이다. */
export interface CardCycle {
  key: YearMonth;
  /** 이용 기간 첫날 · 마감일(포함). */
  start: DateISO;
  close: DateISO;
  /** 결제일. 휴일로 밀리는 것은 넘겨짚지 않는다. */
  payDate: DateISO;
}

/**
 * 결제일이 마감일보다 뒤에 오도록 한 달 수. 0 을 골랐는데 그 달 결제일이 마감일보다 앞이거나 같으면(말일 보정 포함)
 * 다음 달로 본다 — 마감 전에 그 회차를 갚을 수는 없다.
 */
function payOffsetFor(card: Pick<Card, 'closeDay' | 'payDay' | 'payMonthOffset'>, closeYm: YearMonth): number {
  const off = Math.min(MAX_PAY_MONTH_OFFSET, Math.max(0, Math.trunc(card.payMonthOffset) || 0));
  if (off > 0) return off;
  return dayIn(closeYm, card.payDay) > dayIn(closeYm, card.closeDay) ? 0 : 1;
}

function cycleClosingIn(card: Card, closeYm: YearMonth): CardCycle {
  const close = dayIn(closeYm, card.closeDay);
  const start = addDaysISO(dayIn(addMonthsYm(closeYm, -1), card.closeDay), 1);
  const payYm = addMonthsYm(closeYm, payOffsetFor(card, closeYm));
  return { key: payYm, start, close, payDate: dayIn(payYm, card.payDay) };
}

/** 그 날 쓴 돈이 들어가는 회차. */
export function cycleOfUse(card: Card, date: DateISO): CardCycle {
  const d = normalizeDate(date) || date;
  const ym = ymOf(d);
  return d <= dayIn(ym, card.closeDay) ? cycleClosingIn(card, ym) : cycleClosingIn(card, addMonthsYm(ym, 1));
}

/**
 * 결제하는 달로 회차를 찾는다. 마감 달 = 결제 달 − 결제 달 수. 결제 달 수가 말일 보정으로 바뀌는 경우(0 → 1)까지
 * 맞추려고 두 후보 가운데 그 달에 결제하는 것을 고른다.
 */
export function cycleByKey(card: Card, key: YearMonth): CardCycle {
  for (let back = 0; back <= MAX_PAY_MONTH_OFFSET + 1; back++) {
    const c = cycleClosingIn(card, addMonthsYm(key, -back));
    if (c.key === key) return c;
  }
  return cycleClosingIn(card, addMonthsYm(key, -1));
}

// ---------- 거래 판정 ----------

/** 등록한 카드에 걸린 카드 사용인가 (실제 · 예정 모두). */
export function isCardSpend(e: Pick<Entry, 'kind' | 'money'>): boolean {
  return e.kind === 'money' && moneyFlowOf(e.money) === 'cardSpend' && !!e.money?.cardId;
}

/** 등록한 카드에 걸린 카드 대금인가 (실제 · 예정 모두). */
export function isCardPayment(e: Pick<Entry, 'kind' | 'money'>): boolean {
  return e.kind === 'money' && moneyFlowOf(e.money) === 'cardPayment' && !!e.money?.cardId;
}

const CYCLE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 대금(또는 대금 회차)이 갚는 청구 회차. 적어 둔 값이 있으면 그것, 없으면 그 날짜의 달.
 * 반복 예정은 회차마다 다른 달을 갚으므로 적어 둔 값을 쓰지 않고 회차 날짜의 달로 읽는다.
 */
export function paymentCycleKey(e: Pick<Entry, 'money' | 'recurrence'>, date: DateISO): YearMonth {
  const c = e.money?.cardCycle;
  if (!e.recurrence && typeof c === 'string' && CYCLE_RE.test(c)) return c;
  return ymOf(normalizeDate(date) || date);
}

// ---------- 회차 집계 ----------

export interface CycleState extends CardCycle {
  cardId: string;
  /** 청구 금액 — 이용 기간의 실제 카드 사용 합. */
  billedMinor: number;
  /** 그 회차를 가리키는 실제 카드 대금 합. */
  paidMinor: number;
  /** 남은 금액 = max(0, 청구 − 납부). */
  remainingMinor: number;
  /** 청구보다 더 낸 몫. 다른 회차로 넘기지 않는다. */
  overpaidMinor: number;
  /** 이용 기간이 끝났는가(조회일 기준). 끝나지 않았으면 청구 금액은 아직 늘 수 있다(예상). */
  closed: boolean;
  /** 결제일이 지났는데 남아 있는가. */
  overdue: boolean;
  spends: Entry[];
  payments: Entry[];
}

/** 카드 id → 회차 열쇠 → 상태. 결제일 순. */
export interface CardState {
  card: Card;
  cycles: CycleState[];
  /** 미결제 = 회차들의 남은 금액 합. */
  outstandingMinor: number;
  /** 결제일이 오늘이거나 앞날인, 남은 금액이 있는 가장 이른 회차 — "이번 결제". 없으면 null. */
  next: CycleState | null;
  /** 결제일이 지났는데 남아 있는 회차들. */
  overdue: CycleState[];
}

/** 같은 문서가 두 번 와도 한 번만 센다. */
function unique(entries: readonly Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(e.id) && (seen.add(e.id), true));
}

/**
 * 한 카드의 회차들. `cardEntries` 는 카드에 걸린 거래 **전량**이어야 한다(계산 창으로 거르면 창 밖의
 * 지난 사용 · 대금이 빠져 미결제가 틀린다 — `useStore` 가 날짜 무관 구독으로 받는다).
 */
export function cardState(card: Card, cardEntries: readonly Entry[], today: DateISO): CardState {
  const map = new Map<YearMonth, CycleState>();
  const at = (c: CardCycle): CycleState => {
    let s = map.get(c.key);
    if (!s) {
      s = {
        ...c, cardId: card.id, billedMinor: 0, paidMinor: 0, remainingMinor: 0, overpaidMinor: 0,
        closed: c.close < today, overdue: false, spends: [], payments: [],
      };
      map.set(c.key, s);
    }
    return s;
  };
  for (const e of unique(cardEntries)) {
    if (e.money?.cardId !== card.id) continue;
    const amount = Math.abs(e.money.amountMinor);
    if (isCardSpend(e)) {
      const s = at(cycleOfUse(card, e.startDate));
      s.spends.push(e);
      if (isActual(e)) s.billedMinor += amount;
    } else if (isCardPayment(e) && !e.recurrence) {
      const s = at(cycleByKey(card, paymentCycleKey(e, e.startDate)));
      s.payments.push(e);
      if (isActual(e)) s.paidMinor += amount;
    }
  }
  const cycles = [...map.values()].sort((a, b) => a.payDate.localeCompare(b.payDate));
  for (const s of cycles) {
    s.remainingMinor = Math.max(0, s.billedMinor - s.paidMinor);
    s.overpaidMinor = Math.max(0, s.paidMinor - s.billedMinor);
    s.overdue = s.remainingMinor > 0 && s.payDate < today;
    const byDate = (a: Entry, b: Entry) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title);
    s.spends.sort(byDate);
    s.payments.sort(byDate);
  }
  return {
    card,
    cycles,
    outstandingMinor: cycles.reduce((t, s) => t + s.remainingMinor, 0),
    next: cycles.find((s) => s.remainingMinor > 0 && s.payDate >= today) ?? null,
    overdue: cycles.filter((s) => s.overdue),
  };
}

export function cardStates(cards: readonly Card[], cardEntries: readonly Entry[], today: DateISO): CardState[] {
  return cards.map((c) => cardState(c, cardEntries, today));
}

/** `카드id|회차` → 남은 금액. 남은 것이 있는 회차만. 한도 계산(`tide.ts`)이 쓴다. */
export function cardRemainders(
  cards: readonly Card[], cardEntries: readonly Entry[], today: DateISO,
): Map<string, { remainingMinor: number; payDate: DateISO }> {
  const out = new Map<string, { remainingMinor: number; payDate: DateISO }>();
  for (const st of cardStates(cards, cardEntries, today)) {
    for (const c of st.cycles) {
      if (c.remainingMinor > 0) out.set(cycleRef(c.cardId, c.key), { remainingMinor: c.remainingMinor, payDate: c.payDate });
    }
  }
  return out;
}

export function cycleRef(cardId: string, key: YearMonth): string {
  return `${cardId}|${key}`;
}

/**
 * 새 대금을 적을 때 고를 회차 — 남은 금액이 있는 가장 이른 회차. 없으면 그 날짜에 결제하는 회차.
 */
export function defaultPaymentCycle(st: CardState, date: DateISO): YearMonth {
  const open = st.cycles.find((c) => c.remainingMinor > 0);
  if (open) return open.key;
  return ymOf(normalizeDate(date) || date);
}

// ---------- 중복 가능성 — 카드에 연결되지 않은 예정 카드대금 ----------

/** 제목으로 카드대금처럼 보이는가. 넓게 잡지 않는다 — '카드지갑' 같은 지출을 붙잡지 않게. */
const CARD_PAYMENT_TITLE = /카드\s*(값|대금|결제|청구)/;

/**
 * 카드를 등록하기 전부터 적어 둔 예정 카드대금 — 카드에 연결되지 않아 미결제와 따로 빠진다.
 *
 * 카드 사용을 적기 시작하면 그 회차의 빚은 카드 미결제가 지키는데, 같은 돈을 '매월 25일 카드값' 같은 예정이 한 번 더
 * 뺄 수 있다. **자동으로 바꾸지 않는다** — 이 함수는 후보만 고르고, 연결은 사용자가 고른다. 고르는 것은 아직 끝나지
 * 않은(앞날 회차가 남은) 예정 가운데 흐름이 카드 대금이거나 제목이 카드대금처럼 보이는 지출뿐이다.
 */
export function suspectCardPayments(entries: readonly Entry[], today: DateISO): Entry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const m = e.money;
    if (e.kind !== 'money' || !m || isActual(e) || m.type !== 'expense' || m.cardId || seen.has(e.id)) return false;
    if ((e as Entry & { virtual?: boolean }).virtual) return false;
    const flow = moneyFlowOf(m);
    const looks = flow === 'cardPayment' || (flow === 'normal' && CARD_PAYMENT_TITLE.test(e.title));
    if (!looks) return false;
    const live = e.recurrence
      ? !e.recurrence.until || e.recurrence.until >= today
      : (e.endDate ?? e.startDate) >= today;
    if (live) seen.add(e.id);
    return live;
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));
}

/**
 * 예정을 카드대금으로 잇는다 — 사용자가 고른 뒤에만 부른다. 흐름 · 카드만 바꾸고 금액 · 날짜 · 반복은 그대로다.
 * 반복 예정은 회차마다 그 달을 갚으므로 회차를 박지 않는다. 대금은 생활비 · 세이브에 걸리지 않는다.
 */
export function linkPlannedToCard(e: Entry, cardId: string, now = new Date().toISOString()): Entry {
  return {
    ...e,
    updatedAt: now,
    money: {
      ...e.money!,
      flow: 'cardPayment', cardId,
      cardCycle: e.recurrence ? null : ymOf(normalizeDate(e.startDate) || e.startDate),
      budgetId: null, reserveId: null, debtId: null,
    },
  };
}

// ---------- 카드 · 정렬 ----------

export function newCard(over: Partial<Card> = {}, now = new Date().toISOString()): Card {
  const id = over.id ?? `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id, name: '', closeDay: 31, payDay: 25, payMonthOffset: 1, accountId: null,
    currency: 'KRW', order: 0, archivedAt: null, createdAt: now, updatedAt: now, ...over,
  };
}

export function activeCards(cards: readonly Card[]): Card[] {
  return cards.filter((c) => !c.archivedAt).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function archivedCards(cards: readonly Card[]): Card[] {
  return cards.filter((c) => !!c.archivedAt).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** 카드 설정이 말이 되는가. 0 달 뒤 결제는 결제일이 마감일보다 뒤여야 한다. */
export function cardProblem(c: Pick<Card, 'name' | 'closeDay' | 'payDay' | 'payMonthOffset'>): string | null {
  if (!c.name.trim()) return '카드 이름을 적어 주세요.';
  for (const [v, label] of [[c.closeDay, '마감일'], [c.payDay, '결제일']] as const) {
    if (!Number.isInteger(v) || v < 1 || v > 31) return `${label}은 1~31 사이의 날입니다.`;
  }
  if (!Number.isInteger(c.payMonthOffset) || c.payMonthOffset < 0 || c.payMonthOffset > MAX_PAY_MONTH_OFFSET) {
    return '결제하는 달을 골라 주세요.';
  }
  if (c.payMonthOffset === 0 && c.payDay <= c.closeDay) return '마감한 그 달에 결제하려면 결제일이 마감일보다 뒤여야 합니다.';
  return null;
}

/** '11월 25일'. 결제일은 달이 바뀌는 날이라 요일보다 달이 먼저다. */
export function fmtMonthDay(iso: DateISO): string {
  return `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
}

/** "전월 1일 ~ 말일 · 다음 달 25일" 같은 한 줄. */
export function describeCycle(c: Pick<Card, 'closeDay' | 'payDay' | 'payMonthOffset'>): string {
  const close = c.closeDay >= 28 && c.closeDay === 31 ? '말일' : `${c.closeDay}일`;
  const month = ['그 달', '다음 달', '다다음 달'][c.payMonthOffset] ?? '다음 달';
  return `매월 ${close} 마감 · ${month} ${c.payDay >= 31 ? '말일' : `${c.payDay}일`} 결제`;
}
