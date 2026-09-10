/**
 * 복원 검증과 교체 계획.
 *
 * 지키려는 것 두 가지.
 *   1. 잘못된 파일은 **아무것도 건드리기 전에** 걸러진다. 오늘 날짜나 기본값으로
 *      조용히 바꿔 넣지 않는다
 *   2. 전체 교체는 "먼저 쓰고, 다 됐을 때만 지운다". 지우는 목록은 네 컬렉션 모두에서 뽑는다
 */
import { describe, expect, it } from 'vitest';
import { newEntry } from '../domain/entry';
import { defaultRecoveryRule } from '../domain/recovery';
import type { Account, BackupCollection, Debt, Entry, Pin } from '../domain/types';
import type { BackupData } from './backup';
import { readBackupFile } from './backupFile';
import type { CreateManyResult } from './repo';
import {
  countDocs, describeProblem, planMerge, REPLACE_DISABLED_REASON, safeMerge, safeReplace,
  validateBackup, type RestoreIO,
} from './restore';

const account = (p: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-09-01', checkedAt: '2026-09-01T00:00:00.000Z',
  order: 0, createdAt: '', updatedAt: '', ...p,
});
const debt = (p: Partial<Debt> = {}): Debt => ({
  id: 'd1', name: '학자금', balanceMinor: 5_000_000, monthlyMinor: 200_000,
  rate: 3.5, currentRound: 1, totalRounds: 25, order: 0, createdAt: '', updatedAt: '', ...p,
});
const pin = (p: Partial<Pin> = {}): Pin => ({
  id: 'p1', lens: 'task', text: '이번 분기 목표', order: 0, createdAt: '', updatedAt: '', ...p,
});
const data = (p: Partial<BackupData> = {}): BackupData => ({
  entries: [], accounts: [], debts: [], pins: [], recovery: null, ...p,
});

describe('검증 — 온전한 파일은 통과한다', () => {
  it('네 컬렉션이 다 들어 있어도 문제없다', () => {
    const ok = data({
      entries: [newEntry('task', { id: 't1', title: '치과' }), newEntry('money', {
        id: 'm1', startDate: '2026-09-12',
        money: { type: 'expense', amountMinor: 65_000, currency: 'KRW', linkedEntryId: null },
      })],
      accounts: [account()], debts: [debt()], pins: [pin()],
    });
    expect(validateBackup(ok)).toEqual([]);
    expect(countDocs(ok)).toBe(5);
  });

  it('예전 형식(items 배열)을 옮긴 결과도 검증을 통과한다', () => {
    const legacy = {
      items: [{
        id: 'old-1', tab: 'todo', title: '예전 할 일',
        startISO: '2026-09-01T09:00:00.000Z', status: 'planned',
      }],
    };
    const r = readBackupFile(JSON.stringify(legacy));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.data.entries).toHaveLength(1);
      // 이관 변환기가 이미 한도에 맞춰 다듬으므로 도메인 검증도 통과해야 한다.
      expect(validateBackup(r.file.data)).toEqual([]);
    }
  });
});

