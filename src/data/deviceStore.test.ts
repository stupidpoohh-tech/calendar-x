import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newEntry, newMoney } from '../domain/entry';
import { changeDevice, commitDevice, emptyDevice, readDevice, watchDevice, mergeDevice, DEVICE_UID } from './deviceStore';
import { fetchAll, fetchConfirmationsOf, fetchPocketEntries, subscribeEntriesForMonths } from './repo';
import type { Firestore } from 'firebase/firestore';
const db = {} as Firestore; // Guest operations must never use this as a Firestore client.
const entry = (id: string) => newEntry('money', { id, title: id, startDate: '2026-10-19',
  money: newMoney({ status: 'actual', amountMinor: 12000, budgetId: 'living', plannedRef: { entryId: 'plan', date: '2026-10-19' } }) });
beforeEach(async () => { await changeDevice(() => emptyDevice()); });

describe('기기 저장', () => {
  it('새 기기는 데모 기록 없이 시작하고 저장·수정·삭제를 다시 읽어도 유지한다', async () => {
    expect((await readDevice()).entries).toEqual([]);
    await commitDevice({ kind: 'entry', label: '', summary: '', payload: entry('a') });
    await commitDevice({ kind: 'entry', label: '', summary: '', payload: { ...entry('a'), title: '수정한 점심' } });
    expect((await fetchAll(db, DEVICE_UID)).entries.map(e => e.title)).toEqual(['수정한 점심']);
    expect((await fetchConfirmationsOf(db, DEVICE_UID, 'plan')).entries).toHaveLength(1);
    expect((await fetchPocketEntries(db, DEVICE_UID, 'living')).complete).toBe(true);
    await commitDevice({ kind: 'entryDelete', label: '', summary: '', payload: { id: 'a' } });
    expect((await readDevice()).entries).toEqual([]);
  });
  it('동시에 보낸 쓰기도 앞선 기록을 덮지 않는다', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => commitDevice({ kind: 'entry', label: '', summary: '', payload: entry(String(i)) })));
    expect((await readDevice()).entries).toHaveLength(20);
  });
  it('실패한 거래 묶음은 반쯤 반영되지 않는다', async () => {
    await commitDevice({ kind: 'entry', label: '', summary: '', payload: entry('keep') });
    await expect(changeDevice(d => { d.entries = []; throw new Error('저장 실패'); })).rejects.toThrow('저장 실패');
    expect((await readDevice()).entries[0]?.id).toBe('keep');
  });
  it('금융 배치와 회복 규칙·회차를 한 번에 보존한다', async () => {
    const a = { id: 'bank', name: '잔고', balanceMinor: 100000, currency: 'KRW', asOf: '2026-10-19',
      checkedAt: '', order: 0, createdAt: '', updatedAt: '' };
    await commitDevice({ kind: 'ledgerBatch', label: '', summary: '', payload: { entries: [entry('a')], accounts: [a], deleteIds: [] } });
    const rule = { ...(await readDevice()).recovery, enabled: true, activeEntryId: 'recovery' };
    await commitDevice({ kind: 'recoveryCommit', label: '', summary: '', payload: { rule, entry: newEntry('task', { id: 'recovery' }) } });
    const d = await readDevice();
    expect(d.accounts[0]?.balanceMinor).toBe(100000);
    expect(d.recovery.activeEntryId).toBe('recovery');
    expect(d.entries.map(e => e.id)).toEqual(['a', 'recovery']);
  });
  it('가져오기는 같은 ID를 덮지 않고 설정·카드·연간 예산도 유지한다', async () => {
    const e = entry('a');
    await mergeDevice({ entries: [e] }, true);
    const result = await mergeDevice({ entries: [{ ...e, title: '덮으면 안 됨' }] }, true);
    expect(result.created).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    await commitDevice({ kind: 'ledgerSettings', label: '', summary: '', payload: { settleDay: 25 } });
    expect((await readDevice()).ledger.settleDay).toBe(25);
    expect((await readDevice()).entries[0]?.title).toBe('a');
  });
  it('구독은 커밋 뒤에만 갱신하고 해지 뒤에는 알리지 않는다', async () => {
    const seen = vi.fn(); const fail = vi.fn();
    const stop = subscribeEntriesForMonths(db, DEVICE_UID, ['2026-10'], seen, fail);
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    await commitDevice({ kind: 'entry', label: '', summary: '', payload: entry('a') });
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(2));
    expect(seen.mock.calls[1]?.[0]).toHaveLength(1);
    stop();
    await commitDevice({ kind: 'entry', label: '', summary: '', payload: entry('b') });
    expect(seen).toHaveBeenCalledTimes(2);
    expect(fail).not.toHaveBeenCalled();
  });
  it('공유 쓰기와 백업 중 기기 편집은 거절하고 원본을 남긴다', async () => {
    await changeDevice(d => ({ ...d, transferTo: 'account-a' }));
    await expect(commitDevice({ kind: 'entry', label: '', summary: '', payload: entry('a') })).rejects.toThrow('백업');
    await changeDevice(d => ({ ...d, transferTo: null }));
    await expect(commitDevice({ kind: 'sharedInviteDelete', label: '', summary: '', payload: { id: 'invite' } })).rejects.toThrow('로그인');
  });
  it('손상된 버전은 비어 있는 정상 기록으로 간주하지 않는다', async () => {
    await changeDevice(d => ({ ...d, version: 99 as 1 }));
    const fail = vi.fn();
    const stop = watchDevice(d => d.entries, vi.fn(), fail);
    await vi.waitFor(() => expect(fail).toHaveBeenCalled());
    stop();
    // Repair only the deliberately corrupted test fixture.
    const connection = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('calendarx-device', 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = connection.transaction('records', 'readwrite'); tx.objectStore('records').put(emptyDevice(), 'current'); tx.oncomplete = () => resolve(); });
    connection.close();
  });
});
