/**
 * 화면용 목록과 계산용 원본의 분리 — 회귀 테스트.
 *
 * ## 무엇이 잘못됐었나
 *
 * `materialize()` 는 반복 항목을 화면에 그릴 발생분으로 펼치는데, 펼친 사본에는 원본의
 * `recurrence` 가 그대로 남는다. 그 목록을 그대로 `tide.ts` 에 넘기면 tide 가 발생분
 * 하나하나를 **다시** 반복 전개해 같은 입출금을 여러 번 센다.
 *
 * 재현 사례: 2026-09-01 부터 매주 10,000원 지출, (09-01, 09-30] 구간
 *   - 원본으로 계산: −40,000원 (09-08 · 15 · 22 · 29)
 *   - 펼친 목록으로 계산: −140,000원
 *
 * ## 지금의 규칙
 *
 * 계산에는 원본만 넣는다. 펼친 사본은 `virtual` 표식을 달고 있고, tide 의 모든 입구가
 * 그 표식을 보고 `TideInputError` 로 거절한다 — 조용히 부풀린 숫자를 내지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { entryFromDoc, entryToDoc } from '../data/converters';
import { newEntry, setRecurrence } from './entry';
import { isVirtualEntry, materialize } from './recurrence';
import {
  headlineLimit, horizonOf, limitOn, netBetween, occurrences, settle,
  TideInputError, upcomingInHorizon,
} from './tide';
import type { Account, Entry, MoneyType, Recurrence } from './types';

const account = (balanceMinor: number, asOf: string): Account => ({
  id: 'a1', name: '주계좌', balanceMinor, currency: 'KRW',
  asOf, checkedAt: `${asOf}T00:00:00.000Z`,
  order: 0, createdAt: '', updatedAt: '',
});

const money = (
  type: MoneyType, amountMinor: number, startDate: string,
  extra: { endDate?: string; title?: string } = {},
): Entry =>
  newEntry('money', {
    title: extra.title ?? '',
    startDate,
    endDate: extra.endDate ?? null,
    money: { type, amountMinor, currency: 'KRW', linkedEntryId: null },
  });

const repeating = (e: Entry, r: Recurrence): Entry => setRecurrence(e, r);

/**
 * 저장 → 조회 왕복.
 *
 * 실제 앱이 받는 모양 그대로 계산에 넣는다. 손으로 만든 객체만 쓰면 변환 계층이
 * `virtual` 을 흘려보내도(=저장돼 버려도) 테스트가 눈치채지 못한다.
 */
const roundTrip = (e: Entry): Entry => entryFromDoc(e.id, entryToDoc(e));

describe('재현 사례 — 주간 반복 지출 한 달치', () => {
  const weekly = repeating(money('expense', 10_000, '2026-09-01', { title: '주간 장보기' }), {
    freq: 'weekly', interval: 1, until: null, count: null,
  });

  it('원본으로 계산하면 네 번만 센다', () => {
    expect(netBetween([roundTrip(weekly)], '2026-09-01', '2026-09-30')).toBe(-40_000);
  });

  it('펼친 목록을 계산에 넣으면 거절한다 — 조용히 −140,000원을 내지 않는다', () => {
    const shown = materialize([weekly], '2026-09-01', '2026-09-30');
    expect(shown).toHaveLength(5);
    expect(shown.every(isVirtualEntry)).toBe(true);

    expect(() => netBetween(shown, '2026-09-01', '2026-09-30')).toThrow(TideInputError);
  });

  it('화면용 발생분은 저장되지 않는다 — 왕복하면 표식이 사라진다', () => {
    const shown = materialize([weekly], '2026-09-01', '2026-09-30');
    // 혹시 저장되더라도 다시 읽은 값에는 표식이 없어야 한다.
    // 있으면 사용자 데이터가 계산을 막는 상태가 된다.
    expect(roundTrip(shown[0]!).virtual).toBeUndefined();
  });
});

describe('tide 의 모든 입구가 원본만 받는다', () => {
  const weekly = repeating(money('expense', 10_000, '2026-09-01'), {
    freq: 'weekly', interval: 1, until: null, count: null,
  });
  const shown = materialize([weekly], '2026-09-01', '2026-09-30');
  const acc = [account(1_000_000, '2026-09-01')];

  it.each([
    ['occurrences', () => occurrences(shown, '2026-09-01', '2026-09-30')],
    ['netBetween', () => netBetween(shown, '2026-09-01', '2026-09-30')],
    ['horizonOf', () => horizonOf(shown, '2026-09-01')],
    ['limitOn', () => limitOn(acc, shown, '2026-09-30', '2026-09-01')],
    ['headlineLimit', () => headlineLimit(acc, shown, '2026-09-01')],
    ['upcomingInHorizon', () => upcomingInHorizon(shown, '2026-09-01')],
    ['settle', () => settle(acc, shown, 900_000, '2026-09-30')],
  ])('%s 는 화면용 목록을 거절한다', (_name, run) => {
    expect(run).toThrow(TideInputError);
  });
});

