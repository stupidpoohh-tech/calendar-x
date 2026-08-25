import { describe, expect, it } from 'vitest';
import {
  entriesOn,
  formatSignedWon,
  headlineLimit,
  horizonOf,
  limitOn,
  netBetween,
  occurrences,
  settle,
  summarize,
  upcomingInHorizon,
} from './calc';
import type { Entry, State } from './types';

const out = (id: string, name: string, amount: number, day: number): Entry => ({
  id,
  name,
  amount,
  kind: 'expense',
  schedule: { type: 'monthly', day },
});

const inc = (id: string, name: string, amount: number, day: number): Entry => ({
  id,
  name,
  amount,
  kind: 'income',
  schedule: { type: 'monthly', day },
});

const once = (
  id: string,
  name: string,
  amount: number,
  date: string,
  kind: Entry['kind'] = 'expense',
): Entry => ({ id, name, amount, kind, schedule: { type: 'once', date } });

const every = (
  id: string,
  name: string,
  amount: number,
  days: number,
  anchor: string,
  kind: Entry['kind'] = 'expense',
): Entry => ({ id, name, amount, kind, schedule: { type: 'every', days, anchor } });

const state = (over: Partial<State> = {}): State => ({
  balance: { amount: 1_000_000, checkedAt: '2026-03-10T09:00:00+09:00' },
  entries: [],
  ...over,
});

describe('occurrences — 매달 반복', () => {
  it('시작은 열려 있고 끝은 닫혀 있다', () => {
    const list = occurrences([out('a', '월세', 500_000, 10)], '2026-03-10', '2026-04-10');
    expect(list.map((o) => o.date)).toEqual(['2026-04-10']);
  });

  it('구간이 비어 있으면 아무것도 없다', () => {
    expect(occurrences([out('a', '월세', 1, 10)], '2026-03-10', '2026-03-10')).toEqual([]);
    expect(occurrences([out('a', '월세', 1, 10)], '2026-03-11', '2026-03-10')).toEqual([]);
  });

  it('여러 달에 걸쳐 매달 한 번씩 잡힌다', () => {
    const list = occurrences([out('a', '월세', 500_000, 5)], '2026-01-01', '2026-04-30');
    expect(list.map((o) => o.date)).toEqual([
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
    ]);
  });

  it('그 달에 없는 날짜는 말일로 당겨진다', () => {
    const list = occurrences([out('a', '카드', 100_000, 31)], '2026-01-31', '2026-03-31');
    expect(list.map((o) => o.date)).toEqual(['2026-02-28', '2026-03-31']);
  });
});

describe('occurrences — 특정 일자', () => {
  it('그 날짜에 한 번만 잡힌다', () => {
    const entry = once('a', '경조사', 100_000, '2026-03-15');
    expect(occurrences([entry], '2026-03-01', '2026-03-31').map((o) => o.date)).toEqual([
      '2026-03-15',
    ]);
    expect(occurrences([entry], '2026-04-01', '2026-04-30')).toEqual([]);
  });

  it('구간 경계도 (after, through] 규칙을 따른다', () => {
    const entry = once('a', '경조사', 100_000, '2026-03-15');
    expect(occurrences([entry], '2026-03-15', '2026-03-31')).toEqual([]);
    expect(occurrences([entry], '2026-03-14', '2026-03-15')).toHaveLength(1);
  });
});

