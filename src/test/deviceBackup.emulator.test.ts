import 'fake-indexeddb/auto';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { backupDevice } from '../data/deviceBackup';
import { changeDevice, emptyDevice, readDevice } from '../data/deviceStore';
import { fetchAll, fetchLedgerSettings } from '../data/repo';
import { newEntry, newMoney } from '../domain/entry';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'dada-rules-test',
    firestore: { rules: readFileSync('firestore.rules','utf8'), host:'127.0.0.1', port:8080 } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await changeDevice(() => emptyDevice()); });

it('비회원 일정·금융·설정을 실제 계정에 옮기고 서버 확인 뒤 작업 공간을 비운다', async () => {
  const entry = newEntry('money', { id:'device-money', title:'기기 기록', startDate:'2026-10-19',
    money:newMoney({amountMinor:12000}) });
  await changeDevice(d => ({ ...d, entries:[entry], ledger:{settleDay:25},
    recovery:{...d.recovery, defaultMemo:'기기 회복 메모'}, layout:{...d.layout, notes:false} }));
  const source = await readDevice();
  const db = env.authenticatedContext('new-account').firestore() as unknown as Firestore;
  await backupDevice(db, 'new-account');
  expect((await fetchAll(db,'new-account')).entries).toEqual([entry]);
  expect(await fetchLedgerSettings(db,'new-account')).toEqual(source.ledger);
  const user = (await getDoc(doc(db,'users','new-account'))).data()!;
  expect(user.layout).toEqual(source.layout);
  expect((await readDevice()).entries).toEqual([]);
});

it('서버 권한이 없으면 기기 원본을 남긴다', async () => {
  const entry = newEntry('task', { id:'device-task', title:'남겨야 할 기록' });
  await changeDevice(d => ({...d,entries:[entry]}));
  const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
  await expect(backupDevice(db,'no-access')).rejects.toBeDefined();
  expect((await readDevice()).entries).toEqual([entry]);
});
