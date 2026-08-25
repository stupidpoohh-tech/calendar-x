import { SCHEMA_VERSION, migrateToCurrent } from './storage';
import type { State } from './types';

/** 해시 파라미터 이름. 링크가 `#b=...` 로 끝난다. */
const HASH_KEY = 'b';

type Envelope = {
  /** 스키마 버전 */
  v: number;
  /** 내보낸 시각 */
  t: string;
  s: State;
};

export type DecodeResult =
  | { ok: true; state: State; exportedAt: string }
  | { ok: false; reason: string };

export function encodeBackup(state: State, now: Date = new Date()): string {
  const envelope: Envelope = { v: SCHEMA_VERSION, t: now.toISOString(), s: state };
  return base64UrlEncode(JSON.stringify(envelope));
}

export function decodeBackup(payload: string): DecodeResult {
  let json: string;
  try {
    json = base64UrlDecode(payload);
  } catch {
    return { ok: false, reason: '백업 링크가 깨졌습니다.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: '백업 링크의 내용을 해석할 수 없습니다.' };
  }

  const envelope = parsed as Partial<Envelope> | null;
  if (typeof envelope !== 'object' || envelope === null) {
    return { ok: false, reason: '백업 링크의 내용을 해석할 수 없습니다.' };
  }
  if (typeof envelope.v !== 'number' || !Number.isInteger(envelope.v) || envelope.v < 1) {
    return { ok: false, reason: '백업 링크의 버전을 읽을 수 없습니다.' };
  }
  if (envelope.v > SCHEMA_VERSION) {
    return { ok: false, reason: '더 최신 버전에서 만든 백업 링크입니다. 앱을 새로고침해 주세요.' };
  }

  // 예전 버전에 만들어 둔 링크도 그대로 열려야 한다.
  const state = migrateToCurrent(envelope.s, envelope.v);
  if (!state) {
    return { ok: false, reason: '백업 링크에 담긴 데이터의 모양이 맞지 않습니다.' };
  }

  const exportedAt =
    typeof envelope.t === 'string' && !Number.isNaN(Date.parse(envelope.t)) ? envelope.t : '';
  return { ok: true, state, exportedAt };
}

/** 현재 주소를 기준으로 상태 전체를 담은 백업 링크를 만든다. */
export function backupLink(state: State, now: Date = new Date()): string {
  const base = `${location.origin}${location.pathname}${location.search}`;
  return `${base}#${HASH_KEY}=${encodeBackup(state, now)}`;
}

/** 주소 해시에 백업이 실려 있으면 payload를 꺼낸다. */
export function readBackupFromHash(hash: string = location.hash): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === HASH_KEY) {
      const value = part.slice(eq + 1);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * 복원한 뒤 해시를 지운다.
 * 남겨두면 새로고침할 때마다 백업이 다시 덮어써서, 복원 후 입력한 내용이 사라진다.
 */
export function stripBackupFromUrl(): void {
  if (typeof history === 'undefined' || !history.replaceState) return;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

/* ---------- base64url (유니코드 안전) ---------- */

export function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(payload: string): string {
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
