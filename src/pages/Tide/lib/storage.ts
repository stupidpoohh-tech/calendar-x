import { type State, isState, newId } from './types';

export const SCHEMA_VERSION = 4;

const SCHEMA_KEY = 'tideover.schema';
const STATE_KEY = 'tideover.state';
const BACKUP_MARK_KEY = 'tideover.backupTakenAt';
/**
 * 백업 이력은 쿠키에도 남긴다.
 * localStorage가 통째로 날아간 상황을 알아채는 게 목적인데,
 * 그 이력 자체가 같은 localStorage에만 있으면 같이 날아가서 아무 소용이 없다.
 * 쿠키가 영원하진 않지만 삭제 경로가 달라서 한쪽이 살아남을 확률이 생긴다.
 */
const BACKUP_COOKIE = 'tideover_backup';
const BACKUP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; state: State }
  | { status: 'corrupt'; reason: string }
  /** 앞으로의 버전이 남긴 데이터 — 덮어쓰면 안 되니 읽기를 포기한다. */
  | { status: 'future'; version: number };

function ls(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__tideover_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function storageAvailable(): boolean {
  return ls() !== null;
}

export function loadState(): LoadResult {
  const store = ls();
  if (!store) return { status: 'corrupt', reason: '이 브라우저에서 저장소를 쓸 수 없습니다.' };

  const raw = store.getItem(STATE_KEY);
  if (raw === null) return { status: 'empty' };

  const version = Number(store.getItem(SCHEMA_KEY) ?? SCHEMA_VERSION);
  if (!Number.isInteger(version) || version < 1) {
    return { status: 'corrupt', reason: '스키마 버전을 읽을 수 없습니다.' };
  }
  if (version > SCHEMA_VERSION) return { status: 'future', version };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', reason: '저장된 데이터를 해석할 수 없습니다.' };
  }

  const migrated = migrateToCurrent(parsed, version);
  if (!migrated) return { status: 'corrupt', reason: '저장된 데이터의 모양이 맞지 않습니다.' };

  // 올린 결과를 바로 써둔다. 안 그러면 사용자가 뭔가 고칠 때까지 옛 모양이 남아서,
  // 매번 다시 변환하게 되고 저장소의 버전 키도 실제와 어긋난 채로 있는다.
  if (version < SCHEMA_VERSION) saveState(migrated);

  return { status: 'ok', state: migrated };
}

/** v -> v+1 변환. 다음 스키마 버전이 생기면 여기에 한 줄씩 늘린다. */
const MIGRATIONS: Record<number, (data: unknown) => unknown> = {
  /**
   * v1: fixed[{id,name,amount,day}] — 매달 반복되는 출금만 있었다.
   * v2: entries[] — 입금/출금 구분과 특정일자 예약이 생겼다.
   */
  1: (data) => {
    const old = data as { payday?: unknown; balance?: unknown; fixed?: unknown };
    const fixed = Array.isArray(old.fixed) ? old.fixed : [];
    return {
      payday: old.payday,
      balance: old.balance,
      entries: fixed.map((f: Record<string, unknown>) => ({
        id: f.id,
        name: f.name,
        amount: f.amount,
        kind: 'expense',
        schedule: { type: 'monthly', day: f.day },
      })),
    };
  },
  /**
   * v2: 급여일이 별도 필드였다.
   * v3: 급여도 예정 입금이다 — payday를 '급여' 입금 항목으로 바꿔 넣고 필드를 없앤다.
   * 금액은 알 수 없으므로 0으로 넣는다. 0원 입금은 계산에 아무 영향이 없고,
   * 주기(다음 입금 전날까지)만 이전과 똑같이 유지해 준다.
   */
  2: (data) => {
    const old = data as { payday?: unknown; balance?: unknown; entries?: unknown };
    const entries = Array.isArray(old.entries) ? [...old.entries] : [];
    const day = old.payday;

    const alreadyHasPaydayIncome = entries.some((e) => {
      const entry = e as {
        kind?: unknown;
        schedule?: { type?: unknown; day?: unknown };
      };
      return (
        entry?.kind === 'income' &&
        entry?.schedule?.type === 'monthly' &&
        entry?.schedule?.day === day
      );
    });

    if (typeof day === 'number' && !alreadyHasPaydayIncome) {
      entries.push({
        id: newId(),
        name: '급여',
        amount: 0,
        kind: 'income',
        schedule: { type: 'monthly', day },
      });
    }

    return { balance: old.balance, entries };
  },
  /**
   * v4: 스케줄에 span(기간 예산)이 추가됐다. 기존 데이터의 모양은 그대로라
   * 변환은 없지만, v3 코드가 span이 든 데이터를 "깨졌다"고 읽는 대신
   * "더 최신 버전"으로 정중히 거절하도록 버전만 올린다.
   */
  3: (data) => data,
};

/**
 * 옛 버전 데이터를 현재 스키마로 끌어올린다.
 * 저장소와 백업 링크가 같은 경로를 타야 한다 — 예전에 만들어 둔 백업 링크도
 * 그대로 열려야 하기 때문이다.
 */
export function migrateToCurrent(data: unknown, fromVersion: number): State | null {
  let current = data;
  for (let v = fromVersion; v < SCHEMA_VERSION; v += 1) {
    const step = MIGRATIONS[v];
    if (!step) return null;
    current = step(current);
  }
  return isState(current) ? current : null;
}

export function saveState(state: State): boolean {
  const store = ls();
  if (!store) return false;
  try {
    store.setItem(STATE_KEY, JSON.stringify(state));
    store.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
    return true;
  } catch {
    return false;
  }
}

export function clearState(): void {
  const store = ls();
  if (!store) return;
  try {
    store.removeItem(STATE_KEY);
    store.removeItem(SCHEMA_KEY);
  } catch {
    /* 지우지 못해도 앱은 계속 돈다. */
  }
}

/* ---------- 백업 이력 ---------- */

export function markBackupTaken(now: Date = new Date()): void {
  const at = now.toISOString();
  const store = ls();
  try {
    store?.setItem(BACKUP_MARK_KEY, at);
  } catch {
    /* 무시 */
  }
  writeCookie(BACKUP_COOKIE, at, BACKUP_COOKIE_MAX_AGE);
}

export function lastBackupAt(): string | null {
  const store = ls();
  let fromLocal: string | null = null;
  try {
    fromLocal = store?.getItem(BACKUP_MARK_KEY) ?? null;
  } catch {
    fromLocal = null;
  }
  const fromCookie = readCookie(BACKUP_COOKIE);

  const candidates = [fromLocal, fromCookie].filter(
    (v): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)),
  );
  if (candidates.length === 0) return null;
  return candidates.sort().at(-1) ?? null;
}

export function hasBackupHistory(): boolean {
  return lastBackupAt() !== null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined' || !location.protocol.startsWith('http')) return;
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* 무시 */
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/* ---------- 저장소 영속성 ---------- */

export type PersistenceStatus = 'persisted' | 'denied' | 'unsupported' | 'unknown';

/**
 * 브라우저가 저장소를 자동으로 비우지 않게 요청한다.
 * 거절당해도 앱은 그대로 동작한다 — 백업 링크가 진짜 안전장치다.
 */
export async function requestPersistence(): Promise<PersistenceStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'unsupported';
  try {
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return 'persisted';
    return (await navigator.storage.persist()) ? 'persisted' : 'denied';
  } catch {
    return 'unknown';
  }
}
