/**
 * 백업과 복원. (F-03)
 *
 * 이전 exportJSON() 은 localStorage 를 읽었다. 로그인 사용자의 데이터는 Firestore 에
 * 있으므로 "JSON 백업 내려받기"가 항목 0개짜리 파일을 만들었다. 가져오기도 localStorage 에
 * 쓰고 화면만 바꿔서 다음 스냅샷에 사라졌다. 여기서는 양쪽 다 Firestore 를 본다.
 */
import { todayISO } from '../domain/date';
import type { Account, Debt, Entry, Pin } from '../domain/types';
import { accountFromDoc, debtFromDoc, entryFromDoc, pinFromDoc } from './converters';
import { convertLegacyItems } from './migrate';

export const BACKUP_VERSION = 2;

export interface BackupPayload {
  app: 'Dada Calendar';
  version: number;
  exportedAt: string;
  entries: Entry[];
  accounts: Account[];
  debts: Debt[];
  pins: Pin[];
}

export interface BackupData {
  entries: Entry[];
  accounts: Account[];
  debts: Debt[];
  pins: Pin[];
}

export function buildBackup(data: BackupData): BackupPayload {
  return {
    app: 'Dada Calendar',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries: data.entries,
    accounts: data.accounts,
    debts: data.debts,
    pins: data.pins,
  };
}

export function backupFilename(): string {
  return `dada-calendar-backup-${todayISO()}.json`;
}

export function downloadJSON(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class BackupParseError extends Error {}

/**
 * 백업 파일을 읽는다. 이관 전 구조(version 1, items 배열)도 그대로 받는다.
 * 예전 백업 파일이 손에 남아 있을 수 있으므로 버리지 않는다.
 */
export function parseBackup(text: string): BackupData {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new BackupParseError('JSON 형식이 아닙니다. 백업 파일이 맞는지 확인해 주세요.');
  }
  if (!obj || typeof obj !== 'object') {
    throw new BackupParseError('백업 파일의 내용을 읽을 수 없습니다.');
  }

  const raw = obj as Record<string, unknown>;

  // 이관 전 형식: { items: [...] }
  if (Array.isArray(raw.items)) {
    const converted = convertLegacyItems(raw.items as Record<string, unknown>[]);
    return {
      entries: converted.entries,
      accounts: converted.accounts,
      debts: converted.debts,
      pins: converted.pins,
    };
  }

  if (!Array.isArray(raw.entries)) {
    throw new BackupParseError('항목이 들어 있지 않습니다. 다른 앱의 파일일 수 있습니다.');
  }

  const list = <T>(v: unknown, make: (id: string, r: Record<string, unknown>) => T): T[] => {
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => make(typeof x.id === 'string' ? x.id : '', x))
      .filter((x) => (x as { id?: string }).id);
  };

  return {
    entries: list(raw.entries, entryFromDoc),
    accounts: list(raw.accounts, accountFromDoc),
    debts: list(raw.debts, debtFromDoc),
    pins: list(raw.pins, pinFromDoc),
  };
}

export function countBackup(d: BackupData): number {
  return d.entries.length + d.accounts.length + d.debts.length + d.pins.length;
}

/** 병합. 같은 id 는 원본을 남기고 새 항목만 더한다. */
export function mergeBackup(current: BackupData, incoming: BackupData): BackupData {
  const merge = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const seen = new Set(a.map((x) => x.id));
    return [...a, ...b.filter((x) => !seen.has(x.id))];
  };
  return {
    entries: merge(current.entries, incoming.entries),
    accounts: merge(current.accounts, incoming.accounts),
    debts: merge(current.debts, incoming.debts),
    pins: merge(current.pins, incoming.pins),
  };
}
