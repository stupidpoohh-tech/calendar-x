/**
 * 백업 파일 형식 — 내보내기.
 *
 * 읽기는 `backupFile.test.ts` 가 파일 문자열부터 시작해 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { newEntry } from '../domain/entry';
import { defaultRecoveryRule } from '../domain/recovery';
import { readBackupFile } from './backupFile';
import { BACKUP_VERSION, buildBackup, countBackup } from './backup';
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
      accounts: [account], debts: [], pins: [], recovery: null,
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
      entries: [], accounts: [], debts: [], pins: [], recovery: rule,
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

  it('내보낸 파일에는 앱 이름과 버전이 들어 있다', () => {
    const payload = buildBackup({ entries: [], accounts: [], debts: [], pins: [], recovery: null });
    expect(payload.app).toBe('Dada Calendar');
    expect(payload.version).toBe(BACKUP_VERSION);
  });
});
