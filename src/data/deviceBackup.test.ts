import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { newEntry } from '../domain/entry';
import { changeDevice, emptyDevice, readDevice } from './deviceStore';
import { backupDevice } from './deviceBackup';
import { createManyIfAbsent, fetchAll, saveLayout, saveLedgerSettings, saveRecoveryRule } from './repo';
vi.mock('./repo', () => ({ createManyIfAbsent: vi.fn(), fetchAll: vi.fn(), saveLayout: vi.fn(),
  saveLedgerSettings: vi.fn(), saveRecoveryRule: vi.fn() }));
const db = {} as Firestore;
beforeEach(async () => {
  vi.resetAllMocks();
  await changeDevice(() => ({ ...emptyDevice(), entries: [newEntry('task', { id: 'mine', title: '기기 기록' })] }));
  vi.mocked(fetchAll).mockResolvedValue(emptyDevice());
  vi.mocked(createManyIfAbsent).mockResolvedValue({ created: 1, conflicts: [], failed: [], allFailed: false });
  vi.mocked(saveLayout).mockResolvedValue();
  vi.mocked(saveLedgerSettings).mockResolvedValue();
  vi.mocked(saveRecoveryRule).mockResolvedValue();
});
describe('기기 기록 계정 백업', () => {
  it('모든 기록과 설정의 서버 확인 뒤에만 기기 작업 공간을 비운다', async () => {
    let acknowledge!: () => void;
    vi.mocked(saveRecoveryRule).mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve; }));
    const pending = backupDevice(db, 'account-a');
    await vi.waitFor(() => expect(saveRecoveryRule).toHaveBeenCalled());
    expect((await readDevice()).entries).toHaveLength(1);
    acknowledge(); await pending;
    expect((await readDevice()).entries).toHaveLength(0);
    expect(saveLedgerSettings).toHaveBeenCalled();
    expect(saveLayout).toHaveBeenCalled();
  });
  it('실패하면 기기 원본을 보존하고 같은 계정에서 재시도할 수 있다', async () => {
    vi.mocked(createManyIfAbsent).mockResolvedValueOnce({ created: 0, conflicts: [], failed: [{ collection: 'entries', id: 'mine', reason: 'offline' }], allFailed: true });
    await expect(backupDevice(db, 'account-a')).rejects.toThrow('일부 기록');
    expect((await readDevice()).entries[0]?.id).toBe('mine');
    await expect(backupDevice(db, 'account-b')).rejects.toThrow('다른 계정');
    await backupDevice(db, 'account-a');
    expect((await readDevice()).entries).toEqual([]);
  });
  it('이미 기록이 있는 계정에는 합쳐 넣거나 설정을 덮지 않는다', async () => {
    vi.mocked(fetchAll).mockResolvedValue({ ...emptyDevice(), entries: [newEntry('task', { id: 'cloud' })] });
    await expect(backupDevice(db, 'existing')).rejects.toThrow('이미 기록');
    expect(createManyIfAbsent).not.toHaveBeenCalled();
    expect((await readDevice()).transferTo).toBeNull();
    expect((await readDevice()).entries).toHaveLength(1);
  });
});
