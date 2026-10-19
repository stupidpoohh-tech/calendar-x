import { defaultCategories } from '../domain/category';
import { NEW_USER_LAYOUT, type Layout } from '../domain/layout';
import { defaultRecoveryRule } from '../domain/recovery';
import type { BackupData } from './backup';
import type { CommitInput, LedgerBatchPayload, RecoveryCommitPayload, ReservePatchPayload } from './pendingWrites';
import type { Entry, RecoveryRule, LedgerSettings } from '../domain/types';

/** A reserved local identity. Never sent to Firebase or shared-board APIs. */
export const DEVICE_UID = '__calendarx_device__';
export interface DeviceData extends BackupData {
  version: 1;
  revision: number;
  layout: Layout;
  recovery: RecoveryRule;
  ledger: LedgerSettings;
  transferTo: string | null;
}
export const deviceCollections = ['entries', 'accounts', 'debts', 'pins', 'budgets', 'reserves', 'categories',
  'categoryBudgets', 'ledgerNotes', 'annualBudgets', 'cards'] as const;
export type DeviceCollection = typeof deviceCollections[number];
export function emptyDevice(): DeviceData {
  return { version: 1, revision: 0, entries: [], accounts: [], debts: [], pins: [], budgets: [], reserves: [],
    categories: defaultCategories(new Date().toISOString()), categoryBudgets: [], ledgerNotes: [],
    annualBudgets: [], cards: [], recovery: defaultRecoveryRule(), ledger: { settleDay: 1 },
    layout: { ...NEW_USER_LAYOUT }, transferTo: null };
}
let database: Promise<IDBDatabase> | undefined;
function openDevice(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('calendarx-device', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('기기 저장소를 열지 못했습니다. 브라우저의 저장 공간과 권한을 확인해 주세요.')); };
  });
  return database;
}
function checked(value: unknown): DeviceData {
  if (value === undefined) return emptyDevice();
  const data = value as DeviceData;
  if (data.version !== 1 || deviceCollections.some((k) => !Array.isArray(data[k])) || !data.recovery || !data.ledger || !data.layout)
    throw new Error('기기 기록을 읽지 못했습니다. 기존 기록은 보존되어 있습니다.');
  return data;
}
export async function readDevice(): Promise<DeviceData> {
  const db = await openDevice();
  return new Promise((resolve, reject) => {
    const request = db.transaction('records').objectStore('records').get('current');
    request.onsuccess = () => { try { resolve(checked(request.result)); } catch (e) { reject(e); } };
    request.onerror = () => reject(request.error);
  });
}
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
function broadcast() {
  listeners.forEach((listener) => listener());
  channel?.postMessage('changed');
}
/** Read and write occur in one transaction, including across tabs. No memory-only success. */
export async function changeDevice(change: (data: DeviceData) => DeviceData, archiveKey?: string): Promise<void> {
  const db = await openDevice();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    const request = store.get('current');
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const before = checked(request.result);
        const after = change(structuredClone(before));
        if (archiveKey) store.put(before, archiveKey);
        store.put({ ...after, revision: before.revision + 1 }, 'current');
      } catch (e) { failure = e; tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? new Error('기기에 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.'));
    tx.onerror = () => { /* onabort reports the failed transaction */ };
  });
  broadcast();
}
export function watchDevice<T>(select: (data: DeviceData) => T, cb: (value: T) => void, fail: (error: unknown) => void) {
  let active = true;
  let generation = 0;
  let previous = '';
  const refresh = () => {
    const mine = ++generation;
    void readDevice().then((data) => {
      if (!active || mine !== generation) return;
      const value = select(data);
      const signature = JSON.stringify(value);
      if (signature !== previous) { previous = signature; cb(value); }
    }, (e) => { if (active) fail(e); });
  };
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('calendarx-device');
    channel.onmessage = () => listeners.forEach((listener) => listener());
  }
  listeners.add(refresh); refresh();
  return () => { active = false; listeners.delete(refresh); };
}
function put(data: DeviceData, key: DeviceCollection, item: { id: string }) {
  const list = data[key] as { id: string }[];
  const index = list.findIndex((x) => x.id === item.id);
  if (index < 0) list.push(item); else list[index] = item;
}
function remove(data: DeviceData, key: DeviceCollection, id: string) {
  const list = data[key] as { id: string }[];
  const index = list.findIndex((x) => x.id === id);
  if (index >= 0) list.splice(index, 1);
}
/** Same domain payloads as the cloud write queue; financial formulas are unchanged. */
export function applyDeviceOp(data: DeviceData, op: CommitInput): DeviceData {
  if (data.transferTo) throw new Error('계정 백업을 진행 중입니다. 처음 백업한 계정으로 로그인해 백업을 완료해 주세요. 기기 원본은 보관되어 있습니다.');
  const collections: Record<string, DeviceCollection> = { entry: 'entries', account: 'accounts', debt: 'debts',
    pin: 'pins', budget: 'budgets', reserve: 'reserves', category: 'categories', categoryBudget: 'categoryBudgets',
    annualBudget: 'annualBudgets', card: 'cards', ledgerNote: 'ledgerNotes' };
  const key = collections[op.kind.replace(/Delete$/, '')];
  if (key) {
    const item = op.payload as { id: string };
    if (op.kind.endsWith('Delete')) remove(data, key, item.id); else put(data, key, structuredClone(item));
    return data;
  }
  switch (op.kind) {
    case 'entryPrivate': {
      const p = op.payload as { id: string; keepPrivate: boolean };
      const e = data.entries.find((e) => e.id === p.id); if (e) e.keepPrivate = p.keepPrivate; break;
    }
    case 'categories':
      for (const c of (op.payload as { items: DeviceData['categories'] }).items) put(data, 'categories', c); break;
    case 'layout': data.layout = op.payload as Layout; break;
    case 'ledgerSettings': data.ledger = op.payload as LedgerSettings; break;
    case 'recoveryRule': data.recovery = op.payload as RecoveryRule; break;
    case 'recoveryPatch': data.recovery = { ...data.recovery, ...op.payload as Partial<RecoveryRule> }; break;
    case 'recoveryCommit': {
      const p = op.payload as RecoveryCommitPayload;
      data.recovery = p.rule;
      if (p.removeEntryId) remove(data, 'entries', p.removeEntryId);
      if (p.entry) put(data, 'entries', p.entry); break;
    }
    case 'reservePatch': {
      const p = op.payload as ReservePatchPayload;
      const r = data.reserves.find((r) => r.id === p.id);
      if (!r) throw new Error('세이브를 찾을 수 없습니다.');
      Object.assign(r, p.patch, { updatedAt: p.updatedAt }); break;
    }
    case 'taskOrder':
      for (const p of (op.payload as { ordered: { id: string; order: number }[] }).ordered) {
        const e = data.entries.find((e) => e.id === p.id); if (e?.task) e.task.order = p.order;
      } break;
    case 'ledgerBatch': {
      const p = op.payload as LedgerBatchPayload;
      const count = p.entries.length + p.deleteIds.length + p.accounts.length + (p.budgets?.length ?? 0)
        + (p.deleteBudgetIds?.length ?? 0) + (p.deleteReserveIds?.length ?? 0);
      if (count > 450) throw new Error('한 번에 바꿀 문서가 너무 많습니다.');
      p.deleteIds.forEach((id) => remove(data, 'entries', id));
      p.entries.forEach((e) => put(data, 'entries', e));
      p.accounts.forEach((a) => put(data, 'accounts', a));
      p.deleteBudgetIds?.forEach((id) => remove(data, 'budgets', id));
      p.budgets?.forEach((b) => put(data, 'budgets', b));
      p.deleteReserveIds?.forEach((id) => remove(data, 'reserves', id)); break;
    }
    default: throw new Error('같이 보기는 로그인 후 사용할 수 있습니다.');
  }
  return data;
}
export const commitDevice = (op: CommitInput) => changeDevice((data) => applyDeviceOp(data, op));
export async function mergeDevice(payload: Partial<BackupData>, onlyAbsent = false) {
  let written = 0;
  const conflicts: { collection: string; id: string }[] = [];
  await changeDevice((data) => {
    if (data.transferTo) throw new Error('계정 백업 중에는 가져올 수 없습니다.');
    for (const key of deviceCollections) for (const item of payload[key] ?? []) {
      if (onlyAbsent && data[key].some((x) => x.id === item.id)) conflicts.push({ collection: key, id: item.id });
      else { put(data, key, item); written++; }
    }
    return data;
  });
  return { written, created: written, conflicts, failed: [], allFailed: false };
}
export const deviceMeta = { fromCache: false, hasPendingWrites: false };
export const deviceEntries = (predicate: (e: Entry) => boolean) => async () => (await readDevice()).entries.filter(predicate);