describe('반복 모양별 — 원본 경로가 맞는 값을 낸다', () => {
  it('주간 반복, 달 경계를 넘는 구간', () => {
    const weekly = repeating(money('expense', 10_000, '2026-09-01'), {
      freq: 'weekly', interval: 1, until: null, count: null,
    });
    // (09-25, 10-10] → 09-29 · 10-06 두 번.
    expect(netBetween([roundTrip(weekly)], '2026-09-25', '2026-10-10')).toBe(-20_000);
  });

  it('월간 반복은 달마다 한 번', () => {
    const monthly = repeating(money('expense', 700_000, '2026-09-05', { title: '월세' }), {
      freq: 'monthly', interval: 1, until: null, count: null,
    });
    // (09-01, 11-30] → 09-05 · 10-05 · 11-05.
    expect(netBetween([roundTrip(monthly)], '2026-09-01', '2026-11-30')).toBe(-2_100_000);
  });

  it('월간 반복은 말일을 넘기지 않는다', () => {
    const monthly = repeating(money('expense', 10_000, '2026-01-31'), {
      freq: 'monthly', interval: 1, until: null, count: null,
    });
    const dates = occurrences([roundTrip(monthly)], '2026-01-31', '2026-03-31').map((o) => o.date);
    expect(dates).toEqual(['2026-02-28', '2026-03-31']);
  });

  it('until 이 있으면 그 날까지만 센다', () => {
    const weekly = repeating(money('expense', 10_000, '2026-09-01'), {
      freq: 'weekly', interval: 1, until: '2026-09-16', count: null,
    });
    // 09-08 · 09-15 까지. 09-22 · 09-29 는 until 뒤라 빠진다.
    expect(netBetween([roundTrip(weekly)], '2026-09-01', '2026-09-30')).toBe(-20_000);
  });

  it('count 가 있으면 그 횟수까지만 센다 (첫 발생 포함)', () => {
    const weekly = repeating(money('expense', 10_000, '2026-09-01'), {
      freq: 'weekly', interval: 1, until: null, count: 3,
    });
    // 09-01(1) · 09-08(2) · 09-15(3). 구간이 09-01 을 열어 두므로 두 번만 잡힌다.
    expect(netBetween([roundTrip(weekly)], '2026-09-01', '2026-09-30')).toBe(-20_000);
  });

  it('격주(interval 2)', () => {
    const biweekly = repeating(money('expense', 10_000, '2026-09-01'), {
      freq: 'weekly', interval: 2, until: null, count: null,
    });
    // 09-15 · 09-29.
    expect(netBetween([roundTrip(biweekly)], '2026-09-01', '2026-09-30')).toBe(-20_000);
  });

  it('기간 예산은 일할로 깔리고 합이 총액이 된다', () => {
    const span = money('living', 300_000, '2026-09-01', { endDate: '2026-09-30' });
    // 30일 × 10,000원.
    expect(netBetween([roundTrip(span)], '2026-08-31', '2026-09-30')).toBe(-300_000);
    // 절반 구간은 절반.
    expect(netBetween([roundTrip(span)], '2026-08-31', '2026-09-15')).toBe(-150_000);
  });

  it('기간 예산은 반복이 아니라 펼쳐지지 않는다 — 화면용 목록에도 그대로 있다', () => {
    const span = money('living', 300_000, '2026-09-01', { endDate: '2026-09-30' });
    const shown = materialize([span], '2026-09-01', '2026-09-30');
    expect(shown).toHaveLength(1);
    expect(isVirtualEntry(shown[0]!)).toBe(false);
    // 반복이 아니므로 화면용 목록을 넣어도 값이 같다 — 그래도 원본을 넘기는 것이 규칙이다.
    expect(netBetween(shown, '2026-08-31', '2026-09-30')).toBe(-300_000);
  });

  it('반복과 기간이 섞여도 각각 한 번씩만 센다', () => {
    const raw = [
      repeating(money('income', 3_000_000, '2026-09-25', { title: '급여' }), {
        freq: 'monthly', interval: 1, until: null, count: null,
      }),
      repeating(money('expense', 10_000, '2026-09-01'), {
        freq: 'weekly', interval: 1, until: null, count: null,
      }),
      money('living', 300_000, '2026-09-01', { endDate: '2026-09-30' }),
      money('expense', 65_000, '2026-09-12', { title: '전기요금' }),
    ].map(roundTrip);

    // 구간이 08-31 을 열어 두므로 09-01 발생분까지 들어온다.
    // 급여 +3,000,000 / 주간 −50,000(5회) / 생활비 −300,000 / 전기 −65,000
    expect(netBetween(raw, '2026-08-31', '2026-09-30')).toBe(2_585_000);
  });
});

