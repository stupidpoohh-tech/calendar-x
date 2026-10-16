/**
 * 예정 회차를 실제 거래로 확정한다.
 *
 * ── 무엇을 만들고 무엇을 건드리지 않는가 ───────────────────────
 *
 * 확정은 **실제 거래 한 건을 새로 만드는 것**이다. 예정 원본과 반복 규칙은 건드리지
 * 않는다 — 9월 월세를 확정해도 10월 · 11월 회차와 반복 규칙은 그대로다. 연결은 실제
 * 거래 쪽의 `plannedRef` 하나뿐이고, 계산과 화면은 그것을 보고 그 회차를 건너뛴다
 * (`ledger.confirmedSetOf`). 그래서 **확정 취소는 실제 거래를 지우는 것**이고, 지우는
 * 순간 회차가 예정으로 돌아온다. 되돌릴 상태가 따로 없다.
 *
 * 실제 거래의 id 는 회차로 정해진다 (`ledger.confirmedEntryId`). 같은 회차를 두 번
 * 확정해도, 두 기기에서 동시에 확정해도 문서는 하나다.
 *
 * ── 확정하지 않는 것 ──────────────────────────────────────────
 *
 *   span                  기간 예정. 하루 몫으로 쪼개 세는 흐름이라 "그 회차" 가 없다
 *   legacy-unconfirmable  legacy 생활비 · 저축 · 가용 — 현금 거래가 아니거나 주머니다
 *   legacy-needs-choice   legacy 상환 · 우선 — 원금인지 이자인지 일반 지출인지 저장된
 *                         값에 없다. 사용자가 종류와 흐름을 고르기 전에는 만들지 않는다
 *
 * 이 파일은 순수 함수만 담는다. 저장은 부르는 쪽이 평소 경로(`saveEntry`)로 한다.
 */
import { normalizeDate, ymOf } from './date';
import { newEntry, newMoney, withDerived } from './entry';
import {
  confirmedEntryId, confirmedKey, confirmedSetOf, isActual, moneyFlowOf, OUTFLOW_ONLY_FLOWS,
} from './ledger';
import { expandEntry, isVirtualEntry } from './recurrence';
import type { Account, Budget, DateISO, Entry, MoneyFlow, MoneyType } from './types';

export type ConfirmRefusal =
  | 'not-money'
  | 'virtual'
  | 'already-actual'
  | 'span'
  | 'legacy-unconfirmable'
  | 'legacy-needs-choice'
  | 'not-occurrence'
  | 'invalid-flow'
  | 'invalid-amount'
  | 'invalid-date';

/** 확정할 때 실제와 달라진 값. 비우면 예정 값을 그대로 쓴다. */
export interface ConfirmPatch {
  /** 실제로 돈이 움직인 날. 기본은 회차 날짜. */
  date?: DateISO;
  amountMinor?: number;
  /** legacy 상환 · 우선 항목은 반드시 고른다. */
  type?: 'income' | 'expense';
  /** legacy 상환 · 우선 항목은 반드시 고른다. */
  flow?: MoneyFlow;
  title?: string;
  note?: string;
  categoryId?: string | null;
  method?: string | null;
  accountId?: string | null;
  budgetId?: string | null;
  debtId?: string | null;
  /** 사용할 세이브(P3). 예정에 걸어 둔 연결이 기본값이다 — 확정하면 실제 거래가 이어받아 사용액에 들어간다. */
  reserveId?: string | null;
  /** 카드(P4). 예정의 카드가 기본값이다. 카드 사용 · 카드 대금에만 남는다. */
  cardId?: string | null;
  /** 대금이 갚는 회차(P4). 기본은 예정에 적어 둔 회차, 반복 예정이면 그 회차의 달. */
  cardCycle?: string | null;
}

export type ConfirmResult =
  | { ok: true; entry: Entry }
  | { ok: false; reason: ConfirmRefusal };

const UNCONFIRMABLE: readonly MoneyType[] = ['living', 'save', 'free'];
const NEEDS_CHOICE: readonly MoneyType[] = ['repay', 'priority'];

