import {
  type ISODate,
  addDays,
  addMonths,
  compareDate,
  dateOfInstant,
  dayInMonth,
  diffDays,
  fromISODate,
  toISODate,
} from './date';
import type { Entry, State } from './types';

/**
 * 예정 한 건의 하루 발생분. amount는 그 날 몫(양수)이다.
 * once/monthly/every는 entry.amount 그대로, span(기간 예산)은 일할 몫이다.
 */
export type Occurrence = { date: ISODate; entry: Entry; amount: number };

/**
 * (after, through] 구간에 잡히는 예정 입금·출금.
 * 시작은 열려 있고 끝은 닫혀 있다 — "오늘 이후 ~ d일까지"가 그대로 이 모양이다.
 */
export function occurrences(entries: Entry[], after: ISODate, through: ISODate): Occurrence[] {
  if (entries.length === 0 || compareDate(after, through) >= 0) return [];

  const out: Occurrence[] = [];

  for (const entry of entries) {
    const s = entry.schedule;

    if (s.type === 'once') {
      if (compareDate(s.date, after) > 0 && compareDate(s.date, through) <= 0) {
        out.push({ date: s.date, entry, amount: entry.amount });
      }
    } else if (s.type === 'span') {
      // 기간 예산: 하루 몫으로 나눠 깔되, 나머지는 마지막 날에 몰아준다.
      // 그래야 마지막 날이 지나는 순간 합이 정확히 총액이 된다.
      const spanDays = diffDays(s.start, s.end) + 1;
      const perDay = Math.floor(entry.amount / spanDays);
      const firstCountable = addDays(after, 1);
      const from = compareDate(s.start, firstCountable) > 0 ? s.start : firstCountable;
      const to = compareDate(s.end, through) <= 0 ? s.end : through;
      for (let d = from; compareDate(d, to) <= 0; d = addDays(d, 1)) {
        const amount = d === s.end ? entry.amount - perDay * (spanDays - 1) : perDay;
        out.push({ date: d, entry, amount });
      }
    } else if (s.type === 'every') {
      if (s.days < 1) continue; // 잘못된 데이터로 무한 루프를 돌지 않게
      // anchor + k·days 중 after보다 뒤인 첫 k로 바로 점프한다.
      const gap = diffDays(s.anchor, after);
      const k = gap >= 0 ? Math.floor(gap / s.days) + 1 : 0;
      let date = addDays(s.anchor, k * s.days);
      while (compareDate(date, through) <= 0) {
        out.push({ date, entry, amount: entry.amount });
        date = addDays(date, s.days);
      }
    } else {
      // monthly: 구간에 걸친 달을 돌며 그 달의 지정일(없으면 말일)을 잡는다.
      const start = fromISODate(after);
      const end = fromISODate(through);
      let cursor = { year: start.getFullYear(), month0: start.getMonth() };
      const lastMonth = end.getFullYear() * 12 + end.getMonth();
      while (cursor.year * 12 + cursor.month0 <= lastMonth) {
        const date = dayInMonth(cursor.year, cursor.month0, s.day);
        if (compareDate(date, after) > 0 && compareDate(date, through) <= 0) {
          out.push({ date, entry, amount: entry.amount });
        }
        cursor = addMonths(cursor.year, cursor.month0, 1);
      }
    }
  }

  out.sort((a, b) => compareDate(a.date, b.date) || a.entry.name.localeCompare(b.entry.name));
  return out;
}

/** 입금은 더하고 출금은 뺀 순액. */
export function netOf(list: Occurrence[]): number {
  return list.reduce((t, o) => t + (o.entry.kind === 'income' ? o.amount : -o.amount), 0);
}

export function totalIn(list: Occurrence[]): number {
  return list.reduce((t, o) => (o.entry.kind === 'income' ? t + o.amount : t), 0);
}

export function totalOut(list: Occurrence[]): number {
  return list.reduce((t, o) => (o.entry.kind === 'expense' ? t + o.amount : t), 0);
}

/**
 * 목록 표시용 요약. 기간 예산의 하루 발생분들은 한 줄로 합친다 —
 * 계산은 일할이지만 사용자에게 쪼갠 숫자를 보여주지 않는다는 약속.
 */
export type Summary = { key: string; entry: Entry; from: ISODate; to: ISODate; amount: number };

export function summarize(list: Occurrence[]): Summary[] {
  const out: Summary[] = [];
  const spans = new Map<string, Summary>();
  for (const o of list) {
    if (o.entry.schedule.type === 'span') {
      const g = spans.get(o.entry.id);
      if (g) {
        g.to = o.date;
        g.amount += o.amount;
      } else {
        const item = { key: o.entry.id, entry: o.entry, from: o.date, to: o.date, amount: o.amount };
        spans.set(o.entry.id, item);
        out.push(item);
      }
    } else {
      out.push({ key: `${o.date}-${o.entry.id}`, entry: o.entry, from: o.date, to: o.date, amount: o.amount });
    }
  }
  return out;
}

/** (after, through] 구간의 순액. */
export function netBetween(entries: Entry[], after: ISODate, through: ISODate): number {
  return netOf(occurrences(entries, after, through));
}

/**
 * 머리 숫자의 끝점. 급여일 설정은 없고, 급여도 그냥 예정 입금이다.
 * 다음 예정 입금이 있으면 그 전날까지, 없으면 30일 기준으로 본다.
 */