describe('검증 — 잘못된 값은 조용히 바뀌지 않고 보고된다', () => {
  const firstReason = (d: BackupData) => validateBackup(d)[0]?.reason ?? '';

  it('id 가 비면 거른다', () => {
    expect(firstReason(data({ accounts: [account({ id: '' })] }))).toContain('id 가 비어');
  });

  it("id 에 '/' 가 있으면 거른다", () => {
    expect(firstReason(data({ pins: [pin({ id: 'a/b' })] }))).toContain("'/'");
  });

  it("id 에 '@' 가 있으면 거른다 — 반복 전개분과 구분되지 않는다", () => {
    expect(firstReason(data({ pins: [pin({ id: 'x@2026-09-01' })] }))).toContain("'@'");
  });

  it('Firestore 예약어 모양 id 를 거른다', () => {
    expect(firstReason(data({ pins: [pin({ id: '__balance__' })] }))).toContain('예약어');
  });

  it('파일 안에서 id 가 겹치면 거른다', () => {
    const dup = data({ pins: [pin({ id: 'same' }), pin({ id: 'same' })] });
    const problems = validateBackup(dup);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.reason).toContain('겹칩니다');
  });

  it('컬렉션이 다르면 같은 id 여도 괜찮다', () => {
    expect(validateBackup(data({ pins: [pin({ id: 'x' })], debts: [debt({ id: 'x' })] }))).toEqual([]);
  });

  it('날짜가 아닌 값을 오늘로 바꾸지 않는다', () => {
    // 읽기 계층(converters)은 방어적으로 오늘을 채우지만, 가져오기는 그러면 안 된다.
    const bad = data({ entries: [{ ...newEntry('task', { id: 't1' }), startDate: '2026-13-45' }] });
    expect(firstReason(bad)).toContain('날짜');
  });

  it('있을 수 없는 날짜(2월 30일)도 거른다', () => {
    const bad = data({ entries: [{ ...newEntry('task', { id: 't1' }), startDate: '2026-02-30' }] });
    expect(firstReason(bad)).toContain('날짜');
  });

  it('종료일이 시작일보다 앞서면 거른다', () => {
    const bad = data({
      entries: [{ ...newEntry('task', { id: 't1', startDate: '2026-09-10' }), endDate: '2026-09-01' }],
    });
    expect(firstReason(bad)).toContain('종료일');
  });

  it('시각 모양이 아니면 거른다', () => {
    const bad = data({ entries: [{ ...newEntry('task', { id: 't1' }), startTime: '25:00' }] });
    expect(firstReason(bad)).toContain('시각');
  });

  it('금액이 실수면 거른다 — 최소 단위 정수여야 한다', () => {
    const bad = data({
      entries: [newEntry('money', {
        id: 'm1', startDate: '2026-09-01',
        money: { type: 'expense', amountMinor: 1234.5, currency: 'KRW', linkedEntryId: null },
      })],
    });
    expect(firstReason(bad)).toContain('정수');
  });

  it('금액이 음수면 거른다 — 부호는 종류가 정한다', () => {
    const bad = data({
      entries: [newEntry('money', {
        id: 'm1', startDate: '2026-09-01',
        money: { type: 'expense', amountMinor: -1000, currency: 'KRW', linkedEntryId: null },
      })],
    });
    expect(firstReason(bad)).toContain('음수');
  });

  it('잔고가 정수가 아니면 거른다', () => {
    expect(firstReason(data({ accounts: [account({ balanceMinor: 1.5 })] }))).toContain('정수');
  });

  it('저장 규칙 한도를 넘는 값을 미리 거른다', () => {
    const long = data({ entries: [{ ...newEntry('task', { id: 't1' }), title: 'x'.repeat(501) }] });
    expect(firstReason(long)).toContain('제목');
    const tags = data({
      entries: [{ ...newEntry('task', { id: 't1' }), tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }],
    });
    expect(firstReason(tags)).toContain('태그');
    const text = data({ pins: [pin({ text: 'x'.repeat(2001) })] });
    expect(firstReason(text)).toContain('내용');
  });

  it('반복 규칙이 망가져 있으면 거른다', () => {
    const bad = data({
      entries: [{
        ...newEntry('task', { id: 't1' }),
        recurrence: { freq: 'weekly', interval: 0, until: null, count: null },
      }],
    });
    expect(firstReason(bad)).toContain('반복 간격');
  });

  it('렌즈를 알 수 없는 고정 메모를 거른다', () => {
    expect(firstReason(data({ pins: [pin({ lens: 'nope' as Pin['lens'] })] }))).toContain('렌즈');
  });

  it('문제는 어디인지와 함께 보고한다', () => {
    const bad = data({ accounts: [account({ id: 'a1', balanceMinor: 1.5 })] });
    expect(describeProblem(validateBackup(bad)[0]!)).toContain('accounts/a1');
  });

  it('여러 건이면 여러 건 모두 보고한다', () => {
    const bad = data({
      accounts: [account({ id: 'a1', balanceMinor: 1.5 }), account({ id: 'a2', asOf: 'nope' })],
      pins: [pin({ id: '' })],
    });
    expect(validateBackup(bad)).toHaveLength(3);
  });
});

describe('병합 계획', () => {
  const current = data({
    entries: [newEntry('task', { id: 'mine', title: '원본' })],
    pins: [pin({ id: 'p1' })],
  });
  const incoming = data({
    entries: [newEntry('task', { id: 'mine', title: '들어온 것' }), newEntry('task', { id: 'theirs' })],
    pins: [pin({ id: 'p1', text: '다른 내용' }), pin({ id: 'p2' })],
  });

  it('파일에만 있는 것을 더한다. 같은 id 는 지금 것을 남긴다', () => {
    const add = planMerge(current, incoming);
    expect(add.entries.map((e) => e.id)).toEqual(['theirs']);
    expect(add.pins.map((p) => p.id)).toEqual(['p2']);
  });

  it('아무것도 지우지 않는다 — 계획에 지울 목록 자체가 없다', () => {
    expect(Object.keys(planMerge(current, incoming))).not.toContain('remove');
  });

  it('회복 규칙은 쓰고 있는 것을 남긴다', () => {
    const mine = data({ recovery: { ...defaultRecoveryRule(), enabled: true } });
    expect(planMerge(mine, incoming).recovery).toBe(mine.recovery);
  });
});