/** 확정할 수 있는 예정 항목인가. 이유가 없으면 null. */
export function confirmBlockOf(plan: Entry): ConfirmRefusal | null {
  if (plan.kind !== 'money' || !plan.money) return 'not-money';
  if (isVirtualEntry(plan)) return 'virtual';
  if (isActual(plan)) return 'already-actual';
  const end = normalizeDate(plan.endDate);
  if (end && end > normalizeDate(plan.startDate)) return 'span';
  if (UNCONFIRMABLE.includes(plan.money.type)) return 'legacy-unconfirmable';
  return null;
}

/** 확정할 때 사용자가 종류 · 흐름을 직접 골라야 하는 legacy 항목인가. */
export function needsTypeChoice(plan: Entry): boolean {
  return !!plan.money && NEEDS_CHOICE.includes(plan.money.type);
}

/** `date` 가 이 예정의 회차인가. 반복은 실제로 전개해서 본다 — 말일 당김까지 같은 규칙이다. */
export function isOccurrenceOf(plan: Entry, date: DateISO): boolean {
  const d = normalizeDate(date);
  if (!d) return false;
  if (!plan.recurrence) return normalizeDate(plan.startDate) === d;
  return expandEntry(plan, d, d).some((o) => o.startDate === d);
}

export function confirmOccurrence(
  plan: Entry, occurrenceDate: DateISO, patch: ConfirmPatch = {},
  now = new Date().toISOString(),
): ConfirmResult {
  const block = confirmBlockOf(plan);
  if (block) return { ok: false, reason: block };
  const m = plan.money!;

  const occ = normalizeDate(occurrenceDate);
  if (!occ || !isOccurrenceOf(plan, occ)) return { ok: false, reason: 'not-occurrence' };

  // legacy 상환 · 우선은 추정하지 않는다. 종류와 흐름을 모두 받아야 만든다.
  if (needsTypeChoice(plan) && (patch.type === undefined || patch.flow === undefined)) {
    return { ok: false, reason: 'legacy-needs-choice' };
  }
  const type: 'income' | 'expense' = patch.type
    ?? (m.type === 'income' ? 'income' : 'expense');
  const flow = patch.flow ?? moneyFlowOf(m);
  if ((OUTFLOW_ONLY_FLOWS as readonly MoneyFlow[]).includes(flow) && type !== 'expense') {
    return { ok: false, reason: 'invalid-flow' };
  }

  const amount = patch.amountMinor ?? m.amountMinor;
  if (!Number.isSafeInteger(amount) || amount < 0) return { ok: false, reason: 'invalid-amount' };

  const date = patch.date === undefined ? occ : normalizeDate(patch.date);
  if (!date) return { ok: false, reason: 'invalid-date' };

  /*
    사용처는 한 번에 하나다. 입금은 주머니에서도 대출에서도 나가지 않고, 카드 사용은
    주머니에 걸지 않는다 (`budget.inBudget`).
  */
  let budgetId = patch.budgetId !== undefined ? patch.budgetId : m.budgetId ?? null;
  let debtId = patch.debtId !== undefined ? patch.debtId : m.debtId ?? null;
  if (patch.budgetId) debtId = null;
  else if (patch.debtId) budgetId = null;
  if (type === 'income') { budgetId = null; debtId = null; }
  if (flow === 'cardSpend') budgetId = null;
  // 세이브(P3)도 사용처 하나다. 주머니 · 대출과 함께 걸리지 않고, 일반 지출에만 남는다.
  let reserveId = patch.reserveId !== undefined ? patch.reserveId : m.reserveId ?? null;
  if (patch.budgetId || patch.debtId) reserveId = null;
  if (reserveId) { budgetId = null; debtId = null; }
  // 카드(P4)는 지출의 카드 사용 · 카드 대금에만 남는다.
  const cardId = type === 'expense' && (flow === 'cardSpend' || flow === 'cardPayment')
    ? (patch.cardId !== undefined ? patch.cardId : m.cardId ?? null) : null;
  const cardCycle = cardId && flow === 'cardPayment'
    ? (patch.cardCycle ?? (!plan.recurrence ? m.cardCycle : null) ?? ymOf(occ)) : null;
  if (type !== 'expense' || !(flow === 'normal' || (flow === 'cardSpend' && cardId))) reserveId = null;

  const entry = newEntry('money', {
    id: confirmedEntryId(plan.id, occ),
    title: patch.title ?? plan.title,
    note: patch.note ?? plan.note,
    color: plan.color,
    tags: [...plan.tags],
    location: plan.location,
    startDate: date,
    startTime: plan.startTime,
    endDate: null,
    endTime: null,
    recurrence: null,
    money: newMoney({
      type,
      amountMinor: amount,
      currency: m.currency,
      linkedEntryId: m.linkedEntryId ?? null,
      budgetId,
      debtId,
      priority: false,
      status: 'actual',
      flow,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : m.categoryId ?? null,
      method: patch.method !== undefined ? patch.method : m.method ?? null,
      accountId: patch.accountId !== undefined ? patch.accountId : m.accountId ?? null,
      plannedRef: { entryId: plan.id, date: occ },
      reserveId,
      outsidePocket: reserveId ? true : m.outsidePocket === true,
      cardId,
      cardCycle,
    }),
    createdAt: now,
  });
  return { ok: true, entry: withDerived(entry, now) };
}

