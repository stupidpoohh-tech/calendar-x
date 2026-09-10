/**
 * tide 계산 불변식 테스트.
 *
 * tide-over CLAUDE.md 의 §2 불변식 네 가지를 Dada 스키마 위에서도 지킨다.
 *   1. 구간은 (after, through]
 *   2. 급여일 별도 필드 없음. 급여도 그냥 예정 입금
 *   3. 기간 예산은 표시(총액)과 계산(하루 몫)이 다르다
 *   4. 오늘 이전 지나간 발생분은 한도를 못 건드린다
 */
import { describe, expect, it } from 'vitest';
import { localDateOf } from './date';
import { newEntry, setRecurrence } from './entry';
import {
  entriesOn, horizonOf, limitOn, netBetween,
  occurrences, settle, summarize, upcomingInHorizon,
} from './tide';
import type { Account, Entry, MoneyType } from './types';

/**
 * 앱은 잔고를 적을 때 `asOf` 와 `checkedAt` 을 언제나 같이 쓴다 (`balanceEditor`).
 * 여기서도 그렇게 둔다 — `checkedAt` 만 옮겨 놓고 `asOf` 를 그대로 두면
 * 실제로는 생기지 않는 조합이 된다.
 */
const account = (p: Partial<Account> = {}): Account => {
  const checkedAt = p.checkedAt ?? '2026-08-01T00:00:00+09:00';
  return {
    id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
    asOf: localDateOf(checkedAt) as Account['asOf'], checkedAt,
    order: 0, createdAt: '', updatedAt: '', ...p,
  };
};

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

const monthly = (type: MoneyType, amount: number, startDate: string, title?: string): Entry =>
  setRecurrence(money(type, amount, startDate, { title }), {
    freq: 'monthly', interval: 1, until: null, count: null,
  });

const every = (type: MoneyType, amount: number, anchor: string, days: number): Entry =>
  setRecurrence(money(type, amount, anchor), {
    freq: 'daily', interval: days, until: null, count: null,
  });

describe('occurrences — 구간은 (after, through]', () => {
  it('시작 이후·끝 이하만 잡는다', () => {
    const e = money('expense', 10_000, '2026-08-10');
    expect(occurrences([e], '2026-08-09', '2026-08-10').map((o) => o.date)).toEqual(['2026-08-10']);
    expect(occurrences([e], '2026-08-10', '2026-08-11').map((o) => o.date)).toEqual([]);
  });
  it('세이브·가용은 아예 안 잡힌다 (sign 0)', () => {
    expect(occurrences([money('save', 100_000, '2026-08-10')], '2026-08-01', '2026-08-31')).toEqual([]);
    expect(occurrences([money('free', 100_000, '2026-08-10')], '2026-08-01', '2026-08-31')).toEqual([]);
  });
});

