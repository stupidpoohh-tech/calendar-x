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
      accounts: [account], debts: [], pins: [], budgets: [], reserves: [], recovery: null,
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
      entries: [], accounts: [], debts: [], pins: [], budgets: [], reserves: [], recovery: rule,
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
      budgets: [budget], reserves: [reserve], recovery: null,
    })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.format).toBe('v4');
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
      { entries: [], accounts: [], debts: [], pins: [], budgets: [mine], reserves: [], recovery: null },
      { entries: [], accounts: [], debts: [], pins: [], budgets: [theirs], reserves: [added], recovery: null },
    );
    expect(merged.budgets).toEqual([mine]);
    expect(merged.reserves).toEqual([added]);
  });

  it('내보낸 파일에는 앱 이름과 버전이 들어 있다', () => {
    const payload = buildBackup({ entries: [], accounts: [], debts: [], pins: [], budgets: [], reserves: [], recovery: null });
    expect(payload.app).toBe('Dada Calendar');
    expect(payload.version).toBe(BACKUP_VERSION);
  });
});
