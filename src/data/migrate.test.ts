import { describe, expect, it } from 'vitest';
import { BALANCE_TITLE, LOANS_TITLE, convertLegacyItems, extractMoneyLabel, summarize } from './migrate';

/** 이관 전 실제 저장 형태를 그대로 옮긴 픽스처. */
const legacy = {
  todo: {
    id: 'a1', tab: 'todo', title: '치과 예약',
    startISO: '2026-08-03T14:30', endISO: '2026-08-03T15:30',
    startHasTime: true, endHasTime: true,
    location: '강남', important: true, urgent: false,
    status: 'in-progress', repeat: 'none', order: 3,
    memo: '스케일링', tags: ['건강'], color: 'red',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z',
  },
  todoSpan: {
    id: 'a2', tab: 'todo', title: '휴가',
    startISO: '2026-08-10', endISO: '2026-08-14',
    startHasTime: false, endHasTime: false,
    status: 'planned', repeat: 'none', color: 'green', tags: [], memo: '',
  },
  todoRepeat: {
    id: 'a3', tab: 'todo', title: '주간 회의',
    startISO: '2026-08-03', endISO: '2026-08-03',
    status: 'planned', repeat: 'weekly', color: 'blue', tags: [], memo: '',
  },
  idea: {
    id: 'b1', tab: 'day', title: '뉴스레터 아이디어',
    dateISO: '2026-8-5', color: 'violet', tags: [], memo: '주 1회 발행',
  },
  money: {
    id: 'c1', tab: 'money', title: '나갈 돈 45,000원 · 전기요금',
    dateISO: '2026-08-15', moneyType: 'expense', amount: 45000,
    memo: '전기요금', color: 'red', tags: [], status: 'planned',
  },
  moneyNoLabel: {
    id: 'c2', tab: 'money', title: '예상 입금 2,500,000원',
    dateISO: '2026-08-25', moneyType: 'income', amount: 2500000,
    memo: '', color: 'green', tags: [], status: 'planned',
  },
  moneyRanged: {
    id: 'c3', tab: 'money', title: '생활비 600,000원',
    dateISO: '2026-08-01', moneyEnd: '2026-08-31',
    moneyType: 'living', amount: 600000, memo: '', color: 'blue', tags: [], status: 'planned',
  },
  pin: {
    id: 'd1', tab: 'todo', title: '이번 분기 목표: 런칭',
    pinned: true, pinOrder: 1, dateISO: '2026-08-01', color: 'blue', tags: [], memo: '', status: 'planned',
  },
  balance: {
    id: 'e1', tab: 'money', title: BALANCE_TITLE, memo: '1350000',
    dateISO: '2026-08-19', pinned: true, color: 'green', tags: [], status: 'planned',
    updatedAt: '2026-08-19T00:00:00.000Z',
  },
  loans: {
    id: 'f1', tab: 'money', title: LOANS_TITLE, pinned: true, color: 'orange', tags: [], status: 'planned',
    memo: JSON.stringify([
      { name: '카카오뱅크', balance: 5000000, monthly: 300000, rate: '3.5', current: 12, total: 60 },
      { name: '학자금', balance: 2000000, monthly: 150000, rate: '', current: 0, total: 0 },
    ]),
    dateISO: '2026-08-19',
  },
};