describe('occurrences — 반복', () => {
  it('매달 반복은 각 달의 지정일을 잡는다', () => {
    const e = monthly('expense', 700_000, '2026-08-05', '월세');
    const dates = occurrences([e], '2026-08-01', '2026-11-30').map((o) => o.date);
    expect(dates).toEqual(['2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05']);
  });
  it('매달 반복이 없는 날짜(2월 31일)는 말일로 당겨진다', () => {
    const e = monthly('expense', 100_000, '2026-01-31');
    const dates = occurrences([e], '2026-01-30', '2026-04-30').map((o) => o.date);
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('N 일마다는 anchor + k·N 으로 돈다', () => {
    const e = every('expense', 5000, '2026-08-01', 3);
    expect(occurrences([e], '2026-08-01', '2026-08-10').map((o) => o.date))
      .toEqual(['2026-08-04', '2026-08-07', '2026-08-10']);
  });
  it('anchor 가 과거여도 앞으로만 잡힌다', () => {
    const e = every('expense', 5000, '2026-01-01', 7);
    const first = occurrences([e], '2026-08-05', '2026-08-31')[0]?.date;
    expect(first).toBe('2026-08-06');
  });
});

describe('occurrences — 기간 예산 (span)', () => {
  const rent = money('living', 310_000, '2026-08-01', { endDate: '2026-08-31', title: '생활비' });
  it('일할로 깔되 마지막 날에 나머지를 몰아 준다', () => {
    const list = occurrences([rent], '2026-07-31', '2026-08-31');
    expect(list.length).toBe(31);
    const total = list.reduce((t, o) => t + o.amountMinor, 0);
    expect(total).toBe(310_000);
  });
  it('구간에 걸치는 부분만 잡는다', () => {
    const list = occurrences([rent], '2026-08-10', '2026-08-15');
    expect(list.map((o) => o.date)).toEqual(['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']);
  });
});

describe('horizonOf — 다음 입금 전날 또는 30일', () => {
  it('다음 입금이 있으면 그 전날', () => {
    const salary = money('income', 3_000_000, '2026-08-25');
    expect(horizonOf([salary], '2026-08-10').end).toBe('2026-08-24');
    expect(horizonOf([salary], '2026-08-10').nextIncome).toBe('2026-08-25');
  });
  it('입금이 없으면 30일 뒤', () => {
    expect(horizonOf([], '2026-08-10').end).toBe('2026-09-09');
  });
  it('기간 예산(span) 은 "다음 입금" 에서 제외된다 — 안 그러면 끝점이 늘 내일', () => {
    // 매일 조금씩 들어오는 흐름을 "다음 입금" 으로 삼으면 안 된다.
    const stream = money('income', 300_000, '2026-08-01', { endDate: '2026-08-31' });
    expect(horizonOf([stream], '2026-08-10').nextIncome).toBeNull();
  });
});

describe('limitOn — "이 날까지 쓸 수 있는 한도"', () => {
  it('잔고 + (오늘, d] 순액', () => {
    const salary = money('income', 3_000_000, '2026-08-25');
    const util = money('expense', 300_000, '2026-08-15');
    const r = limitOn([account()], [salary, util], '2026-08-25', '2026-08-10');
    expect(r).toBe(1_000_000 + 3_000_000 - 300_000);
  });
  it('기간 예산은 시작하는 순간 남은 몫 전체가 예약된다', () => {
    const rent = money('living', 310_000, '2026-08-11', { endDate: '2026-08-31' });
    const inside = limitOn([account()], [rent], '2026-08-11', '2026-08-10');
    const later  = limitOn([account()], [rent], '2026-08-20', '2026-08-10');
    // 기간 안에서는 상수 — 두 값이 같아야 한다.
    expect(inside).toBe(1_000_000 - 310_000);
    expect(later).toBe(inside);
  });
  it('마지막 날이 지나도 값이 같다 (한도는 이미 예약됐다)', () => {
    const rent = money('living', 310_000, '2026-08-01', { endDate: '2026-08-31' });
    const during = limitOn([account()], [rent], '2026-08-15', '2026-08-01');
    const after  = limitOn([account()], [rent], '2026-09-15', '2026-08-01');
    expect(after).toBe(during);
  });
});

describe('불변식 4 — 오늘 이전 지나간 발생분은 한도를 못 건드린다', () => {
  it('과거의 반복 발생분은 무시된다', () => {
    // 매월 5일 지출인데, 오늘이 8/10 이면 8/5 분은 이미 잔고에 반영됐다.
    // 그래서 오늘 기준 한도에는 안 들어간다.
    const rent = monthly('expense', 700_000, '2026-01-05');
    const today = '2026-08-10';
    const r = limitOn([account()], [rent], '2026-08-31', today);
    // 8/10 이후 잡히는 발생: 9/5. 반영 안 됨(8/31 이 끝점).
    expect(r).toBe(1_000_000);
  });
  it('과거에 시작했어도 아직 안 끝난 기간은 남은 몫이 한도에 잡힌다', () => {
    // 8/1 시작 8/31 종료, 오늘 8/11. 앞 10일은 잔고에 반영됐고 남은 21일 몫만 한도에.
    const rent = money('living', 310_000, '2026-08-01', { endDate: '2026-08-31' });
    const today = '2026-08-11';
    const r = limitOn([account()], [rent], '2026-08-31', today);
    // 남은 몫 계산: 31일 총액 310,000, 하루 10,000 (마지막 날 10,000).
    // 8/12 ~ 8/31 = 20일 × 10,000 = 200,000 (마지막 날 몫 포함).
    expect(1_000_000 - r).toBeGreaterThan(150_000);
    expect(1_000_000 - r).toBeLessThan(220_000);
  });
});

describe('settle — 정산 diff', () => {
  it('diff = 새 잔고 − (이전 잔고 + 지나간 순액)', () => {
    // 8/1 100만 원, 8/5 에 30만 나갔어야 하는데 실제 오늘(8/10) 잔고를 65만으로 적는다.
    // 예정대로면 70만이어야 하니 diff = -5만 (예정에 없던 5만 지출).
    const util = money('expense', 300_000, '2026-08-05');
    const acc = account({ balanceMinor: 1_000_000, checkedAt: '2026-08-01T00:00:00.000Z' });
    const r = settle([acc], [util], 650_000, '2026-08-10');
    expect(r.expected).toBe(700_000);
    expect(r.diff).toBe(-50_000);
    expect(r.passedOut).toBe(300_000);
  });

  it('예정대로 지났으면 diff 0', () => {
    const util = money('expense', 300_000, '2026-08-05');
    const acc = account({ checkedAt: '2026-08-01T00:00:00.000Z' });
    const r = settle([acc], [util], 700_000, '2026-08-10');
    expect(r.diff).toBe(0);
  });

  it('정산 후 다시 계산해도 한도가 어긋나지 않는다 — 핵심 불변식', () => {
    // tide-over CLAUDE.md 가 지목한 테스트를 Dada 스키마로 옮긴 것.
    //
    // diff = 0 인 정산(예정대로 정확히 맞아떨어지는 잔고를 적었을 때)이면,
    // 정산 후 새 today 시점에서 같은 미래 시점의 한도가 그대로 나와야 한다.
    // 안 그러면 같은 항목이 두 번 세지거나 사라진 것이다.
    const rent = monthly('expense', 600_000, '2026-08-10');    // 매달 10일
    const save = every('expense', 30_000, '2026-08-05', 7);    // 8/5 부터 7일마다
    const acc0 = account({ balanceMinor: 1_000_000, checkedAt: '2026-08-07T09:00:00.000Z' });

    const before = limitOn([acc0], [rent, save], '2026-08-24', '2026-08-07');

    // 8/12 에 예정대로 맞아떨어지는 잔고를 적는다.
    // (8/7, 8/12] 사이 지나간 것: 8/10 월세, 8/12 적금(8/5+7일). 8/5 는 구간 밖.
    const r = settle([acc0], [rent, save], 1_000_000 - 600_000 - 30_000, '2026-08-12');
    expect(r.diff).toBe(0);

    const acc1 = account({ balanceMinor: 370_000, checkedAt: '2026-08-12T09:00:00.000Z' });
    expect(limitOn([acc1], [rent, save], '2026-08-24', '2026-08-12')).toBe(before);
  });
});

describe('summarize — 기간 예산은 한 줄로 접힌다', () => {
  it('span 하루 발생분들이 총액 한 줄로 요약된다', () => {
    const rent = money('living', 310_000, '2026-08-01', { endDate: '2026-08-31', title: '생활비' });
    const list = occurrences([rent], '2026-07-31', '2026-08-31');
    const s = summarize(list);
    expect(s).toHaveLength(1);
    expect(s[0]?.amountMinor).toBe(310_000);
    expect(s[0]?.from).toBe('2026-08-01');
    expect(s[0]?.to).toBe('2026-08-31');
  });
  it('단발·반복은 각각 한 줄로', () => {
    const salary = money('income', 3_000_000, '2026-08-25');
    const util = money('expense', 300_000, '2026-08-15');
    const list = occurrences([salary, util], '2026-08-10', '2026-08-31');
    const s = summarize(list);
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.amountMinor).sort()).toEqual([300_000, 3_000_000]);
  });
});