/** 이 회차를 확정한 실제 거래. 없으면 null. 확정 취소는 이것을 지우는 것이다. */
export function confirmationOf(
  entries: readonly Entry[], planId: string, date: DateISO,
): Entry | null {
  const key = confirmedKey(planId, normalizeDate(date));
  return entries.find((e) => isActual(e)
    && e.money?.plannedRef
    && confirmedKey(e.money.plannedRef.entryId, normalizeDate(e.money.plannedRef.date)) === key) ?? null;
}

/** 이 회차가 이미 확정됐는가. */
export function isConfirmed(entries: readonly Entry[], planId: string, date: DateISO): boolean {
  return confirmedSetOf(entries).has(confirmedKey(planId, normalizeDate(date)));
}

/**
 * 실제 거래를 걸 생활비 주머니.
 *
 * 그 날을 품는 주머니가 하나면 그것을 기본으로 고른다. 여럿이면 고르지 않는다 —
 * 어느 주머니에서 나간 돈인지 넘겨짚으면 다른 주머니의 남은 금액이 틀린다. 없으면
 * 일반 지출이다. 무엇이 골라졌는지는 저장 전에 화면이 보여 준다.
 */
export interface PocketChoice {
  selected: Budget | null;
  candidates: Budget[];
}

export function pocketChoiceFor(date: DateISO, budgets: readonly Budget[]): PocketChoice {
  const d = normalizeDate(date);
  const candidates = budgets
    .filter((b) => b.startDate <= d && d <= b.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  return { selected: candidates.length === 1 ? candidates[0]! : null, candidates };
}

// ---------- 예정을 고치면 연결을 잃는 확정 거래 ----------

/**
 * 예정의 날짜 · 반복을 고치면 확정해 둔 실제 거래가 "없는 회차" 를 가리키게 된다.
 *
 * 매월 25일 월세의 10/25 회차를 510,000원으로 확정한 뒤 반복 시작일을 26일로 바꾸면,
 * 실제 거래는 여전히 10/25 회차를 가리키고 10/26 은 확정된 적 없는 새 회차가 된다.
 * 계산은 둘 다 센다 — 실제 510,000원과 예정 500,000원. 잔고 200만원 기준 한도가
 * 149만원에서 99만원으로 떨어졌다(실제로 재현됨).
 *
 * 그래서 예정을 저장하기 **전에** 연결을 잃는 확정 거래를 찾아 보여 주고, 무엇을 할지
 * 사용자가 고르게 한다. 조용히 지우지도, 넘겨짚어 잇지도 않는다.
 *
 *   relink   새 규칙의 회차 하나에 다시 잇는다. 이을 회차는 화면에 날짜로 적어 보여 준다
 *   unlink   예정과의 연결을 끊고 실제 거래로만 남긴다 — 새 회차는 예정으로 다시 센다
 *
 * 어느 쪽이든 실제 거래의 날짜 · 금액 · 분류는 그대로다.
 */
export interface LostConfirmation {
  actual: Entry;
  /** 지금 가리키는 회차 (새 규칙에는 없다). */
  from: DateISO;
  /** 다시 이을 수 있는 새 회차. 없으면 null — 그때는 끊는 것만 고를 수 있다. */
  candidate: DateISO | null;
}

/** 이 예정을 가리키는 확정 거래. */
export function confirmationsOfPlan(entries: readonly Entry[], planId: string): Entry[] {
  return entries.filter((e) => isActual(e) && e.money?.plannedRef?.entryId === planId);
}

/** 그 날짜가 고친 뒤의 예정에서도 확정할 수 있는 회차인가. */
function stillOccurrence(plan: Entry, date: DateISO): boolean {
  return confirmBlockOf(plan) === null && isOccurrenceOf(plan, date);
}

/**
 * 반복 한 칸(일). 옛 회차에서 **반 칸보다 확실히 가까운** 새 회차만 "같은 회차를 옮긴 것" 으로
 * 제안한다. 25일 → 10일처럼 앞뒤 어느 쪽 회차인지 애매하면(15일 대 16일) 제안하지 않는다.
 */
function stepDays(plan: Entry): number {
  const r = plan.recurrence;
  if (!r) return Infinity;
  const days = r.freq === 'daily' ? 1 : r.freq === 'weekly' ? 7 : 30;
  return days * Math.max(1, r.interval);
}

const dayDiff = (a: DateISO, b: DateISO) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * 고친 뒤의 예정(`after`)에서 연결을 잃는 확정 거래.
 *
 * 다시 이을 후보는 반 칸보다 가까운 새 회차다(반복이 아니면 새 날짜).
 * 이미 다른 실제 거래가 확정한 회차나, 앞의 거래에 먼저 돌아간 회차는 후보가 되지 않는다 —
 * 한 회차를 두 거래가 가리키면 같은 돈을 두 번 센다.
 */
export function lostConfirmations(after: Entry, confirmations: readonly Entry[]): LostConfirmation[] {
  const mine = confirmations.filter((e) => e.money?.plannedRef?.entryId === after.id);
  const taken = new Set<string>();
  const lost: Entry[] = [];
  for (const e of mine) {
    const from = normalizeDate(e.money!.plannedRef!.date);
    if (from && stillOccurrence(after, from)) taken.add(from);
    else lost.push(e);
  }
  lost.sort((a, b) => a.money!.plannedRef!.date.localeCompare(b.money!.plannedRef!.date));

  return lost.map((actual) => {
    const from = normalizeDate(actual.money!.plannedRef!.date);
    let candidate: DateISO | null = null;
    if (confirmBlockOf(after) === null) {
      if (!after.recurrence) {
        const d = normalizeDate(after.startDate);
        candidate = d && !taken.has(d) ? d : null;
      } else {
        const step = stepDays(after);
        const near = expandEntry(after, addDaysOf(from, -step), addDaysOf(from, step))
          .map((o) => o.startDate)
          .filter((d) => !taken.has(d) && Math.abs(dayDiff(d, from)) * 2 < step)
          .sort((a, b) => Math.abs(dayDiff(a, from)) - Math.abs(dayDiff(b, from)) || b.localeCompare(a));
        candidate = near[0] ?? null;
      }
    }
    if (candidate) taken.add(candidate);
    return { actual, from, candidate };
  });
}

function addDaysOf(iso: DateISO, n: number): DateISO {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface LinkRepair {
  /** 지울 옛 문서 id. */
  removeId: string;
  /** 새로 쓸 실제 거래 — 날짜 · 금액 · 분류는 그대로, id 와 연결만 바뀐다. */
  entry: Entry;
}

/**
 * 고르신 대로 실제 거래를 고친다.
 *
 * 어느 쪽이든 **id 가 바뀐다.** 확정 거래의 id 는 회차로 정해져 있어야(`예정id~날짜`)
 * 두 기기에서 같은 회차를 확정해도 문서가 하나로 모인다. 다시 이으면 새 회차의 id 로,
 * 끊으면 회차와 무관한 새 id 로 옮긴다 — 옛 id 를 그대로 두면 나중에 그 날짜를 다시
 * 확정할 때 같은 문서를 덮어써 이 거래를 잃는다. 그래서 옛 문서 삭제와 새 문서 쓰기는
 * 예정 저장과 **한 배치**로 나가야 한다(부르는 쪽 몫).
 */
export function repairLink(
  lost: LostConfirmation, choice: 'relink' | 'unlink', planId: string, newId: () => string,
  now = new Date().toISOString(),
): LinkRepair {
  const a = lost.actual;
  const relink = choice === 'relink' && lost.candidate !== null;
  const entry: Entry = {
    ...a,
    id: relink ? confirmedEntryId(planId, lost.candidate!) : newId(),
    money: { ...a.money!, plannedRef: relink ? { entryId: planId, date: lost.candidate! } : null },
    updatedAt: now,
  };
  return { removeId: a.id, entry: withDerived(entry, now) };
}

/**
 * 백업 병합에서 같은 회차를 두 번 세게 될 확정 거래.
 *
 * 다시 잇거나 끊으면 옛 id 가 사라진다. 그 전에 받아 둔 백업을 다시 가져오면 옛 id 는
 * "없는 문서" 라 새로 만들어지고, 같은 돈이 두 번 세어진다. 그래서 들어올 확정 거래 중
 *   - 이미 같은 회차를 확정한 다른 문서가 있거나
 *   - 가리키는 예정은 있는데 그 날짜가 더 이상 회차가 아닌 것
 * 은 넣지 않고 따로 센다. 예정 자체가 없으면(지운 예정) 그대로 넣는다 — 그때는 겹칠
 * 예정 회차가 없다.
 */
export function conflictingConfirmations(current: readonly Entry[], incoming: readonly Entry[]): Set<string> {
  const have = new Set(current.map((e) => e.id));
  const plans = new Map<string, Entry>();
  for (const e of incoming) if (e.kind === 'money' && !isActual(e)) plans.set(e.id, e);
  for (const e of current) if (e.kind === 'money' && !isActual(e)) plans.set(e.id, e); // 지금 것이 이긴다
  const keys = new Set(confirmedSetOf(current));
  const out = new Set<string>();
  for (const e of incoming) {
    if (have.has(e.id) || !isActual(e)) continue;
    const ref = e.money?.plannedRef;
    const date = normalizeDate(ref?.date);
    if (!ref || !date) continue;
    const key = confirmedKey(ref.entryId, date);
    const plan = plans.get(ref.entryId);
    if (keys.has(key) || (plan && !stillOccurrence(plan, date))) { out.add(e.id); continue; }
    keys.add(key);
  }
  return out;
}

/**
 * id 가 바뀐 거래를 계좌의 반영 목록에서도 바꾼다.
 *
 * 잔고를 적은 날 당일의 거래는 반영 목록(`reflectedEntryIds`)에 든 것만 잔고 안이다.
 * id 를 옮기고 목록을 그대로 두면 그 거래가 잔고 밖으로 떨어져 한도에서 한 번 더 빠진다.
 * 바뀐 계좌만 돌려준다.
 */
export function reflectedAfterRename(
  accounts: readonly Account[], renamed: ReadonlyMap<string, string>, now = new Date().toISOString(),
): Account[] {
  const out: Account[] = [];
  for (const a of accounts) {
    const ids = a.reflectedEntryIds ?? [];
    if (!ids.some((id) => renamed.has(id))) continue;
    out.push({ ...a, reflectedEntryIds: ids.map((id) => renamed.get(id) ?? id), updatedAt: now });
  }
  return out;
}

/** 이 편집이 예정의 회차를 바꿀 수 있는가 — 날짜 · 기간 · 반복 · 종류 · 상태. 금액 · 제목만 고치면 아니다. */
export function planScheduleChanged(before: Entry, after: Entry): boolean {
  if (before.kind !== 'money' || !before.money || isActual(before)) return false;
  return before.startDate !== after.startDate
    || (before.endDate ?? null) !== (after.endDate ?? null)
    || JSON.stringify(before.recurrence ?? null) !== JSON.stringify(after.recurrence ?? null)
    || after.kind !== 'money'
    || isActual(after)
    || before.money.type !== after.money?.type;
}
