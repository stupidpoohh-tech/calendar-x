/**
 * /tide (잔고캘린더) 의 로컬 저장.
 *
 * tide-over CLAUDE.md §4·§7 를 지킨다 — 서버 · 계정 · 자동 동기화가 없다.
 * localStorage 만 쓰고, 백업은 URL 프래그먼트에 상태 전체를 담는다.
 *
 * Dada 앱의 계산 로직(domain/tide.ts)을 재사용하기 위해 스토어의 항목 형태는
 * Dada 의 Entry(kind:'money')와 같다. 이렇게 두면 로그인해서 Dada 로 넘어가도
 * 같은 값이 보이는 것이 자연스러워지고, 두 계산 경로가 갈라지지 않는다.
 */
import type { Account, Entry } from '../domain/types';

const STORAGE_KEY = 'calendarx.tide.v1';

export interface TideState {
  version: 1;
  account: Account;
  entries: Entry[];
}

export function emptyTideState(): TideState {
  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);
  return {
    version: 1,
    account: {
      id: 'local', name: '주계좌', balanceMinor: 0, currency: 'KRW',
      asOf, checkedAt: now.toISOString(), order: 0,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    },
    entries: [],
  };
}

export function loadTide(): TideState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTideState();
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.account && Array.isArray(parsed.entries)) {
      return parsed as TideState;
    }
  } catch { /* 저장소 접근 실패는 조용히 무시 — 빈 상태로 시작 */ }
  return emptyTideState();
}

export function saveTide(state: TideState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearTide(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 무시 */ }
}

/**
 * 백업 링크. 상태 전체를 URL 프래그먼트에 담는다.
 * 링크 하나만 있으면 어느 기기에서든 복원 가능하다는 원본 방식 그대로.
 * `#tide=<base64url(json)>`.
 */
export function encodeBackupHash(state: TideState): string {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `tide=${b64}`;
}

export function decodeBackupHash(hash: string): TideState | null {
  const m = hash.match(/tide=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b64 = m[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (parsed && parsed.version === 1) return parsed as TideState;
    return null;
  } catch {
    return null;
  }
}
