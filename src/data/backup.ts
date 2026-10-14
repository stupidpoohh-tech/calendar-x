/**
 * 백업 파일의 형식과 내보내기. (F-03)
 *
 * 이전 exportJSON() 은 localStorage 를 읽었다. 로그인 사용자의 데이터는 Firestore 에
 * 있으므로 "JSON 백업 내려받기"가 항목 0개짜리 파일을 만들었다. 가져오기도 localStorage 에
 * 쓰고 화면만 바꿔서 다음 스냅샷에 사라졌다. 여기서는 양쪽 다 Firestore 를 본다.
 */
import { todayISO } from '../domain/date';
import type {
  AnnualBudget,
  Account, Budget, Category, CategoryBudget, Debt, Entry, LedgerNote, LedgerSettings, Pin, RecoveryRule, Reserve,
} from '../domain/types';

/**
 * 4 부터 `budgets` · `reserves` 가 들어간다.
 *
 * 올린 이유는 **읽는 쪽이 둘을 구분해야 하기 때문**이다. v3 파일에 두 배열이 없는 것은
 * 정상(그 구조가 없던 시절)이고, v4 파일에 없는 것은 망가진 파일이다. 버전을 그대로
 * 두면 그 둘을 가를 수 없어 어느 쪽이든 빈 배열로 넘겨짚게 된다.
 *
 * 5 는 구조가 4 와 같고 가계부 원장 필드(실제 거래 · 흐름 · 확정한 회차 · 잔고 반영
 * 목록)가 실릴 수 있다. 올린 이유는 **구버전 앱이 이 파일을 거절하게 하려는 것**이다.
 * 구버전은 그 필드를 읽지 않고 가져오므로, 실제 거래가 예정으로 들어가 같은 돈이 두 번
 * 세어진다. 모르는 버전이면 구버전은 "새로고침해 최신 버전으로" 라고 말하고 멈춘다.
 *
 * 6 부터 `categories` · `categoryBudgets` · `ledger`(정산 시작일)가 들어간다. 두 배열은
 * **필수**다 — v5 파일에 없는 것은 그 구조가 없던 시절이라 정상이고, v6 에 없는 것은
 * 잘린 파일이다. 버전을 올리지 않으면 둘을 가를 수 없어 카테고리 예산이 빠진 파일을
 * 온전한 백업으로 받게 된다.
 *
 * 7 부터 `ledgerNotes`(정산 기간 메모)가 **필수**다. 같은 이유로 올렸다 — 메모가 빠진
 * 잘린 파일과 메모가 없던 시절의 파일을 가르기 위해서다.
 *
 * 8 은 7 과 구조가 같다. 세이브에 보호 · 목표 · 보관이 실릴 수 있어 올렸다 — 그 필드를 모르는
 * 예전 앱이 이 파일을 가져오면 꺼 둔 보호가 사라져(= 켬) 세이브가 말없이 다시 한도에서 빠진다.
 * 예전 앱은 모르는 버전을 거절하므로, 판 번호를 올리는 것이 그 길을 막는 방법이다.
 *
 * 9 부터 `annualBudgets`(연간 카테고리 예산)가 **필수**다 — v8 에 없는 것은 정상(그 구조가 없던 시절),
 * v9 에 없는 것은 잘린 파일이다. 예전 앱은 이 파일을 거절한다(연간 예산을 버린 채 가져오지 않게).
 */
export const BACKUP_VERSION = 9;

export interface BackupPayload {
  app: 'Dada Calendar';
  version: number;
  exportedAt: string;
  entries: Entry[];
  accounts: Account[];
  debts: Debt[];
  pins: Pin[];
  budgets: Budget[];
  reserves: Reserve[];
  categories: Category[];
  categoryBudgets: CategoryBudget[];
  ledgerNotes: LedgerNote[];
  /** 연간 카테고리 예산(v9). */
  annualBudgets: AnnualBudget[];
  /** 정산 시작일. 회복 규칙처럼 설정이라 개수에 세지 않는다. */
  ledger: LedgerSettings | null;
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
  budgets: Budget[];
  reserves: Reserve[];
  categories: Category[];
  categoryBudgets: CategoryBudget[];
  ledgerNotes: LedgerNote[];
  annualBudgets: AnnualBudget[];
  ledger: LedgerSettings | null;
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
    budgets: data.budgets,
    reserves: data.reserves,
    categories: data.categories,
    categoryBudgets: data.categoryBudgets,
    ledgerNotes: data.ledgerNotes,
    annualBudgets: data.annualBudgets,
    ledger: data.ledger,
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

/** 항목 수. 회복 규칙 · 정산 시작일은 항목이 아니라 설정이라 세지 않는다. */
export function countBackup(d: Omit<BackupData, 'recovery' | 'ledger'>): number {
  return d.entries.length + d.accounts.length + d.debts.length + d.pins.length
    + d.budgets.length + d.reserves.length + d.categories.length + d.categoryBudgets.length
    + d.ledgerNotes.length + d.annualBudgets.length;
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
    budgets: merge(current.budgets, incoming.budgets),
    reserves: merge(current.reserves, incoming.reserves),
    categories: merge(current.categories, incoming.categories),
    categoryBudgets: merge(current.categoryBudgets, incoming.categoryBudgets),
    ledgerNotes: merge(current.ledgerNotes, incoming.ledgerNotes),
    annualBudgets: merge(current.annualBudgets, incoming.annualBudgets),
    // 설정은 병합할 수 없다. 쓰고 있는 것을 남긴다.
    ledger: current.ledger ?? incoming.ledger,
    recovery: current.recovery ?? incoming.recovery,
  };
}
