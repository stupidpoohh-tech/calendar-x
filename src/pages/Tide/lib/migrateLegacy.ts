/**
 * 중간 이식판이 남긴 로컬 데이터를 원본 형식으로 옮긴다.
 *
 * 짧게 배포됐던 이식판은 캘린더X 의 Entry 모양을 그대로 써서
 * `calendarx.tide.v1` 키에 저장했다. 지금은 원본 앱을 화면째로 옮겨 왔으므로
 * 저장 형식도 원본(`tideover.state`)이다. 그 사이에 적어 둔 값을 잃지 않도록
 * 첫 로드 때 한 번만 옮긴다.
 *
 * 원본 URL(tide-over.stupidpoohh.workers.dev)의 데이터는 여기로 오지 않는다 —
 * 오리진이 달라 localStorage 가 애초에 공유되지 않는다. 그쪽 데이터는 설정의
 * 백업 링크로 옮겨야 한다.
 */
import { type Entry, type State, newId } from './types';

const LEGACY_KEY = 'calendarx.tide.v1';
const STATE_KEY = 'tideover.state';
const SCHEMA_KEY = 'tideover.schema';

/** 이식판이 쓰던 캘린더X Entry 중 이 변환이 보는 부분만 적는다. */
interface LegacyEntry {
  title?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  recurrence?: { freq?: unknown; interval?: unknown } | null;
  money?: { type?: unknown; amountMinor?: unknown } | null;
}

const isISO = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function convertEntry(raw: LegacyEntry): Entry | null {
  const money = raw.money;
  if (!money || typeof money.amountMinor !== 'number' || !Number.isFinite(money.amountMinor)) return null;
  if (!isISO(raw.startDate)) return null;

  const amount = Math.abs(Math.trunc(money.amountMinor));
  const kind = money.type === 'income' ? 'income' : 'expense';
  const name = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '이름 없음';

  // 이식판의 scheduleKindOf 와 같은 순서로 판단한다.
  const rec = raw.recurrence;
  let schedule: Entry['schedule'];
  if (rec && rec.freq === 'monthly') {
    schedule = { type: 'monthly', day: Number(raw.startDate.slice(8, 10)) };
  } else if (rec) {
    const interval = typeof rec.interval === 'number' && rec.interval >= 1 ? Math.trunc(rec.interval) : 1;
    const days = rec.freq === 'weekly' ? interval * 7 : interval;
    schedule = { type: 'every', days: Math.min(365, Math.max(1, days)), anchor: raw.startDate };
  } else if (isISO(raw.endDate) && raw.endDate > raw.startDate) {
    schedule = { type: 'span', start: raw.startDate, end: raw.endDate };
  } else {
    schedule = { type: 'once', date: raw.startDate };
  }

  return { id: newId(), name, amount, kind, schedule };
}

/**
 * 옮길 것이 있으면 옮기고 true. 원본 키에 이미 값이 있으면 손대지 않는다 —
 * 원본 데이터가 언제나 우선이다.
 */
export function migrateLegacyTide(): boolean {
  let store: Storage;
  try {
    store = window.localStorage;
  } catch {
    return false;
  }

  try {
    if (store.getItem(STATE_KEY) !== null) return false;
    const raw = store.getItem(LEGACY_KEY);
    if (raw === null) return false;

    const parsed = JSON.parse(raw) as {
      account?: { balanceMinor?: unknown; checkedAt?: unknown };
      entries?: unknown;
    };

    const balanceMinor = parsed.account?.balanceMinor;
    const amount = typeof balanceMinor === 'number' && Number.isFinite(balanceMinor)
      ? Math.trunc(balanceMinor)
      : 0;
    const checkedAt = typeof parsed.account?.checkedAt === 'string'
      && !Number.isNaN(Date.parse(parsed.account.checkedAt))
      ? parsed.account.checkedAt
      : new Date().toISOString();

    const entries = Array.isArray(parsed.entries)
      ? (parsed.entries as LegacyEntry[]).map(convertEntry).filter((e): e is Entry => e !== null)
      : [];

    // 잔고도 항목도 없으면 옮길 것이 없다. 빈 상태를 써 두면 첫 화면(온보딩)을 건너뛴다.
    if (amount === 0 && entries.length === 0) return false;

    const state: State = { balance: { amount, checkedAt }, entries };
    store.setItem(STATE_KEY, JSON.stringify(state));
    store.setItem(SCHEMA_KEY, '4');
    return true;
  } catch {
    return false;
  }
}