describe('upcomingInHorizon — 남은 예정 목록', () => {
  it('오늘 이후 ~ 끝점까지', () => {
    const salary = money('income', 3_000_000, '2026-08-25');
    const util = money('expense', 300_000, '2026-08-15');
    const list = upcomingInHorizon([salary, util], '2026-08-10');
    // 끝점은 8/24 (다음 입금 8/25 전날). 8/15 만 남은 예정.
    expect(list.map((o) => o.entry.title)).toEqual(['']);
    expect(list[0]?.date).toBe('2026-08-15');
  });
});

describe('entriesOn — 하루 발생분', () => {
  it('그 날 딱 하나만', () => {
    const e = money('expense', 10_000, '2026-08-10');
    expect(entriesOn([e], '2026-08-10').map((o) => o.date)).toEqual(['2026-08-10']);
    expect(entriesOn([e], '2026-08-11')).toEqual([]);
  });
});

describe('netBetween', () => {
  it('입금 +, 출금 −', () => {
    const salary = money('income', 3_000_000, '2026-08-25');
    const util = money('expense', 300_000, '2026-08-15');
    expect(netBetween([salary, util], '2026-08-10', '2026-08-31')).toBe(2_700_000);
  });
});

describe('settle — 정산 기준일', () => {
  it('한국 시간 오전에 적은 잔고가 전날로 읽히지 않는다', () => {
    // checkedAt 을 UTC 로 잘라 쓰면 08:00 KST 가 전날이 된다. 그러면 그 날 나갈
    // 예정이 "이미 지나간 것" 으로 잡혀 없던 차액이 생긴다.
    const a = account({ asOf: '2026-09-10', checkedAt: '2026-09-10T08:00:00+09:00' });
    expect(new Date(a.checkedAt).toISOString().slice(0, 10)).toBe('2026-09-09');

    const out = money('expense', 50_000, '2026-09-10');
    const r = settle([a], [out], 1_000_000, '2026-09-10');

    expect(r.since).toBe('2026-09-10');
    expect(r.passed).toHaveLength(0);
    expect(r.diff).toBe(0);
  });

  it('계좌가 여럿이면 가장 최근에 확인한 것의 날짜를 쓴다', () => {
    const older = account({ id: 'a1', asOf: '2026-09-01', checkedAt: '2026-09-01T09:00:00+09:00' });
    const newer = account({ id: 'a2', asOf: '2026-09-08', checkedAt: '2026-09-08T09:00:00+09:00' });
    expect(settle([older, newer], [], 0, '2026-09-10').since).toBe('2026-09-08');
    expect(settle([newer, older], [], 0, '2026-09-10').since).toBe('2026-09-08');
  });

  it('asOf 가 비었으면 순간에서 벽시계 날짜를 뽑는다', () => {
    const a = account({ asOf: '' as never, checkedAt: '2026-09-10T08:00:00+09:00' });
    expect(settle([a], [], 0, '2026-09-10').since).toBe('2026-09-10');
  });

  it('패딩 없는 asOf 도 맞춰 읽는다', () => {
    const a = account({ asOf: '2026-9-3' as never, checkedAt: '2026-09-03T09:00:00+09:00' });
    expect(settle([a], [], 0, '2026-09-10').since).toBe('2026-09-03');
  });
});
