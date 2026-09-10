/**
 * 백업 파일 읽기 — **파일 문자열에서 시작한다.**
 *
 * 이미 보정된 `BackupData` 를 넣고 검증하는 테스트는 아무것도 지키지 못한다. 문제는
 * 변환기가 잘못된 값을 이미 고쳐 놓는다는 것이었으므로, 테스트도 원시 JSON 문자열에서
 * 출발해야 그 구멍을 잡는다.
 */
import { describe, expect, it } from 'vitest';
import { readBackupFile, type ReadResult } from './backupFile';

const read = (obj: unknown): ReadResult => readBackupFile(JSON.stringify(obj));

const problemsOf = (r: ReadResult): string[] =>
  r.ok ? [] : r.problems.map((p) => `${p.where} — ${p.reason}`);

/** v3 백업의 최소 뼈대. 여기에 잘못된 값을 하나씩 얹어 본다. */
const v3 = (over: Record<string, unknown> = {}) => ({
  app: 'Dada Calendar', version: 3, exportedAt: '2026-09-10T00:00:00.000Z',
  entries: [], accounts: [], debts: [], pins: [], recovery: null, ...over,
});

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1', kind: 'task', title: '치과', note: '', color: 'blue', tags: [], location: '',
  startDate: '2026-09-12', startTime: null, endDate: null, endTime: null,
  ymSpan: ['2026-09'], isRecurring: false, recurrence: null,
  task: { status: 'planned', important: false, urgent: false, order: 0 },
  money: null, createdAt: '', updatedAt: '', ...over,
});

const moneyEntry = (over: Record<string, unknown> = {}) => entry({
  id: 'm1', kind: 'money', task: null,
  money: { type: 'expense', amountMinor: 65_000, currency: 'KRW', linkedEntryId: null },
  ...over,
});

const acct = (over: Record<string, unknown> = {}) => ({
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-09-01', checkedAt: '2026-09-01T00:00:00.000Z', order: 0,
  createdAt: '', updatedAt: '', ...over,
});