describe('convertLegacyItems — 할 일', () => {
  const r = convertLegacyItems([legacy.todo]);
  const e = r.entries[0];

  it('탭을 kind 로 옮긴다', () => {
    expect(e?.kind).toBe('task');
  });
  it('날짜와 시각을 가른다', () => {
    expect(e?.startDate).toBe('2026-08-03');
    expect(e?.startTime).toBe('14:30');
    expect(e?.endTime).toBe('15:30');
  });
  it('같은 날 하루짜리면 endDate 를 비운다', () => {
    expect(e?.endDate).toBeNull();
  });
  it('할 일 속성을 옮긴다', () => {
    expect(e?.task).toEqual({ status: 'in-progress', important: true, urgent: false, order: 3 });
  });
  it('메모·태그·장소·색상을 지킨다', () => {
    expect(e?.note).toBe('스케일링');
    expect(e?.tags).toEqual(['건강']);
    expect(e?.location).toBe('강남');
    expect(e?.color).toBe('red');
  });
  it('생성·수정 시각을 지킨다', () => {
    expect(e?.createdAt).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('convertLegacyItems — 기간과 반복', () => {
  it('기간형 할 일의 ymSpan 을 만든다', () => {
    const e = convertLegacyItems([legacy.todoSpan]).entries[0];
    expect(e?.endDate).toBe('2026-08-14');
    expect(e?.ymSpan).toEqual(['2026-08']);
    expect(e?.startTime).toBeNull();
  });
  it('repeat 를 recurrence 로 살려낸다 — 저장만 되고 죽어 있던 값', () => {
    const e = convertLegacyItems([legacy.todoRepeat]).entries[0];
    expect(e?.recurrence).toEqual({ freq: 'weekly', interval: 1, until: null, count: null });
    expect(e?.isRecurring).toBe(true);
  });
  it("repeat: 'none' 은 반복으로 보지 않는다", () => {
    expect(convertLegacyItems([legacy.todo]).entries[0]?.recurrence).toBeNull();
  });
});

describe('convertLegacyItems — 아이디어', () => {
  it("tab 'day' 를 idea 로 옮기고 패딩 없는 날짜를 고친다", () => {
    const e = convertLegacyItems([legacy.idea]).entries[0];
    expect(e?.kind).toBe('idea');
    expect(e?.startDate).toBe('2026-08-05');
    expect(e?.task).toBeNull();
    expect(e?.note).toBe('주 1회 발행');
  });
});

describe('convertLegacyItems — 가계부', () => {
  it('자동 생성된 제목에서 사용자 라벨만 되찾는다', () => {
    const e = convertLegacyItems([legacy.money]).entries[0];
    expect(e?.title).toBe('전기요금');
    expect(e?.money?.amountMinor).toBe(45000);
    expect(e?.money?.type).toBe('expense');
    expect(e?.money?.currency).toBe('KRW');
  });
  it('라벨이 없던 항목은 제목을 비운다 — 화면에서 유형명으로 파생한다', () => {
    const e = convertLegacyItems([legacy.moneyNoLabel]).entries[0];
    expect(e?.title).toBe('');
    expect(e?.money?.amountMinor).toBe(2500000);
  });
  it('제목과 같은 메모를 중복 저장하지 않는다', () => {
    expect(convertLegacyItems([legacy.money]).entries[0]?.note).toBe('');
  });
  it('기간형 가계부의 moneyEnd 를 endDate 로 옮긴다', () => {
    const e = convertLegacyItems([legacy.moneyRanged]).entries[0];
    expect(e?.startDate).toBe('2026-08-01');
    expect(e?.endDate).toBe('2026-08-31');
    expect(e?.money?.type).toBe('living');
  });
});

describe('convertLegacyItems — 고정 메모', () => {
  it('pinned 항목을 pins 로 뺀다', () => {
    const r = convertLegacyItems([legacy.pin]);
    expect(r.entries).toHaveLength(0);
    expect(r.pins[0]).toMatchObject({ lens: 'task', text: '이번 분기 목표: 런칭', order: 1 });
  });
});

describe('convertLegacyItems — ::balance:: 우회 해제', () => {
  it('memo 의 문자열 금액을 잔고 계좌로 만든다', () => {
    const r = convertLegacyItems([legacy.balance]);
    expect(r.entries).toHaveLength(0);
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0]).toMatchObject({ name: '주계좌', balanceMinor: 1350000, currency: 'KRW' });
    expect(r.accounts[0]?.asOf).toBe('2026-08-19');
  });
  it('잔고 문서가 여러 개면 가장 최근 것만 남기고 보고한다', () => {
    const old = { ...legacy.balance, id: 'e0', memo: '999', updatedAt: '2026-01-01T00:00:00.000Z' };
    const r = convertLegacyItems([old, legacy.balance]);
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0]?.balanceMinor).toBe(1350000);
    expect(r.skipped).toHaveLength(1);
  });
});

describe('convertLegacyItems — ::loans:: 우회 해제', () => {
  const r = convertLegacyItems([legacy.loans]);

  it('한 문서의 JSON 배열을 대출 1건 = 1문서로 쪼갠다 — 덮어쓰기 원인 제거', () => {
    expect(r.debts).toHaveLength(2);
    expect(new Set(r.debts.map((d) => d.id)).size).toBe(2);
    // 원본 문서 id 에서 파생시켜 재실행해도 같은 문서를 가리킨다.
    expect(r.debts.map((d) => d.id)).toEqual(['f1-0', 'f1-1']);
  });
  it('금액과 회차를 정수로 옮긴다', () => {
    expect(r.debts[0]).toMatchObject({
      name: '카카오뱅크', balanceMinor: 5000000, monthlyMinor: 300000,
      rate: 3.5, currentRound: 12, totalRounds: 60, order: 0,
    });
  });
  it('문자열 이자율이 비어 있으면 null 로 둔다', () => {
    expect(r.debts[1]?.rate).toBeNull();
  });
  it('깨진 JSON 은 조용히 버리지 않고 보고한다', () => {
    const broken = convertLegacyItems([{ ...legacy.loans, memo: '{not json' }]);
    expect(broken.debts).toHaveLength(0);
    expect(broken.skipped).toHaveLength(1);
    expect(broken.skipped[0]?.reason).toContain('JSON');
  });
});

