/**
 * 이관 전 구조 → 새 구조.
 *
 * 이전 구조는 모든 것을 users/{uid}/items 한 컬렉션에 넣고, 보안 규칙이 비표준 필드를
 * 거부했기 때문에 특수 데이터를 title 로 표시하는 우회를 썼다.
 *
 *   title === '::balance::'  → 잔고. 금액이 memo 에 문자열로.
 *   title === '::loans::'    → 대출 목록 전체가 memo 에 JSON 배열로.
 *   pinned === true          → 고정 메모.
 *   tab: 'todo' | 'day' | 'money'
 *
 * 여기서는 그것을 entries / accounts / debts / pins 로 풀어낸다.
 * 원본 items 는 지우지 않는다. 되돌릴 지점을 남겨 둬야 한다.
 */
import { getDocs } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { DEFAULT_CURRENCY, MONEY_TYPES, MONEY_TYPE_BY_ID } from '../domain/constants';
import { normalizeDate, todayISO, ymRange } from '../domain/date';
import type {
  Account, ColorId, Debt, Entry, EntryKind, MoneyType, Pin, Recurrence, TaskStatus,
} from '../domain/types';
import { COLOR_BY_ID, STATUS_BY_ID } from '../domain/constants';
import { COL, col } from './paths';

export const BALANCE_TITLE = '::balance::';
export const LOANS_TITLE = '::loans::';

/**
 * firestore.rules 가 강제하는 상한.
 *
 * Firestore 배치 쓰기는 원자적이라, 한도를 넘는 항목이 하나만 있어도 400건짜리 배치
 * 전체가 'Missing or insufficient permissions' 로 실패한다. 어느 항목 때문인지도
 * 알려주지 않는다. 그래서 옮기기 전에 여기서 맞춰 두고, 잘라낸 것은 보고한다.
 */
export const LIMITS = {
  title: 500,
  note: 20_000,
  tags: 50,
  pinText: 2_000,
  name: 100,
} as const;

function clamp(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

export interface MigrationResult {
  entries: Entry[];
  accounts: Account[];
  debts: Debt[];
  pins: Pin[];
  /** 읽었지만 어디에도 넣지 못한 항목. 조용히 버리지 않고 보고한다. */
  skipped: { id: string; reason: string }[];
  /** 저장 한도에 맞춰 잘라낸 항목. 값이 바뀌었으므로 함께 알린다. */
  trimmed: { id: string; reason: string }[];
  legacyCount: number;
}

type Raw = Record<string, unknown>;

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const numOf = (v: unknown, d = 0): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return d;
};
const boolOf = (v: unknown): boolean => v === true;

const TAB_TO_KIND: Record<string, EntryKind> = { todo: 'task', day: 'idea', money: 'money' };

/** 'YYYY-MM-DDTHH:mm' 을 날짜와 시각으로 가른다. */
function splitDateTime(raw: unknown): { date: string; time: string | null } {
  const s = str(raw);
  const date = normalizeDate(s);
  if (!date) return { date: '', time: null };
  const time = s.length > 10 ? s.slice(11, 16) : '';
  return { date, time: /^\d{2}:\d{2}$/.test(time) ? time : null };
}

function legacyRecurrence(raw: unknown): Recurrence | null {
  const v = str(raw);
  if (v === 'daily' || v === 'weekly' || v === 'monthly') {
    return { freq: v, interval: 1, until: null, count: null };
  }
  return null;
}

/**
 * 가계부 제목은 저장할 때 '나갈 돈 45,000원 · 전기요금' 처럼 자동 생성됐다.
 * 사용자가 실제로 쓴 라벨은 ' · ' 뒤에 있다. 앞부분은 이제 화면에서 파생하므로 떼어낸다.
 */
export function extractMoneyLabel(title: string, type: MoneyType): string {
  const typeLabel = MONEY_TYPE_BY_ID[type]?.label ?? '';
  const sepIndex = title.indexOf(' · ');
  if (sepIndex >= 0) {
    const head = title.slice(0, sepIndex);
    if (head.startsWith(typeLabel) || MONEY_TYPES.some((t) => head.startsWith(t.label))) {
      return title.slice(sepIndex + 3).trim();
    }
    return title.trim();
  }
  // ' · ' 가 없고 자동 생성 형태 그대로면 라벨이 없었던 것이다.
  if (/^.+ [\d,]+원$/.test(title) && MONEY_TYPES.some((t) => title.startsWith(t.label))) return '';
  return title.trim();
}

