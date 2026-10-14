/**
 * 백업 파일 형식 — 내보내기.
 *
 * 읽기는 `backupFile.test.ts` 가 파일 문자열부터 시작해 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { newEntry } from '../domain/entry';
import { defaultRecoveryRule } from '../domain/recovery';
import { readBackupFile } from './backupFile';
import { BACKUP_VERSION, buildBackup, countBackup, mergeBackup } from './backup';
import { planMerge } from './restore';
import { newAnnualBudget } from '../domain/annualBudget';
import { newBudget, newReserve } from '../domain/budget';
import type { Account } from '../domain/types';

const account: Account = {
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-08-01', checkedAt: '2026-08-01T00:00:00.000Z',
  order: 0, createdAt: '', updatedAt: '',
};

describe('buildBackup', () => {
  it('내보낸 파일을 그대로 되읽는다', () => {
    const data = {
      entries: [newEntry('task', { id: 't1', title: '치과', startDate: '2026-08-20' })],
      accounts: [account], debts: [], pins: [], budgets: [], reserves: [], categories: [], categoryBudgets: [], ledgerNotes: [], annualBudgets: [], ledger: null, recovery: null,
    };
    const r = readBackupFile(JSON.stringify(buildBackup(data)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.version).toBe(BACKUP_VERSION);
      expect(r.file.data.entries[0]?.title).toBe('치과');
      expect(r.file.data.accounts[0]?.balanceMinor).toBe(1_000_000);
      expect(countBackup(r.file.data)).toBe(2);
    }
  });

  it('회복 규칙도 함께 실어 보낸다', () => {
    // 규칙이 빠지면 "전체 데이터를 한 파일로" 라고 적어 두고 회복 간격과 밀린 횟수를
    // 조용히 흘리게 된다.
    const rule = { ...defaultRecoveryRule(), enabled: true, intervalDays: 5, debtCount: 2 };
    const r = readBackupFile(JSON.stringify(buildBackup({
      entries: [], accounts: [], debts: [], pins: [], budgets: [], reserves: [], categories: [], categoryBudgets: [], ledgerNotes: [], annualBudgets: [], ledger: null, recovery: rule,
    })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.data.recovery?.enabled).toBe(true);
      expect(r.file.data.recovery?.intervalDays).toBe(5);
      expect(r.file.data.recovery?.debtCount).toBe(2);
      // 설정은 항목이 아니다.
      expect(countBackup(r.file.data)).toBe(0);
    }
  });

  it('생활비와 세이브도 한 파일에 담아 그대로 되읽는다', () => {
    const budget = newBudget({
      id: 'b1', name: '9월 생활비',
      startDate: '2026-09-01', endDate: '2026-09-30', amountMinor: 700_000,
    });
    const reserve = newReserve({ id: 'r1', name: '비상금', amountMinor: 500_000 });
    const r = readBackupFile(JSON.stringify(buildBackup({
      entries: [], accounts: [], debts: [], pins: [],
      budgets: [budget], reserves: [reserve], categories: [], categoryBudgets: [], ledgerNotes: [], annualBudgets: [], ledger: null, recovery: null,
    })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.format).toBe('v9');
      expect(r.file.data.budgets[0]).toEqual(budget);
      expect(r.file.data.reserves[0]).toEqual(reserve);
      // 건수는 파일 총계와 맞아떨어져야 한다.
      expect(countBackup(r.file.data)).toBe(2);
    }
  });

  it('병합은 같은 id 를 덮지 않는다 — 생활비·세이브도 마찬가지다', () => {
    const mine = newBudget({ id: 'b1', name: '내 것', amountMinor: 700_000 });
    const theirs = newBudget({ id: 'b1', name: '파일 것', amountMinor: 100_000 });
    const added = newReserve({ id: 'r2', name: '여행', amountMinor: 300_000 });
    const merged = mergeBackup(
      { entries: [], accounts: [], debts: [], pins: [], budgets: [mine], reserves: [], categories: [], categoryBudgets: [], ledgerNotes: [], annualBudgets: [], ledger: null, recovery: null },
      { entries: [], accounts: [], debts: [], pins: [], budgets: [theirs], reserves: [added], categories: [], categoryBudgets: [], ledgerNotes: [], annualBudgets: [], ledger: null, recovery: null },
    );
    expect(merged.budgets).toEqual([mine]);
    expect(merged.reserves).toEqual([added]);
  });

  it('내보낸 파일에는 앱 이름과 버전이 들어 있다', () => {
    const payload = buildBackup({ entries: [], accounts: [], debts: [], pins: [], budgets: [], reserves: [], categories: [], categoryBudgets: [], ledgerNotes: [], annualBudgets: [], ledger: null, recovery: null });
    expect(payload.app).toBe('Dada Calendar');
    expect(payload.version).toBe(BACKUP_VERSION);
  });
});

describe('v6 — 결산 자료도 한 파일에', () => {
  it('카테고리 · 카테고리 예산 · 정산 시작일을 담아 그대로 되읽는다', () => {
    const categories = [{ id: 'food', kind: 'expense' as const, name: '식비', order: 0, archived: true, createdAt: '', updatedAt: '' }];
    const categoryBudgets = [{
      id: 'food~default~2026-09', categoryId: 'food', scope: 'default' as const, period: '2026-09',
      amountMinor: 300_000, currency: 'KRW', createdAt: '', updatedAt: '',
    }];
    const r = readBackupFile(JSON.stringify(buildBackup({
      entries: [], accounts: [], debts: [], pins: [], budgets: [], reserves: [],
      categories, categoryBudgets, ledgerNotes: [], annualBudgets: [], ledger: { settleDay: 25 }, recovery: null,
    })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.version).toBe(BACKUP_VERSION);
      expect(r.file.data.categories).toEqual(categories);
      expect(r.file.data.categoryBudgets).toEqual(categoryBudgets);
      expect(r.file.data.ledger).toEqual({ settleDay: 25 });
      // 건수에 결산 자료가 들어간다. 설정은 세지 않는다.
      expect(countBackup(r.file.data)).toBe(2);
    }
  });
});

describe('v8 — 세이브 보호 · 목표 · 보관 (P1)', () => {
  const empty = {
    entries: [], accounts: [], debts: [], pins: [], budgets: [], categories: [], categoryBudgets: [], ledgerNotes: [], annualBudgets: [],
    ledger: null, recovery: null,
  };
  const off = newReserve({
    id: 'r1', name: '비상금', amountMinor: 300_000, protected: false,
    targetAmountMinor: 1_000_000, targetDate: '2027-03-01', archivedAt: null,
  });
  const archived = newReserve({ id: 'r2', name: '옛 적금', amountMinor: 70_000, archivedAt: '2026-10-01T00:00:00.000Z' });

  it('보호 끔 · 목표 · 보관이 내보내기 → 가져오기 뒤에도 그대로다', () => {
    const r = readBackupFile(JSON.stringify(buildBackup({ ...empty, reserves: [off, archived] })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.version).toBe(BACKUP_VERSION);
      expect(r.file.data.reserves).toEqual([off, archived]);
      expect(r.file.data.reserves[0]?.protected).toBe(false);
    }
  });

  it('예전 판(v7 · v4)의 세이브는 보호 켬 · 목표 없음 · 보관 안 함으로 읽는다', () => {
    const legacy = { id: 'r1', name: '비상금', amountMinor: 300_000, currency: 'KRW', createdAt: '', updatedAt: '' };
    for (const version of [4, 7]) {
      const file = {
        app: 'Dada Calendar', version, exportedAt: '', ...empty, reserves: [legacy],
      };
      const r = readBackupFile(JSON.stringify(file));
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.file.data.reserves[0]).toMatchObject({
          protected: true, targetAmountMinor: null, targetDate: null, archivedAt: null, amountMinor: 300_000,
        });
      }
    }
  });

  it('보호 · 목표 · 보관의 형태가 틀리면 아무것도 넣지 않고 그 자리를 짚는다', () => {
    const bad = [
      { protected: 'false' }, { targetAmountMinor: -1 }, { targetAmountMinor: 1.5 }, { targetAmountMinor: '100' },
      { targetDate: '2027-13-01' }, { targetDate: 20270301 }, { archivedAt: '' }, { archivedAt: 3 },
    ];
    for (const over of bad) {
      const file = { ...buildBackup({ ...empty, reserves: [off] }) } as Record<string, unknown>;
      file.reserves = [{ ...off, ...over }];
      const r = readBackupFile(JSON.stringify(file));
      expect(r.ok, JSON.stringify(over)).toBe(false);
      if (!r.ok) expect(r.problems[0]?.where).toMatch(/^reserves\[0\]\./);
    }
  });

  it('병합은 이미 있는 세이브의 금액 · 보호를 덮지 않는다 — 없는 것만 더한다', () => {
    const current = { ...empty, reserves: [{ ...off, amountMinor: 500_000, protected: true }] };
    const merged = mergeBackup(current, { ...empty, reserves: [off, archived] });
    expect(merged.reserves).toEqual([{ ...off, amountMinor: 500_000, protected: true }, archived]);
    // 실제 쓰기 계획도 같다 — 이미 있는 id 는 후보에서 빠진다.
    expect(planMerge(current, { ...empty, reserves: [off, archived] }).reserves).toEqual([archived]);
  });
});

describe('v9 — 연간 카테고리 예산 (P2)', () => {
  const empty = {
    entries: [], accounts: [], debts: [], pins: [], budgets: [], reserves: [], categories: [], categoryBudgets: [],
    ledgerNotes: [], annualBudgets: [], ledger: null, recovery: null,
  };
  const y26 = newAnnualBudget('beauty', 2026, 300_000);
  const y27 = newAnnualBudget('beauty', 2027, 600_000, { '04': 400_000, '10': 200_000 });

  it('연간 예산 · 월별 배분이 내보내기 → 가져오기 뒤에도 그대로다', () => {
    const r = readBackupFile(JSON.stringify(buildBackup({ ...empty, annualBudgets: [y26, y27] })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.version).toBe(9);
      expect(r.file.format).toBe('v9');
      expect(r.file.data.annualBudgets).toEqual([y26, y27]);
      expect(countBackup(r.file.data)).toBe(2);
    }
  });

  it('v8 파일에는 연간 예산이 없는 것이 정상이다 — 빈 목록으로 읽고 나머지는 그대로', () => {
    const file = { ...buildBackup({ ...empty, reserves: [newReserve({ id: 'r1', amountMinor: 1 })] }), version: 8 } as Record<string, unknown>;
    delete file.annualBudgets;
    const r = readBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.data.annualBudgets).toEqual([]);
      expect(r.file.data.reserves).toHaveLength(1);
    }
  });

  it('v9 에 연간 예산 배열이 없으면 잘린 파일이다', () => {
    const file = buildBackup(empty) as unknown as Record<string, unknown>;
    delete file.annualBudgets;
    const r = readBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]?.where).toBe('annualBudgets');
  });

  it('배분 합 초과 · 모르는 달 · 0 · 소수 · id 모양이 틀리면 아무것도 넣지 않는다', () => {
    const bad: Record<string, unknown>[] = [
      { monthAllocations: { '04': 400_000, '10': 200_001 } },
      { monthAllocations: { '13': 1 } },
      { monthAllocations: { '04': 0 } },
      { monthAllocations: { '04': 1.5 } },
      { amountMinor: -1, monthAllocations: {} },
      { year: 1999, id: 'beauty~1999' },
      { id: 'beauty~2028' },
    ];
    for (const over of bad) {
      const file = buildBackup(empty) as unknown as Record<string, unknown>;
      file.annualBudgets = [{ ...y27, ...over }];
      const r = readBackupFile(JSON.stringify(file));
      expect(r.ok, JSON.stringify(over)).toBe(false);
      if (!r.ok) expect(r.problems[0]?.where).toMatch(/^annualBudgets\[0\]/);
    }
  });

  it('병합은 이미 있는 같은 해 같은 카테고리의 연간 예산을 덮지 않는다', () => {
    const mine = { ...y27, amountMinor: 900_000, monthAllocations: {} };
    expect(planMerge({ ...empty, annualBudgets: [mine] }, { ...empty, annualBudgets: [y26, y27] }).annualBudgets).toEqual([y26]);
  });
});
