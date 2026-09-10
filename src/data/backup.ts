/**
 * 백업 파일의 형식과 내보내기. (F-03)
 *
 * 이전 exportJSON() 은 localStorage 를 읽었다. 로그인 사용자의 데이터는 Firestore 에
 * 있으므로 "JSON 백업 내려받기"가 항목 0개짜리 파일을 만들었다. 가져오기도 localStorage 에
 * 쓰고 화면만 바꿔서 다음 스냅샷에 사라졌다. 여기서는 양쪽 다 Firestore 를 본다.
 */
import { todayISO } from '../domain/date';
import type { Account, Debt, Entry, Pin, RecoveryRule } from '../domain/types';

export const BACKUP_VERSION = 3;

export interface BackupPayload {
  app: 'Dada Calendar';
  version: number;
  exportedAt: string;
  entries: Entry[];
  accounts: Account[];
  debts: Debt[];
  pins: Pin[];
  /**
   * 회복 규칙. 항목이 아니라 설정이라 개수에 세지 않는다.
   * 빼 두면 "전체 데이터를 한 파일로" 라고 적어 두고 회복 간격과 밀린 횟수를
   * 조용히 흘리게 된다. 예전 버전 파일에는 이 값이 없다.
   */
  recovery: RecoveryRule | null;
}

export interface BackupData {
  entries: Entry[];
  accounts: Account[];
  debts: Debt[];
  pins: Pin[];
  recovery: RecoveryRule | null;
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
    recovery: data.recovery,
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

/*
  파일을 읽는 일은 `backupFile.ts` 가 맡는다.

  예전에는 여기 `parseBackup()` 이 있었고, 그것이 converters 로 값을 먼저 보정한 뒤
  검증기가 돌았다. 보정이 앞서면 잘못된 날짜는 오늘로, 소수 금액은 잘려서, id 없는
  항목은 사라진 뒤라 검증기에 원래 오류가 닿지 않는다. 그 함수를 남겨 두면 같은 순서를
  다시 쓰게 되므로 걷어냈다.

  병합 규칙(`mergeBackup`)도 `restore.ts` 의 `planMerge` 로 옮겼다 — 병합은 계획과
  쓰기가 한 자리에 있어야 "이미 있으면 건드리지 않는다" 를 끝까지 지킬 수 있다.
*/

/** 항목 수. 회복 규칙은 항목이 아니라 설정이라 세지 않는다. */
export function countBackup(d: Omit<BackupData, 'recovery'>): number {
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
    // 설정은 병합할 수 없다. 쓰고 있는 규칙을 남긴다.
    recovery: current.recovery ?? incoming.recovery,
  };
}