describe('온전한 파일', () => {
  it('v3 를 읽는다', () => {
    const r = read(v3({ entries: [entry()], accounts: [acct()] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.format).toBe('v3');
      expect(r.file.data.entries[0]?.title).toBe('치과');
      expect(r.file.data.accounts[0]?.balanceMinor).toBe(1_000_000);
      expect(r.file.notes).toEqual([]);
    }
  });

  it('v2 를 읽는다 (recovery 없음)', () => {
    const { recovery: _drop, ...rest } = v3({ entries: [entry()] });
    const r = read({ ...rest, version: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.format).toBe('v2');
      expect(r.file.data.recovery).toBeNull();
    }
  });
});

describe('파일 자체', () => {
  it('JSON 이 아니면 거른다', () => {
    expect(problemsOf(readBackupFile('{ 이건 JSON 이 아니다'))).toEqual([
      '파일 — JSON 형식이 아닙니다. 백업 파일이 맞는지 확인해 주세요.',
    ]);
  });

  it('배열이면 거른다', () => {
    expect(problemsOf(read([1, 2, 3]))[0]).toContain('읽을 수 없습니다');
  });

  it('다른 앱의 백업이면 거른다', () => {
    expect(problemsOf(read(v3({ app: '다른 앱' })))[0]).toContain('이 앱의 백업이 아닙니다');
  });

  it('버전이 없으면 거른다', () => {
    const { version: _drop, ...rest } = v3();
    expect(problemsOf(read(rest))[0]).toContain('버전이 없습니다');
  });

  it('미래 버전이면 거른다 — 조용히 읽어 내려가지 않는다', () => {
    const p = problemsOf(read(v3({ version: 99 })))[0]!;
    expect(p).toContain('아직 모르는 버전');
    expect(p).toContain('99');
  });

  it('버전이 정수가 아니면 거른다', () => {
    expect(problemsOf(read(v3({ version: '3' })))[0]).toContain('정수가 아닙니다');
  });
});

describe('컬렉션 형식 — 빠진 것을 빈 배열로 넘겨짚지 않는다', () => {
  it.each(['entries', 'accounts', 'debts', 'pins'])('%s 가 없으면 거른다', (name) => {
    const obj = v3();
    delete (obj as Record<string, unknown>)[name];
    const p = problemsOf(read(obj));
    expect(p.some((x) => x.startsWith(name) && x.includes('반드시'))).toBe(true);
  });

  it('배열이 아니면 거른다', () => {
    expect(problemsOf(read(v3({ debts: {} })))[0]).toContain('배열이 아닙니다');
  });

  it('원소가 객체가 아니면 거른다', () => {
    expect(problemsOf(read(v3({ pins: ['문자열'] })))[0]).toContain('객체가 아닙니다');
  });

  it('v2 파일에 recovery 가 있으면 거른다', () => {
    const { recovery: _drop, ...rest } = v3();
    expect(problemsOf(read({ ...rest, version: 2, recovery: { enabled: true } }))[0])
      .toContain('version 2');
  });
});

describe('id — 원시 JSON 에서 본다', () => {
  it('id 가 없으면 거른다 (예전에는 조용히 버렸다)', () => {
    const { id: _drop, ...rest } = entry();
    expect(problemsOf(read(v3({ entries: [rest] })))[0]).toContain('id 가 없습니다');
  });

  it('id 가 숫자면 거른다', () => {
    expect(problemsOf(read(v3({ entries: [entry({ id: 12 })] })))[0]).toContain('문자열이 아닙니다');
  });

  it('id 가 겹치면 거른다', () => {
    const p = problemsOf(read(v3({ entries: [entry({ id: 'same' }), entry({ id: 'same' })] })));
    expect(p[0]).toContain('겹칩니다');
  });

  it("'/' · '@' · 예약어 모양을 거른다", () => {
    expect(problemsOf(read(v3({ pins: [{ id: 'a/b', lens: 'task', text: 'x' }] })))[0]).toContain("'/'");
    expect(problemsOf(read(v3({ pins: [{ id: 'a@b', lens: 'task', text: 'x' }] })))[0]).toContain("'@'");
    expect(problemsOf(read(v3({ pins: [{ id: '__x__', lens: 'task', text: 'x' }] })))[0]).toContain('예약어');
  });

  it('컬렉션이 다르면 같은 id 여도 괜찮다', () => {
    const r = read(v3({
      entries: [entry({ id: 'x' })],
      pins: [{ id: 'x', lens: 'task', text: '메모' }],
    }));
    expect(r.ok).toBe(true);
  });
});

describe('날짜 — 변환기가 오늘로 바꾸기 전에 본다', () => {
  it('있을 수 없는 날짜를 거른다', () => {
    // 예전에는 entryFromDoc 이 todayISO() 로 갈아 끼워 검증기에 닿지 않았다.
    expect(problemsOf(read(v3({ entries: [entry({ startDate: '2026-13-45' })] })))[0])
      .toContain('날짜(YYYY-MM-DD)가 아닙니다');
  });

  it('2월 30일도 거른다', () => {
    expect(problemsOf(read(v3({ entries: [entry({ startDate: '2026-02-30' })] })))[0]).toContain('2026-02-30');
  });

  it('날짜가 숫자면 거른다', () => {
    expect(problemsOf(read(v3({ entries: [entry({ startDate: 20260912 })] })))[0])
      .toContain('문자열이 아닙니다');
  });

  it('종료일이 시작일보다 앞서면 거른다', () => {
    expect(problemsOf(read(v3({ entries: [entry({ startDate: '2026-09-10', endDate: '2026-09-01' })] })))[0])
      .toContain('앞섭니다');
  });

  it('시각이 HH:mm 이 아니면 거른다', () => {
    expect(problemsOf(read(v3({ entries: [entry({ startTime: '25:00' })] })))[0]).toContain('시각(HH:mm)');
  });

  it('잔고 기준일도 본다', () => {
    expect(problemsOf(read(v3({ accounts: [acct({ asOf: 'nope' })] })))[0]).toContain('날짜');
  });
});

describe('금액 — 실수·문자열을 조용히 바꾸지 않는다', () => {
  it('소수 금액을 거른다 (예전에는 Math.trunc 로 잘렸다)', () => {
    const p = problemsOf(read(v3({ entries: [moneyEntry({ money: { type: 'expense', amountMinor: 1234.5, currency: 'KRW', linkedEntryId: null } })] })));
    expect(p[0]).toContain('정수가 아닙니다');
    expect(p[0]).toContain('1234.5');
  });

  it('문자열 금액을 거른다', () => {
    const p = problemsOf(read(v3({ entries: [moneyEntry({ money: { type: 'expense', amountMinor: '65000', currency: 'KRW', linkedEntryId: null } })] })));
    expect(p[0]).toContain('금액이 문자열입니다');
  });

  it('음수 금액을 거른다 — 부호는 종류가 정한다', () => {
    const p = problemsOf(read(v3({ entries: [moneyEntry({ money: { type: 'expense', amountMinor: -1000, currency: 'KRW', linkedEntryId: null } })] })));
    expect(p[0]).toContain('음수');
  });

  it('가계부 항목에 money 가 없으면 거른다', () => {
    expect(problemsOf(read(v3({ entries: [moneyEntry({ money: null })] })))[0]).toContain('금액이 없습니다');
  });

  it('잔고가 실수면 거른다', () => {
    expect(problemsOf(read(v3({ accounts: [acct({ balanceMinor: 1.5 })] })))[0]).toContain('정수가 아닙니다');
  });

  it('대출 금액도 본다', () => {
    const p = problemsOf(read(v3({ debts: [{ id: 'd1', name: '학자금', balanceMinor: '5000000', monthlyMinor: 200_000 }] })));
    expect(p[0]).toContain('문자열');
  });
});

describe('그 밖의 형태', () => {
  it('종류를 알 수 없으면 거른다', () => {
    expect(problemsOf(read(v3({ entries: [entry({ kind: 'wat' })] })))[0]).toContain('종류를 알 수 없습니다');
  });

  it('반복 간격이 0이면 거른다', () => {
    const p = problemsOf(read(v3({ entries: [entry({ recurrence: { freq: 'weekly', interval: 0, until: null, count: null } })] })));
    expect(p[0]).toContain('1 이상의 정수');
  });

  it('저장 규칙 한도를 미리 본다', () => {
    expect(problemsOf(read(v3({ entries: [entry({ title: 'x'.repeat(501) })] })))[0]).toContain('500자를 넘습니다');
    expect(problemsOf(read(v3({ accounts: [acct({ checkedAt: 'x'.repeat(41) })] })))[0]).toContain('40자를 넘습니다');
  });

  it('렌즈를 알 수 없는 고정 메모를 거른다', () => {
    expect(problemsOf(read(v3({ pins: [{ id: 'p1', lens: 'nope', text: '메모' }] })))[0]).toContain('렌즈');
  });

  it('여러 곳이 잘못되면 여러 곳을 모두 보고한다', () => {
    const p = problemsOf(read(v3({
      entries: [entry({ startDate: 'nope' })],
      accounts: [acct({ balanceMinor: 1.5 })],
      pins: [{ id: '', lens: 'task', text: 'x' }],
    })));
    expect(p).toHaveLength(3);
  });

  it('문제가 있으면 변환을 아예 하지 않는다', () => {
    const r = read(v3({ entries: [entry({ startDate: '2026-13-45' })] }));
    expect(r.ok).toBe(false);
    // ok:false 에는 data 가 없다 — 보정된 값이 새어 나갈 자리가 없다.
    expect('file' in r).toBe(false);
  });
});

describe('예전 형식 — 달라지는 것을 숨기지 않는다', () => {
  it('items 배열을 읽고 형식을 알린다', () => {
    const r = read({
      items: [{ id: 'old-1', tab: 'todo', title: '예전 할 일', startISO: '2026-09-01T09:00:00.000Z', status: 'planned' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.format).toBe('legacy');
      expect(r.file.version).toBe(1);
      expect(r.file.data.entries).toHaveLength(1);
    }
  });

  it('제외된 항목을 이유와 함께 돌려준다', () => {
    const r = read({ items: [
      { id: 'bad', tab: '없는탭', title: '어디에도 안 맞는 것' },
      { id: 'ok', tab: 'todo', title: '남는 것', startISO: '2026-09-01T00:00:00.000Z' },
    ] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 변환기가 건너뛴 사실이 notes 로 나와야 한다. 조용히 사라지면 안 된다.
      expect(r.file.notes.some((n) => n.id === 'bad')).toBe(true);
      expect(r.file.data.entries.map((e) => e.id)).toEqual(['ok']);
    }
  });

  it('잘린 항목도 이유와 함께 돌려준다', () => {
    const r = read({ items: [{ id: 'long', tab: 'todo', title: 'x'.repeat(600), startISO: '2026-09-01T00:00:00.000Z' }] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.notes.some((n) => n.reason.includes('잘랐습니다'))).toBe(true);
      expect(r.file.data.entries[0]?.title).toHaveLength(500);
    }
  });

  it('items 원소가 객체가 아니면 거른다', () => {
    expect(problemsOf(read({ items: ['문자열'] }))[0]).toContain('객체가 아닙니다');
  });
});