describe('무결성 — Entry 가 아닌 값', () => {
  it('가계부 항목에 금액이 없으면 거른다', () => {
    const bad = data({ entries: [{ ...newEntry('task', { id: 'm1' }), kind: 'money' } as Entry] });
    expect(validateBackup(bad)[0]?.reason).toContain('금액');
  });

  it('종류를 알 수 없으면 거른다', () => {
    const bad = data({ entries: [{ ...newEntry('task', { id: 'x1' }), kind: 'wat' as Entry['kind'] }] });
    expect(validateBackup(bad)[0]?.reason).toContain('종류');
  });
});

// ---------- 실행 — 무엇이 보존되는가 ----------

/**
 * 가짜 저장소.
 *
 * `createIfAbsent` 는 실제 구현과 같은 약속을 지킨다 — 이미 있으면 **건드리지 않고**
 * 충돌로 남긴다. 그래야 "덮어쓰지 않는다" 를 값으로 확인할 수 있다.
 */
function fakeStore(seed: BackupData, opts: { failWrites?: Set<string> } = {}) {
  const state: BackupData = {
    entries: [...seed.entries], accounts: [...seed.accounts],
    debts: [...seed.debts], pins: [...seed.pins], recovery: seed.recovery,
  };
  const log: string[] = [];
  const keys: BackupCollection[] = ['entries', 'accounts', 'debts', 'pins'];

  const io: RestoreIO = {
    fetchAll: async () => {
      log.push('fetchAll');
      return {
        entries: [...state.entries], accounts: [...state.accounts],
        debts: [...state.debts], pins: [...state.pins],
      };
    },
    createIfAbsent: async (payload) => {
      log.push('create');
      const result: CreateManyResult = { created: 0, conflicts: [], failed: [], allFailed: false };
      let total = 0;
      for (const key of keys) {
        for (const item of payload[key] ?? []) {
          total += 1;
          if (opts.failWrites?.has(item.id)) {
            result.failed.push({ collection: key, id: item.id, reason: '주입한 실패' });
            continue;
          }
          const list = state[key] as { id: string }[];
          if (list.some((x) => x.id === item.id)) {
            // 이미 있다. 덮어쓰지 않는다.
            result.conflicts.push({ collection: key, id: item.id });
            continue;
          }
          list.push(item);
          result.created += 1;
        }
      }
      result.allFailed = total > 0 && result.created === 0 && result.conflicts.length === 0;
      return result;
    },
  };
  return { io, state, log };
}

const seeded = () => data({
  entries: [newEntry('task', { id: 'A', title: '내 것' }), newEntry('task', { id: 'old-2' })],
  accounts: [account({ id: 'a-old' })],
  debts: [debt({ id: 'd-old' })],
  pins: [pin({ id: 'p-old' })],
});

describe('전체 교체 — 꺼져 있다', () => {
  it('저장소를 한 번도 부르지 않는다', () => {
    const outcome = safeReplace();
    expect(outcome.kind).toBe('replace-disabled');
    if (outcome.kind === 'replace-disabled') {
      expect(outcome.reason).toBe(REPLACE_DISABLED_REASON);
    }
  });

  it('RestoreIO 를 받지도 않는다 — 쓰기·삭제가 새어 나갈 자리가 없다', () => {
    expect(safeReplace).toHaveLength(0);
  });

  it('이유가 사용자에게 보여 줄 문장이다', () => {
    expect(REPLACE_DISABLED_REASON).toContain('되돌릴 방법이 없');
    expect(REPLACE_DISABLED_REASON).toContain('기존 데이터에 더하기');
  });
});