describe('occurrences — N일마다', () => {
  it('anchor부터 N일 간격으로 잡힌다 (1주 = 7)', () => {
    const list = occurrences([every('a', '적금', 10_000, 7, '2026-03-10')], '2026-03-07', '2026-03-31');
    expect(list.map((o) => o.date)).toEqual(['2026-03-10', '2026-03-17', '2026-03-24', '2026-03-31']);
  });

  it('anchor 이전에는 발생하지 않는다', () => {
    expect(occurrences([every('a', '적금', 1, 7, '2026-03-10')], '2026-03-01', '2026-03-09')).toEqual(
      [],
    );
  });

  it('시작 경계는 열려 있다 — anchor 당일이 after면 다음 발생부터', () => {
    const list = occurrences([every('a', '적금', 1, 7, '2026-03-10')], '2026-03-10', '2026-03-24');
    expect(list.map((o) => o.date)).toEqual(['2026-03-17', '2026-03-24']);
  });

  it('과거 anchor에서도 미래 발생분으로 바로 점프한다 (10일 주기)', () => {
    const list = occurrences([every('a', '적금', 1, 10, '2026-03-03')], '2026-03-20', '2026-04-10');
    expect(list.map((o) => o.date)).toEqual(['2026-03-23', '2026-04-02']);
  });

  it('매일(1일마다)도 된다', () => {
    const list = occurrences([every('a', '커피', 1, 1, '2026-03-01')], '2026-03-01', '2026-03-05');
    expect(list.map((o) => o.date)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']);
  });

  it('달을 넘어도 간격이 정확하다', () => {
    const list = occurrences([every('a', '적금', 1, 14, '2026-02-20')], '2026-02-20', '2026-04-01');
    expect(list.map((o) => o.date)).toEqual(['2026-03-06', '2026-03-20']);
  });
});

const span = (
  id: string,
  name: string,
  amount: number,
  start: string,
  end: string,
  kind: Entry['kind'] = 'expense',
): Entry => ({ id, name, amount, kind, schedule: { type: 'span', start, end } });

describe('occurrences — 기간 예산(생활비)', () => {
  it('하루 몫으로 나뉘고, 합은 정확히 총액이다 (나머지는 마지막 날)', () => {
    // 100,000원 / 11일 = 9,090 × 10일 + 9,100 (마지막 날)
    const list = occurrences([span('a', '생활비', 100_000, '2026-03-05', '2026-03-15')], '2026-03-01', '2026-03-31');
    expect(list).toHaveLength(11);
    expect(list[0]).toMatchObject({ date: '2026-03-05', amount: 9_090 });
    expect(list.at(-1)).toMatchObject({ date: '2026-03-15', amount: 9_100 });
    expect(list.reduce((t, o) => t + o.amount, 0)).toBe(100_000);
  });

  it('마지막 날이 지나면 정확히 총액만큼 빠진 상태가 된다', () => {
    const entries = [span('a', '생활비', 100_000, '2026-03-05', '2026-03-15')];
    expect(netBetween(entries, '2026-03-04', '2026-03-15')).toBe(-100_000);
    expect(netBetween(entries, '2026-03-04', '2026-03-31')).toBe(-100_000);
  });

  it('구간 경계도 (after, through] 규칙을 따른다', () => {
    const entries = [span('a', '생활비', 100_000, '2026-03-05', '2026-03-15')];
    // 3/10까지 지나간 몫 + 3/10 이후 남은 몫 = 총액
    const passed = netBetween(entries, '2026-03-04', '2026-03-10');
    const remaining = netBetween(entries, '2026-03-10', '2026-03-15');
    expect(passed + remaining).toBe(-100_000);
    expect(passed).toBe(-9_090 * 6);
  });

  it('기간 시작 전에는 아무것도 빠지지 않는다', () => {
    const entries = [span('a', '생활비', 100_000, '2026-03-05', '2026-03-15')];
    expect(netBetween(entries, '2026-03-01', '2026-03-04')).toBe(0);
  });

  it('하루짜리 기간은 그 날 총액 그대로다', () => {
    const list = occurrences([span('a', '경조사', 50_000, '2026-03-10', '2026-03-10')], '2026-03-01', '2026-03-31');
    expect(list).toEqual([
      { date: '2026-03-10', entry: expect.anything(), amount: 50_000 },
    ]);
  });
});

describe('summarize', () => {
  it('기간 예산의 하루 발생분들을 한 줄로 합친다', () => {
    const entries = [
      span('a', '생활비', 100_000, '2026-03-05', '2026-03-15'),
      out('b', '월세', 600_000, 10),
    ];
    const groups = summarize(occurrences(entries, '2026-03-04', '2026-03-31'));
    expect(groups).toHaveLength(2);
    const living = groups.find((g) => g.entry.name === '생활비');
    expect(living).toMatchObject({ from: '2026-03-05', to: '2026-03-15', amount: 100_000 });
  });

  it('기간 중간부터 요약하면 남은 몫만 담긴다', () => {
    const entries = [span('a', '생활비', 100_000, '2026-03-05', '2026-03-15')];
    const groups = summarize(occurrences(entries, '2026-03-10', '2026-03-31'));
    expect(groups[0]).toMatchObject({ from: '2026-03-11', to: '2026-03-15', amount: 100_000 - 9_090 * 6 });
  });
});

describe('entriesOn', () => {
  it('그 날 하루치만 뽑는다', () => {
    const entries = [
      out('a', '월세', 600_000, 10),
      once('b', '경조사', 50_000, '2026-03-10'),
      every('c', '적금', 10_000, 7, '2026-03-03'),
    ];
    expect(entriesOn(entries, '2026-03-10')).toHaveLength(3);
    expect(entriesOn(entries, '2026-03-11')).toEqual([]);
  });
});

describe('horizonOf — 주기는 다음 예정 입금 전날까지', () => {
  it('다음 입금 전날이 끝점이다', () => {
    const h = horizonOf([inc('a', '급여', 0, 25)], '2026-03-07');
    expect(h).toEqual({ end: '2026-03-24', nextIncome: '2026-03-25' });
  });

  it('입금 당일에는 다음 달 입금이 기준이다', () => {
    const h = horizonOf([inc('a', '급여', 0, 25)], '2026-03-25');
    expect(h).toEqual({ end: '2026-04-24', nextIncome: '2026-04-25' });
  });

  it('말일보다 큰 날짜는 말일로 당겨진다', () => {
    const h = horizonOf([inc('a', '급여', 0, 31)], '2026-02-01');
    expect(h).toEqual({ end: '2026-02-27', nextIncome: '2026-02-28' });
  });

  it('N일마다 입금도 기준이 된다', () => {
    const h = horizonOf([every('a', '주급', 200_000, 7, '2026-03-10', 'income')], '2026-03-12');
    expect(h).toEqual({ end: '2026-03-16', nextIncome: '2026-03-17' });
  });

  it('여러 입금 중 가장 가까운 것이 기준이다', () => {
    const h = horizonOf(
      [inc('a', '급여', 0, 25), once('b', '용돈', 50_000, '2026-03-15', 'income')],
      '2026-03-07',
    );
    expect(h.nextIncome).toBe('2026-03-15');
  });

  it('예정 입금이 없으면 30일 기준으로 본다', () => {
    expect(horizonOf([], '2026-03-07')).toEqual({ end: '2026-04-06', nextIncome: null });
    expect(horizonOf([out('a', '월세', 1, 10)], '2026-03-07').nextIncome).toBeNull();
  });

  it('기간 입금은 주기 기준이 되지 않는다 — 매일 조금씩 들어오는 흐름은 입금일이 아니다', () => {
    const h = horizonOf(
      [span('a', '용돈', 100_000, '2026-03-08', '2026-03-20', 'income'), inc('b', '급여', 0, 25)],
      '2026-03-07',
    );
    expect(h.nextIncome).toBe('2026-03-25');
  });
});

describe('limitOn', () => {
  const s = state({
    balance: { amount: 1_900_000, checkedAt: '2026-03-07T09:00:00+09:00' },
    entries: [out('a', '월세', 600_000, 10), out('b', '통신비', 55_000, 20), inc('c', '급여', 0, 25)],
  });

  it('오늘까지의 한도는 잔고 그대로다 — 오늘 이전은 잔고가 이미 말해준다', () => {
    expect(limitOn(s, '2026-03-07', '2026-03-07')).toBe(1_900_000);
    expect(limitOn(s, '2026-03-01', '2026-03-07')).toBe(1_900_000);
  });

  // 과거 날짜로도 항목을 만들 수 있게 열어둔 근거. 만들 수 있게 한 이상,
  // 그것이 한도를 흔들지 않는다는 사실을 테스트로 못 박아 둔다.
  it('오늘 이전에 지나간 발생분은 한도를 바꾸지 않는다', () => {
    const withPast = state({
      ...s,
      entries: [...s.entries, once('p', '관리비', 78_000, '2026-03-05'), once('t', '점심', 9_000, '2026-03-07')],
    });
    expect(limitOn(withPast, '2026-03-07', '2026-03-07')).toBe(limitOn(s, '2026-03-07', '2026-03-07'));
    expect(limitOn(withPast, '2026-03-20', '2026-03-07')).toBe(limitOn(s, '2026-03-20', '2026-03-07'));
    expect(headlineLimit(withPast, '2026-03-07')).toBe(headlineLimit(s, '2026-03-07'));
  });

  /*
   * "지나간 발생분"이지 "지난 날짜에 시작한 항목"이 아니다. 기간은 시작이 과거여도
   * 오늘 이후까지 걸쳐 있으면 남은 몫이 잡힌다 — 불변식 3이 그렇게 정해져 있다.
   * 이 구분을 놓치면 "과거 항목은 무조건 한도 밖"이라고 잘못 적게 된다.
   */
  it('과거에 시작했어도 아직 안 끝난 기간은 남은 몫이 한도에 잡힌다', () => {
    const span = (start: string, end: string): State =>
      state({
        balance: { amount: 1_000_000, checkedAt: '2026-03-07T09:00:00+09:00' },
        entries: [
          {
            id: 's',
            name: '생활비',
            amount: 100_000,
            kind: 'expense',
            schedule: { type: 'span', start, end },
          },
        ],
      });
    // 3/1~3/20 중 오늘이 3/7 → 남은 3/8~3/20(13일) 몫만 예약된다.
    expect(limitOn(span('2026-03-01', '2026-03-20'), '2026-03-10', '2026-03-07')).toBe(935_000);
    // 이미 끝난 기간은 아무것도 안 잡힌다.
    expect(limitOn(span('2026-03-01', '2026-03-05'), '2026-03-10', '2026-03-07')).toBe(1_000_000);
  });

  it('오늘 이후의 예정 출금만 빠진다', () => {
    expect(limitOn(s, '2026-03-10', '2026-03-07')).toBe(1_300_000);
    expect(limitOn(s, '2026-03-19', '2026-03-07')).toBe(1_300_000);
    expect(limitOn(s, '2026-03-20', '2026-03-07')).toBe(1_245_000);
  });

  it('머리 숫자는 다음 입금 전날까지의 한도다', () => {
    // 급여 매달 25일 → 끝점 3/24. 그 사이 3/10 월세, 3/20 통신비.
    expect(headlineLimit(s, '2026-03-07')).toBe(1_245_000);
  });

  it('N일마다 출금이 한도에 반영된다', () => {
    const s2 = state({
      balance: { amount: 500_000, checkedAt: '2026-03-07T09:00:00+09:00' },
      entries: [every('a', '적금', 50_000, 7, '2026-03-10'), inc('b', '급여', 0, 25)],
    });
    // 3/10, 3/17, 3/24 세 번.
    expect(headlineLimit(s2, '2026-03-07')).toBe(350_000);
  });

  it('예정 입금은 한도를 늘리지만, 다음 급여 자체는 이번 주기에 안 들어간다', () => {
    const s3 = state({
      balance: { amount: 100_000, checkedAt: '2026-03-07T09:00:00+09:00' },
      entries: [inc('a', '급여', 2_000_000, 25), once('b', '용돈', 50_000, '2026-03-10', 'income')],
    });
    // 3/10 용돈 입금이 기준일이 된다 → 끝점 3/9. 용돈은 3/10이라 아직 안 들어감.
    expect(headlineLimit(s3, '2026-03-07')).toBe(100_000);
    // 용돈이 들어온 다음(3/10 이후)의 기준은 3/25 급여 → 3/24까지.
    expect(headlineLimit(s3, '2026-03-10')).toBe(100_000);
  });

  it('한도는 음수가 될 수 있다', () => {
    const tight = state({
      balance: { amount: 100_000, checkedAt: '2026-03-07T09:00:00+09:00' },
      entries: [out('a', '월세', 600_000, 10), inc('b', '급여', 0, 25)],
    });
    expect(headlineLimit(tight, '2026-03-07')).toBe(-500_000);
  });
});

describe('limitOn — 기간 예산은 전액 예약으로 보인다', () => {
  const s = state({
    balance: { amount: 500_000, checkedAt: '2026-03-04T09:00:00+09:00' },
    entries: [span('a', '생활비', 100_000, '2026-03-05', '2026-03-15'), inc('b', '급여', 0, 25)],
  });

  it('기간 시작 전 날짜의 한도에는 잡히지 않는다', () => {
    expect(limitOn(s, '2026-03-04', '2026-03-04')).toBe(500_000);
  });

  it('기간에 들어서면 남은 몫 전체가 한 번에 빠지고, 기간 내내 상수다', () => {
    // 매일 9,090원씩 줄어드는 숫자가 보이면 안 된다 — 사용자 요구사항.
    const values = ['2026-03-05', '2026-03-08', '2026-03-12', '2026-03-15', '2026-03-20'].map(
      (d) => limitOn(s, d, '2026-03-04'),
    );
    expect(new Set(values).size).toBe(1);
    expect(values[0]).toBe(400_000);
  });

  it('기간 중간 시점에서는 이미 지난 몫을 빼고 남은 몫만 예약한다', () => {
    // 3/10 기준 남은 몫 = (3/10, 3/15] = 9,090×4 + 9,100 = 45,460
    const mid = limitOn(s, '2026-03-12', '2026-03-10');
    expect(mid).toBe(500_000 - 45_460);
    expect(limitOn(s, '2026-03-15', '2026-03-10')).toBe(mid);
    expect(limitOn(s, '2026-03-20', '2026-03-10')).toBe(mid);
  });

  it('기간이 주기 끝을 넘어가도 머리 숫자는 남은 몫 전체를 예약한다', () => {
    const crossing = state({
      balance: { amount: 500_000, checkedAt: '2026-03-18T09:00:00+09:00' },
      entries: [span('a', '생활비', 100_000, '2026-03-20', '2026-04-10'), inc('b', '급여', 0, 25)],
    });
    // 주기 끝은 3/24지만, 3/20에 시작하는 생활비는 전액이 묶인 돈이다.
    expect(headlineLimit(crossing, '2026-03-18')).toBe(400_000);
  });
});

describe('upcomingInHorizon', () => {
  it('오늘 이후 ~ 다음 입금 전날까지만 담는다', () => {
    const s = state({
      entries: [out('a', '월세', 600_000, 10), inc('b', '급여', 0, 25), out('c', '보험', 30_000, 28)],
    });
    // 끝점 3/24 → 3/28 보험은 다음 주기다.
    expect(upcomingInHorizon(s, '2026-03-07').map((o) => o.date)).toEqual(['2026-03-10']);
  });

  it('기간 예산은 주기 끝에 걸치기만 하면 남은 몫 전체가 담긴다', () => {
    const s = state({
      entries: [span('a', '생활비', 100_000, '2026-03-20', '2026-04-10'), inc('b', '급여', 0, 25)],
    });
    const total = upcomingInHorizon(s, '2026-03-18').reduce(
      (t, o) => t + (o.entry.kind === 'income' ? o.amount : -o.amount),
      0,
    );
    // 머리 숫자와 같은 규칙 — 내역 합이 headlineLimit의 차감분과 일치한다.
    expect(total).toBe(-100_000);
  });
});

describe('settle', () => {
  it('예정에 없던 지출을 음수 diff로 잡아낸다', () => {
    const s = state({
      balance: { amount: 1_900_000, checkedAt: '2026-03-07T09:00:00+09:00' },
      entries: [out('a', '월세', 600_000, 10)],
    });
    const result = settle(s, 1_176_000, new Date('2026-03-12T21:00:00+09:00'));
    expect(result.passedOut).toBe(600_000);
    expect(result.expected).toBe(1_300_000);
    expect(result.diff).toBe(-124_000);
    expect(formatSignedWon(result.diff)).toBe('−124,000원');
  });

  it('지나간 예정 입금은 예상 잔고를 올린다', () => {
    const s = state({
      balance: { amount: 500_000, checkedAt: '2026-03-07T09:00:00+09:00' },
      entries: [inc('a', '부수입', 200_000, 10)],
    });
    const result = settle(s, 650_000, new Date('2026-03-12T09:00:00+09:00'));
    expect(result.passedIn).toBe(200_000);
    expect(result.expected).toBe(700_000);
    expect(result.diff).toBe(-50_000);
  });

  it('N일마다 항목도 지나간 만큼 정산된다', () => {
    const s = state({
      balance: { amount: 500_000, checkedAt: '2026-03-01T09:00:00+09:00' },
      entries: [every('a', '적금', 50_000, 7, '2026-03-03')],
    });
    // 3/3, 3/10 두 번 지나감.
    const result = settle(s, 400_000, new Date('2026-03-12T09:00:00+09:00'));
    expect(result.passedOut).toBe(100_000);
    expect(result.expected).toBe(400_000);
    expect(result.diff).toBe(0);
  });

  it('같은 날 다시 적으면 그 날짜의 예정은 아직 지나가지 않은 것으로 본다', () => {
    const s = state({
      balance: { amount: 500_000, checkedAt: '2026-03-10T09:00:00+09:00' },
      entries: [out('a', '월세', 100_000, 10)],
    });
    const result = settle(s, 500_000, new Date('2026-03-10T23:00:00+09:00'));
    expect(result.passedOut).toBe(0);
    expect(result.diff).toBe(0);
  });

  it('생활비 기간 중간에 정산하면 일할 페이스가 기준이 된다', () => {
    const s = state({
      balance: { amount: 300_000, checkedAt: '2026-03-04T09:00:00+09:00' },
      entries: [span('a', '생활비', 100_000, '2026-03-05', '2026-03-15')],
    });
    // 3/10까지 6일치 = 9,090 × 6 = 54,540원이 예정 페이스.
    const result = settle(s, 245_460, new Date('2026-03-10T09:00:00+09:00'));
    expect(result.passedOut).toBe(54_540);
    expect(result.expected).toBe(245_460);
    expect(result.diff).toBe(0);
    // 정산 후에도 남은 기간 몫만 한도에서 빠진다 — 이중 차감이 없다.
    const after = state({
      ...s,
      balance: { amount: 245_460, checkedAt: '2026-03-10T09:00:00+09:00' },
    });
    expect(limitOn(after, '2026-03-15', '2026-03-10')).toBe(245_460 - (100_000 - 54_540));
    expect(limitOn(after, '2026-03-15', '2026-03-10')).toBe(200_000);
  });

  it('한 달을 통째로 건너뛰어도 지나간 예정을 모두 센다', () => {
    const s = state({
      balance: { amount: 3_000_000, checkedAt: '2026-01-05T09:00:00+09:00' },
      entries: [out('a', '월세', 600_000, 10)],
    });
    const result = settle(s, 1_000_000, new Date('2026-03-15T09:00:00+09:00'));
    expect(result.passedOut).toBe(1_800_000);
    expect(result.expected).toBe(1_200_000);
    expect(result.diff).toBe(-200_000);
  });
});

describe('구간 규칙의 일관성', () => {
  it('세 스케줄 모두에서 정산과 한도가 같은 규칙을 쓴다 — 이중 차감이 없다', () => {
    const entries = [
      out('a', '월세', 600_000, 10),
      inc('b', '부수입', 200_000, 15),
      once('c', '경조사', 50_000, '2026-03-18'),
      every('d', '적금', 30_000, 7, '2026-03-05'),
      span('e', '생활비', 100_000, '2026-03-08', '2026-03-20'),
    ];
    const passed = netBetween(entries, '2026-03-07', '2026-03-12');
    const remaining = netBetween(entries, '2026-03-12', '2026-04-24');
    expect(passed + remaining).toBe(netBetween(entries, '2026-03-07', '2026-04-24'));
  });

  it('정산 후 다시 계산해도 한도가 어긋나지 않는다', () => {
    const s = state({
      balance: { amount: 1_000_000, checkedAt: '2026-03-07T09:00:00+09:00' },
      entries: [out('a', '월세', 600_000, 10), every('b', '적금', 30_000, 7, '2026-03-05')],
    });
    const before = limitOn(s, '2026-03-24', '2026-03-07');

    // 3/12에 예정대로 정확히 맞아떨어지는 잔고를 적었다.
    // (3/7, 3/12] 사이 지나간 것: 3/10 월세, 3/12 적금(3/5+7일). 3/5분은 구간 밖이다.
    const result = settle(s, 1_000_000 - 600_000 - 30_000, new Date('2026-03-12T09:00:00+09:00'));
    expect(result.diff).toBe(0);
    const after = state({
      ...s,
      balance: { amount: 370_000, checkedAt: '2026-03-12T09:00:00+09:00' },
    });
    expect(limitOn(after, '2026-03-24', '2026-03-12')).toBe(before);
  });
});