function asColor(v: unknown, fallback: ColorId): ColorId {
  return typeof v === 'string' && v in COLOR_BY_ID ? (v as ColorId) : fallback;
}

function asStatus(v: unknown): TaskStatus {
  return typeof v === 'string' && v in STATUS_BY_ID ? (v as TaskStatus) : 'planned';
}

export function convertLegacyItems(items: readonly Raw[]): MigrationResult {
  const entries: Entry[] = [];
  const accounts: Account[] = [];
  const debts: Debt[] = [];
  const pins: Pin[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const trimmed: { id: string; reason: string }[] = [];
  const now = new Date().toISOString();

  let pinOrderFallback = 0;

  items.forEach((raw, index) => {
    // id 가 없으면 순번으로 고정한다. 랜덤 id 를 쓰면 이관을 두 번 돌렸을 때
    // 같은 항목이 두 건으로 늘어난다.
    const id = str(raw.id) || `legacy-${index}`;
    const title = str(raw.title);
    const tab = str(raw.tab, 'todo');
    const kind = TAB_TO_KIND[tab];

    // ---- 잔고 ----
    if (title === BALANCE_TITLE) {
      const amount = Math.trunc(numOf(raw.memo));
      accounts.push({
        id, name: '주계좌', balanceMinor: amount, currency: DEFAULT_CURRENCY,
        asOf: normalizeDate(str(raw.updatedAt)) || normalizeDate(str(raw.dateISO)) || todayISO(),
        order: 0,
        createdAt: str(raw.createdAt, now), updatedAt: str(raw.updatedAt, now),
      });
      return;
    }

    // ---- 대출: 배열 전체가 한 문서의 memo 에 들어 있었다 ----
    if (title === LOANS_TITLE) {
      let list: unknown;
      try {
        list = JSON.parse(str(raw.memo, '[]'));
      } catch {
        // 깨진 JSON 을 조용히 버리면 대출 내역이 통째로 사라진 줄도 모른다.
        skipped.push({ id, reason: '대출 목록 JSON 을 읽을 수 없어 건너뛰었습니다.' });
        return;
      }
      if (!Array.isArray(list)) {
        skipped.push({ id, reason: '대출 목록이 배열이 아닙니다.' });
        return;
      }
      list.forEach((entry, i) => {
        const l = (entry ?? {}) as Raw;
        const rate = numOf(l.rate, NaN);
        debts.push({
          // 원본 문서 id + 순번으로 고정한다. 랜덤 id 를 쓰면 이관을 두 번 돌렸을 때
          // 같은 대출이 두 건으로 늘어난다.
          id: `${id}-${i}`,
          name: clamp(str(l.name, `대출 ${i + 1}`), LIMITS.name),
          balanceMinor: Math.trunc(numOf(l.balance)),
          monthlyMinor: Math.trunc(numOf(l.monthly)),
          rate: Number.isFinite(rate) && rate > 0 ? rate : null,
          currentRound: Math.trunc(numOf(l.current)),
          totalRounds: Math.trunc(numOf(l.total)),
          order: i,
          createdAt: str(raw.createdAt, now), updatedAt: str(raw.updatedAt, now),
        });
      });
      return;
    }

    if (!kind) {
      skipped.push({ id, reason: `알 수 없는 탭: ${tab}` });
      return;
    }

    // ---- 고정 메모 ----
    if (boolOf(raw.pinned)) {
      if (title.length > LIMITS.pinText) {
        trimmed.push({ id, reason: `고정 메모가 ${LIMITS.pinText}자를 넘어 잘랐습니다.` });
      }
      pins.push({
        id,
        lens: kind,
        text: clamp(title, LIMITS.pinText),
        order: numOf(raw.pinOrder, pinOrderFallback++),
        createdAt: str(raw.createdAt, now), updatedAt: str(raw.updatedAt, now),
      });
      return;
    }

    // ---- 일반 항목 ----
    const start = kind === 'task'
      ? splitDateTime(raw.startISO ?? raw.dateISO)
      : splitDateTime(raw.dateISO ?? raw.startISO);
    const startDate = start.date || todayISO();

    const endSource = kind === 'task' ? raw.endISO : raw.moneyEnd;
    const end = splitDateTime(endSource);
    const endDate = end.date && end.date > startDate ? end.date : null;

    const moneyType: MoneyType =
      kind === 'money' && typeof raw.moneyType === 'string' && raw.moneyType in MONEY_TYPE_BY_ID
        ? (raw.moneyType as MoneyType)
        : 'expense';

    const recurrence = kind === 'task' ? legacyRecurrence(raw.repeat) : null;

    const rawTitle = kind === 'money' ? extractMoneyLabel(title, moneyType) : title;
    const rawNote = str(raw.memo);
    const rawTags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [];

    if (rawTitle.length > LIMITS.title) trimmed.push({ id, reason: `제목이 ${LIMITS.title}자를 넘어 잘랐습니다.` });
    if (rawNote.length > LIMITS.note) trimmed.push({ id, reason: `메모가 ${LIMITS.note}자를 넘어 잘랐습니다.` });
    if (rawTags.length > LIMITS.tags) trimmed.push({ id, reason: `태그가 ${LIMITS.tags}개를 넘어 잘랐습니다.` });

    const entryTitle = clamp(rawTitle, LIMITS.title);
    const note = clamp(rawNote, LIMITS.note);

    entries.push({
      id,
      kind,
      title: entryTitle,
      // 가계부는 memo 가 라벨로 쓰였고 그 값이 title 에 합쳐져 있었다. 중복 저장을 피한다.
      note: kind === 'money' && note === entryTitle ? '' : note,
      color: asColor(raw.color, kind === 'money' ? MONEY_TYPE_BY_ID[moneyType].defaultColor : kind === 'idea' ? 'violet' : 'blue'),
      tags: rawTags.slice(0, LIMITS.tags),
      location: str(raw.location),
      startDate,
      startTime: boolOf(raw.startHasTime) ? start.time : (kind === 'task' ? start.time : null),
      endDate,
      endTime: boolOf(raw.endHasTime) ? end.time : null,
      ymSpan: ymRange(startDate, endDate ?? startDate),
      isRecurring: recurrence != null,
      recurrence,
      task: kind === 'task'
        ? {
            status: asStatus(raw.status),
            important: boolOf(raw.important),
            urgent: boolOf(raw.urgent),
            order: numOf(raw.order, 0),
          }
        : null,
      money: kind === 'money'
        ? {
            type: moneyType,
            amountMinor: Math.trunc(Math.abs(numOf(raw.amount))),
            currency: DEFAULT_CURRENCY,
            linkedEntryId: null,
          }
        : null,
      createdAt: str(raw.createdAt, now),
      updatedAt: str(raw.updatedAt, now),
    });
  });

  // 잔고가 여러 개면 가장 최근 것만 남긴다. 이전 구조는 하나만 쓰는 전제였다.
  accounts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const keptAccounts = accounts.slice(0, 1);
  for (const dropped of accounts.slice(1)) {
    skipped.push({ id: dropped.id, reason: '잔고 문서가 여러 개라 가장 최근 것만 남겼습니다.' });
  }

  return { entries, accounts: keptAccounts, debts, pins, skipped, trimmed, legacyCount: items.length };
}

/** 이관 전 컬렉션을 읽는다. 원본은 건드리지 않는다. */
export async function readLegacyItems(db: Firestore, uid: string): Promise<Raw[]> {
  const snap = await getDocs(col(db, uid, COL.legacyItems));
  const out: Raw[] = [];
  snap.forEach((d) => out.push({ ...(d.data() as Raw), id: d.id }));
  return out;
}

export function summarize(r: MigrationResult): string {
  const parts = [
    `일정·아이디어·가계부 ${r.entries.length}건`,
    `잔고 ${r.accounts.length}건`,
    `대출 ${r.debts.length}건`,
    `고정 메모 ${r.pins.length}건`,
  ];
  if (r.trimmed.length > 0) parts.push(`길이 조정 ${r.trimmed.length}건`);
  if (r.skipped.length > 0) parts.push(`건너뜀 ${r.skipped.length}건`);
  return parts.join(' · ');
}