describe('병합 — 기존 문서를 덮어쓰지 않는다', () => {
  it('파일에만 있는 것을 더한다', async () => {
    const { io, state } = fakeStore(seeded());
    const outcome = await safeMerge(data({ entries: [newEntry('task', { id: 'new-1' })] }), io);

    expect(outcome.kind).toBe('ok');
    expect(state.entries.map((e) => e.id).sort()).toEqual(['A', 'new-1', 'old-2']);
    // 지우는 단계 자체가 없다.
    expect(state.debts.map((d) => d.id)).toEqual(['d-old']);
    expect(state.pins.map((p) => p.id)).toEqual(['p-old']);
  });

  it('같은 id 는 지금 것을 남긴다 — 내용이 달라도 덮지 않는다', async () => {
    const { io, state } = fakeStore(seeded());
    await safeMerge(data({ entries: [newEntry('task', { id: 'A', title: '파일 내용' })] }), io);
    expect(state.entries.find((e) => e.id === 'A')?.title).toBe('내 것');
  });

  it('조회 뒤에 다른 클라이언트가 같은 id 를 만들어도 덮어쓰지 않는다', async () => {
    const store = fakeStore(seeded());
    const real = store.io;
    const io: RestoreIO = {
      // 조회 시점에는 없다가...
      fetchAll: real.fetchAll,
      createIfAbsent: async (payload) => {
        // ...쓰기 직전에 다른 탭이 같은 id 를 만든다.
        store.state.entries.push(newEntry('task', { id: 'race', title: '다른 탭이 먼저' }));
        return real.createIfAbsent(payload);
      },
    };

    const outcome = await safeMerge(data({ entries: [newEntry('task', { id: 'race', title: '파일 내용' })] }), io);

    expect(outcome.kind).toBe('partial');
    if (outcome.kind === 'partial') {
      expect(outcome.created.conflicts.map((c) => c.id)).toEqual(['race']);
      expect(outcome.created.created).toBe(0);
    }
    // 먼저 만들어진 쪽이 남는다.
    expect(store.state.entries.find((e) => e.id === 'race')?.title).toBe('다른 탭이 먼저');
  });

  it('A 를 더한 뒤 B 가 실패해도 A 의 기존 내용은 그대로다', async () => {
    // 필수 회귀 사례: 기존 A 와 백업 A 의 내용이 다른 상태에서 B 저장 실패.
    const { io, state } = fakeStore(seeded(), { failWrites: new Set(['B']) });
    const outcome = await safeMerge(data({
      entries: [newEntry('task', { id: 'A', title: '파일 내용' }), newEntry('task', { id: 'B' })],
    }), io);

    // A 는 조회 시점에 이미 있어 후보에서 빠졌고, B 는 실패했다 — 들어간 것이 없다.
    expect(outcome.kind).toBe('all-failed');
    if (outcome.kind === 'all-failed') {
      expect(outcome.skippedExisting).toBe(1);
      expect(outcome.created.failed.map((f) => f.id)).toEqual(['B']);
    }
    // A 는 쓰기를 시도하지도 않았다 — 원래 내용이 그대로다.
    expect(state.entries.find((e) => e.id === 'A')?.title).toBe('내 것');
    expect(state.entries.find((e) => e.id === 'B')).toBeUndefined();
  });

  it('전체 실패면 all-failed 로 알린다', async () => {
    const { io, state } = fakeStore(seeded(), { failWrites: new Set(['new-1', 'new-2']) });
    const outcome = await safeMerge(data({
      entries: [newEntry('task', { id: 'new-1' }), newEntry('task', { id: 'new-2' })],
    }), io);

    expect(outcome.kind).toBe('all-failed');
    expect(state.entries.map((e) => e.id).sort()).toEqual(['A', 'old-2']);
  });

  it('부분 성공 뒤 다시 하면 못 들어간 것만 들어간다', async () => {
    const first = fakeStore(seeded(), { failWrites: new Set(['B']) });
    const payload = data({ entries: [newEntry('task', { id: 'A' }), newEntry('task', { id: 'B' })] });
    expect((await safeMerge(payload, first.io)).kind).toBe('all-failed');

    const retry = fakeStore(first.state);
    const outcome = await safeMerge(payload, retry.io);
    expect(outcome.kind).toBe('ok');
    expect(retry.state.entries.map((e) => e.id).sort()).toEqual(['A', 'B', 'old-2']);
  });

  it('두 번 연속 가져와도 같은 자리에 머문다', async () => {
    const store = fakeStore(seeded());
    const payload = data({ entries: [newEntry('task', { id: 'new-1' })] });
    await safeMerge(payload, store.io);
    const second = await safeMerge(payload, store.io);

    // 두 번째에는 더할 것이 없다 — 저장소를 쓰지도 않는다.
    expect(second.kind).toBe('ok');
    if (second.kind === 'ok') expect(second.created.created).toBe(0);
    expect(store.state.entries.filter((e) => e.id === 'new-1')).toHaveLength(1);
  });

  it('잘못된 파일이면 저장소를 한 번도 부르지 않는다', async () => {
    const { io, log } = fakeStore(seeded());
    expect((await safeMerge(data({ pins: [pin({ id: 'a/b' })] }), io)).kind).toBe('invalid');
    expect(log).toEqual([]);
  });

  it('더할 것이 없으면 쓰지 않는다', async () => {
    const { io, log } = fakeStore(seeded());
    const outcome = await safeMerge(data({ entries: [newEntry('task', { id: 'A' })] }), io);
    expect(outcome.kind).toBe('ok');
    expect(log).toEqual(['fetchAll']);
  });
});