describe('한도·다음 입금일은 보고 있는 달과 무관하다', () => {
  const raw = [
    repeating(money('income', 3_000_000, '2026-09-25', { title: '급여' }), {
      freq: 'monthly', interval: 1, until: null, count: null,
    }),
    repeating(money('expense', 10_000, '2026-09-01'), {
      freq: 'weekly', interval: 1, until: null, count: null,
    }),
  ].map(roundTrip);
  // 잔고를 09-01 에 적었고 오늘은 09-10 — 그 사이 주간 지출 09-08 한 번이 지나갔다.
  const acc = [account(1_000_000, '2026-09-01')];
  const today = '2026-09-10';

  it('다음 입금은 급여일이고 한도는 그 전날까지다', () => {
    const h = horizonOf(raw, today);
    expect(h.nextIncome).toBe('2026-09-25');
    expect(h.end).toBe('2026-09-24');
    // 잔고 1,000,000 − 주간 지출 09-15 · 09-22 두 번.
    expect(headlineLimit(acc, raw, today)).toBe(980_000);
  });

  it('달력을 아무리 넘겨도 같은 값을 낸다', () => {
    // 화면용 목록은 보고 있는 달마다 달라지지만, 계산 입력은 바뀌지 않는다.
    for (const [from, to] of [
      ['2026-09-01', '2026-09-30'],
      ['2026-12-01', '2026-12-31'],
      ['2027-06-01', '2027-06-30'],
    ] as const) {
      const shown = materialize(raw, from, to);
      expect(shown.length).toBeGreaterThan(0);

      // 화면용 목록은 구간마다 길이가 다르다.
      // 계산은 그것과 무관하게 원본만 본다 — 그래서 값이 고정이다.
      expect(horizonOf(raw, today).nextIncome).toBe('2026-09-25');
      expect(headlineLimit(acc, raw, today)).toBe(980_000);
      expect(settle(acc, raw, 900_000, today).diff).toBe(-90_000);
    }
  });
});

describe('정산 — 자료가 모자라면 확정 금액을 내지 않는다', () => {
  const weekly = repeating(money('expense', 10_000, '2026-01-06'), {
    freq: 'weekly', interval: 1, until: null, count: null,
  });
  const oneOff = money('expense', 500_000, '2026-06-15', { title: '한 번짜리' });
  const raw = [weekly, oneOff].map(roundTrip);

  it('기준일이 계산 구간 안이면 완전하다고 표시한다', () => {
    const acc = [account(1_000_000, '2026-09-01')];
    const r = settle(acc, raw, 900_000, '2026-09-10', '2026-08-01');
    expect(r.complete).toBe(true);
    expect(r.coveredFrom).toBe('2026-08-01');
  });

  it('기준일이 계산 구간보다 앞서면 불완전하다고 표시한다', () => {
    // 계산 구독은 뒤로 1달뿐이다. 6월의 한 번짜리 지출은 목록에 없다.
    const acc = [account(1_000_000, '2026-05-01')];
    const r = settle(acc, raw, 900_000, '2026-09-10', '2026-08-01');
    expect(r.complete).toBe(false);
    expect(r.coveredFrom).toBe('2026-08-01');
  });

  it('덮는 구간을 주지 않으면 완전하다고 본다 (도메인 테스트 · 이전 호출부 호환)', () => {
    const acc = [account(1_000_000, '2026-05-01')];
    expect(settle(acc, raw, 900_000, '2026-09-10').complete).toBe(true);
  });

  it('불완전할 때의 diff 는 실제보다 크다 — 그래서 보여 주면 안 된다', () => {
    const acc = [account(1_000_000, '2026-05-01')];
    // 자료가 다 있을 때: 주간 지출 + 6월 한 번짜리 500,000 이 지나갔다.
    const full = settle(acc, raw, 900_000, '2026-09-10');
    // 계산 구독 구간만 있을 때: 6월 한 번짜리가 빠진다.
    const partial = settle(acc, [roundTrip(weekly)], 900_000, '2026-09-10', '2026-08-01');

    expect(partial.complete).toBe(false);
    // 빠진 지출만큼 "예정대로면 남아 있어야 할 금액" 이 더 크게 나온다.
    expect(partial.expected).toBeGreaterThan(full.expected);
    expect(partial.expected - full.expected).toBe(500_000);
  });
});