export type Horizon = { end: ISODate; nextIncome: ISODate | null };

/** 매달 반복이 말일로 당겨져도 최소 한 번은 잡히는 넉넉한 탐색 범위. */
const SEARCH_DAYS = 400;
const FALLBACK_DAYS = 30;

export function horizonOf(entries: Entry[], today: ISODate): Horizon {
  // 기간 예산은 "입금일"이 아니라 흐름이므로 주기 기준에서 뺀다 —
  // 매일 조금씩 들어오는 걸 기준 삼으면 끝점이 늘 내일이 돼 버린다.
  const incomes = entries.filter((e) => e.kind === 'income' && e.schedule.type !== 'span');
  const next = occurrences(incomes, today, addDays(today, SEARCH_DAYS))[0]?.date;
  if (next) return { end: addDays(next, -1), nextIncome: next };
  return { end: addDays(today, FALLBACK_DAYS), nextIncome: null };
}

/**
 * limit(d) = 현재 잔고 + (오늘 이후 ~ d일까지의 예정 입금 − 예정 출금)
 *
 * "예상 잔고"가 아니라 "이 날까지 쓸 수 있는 한도"다.
 * 오늘 이전은 잔고가 이미 말해주므로 계산에 들어가지 않는다.
 *
 * 기간 예산(생활비)만 규칙이 다르다: d가 기간에 들어서는 순간
 * **남은 몫 전체**를 예약한다. 일할로 깎으면 기간 안의 날들이 매일
 * 줄어드는 숫자로 보이는데, 그 돈은 어차피 기간 동안 생활비로 묶인
 * 돈이라 다른 지출의 한도에서는 처음부터 통째로 빼는 게 맞다.
 * 기간 안에서는 상수이고, 마지막 날이 지나도 같은 값이다.
 * (정산은 여전히 일할 페이스가 기준이라, 페이스대로 정산하면
 * 이 한도가 흔들리지 않는다.)
 */
export function limitOn(state: State, date: ISODate, today: ISODate): number {
  let total = state.balance.amount;
  for (const entry of state.entries) {
    const s = entry.schedule;
    if (s.type === 'span') {
      if (compareDate(s.start, date) <= 0) {
        total += netBetween([entry], today, s.end);
      }
    } else {
      total += netBetween([entry], today, date);
    }
  }
  return total;
}

/** 머리 숫자 — 다음 입금 전날(또는 30일 뒤)까지 남는 한도. */
export function headlineLimit(state: State, today: ISODate): number {
  return limitOn(state, horizonOf(state.entries, today).end, today);
}

export type Settlement = {
  /** 직전 잔고를 적은 날. */
  since: ISODate;
  /** 그 사이 지나간 예정 입금·출금. */
  passed: Occurrence[];
  passedIn: number;
  passedOut: number;
  /** 예정대로만 움직였다면 남아 있어야 할 금액. */
  expected: number;
  /** 새로 적은 잔고 − expected. 음수면 예정에 없던 지출. */
  diff: number;
};

/**
 * 정산 diff = 새로 적은 잔고 − (직전 잔고 + 그 사이 지나간 예정 입금 − 예정 출금)
 *
 * 과거 지출을 입력하지 않아도 이 한 줄로 변동 지출이 전부 정산된다.
 */
export function settle(state: State, newAmount: number, now: Date = new Date()): Settlement {
  const since = dateOfInstant(state.balance.checkedAt);
  const today = toISODate(now);
  const passed = occurrences(state.entries, since, today);
  const expected = state.balance.amount + netOf(passed);
  return {
    since,
    passed,
    passedIn: totalIn(passed),
    passedOut: totalOut(passed),
    expected,
    diff: newAmount - expected,
  };
}

/**
 * 오늘 이후 ~ 머리 숫자 끝점까지 남은 예정.
 * 기간 예산은 끝점에 걸치기만 하면 남은 몫 전체가 담긴다 —
 * 머리 숫자(limitOn)와 같은 규칙이어야 내역 합과 머리 숫자가 맞는다.
 */
export function upcomingInHorizon(state: State, today: ISODate): Occurrence[] {
  const h = horizonOf(state.entries, today);
  const out: Occurrence[] = [];
  for (const entry of state.entries) {
    const s = entry.schedule;
    if (s.type === 'span') {
      if (compareDate(s.start, h.end) <= 0) {
        out.push(...occurrences([entry], today, s.end));
      }
    } else {
      out.push(...occurrences([entry], today, h.end));
    }
  }
  out.sort((a, b) => compareDate(a.date, b.date) || a.entry.name.localeCompare(b.entry.name));
  return out;
}

/** 하루치 (전날, 그날] 구간의 예정. */
export function entriesOn(entries: Entry[], date: ISODate): Occurrence[] {
  return occurrences(entries, addDays(date, -1), date);
}

export function formatWon(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}${Math.abs(Math.round(n)).toLocaleString('ko-KR')}원`;
}

/** 부호를 항상 붙여서 보여준다 (정산 diff·입금 표시용). */
export function formatSignedWon(n: number): string {
  const rounded = Math.round(n);
  if (rounded === 0) return '0원';
  const sign = rounded < 0 ? '−' : '+';
  return `${sign}${Math.abs(rounded).toLocaleString('ko-KR')}원`;
}
