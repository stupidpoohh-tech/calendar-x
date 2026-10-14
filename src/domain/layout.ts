/**
 * 내 캘린더 구성 — 사용자가 고른 화면 구성. `users/{uid}` 문서의 `layout` 필드 하나다.
 *
 * ── 네 갈래의 설정을 한 객체로 섞지 않는다 ──────────────────────────
 *
 *   FIXED        캘린더(전체 · 캘린더 렌즈). 끄는 자리가 없다
 *   VISIBILITY   가계부 · 노트 · 같이 보기 스위처 — **화면에서 보이는가**만 정한다. 자료 · 계산 ·
 *                권한은 그대로다. 가계부를 숨겨도 거래 · 잔고 · 생활비는 남고 한도 계산도 그대로 돈다
 *   OPERATIONAL  회복 — 실제로 자동 생성이 도는가. 회복 규칙(`recovery.enabled`)이 맡는다. 여기 없다
 *   CONNECTION   같이 보기 보드 연결 — 보드 문서의 member 목록이 맡는다. 여기 없다
 *
 * 스위처를 숨기는 것은 공유를 끊는 것이 아니다. 끊기는 '공유 연결 관리' 에서만 한다.
 *
 * ── 필드가 없으면 지금까지 보던 그대로 ─────────────────────────────
 *
 * 이 필드가 생기기 전의 사용자는 네 렌즈와 스위처를 모두 보고 있었고, 달력 셀에는 예상 잔고가
 * 떴다. 그래서 필드가 없거나 일부만 있으면 **그 값**으로 메운다(`LEGACY_LAYOUT`). 새로 가입한
 * 사람만 가입하는 순간 `NEW_USER_LAYOUT` 을 받는다(달력 금액 기준이 가용 한도).
 */
import { budgetCovers, budgetStates } from './budget';
import { confirmedBalance, limitOn, projectedBalanceOn, type Reservations } from './tide';
import type { Account, DateISO, Entry, LensId } from './types';

/** 현금흐름 달력 셀에 적는 금액. 계산은 그대로이고 무엇을 보여 줄지만 고른다. */
export type CalendarAmount = 'balance' | 'projected' | 'available' | 'pocket';

export interface Layout {
  /** 가계부 렌즈와 그 진입점(가계부 입력 · 가계부 설정 · 전체 렌즈의 가계부 항목). */
  ledger: boolean;
  /** 노트 렌즈(독립 노트 화면). 아이디어 기록 자체와 전체 렌즈 · 입력 창은 그대로다. */
  notes: boolean;
  /** 👤 / 👥 공간 전환. 보드가 있을 때만 뜻이 있다. */
  sharedSwitcher: boolean;
  calendarAmount: CalendarAmount;
}

export const LEGACY_LAYOUT: Layout = { ledger: true, notes: true, sharedSwitcher: true, calendarAmount: 'projected' };
export const NEW_USER_LAYOUT: Layout = { ...LEGACY_LAYOUT, calendarAmount: 'available' };

export const CALENDAR_AMOUNTS: readonly { id: CalendarAmount; label: string; hint: string }[] = [
  { id: 'balance', label: '전체 보유액', hint: '계좌에 적은 잔고의 합(확인 잔고). 오늘 칸에만 적습니다' },
  { id: 'projected', label: '예상 잔고', hint: '확인 잔고 + 그 날까지 적어 둔 입출금. 생활비 · 세이브는 빼지 않습니다' },
  { id: 'available', label: '가용 잔액', hint: '그 날 생활비 · 세이브를 빼고 쓸 수 있는 돈(가용 한도)' },
  { id: 'pocket', label: '생활비 잔여', hint: '그 날을 품는 생활비의 남은 금액(실제로 쓴 돈 기준)' },
];

const AMOUNT_IDS = new Set<string>(CALENDAR_AMOUNTS.map((a) => a.id));

/** 저장된 값(아무 모양이나) → 구성. 없거나 모르는 값은 `LEGACY_LAYOUT` 의 그 칸으로 메운다. */
export function layoutFrom(raw: unknown): Layout {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const bool = (k: keyof Layout) => (typeof o[k] === 'boolean' ? o[k] as boolean : LEGACY_LAYOUT[k] as boolean);
  return {
    ledger: bool('ledger'),
    notes: bool('notes'),
    sharedSwitcher: bool('sharedSwitcher'),
    calendarAmount: typeof o.calendarAmount === 'string' && AMOUNT_IDS.has(o.calendarAmount)
      ? o.calendarAmount as CalendarAmount
      : LEGACY_LAYOUT.calendarAmount,
  };
}

/** 이 렌즈를 지금 구성에서 보이는가. 전체 · 캘린더는 늘 보인다. */
export function lensVisible(lens: LensId, layout: Layout): boolean {
  if (lens === 'money') return layout.ledger;
  if (lens === 'idea') return layout.notes;
  return true;
}

/** 달력 위 한 줄 — 셀의 숫자가 무엇인지 고른 기준대로 적는다. */
export function calendarAmountCaption(mode: CalendarAmount): string {
  switch (mode) {
    case 'balance': return '오늘 칸의 숫자는 전체 보유액(확인 잔고)입니다';
    case 'projected': return '칸의 숫자는 그 날의 예상 잔고입니다 · 생활비 · 세이브는 빼지 않습니다';
    case 'available': return '칸의 숫자는 그 날의 가용 잔액입니다 · 생활비 · 세이브를 뺀 쓸 수 있는 돈';
    case 'pocket': return '칸의 숫자는 그 날을 품는 생활비의 남은 금액입니다';
  }
}

/**
 * 고른 기준으로 그 날 칸에 적을 금액. 적을 것이 없으면 null.
 *
 * **새 계산을 만들지 않는다** — 카드 · 날짜 상세가 이미 쓰는 함수 그대로다.
 *   balance    `confirmedBalance` — 날짜가 없는 값(계좌에 적은 잔고의 합)이라 오늘 칸에만
 *   projected  `projectedBalanceOn`
 *   available  `limitOn` — 날짜 상세의 '생활비 외 가용' 과 같은 값
 *   pocket     그 날을 품는 생활비의 `remainingMinor`(실제로 쓴 돈 기준) 합. 품는 주머니가 없는 날은 비운다
 *
 * 오늘 앞은 적지 않는다(호출하는 쪽이 거른다). `entries` 는 계산용 원본이다.
 */
export function calendarAmountOn(
  mode: CalendarAmount, accounts: readonly Account[], entries: readonly Entry[],
  date: DateISO, today: DateISO, res: Reservations = {},
): number | null {
  switch (mode) {
    case 'balance':
      return date === today ? confirmedBalance(accounts) : null;
    case 'projected':
      return projectedBalanceOn(accounts, entries, date, today);
    case 'available':
      return limitOn(accounts, entries, date, today, res);
    case 'pocket': {
      const covering = (res.budgets ?? []).filter((b) => budgetCovers(b, date));
      if (covering.length === 0) return null;
      return budgetStates(covering, entries, { accounts, today })
        .reduce((t, st) => t + st.remainingMinor, 0);
    }
  }
}
