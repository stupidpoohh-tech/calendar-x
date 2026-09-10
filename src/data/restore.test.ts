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
import { parseBackup } from './backup';
import type { WriteManyResult } from './repo';
import {
  countDocs, describeProblem, planMerge, planReplace, safeMerge, safeReplace,
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

  it('예전 형식(version 1, items 배열)도 그대로 받는다', () => {
    const legacy = {
      items: [{
        id: 'old-1', type: 'todo', title: '예전 할 일',
        startISO: '2026-09-01T09:00:00.000Z', status: 'planned',
      }],
    };
    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.entries).toHaveLength(1);
    // 이관 변환기가 이미 한도에 맞춰 다듬으므로 검증을 통과해야 한다.
    expect(validateBackup(parsed)).toEqual([]);
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

describe('전체 교체 계획 — 네 컬렉션 모두', () => {
  const current = data({
    entries: [newEntry('task', { id: 'keep' }), newEntry('task', { id: 'drop' })],
    accounts: [account({ id: 'a-keep' }), account({ id: 'a-drop' })],
    debts: [debt({ id: 'd-drop' })],
    pins: [pin({ id: 'p-drop' })],
  });
  const incoming = data({
    entries: [newEntry('task', { id: 'keep' }), newEntry('task', { id: 'new' })],
    accounts: [account({ id: 'a-keep' })],
  });

  it('쓸 것은 백업 전체다 — 지우기 전에 전부 쓴다', () => {
    expect(planReplace(current, incoming).write).toBe(incoming);
  });

  it('지울 것은 지금 있는데 파일에 없는 것뿐이다', () => {
    const ids = planReplace(current, incoming).remove.map((r) => `${r.collection}/${r.id}`);
    expect(ids.sort()).toEqual([
      'accounts/a-drop', 'debts/d-drop', 'entries/drop', 'pins/p-drop',
    ]);
  });

  it('예전에는 일정만 지웠다 — 잔고·대출·고정 메모가 남았다', () => {
    const removed = planReplace(current, incoming).remove;
    // 이 세 줄이 그 구멍을 막는다.
    expect(removed.some((r) => r.collection === 'accounts')).toBe(true);
    expect(removed.some((r) => r.collection === 'debts')).toBe(true);
    expect(removed.some((r) => r.collection === 'pins')).toBe(true);
  });

  it('두 번 돌려도 같은 결과가 나온다', () => {
    const first = planReplace(current, incoming);
    // 한 번 끝난 뒤의 상태(= 파일 그대로)에서 다시 계획하면 지울 것이 없다.
    const after = planReplace(incoming, incoming);
    expect(first.remove.length).toBeGreaterThan(0);
    expect(after.remove).toEqual([]);
  });

  it('복원 도중 다른 탭에서 생긴 문서도 지울 목록에 잡힌다', () => {
    const meanwhile = data({ ...current, pins: [...current.pins, pin({ id: 'p-new-elsewhere' })] });
    const ids = planReplace(meanwhile, incoming).remove.map((r) => r.id);
    // "파일에 없는 것은 남기지 않는다" 가 전체 교체의 뜻이다.
    expect(ids).toContain('p-new-elsewhere');
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

// ---------- 순서 — 실패를 주입해서 확인한다 ----------

/**
 * 가짜 저장소.
 *
 * 실제 Firestore 없이 "쓰기가 실패하면 지우지 않는다" 를 시험한다.
 * 에뮬레이터로 도는 통합 테스트(`src/test/restore.emulator.test.ts`)가 같은 순서를
 * 진짜 저장소에서 한 번 더 확인한다.
 */
function fakeStore(seed: BackupData, opts: { failWrites?: Set<string>; failDeletes?: Set<string> } = {}) {
  const state: BackupData = {
    entries: [...seed.entries], accounts: [...seed.accounts],
    debts: [...seed.debts], pins: [...seed.pins], recovery: seed.recovery,
  };
  const log: string[] = [];
  const keys: BackupCollection[] = ['entries', 'accounts', 'debts', 'pins'];

  const io: RestoreIO = {
    fetchAll: async () => {
      log.push('fetchAll');
      return { entries: [...state.entries], accounts: [...state.accounts], debts: [...state.debts], pins: [...state.pins] };
    },
    writeMany: async (payload) => {
      log.push('write');
      const result: WriteManyResult = { written: 0, failed: [], allFailed: false };
      let total = 0;
      for (const key of keys) {
        for (const item of payload[key] ?? []) {
          total += 1;
          if (opts.failWrites?.has(item.id)) {
            result.failed.push({ collection: key, id: item.id, reason: '주입한 실패' });
            continue;
          }
          const list = state[key] as { id: string }[];
          const at = list.findIndex((x) => x.id === item.id);
          if (at >= 0) list[at] = item; else list.push(item);
          result.written += 1;
        }
      }
      result.allFailed = total > 0 && result.written === 0;
      return result;
    },
    deleteMany: async (targets) => {
      log.push('delete');
      const result: WriteManyResult = { written: 0, failed: [], allFailed: false };
      for (const t of targets) {
        if (opts.failDeletes?.has(t.id)) {
          result.failed.push({ collection: t.collection, id: t.id, reason: '주입한 실패' });
          continue;
        }
        for (const key of keys) {
          const list = state[key] as { id: string }[];
          const at = list.findIndex((x) => x.id === t.id);
          if (at >= 0) { list.splice(at, 1); result.written += 1; break; }
        }
      }
      result.allFailed = targets.length > 0 && result.written === 0;
      return result;
    },
  };
  return { io, state, log };
}

const seeded = () => data({
  entries: [newEntry('task', { id: 'old-1', title: '내 것' }), newEntry('task', { id: 'old-2' })],
  accounts: [account({ id: 'a-old' })],
  debts: [debt({ id: 'd-old' })],
  pins: [pin({ id: 'p-old' })],
});

const restored = () => data({
  entries: [newEntry('task', { id: 'new-1', title: '복원' })],
  accounts: [account({ id: 'a-new' })],
});

describe('전체 교체 — 쓰기가 먼저고 지우기는 맨 끝', () => {
  it('정상 복원: 쓰고 나서 지운다', async () => {
    const { io, state, log } = fakeStore(seeded());
    const outcome = await safeReplace(restored(), io);

    expect(outcome.kind).toBe('ok');
    expect(log).toEqual(['write', 'fetchAll', 'delete']);
    expect(state.entries.map((e) => e.id)).toEqual(['new-1']);
    expect(state.accounts.map((a) => a.id)).toEqual(['a-new']);
    // 전체 교체는 네 컬렉션 모두에 적용된다.
    expect(state.debts).toEqual([]);
    expect(state.pins).toEqual([]);
  });

  it('일부 쓰기 실패: 아무것도 지우지 않는다 — 기존 데이터가 그대로 남는다', async () => {
    const { io, state, log } = fakeStore(seeded(), { failWrites: new Set(['a-new']) });
    const outcome = await safeReplace(restored(), io);

    expect(outcome.kind).toBe('write-failed');
    expect(log).not.toContain('delete');
    // 예전 구조라면 여기서 이미 일정이 다 지워져 있었다.
    expect(state.entries.map((e) => e.id).sort()).toEqual(['new-1', 'old-1', 'old-2']);
    expect(state.debts.map((d) => d.id)).toEqual(['d-old']);
    expect(state.pins.map((p) => p.id)).toEqual(['p-old']);
  });

  it('전체 쓰기 실패: 역시 아무것도 지우지 않는다', async () => {
    const { io, state, log } = fakeStore(seeded(), { failWrites: new Set(['new-1', 'a-new']) });
    const outcome = await safeReplace(restored(), io);

    expect(outcome.kind).toBe('write-failed');
    if (outcome.kind === 'write-failed') expect(outcome.written.allFailed).toBe(true);
    expect(log).not.toContain('delete');
    expect(state.entries.map((e) => e.id)).toEqual(['old-1', 'old-2']);
  });

  it('실패한 뒤 같은 파일로 다시 하면 이어서 끝난다 (재시도)', async () => {
    const fail = fakeStore(seeded(), { failWrites: new Set(['a-new']) });
    expect((await safeReplace(restored(), fail.io)).kind).toBe('write-failed');

    // 원인을 고친 뒤 같은 상태에서 다시 — 이번에는 실패를 주입하지 않는다.
    const retry = fakeStore(fail.state);
    const outcome = await safeReplace(restored(), retry.io);
    expect(outcome.kind).toBe('ok');
    expect(retry.state.entries.map((e) => e.id)).toEqual(['new-1']);
    expect(retry.state.accounts.map((a) => a.id)).toEqual(['a-new']);
  });

  it('두 번 연속 복원해도 같은 자리에 머문다', async () => {
    const store = fakeStore(seeded());
    await safeReplace(restored(), store.io);
    const second = await safeReplace(restored(), store.io);

    expect(second.kind).toBe('ok');
    if (second.kind === 'ok') expect(second.removed.written).toBe(0);
    expect(store.state.entries.map((e) => e.id)).toEqual(['new-1']);
  });

  it('지우기가 일부 실패하면 복원은 끝났다고 알리고 남은 것을 보고한다', async () => {
    const { io, state } = fakeStore(seeded(), { failDeletes: new Set(['old-2']) });
    const outcome = await safeReplace(restored(), io);

    expect(outcome.kind).toBe('remove-failed');
    if (outcome.kind === 'remove-failed') {
      expect(outcome.written.failed).toEqual([]);
      expect(outcome.removed.failed.map((f) => f.id)).toEqual(['old-2']);
    }
    // 파일 내용은 다 들어갔다.
    expect(state.entries.map((e) => e.id)).toContain('new-1');
  });

  it('잘못된 파일이면 저장소를 한 번도 부르지 않는다', async () => {
    const { io, state, log } = fakeStore(seeded());
    const bad = data({ pins: [pin({ id: 'a/b' })] });
    const outcome = await safeReplace(bad, io);

    expect(outcome.kind).toBe('invalid');
    expect(log).toEqual([]);
    expect(state.entries.map((e) => e.id)).toEqual(['old-1', 'old-2']);
  });

  it('배치 경계(400건)를 넘는 데이터도 끝까지 처리한다', async () => {
    const many = data({
      entries: Array.from({ length: 950 }, (_, i) => newEntry('task', { id: `bulk-${i}` })),
    });
    const { io, state } = fakeStore(seeded());
    const outcome = await safeReplace(many, io);

    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.written.written).toBe(950);
      // 기존 5건이 전부 지워진다.
      expect(outcome.removed.written).toBe(5);
    }
    expect(state.entries).toHaveLength(950);
  });
});

describe('병합 — 지우는 단계가 없다', () => {
  it('파일에만 있는 것을 더하고 기존은 건드리지 않는다', async () => {
    const { io, state, log } = fakeStore(seeded());
    const outcome = await safeMerge(restored(), io, null);

    expect(outcome.kind).toBe('ok');
    expect(log).not.toContain('delete');
    expect(state.entries.map((e) => e.id).sort()).toEqual(['new-1', 'old-1', 'old-2']);
    expect(state.debts.map((d) => d.id)).toEqual(['d-old']);
  });

  it('같은 id 는 지금 것을 남긴다', async () => {
    const { io, state } = fakeStore(seeded());
    await safeMerge(data({ entries: [newEntry('task', { id: 'old-1', title: '들어온 것' })] }), io, null);
    expect(state.entries.find((e) => e.id === 'old-1')?.title).toBe('내 것');
  });

  it('쓰기가 실패하면 실패로 보고한다 — 조용히 성공이라 하지 않는다', async () => {
    const { io } = fakeStore(seeded(), { failWrites: new Set(['new-1']) });
    const outcome = await safeMerge(restored(), io, null);
    expect(outcome.kind).toBe('write-failed');
  });

  it('잘못된 파일이면 저장소를 부르지 않는다', async () => {
    const { io, log } = fakeStore(seeded());
    expect((await safeMerge(data({ pins: [pin({ id: '' })] }), io, null)).kind).toBe('invalid');
    expect(log).toEqual([]);
  });
});

describe('저장 규칙과 검증기가 같은 한도를 본다', () => {
  it('확인 시각이 40자를 넘으면 거른다 — 규칙이 길이로 거부한다', () => {
    const bad = data({ accounts: [account({ checkedAt: 'x'.repeat(41) })] });
    expect(validateBackup(bad)[0]?.reason).toContain('확인 시각');
  });
});