describe('convertLegacyItems — 전체', () => {
  const all = Object.values(legacy);
  const r = convertLegacyItems(all);

  it('아무 항목도 조용히 사라지지 않는다', () => {
    const accounted = r.entries.length + r.pins.length + r.accounts.length + r.skipped.length;
    // 대출 문서 1개가 2건으로 늘어나므로 문서 수 기준으로 센다.
    expect(accounted + 1).toBe(all.length);
    expect(r.legacyCount).toBe(all.length);
  });

  it('알 수 없는 탭은 건너뛰고 이유를 남긴다', () => {
    const r2 = convertLegacyItems([{ id: 'x', tab: 'memo', title: '옛 탭' }]);
    expect(r2.entries).toHaveLength(0);
    expect(r2.skipped[0]?.reason).toContain('memo');
  });

  it('id 가 없으면 순번으로 고정한다', () => {
    const r2 = convertLegacyItems([{ tab: 'todo', title: 'id 없음' }]);
    expect(r2.entries[0]?.id).toBe('legacy-0');
  });

  it('두 번 돌려도 같은 결과를 낸다 — 이관은 몇 번을 눌러도 안전해야 한다', () => {
    // 원본 items 를 지우지 않으므로 사용자가 이관을 두 번 누를 수 있다.
    // id 가 랜덤이면 대출이 두 건으로 늘어난다.
    const a = convertLegacyItems(all);
    const b = convertLegacyItems(all);
    expect(b.entries.map((e) => e.id)).toEqual(a.entries.map((e) => e.id));
    expect(b.debts.map((d) => d.id)).toEqual(a.debts.map((d) => d.id));
    expect(b.accounts.map((x) => x.id)).toEqual(a.accounts.map((x) => x.id));
    expect(b.pins.map((x) => x.id)).toEqual(a.pins.map((x) => x.id));
  });

  it('요약 문장을 낸다', () => {
    expect(summarize(r)).toContain('대출 2건');
  });
});

describe('저장 한도', () => {
  it('제목이 한도를 넘으면 자르고 보고한다 — 배치 전체가 실패하는 것을 막는다', () => {
    const r = convertLegacyItems([{ id: 'long', tab: 'todo', title: 'ㄱ'.repeat(600), startISO: '2026-08-01' }]);
    expect(r.entries[0]?.title).toHaveLength(500);
    expect(r.trimmed[0]?.reason).toContain('제목');
  });

  it('메모가 한도를 넘으면 자른다', () => {
    const r = convertLegacyItems([{ id: 'n', tab: 'todo', title: '메모 김', memo: 'ㄴ'.repeat(20_500), startISO: '2026-08-01' }]);
    expect(r.entries[0]?.note).toHaveLength(20_000);
    expect(r.trimmed.some((t) => t.reason.includes('메모'))).toBe(true);
  });

  it('태그가 한도를 넘으면 자른다', () => {
    const tags = Array.from({ length: 60 }, (_, i) => `t${i}`);
    const r = convertLegacyItems([{ id: 't', tab: 'todo', title: '태그 많음', tags, startISO: '2026-08-01' }]);
    expect(r.entries[0]?.tags).toHaveLength(50);
    expect(r.trimmed.some((t) => t.reason.includes('태그'))).toBe(true);
  });

  it('고정 메모도 한도에 맞춘다', () => {
    const r = convertLegacyItems([{ id: 'p', tab: 'todo', title: 'ㄷ'.repeat(2_500), pinned: true }]);
    expect(r.pins[0]?.text).toHaveLength(2_000);
  });

  it('한도 안이면 건드리지 않는다', () => {
    const r = convertLegacyItems([legacy.todo]);
    expect(r.trimmed).toHaveLength(0);
    expect(r.entries[0]?.title).toBe('치과 예약');
  });
});

describe('extractMoneyLabel', () => {
  it('자동 생성 접두를 걷어낸다', () => {
    expect(extractMoneyLabel('나갈 돈 45,000원 · 전기요금', 'expense')).toBe('전기요금');
    expect(extractMoneyLabel('예상 입금 2,500,000원', 'income')).toBe('');
  });
  it('사용자가 직접 쓴 제목은 건드리지 않는다', () => {
    expect(extractMoneyLabel('전기요금', 'expense')).toBe('전기요금');
    expect(extractMoneyLabel('월세 · 8월분', 'expense')).toBe('월세 · 8월분');
  });
});
