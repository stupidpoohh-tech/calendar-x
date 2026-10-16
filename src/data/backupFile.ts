/**
 * 백업 파일 읽기 — **변환하기 전에** 검증한다.
 *
 * ## 왜 순서가 중요한가
 *
 * 예전에는 `parseBackup()` 이 먼저 돌고 그 결과를 검증했다. 그런데 parseBackup 안의
 * `converters.ts` 는 **읽기 계층**이라 방어적이다 — 날짜가 이상하면 오늘로, 금액이
 * 실수면 잘라서, 색이 없으면 기본값으로 채우고, id 가 없는 항목은 조용히 버린다.
 * 그 뒤에 검증기를 돌리면 이미 멀쩡해진 값만 본다. 원래 오류는 검증기에 닿지 않았다.
 *
 * 그래서 파이프라인을 이렇게 세운다.
 *
 *   JSON 파싱 → 원시 구조·버전 검증 → 원시 항목 검증 → 명시적 변환 → 도메인 데이터
 *
 * 변환은 검증을 통과한 값에만 닿는다. 변환기가 무엇을 고칠 일이 없다.
 *
 * ## 버전별 명세
 *
 * | 형식 | 알아보는 법 | 담고 있는 것 |
 * |------|------------|-------------|
 * | legacy | `version: 1` 또는 버전 없음 + `items` 배열 | 이관 전 단일 컬렉션. 변환 시 제외·절단 항목을 함께 보고한다 |
 * | v2 | `version: 2` | entries · accounts · debts · pins **네 배열 모두 필수** |
 * | v3 | `version: 3` | v2 + `recovery` (null 허용) |
 * | v4 | `version: 4` | v3 + `budgets` · `reserves` **두 배열 모두 필수** |
 * | v5 | `version: 5` | v4 와 같은 구조. 가계부 원장 필드(실제 거래 · 흐름 · 확정한 회차)가 실릴 수 있다 |
 * | v6 | `version: 6` | v5 + `categories` · `categoryBudgets` **두 배열 모두 필수** + `ledger`(정산 시작일, null 허용) |
 * | v7 | `version: 7` | v6 + `ledgerNotes`(정산 기간 메모) **필수** |
 * | v8 | `version: 8` | v7 과 같은 구조. 세이브에 보호 · 목표 · 보관(P1)이 실릴 수 있다 — 없으면 보호 켬 |
 * | v9 | `version: 9` | v8 + `annualBudgets`(연간 카테고리 예산, P2) **필수** |
 * | v10 | `version: 10` | v9 와 같은 구조. 지출에 세이브 연결(`money.reserveId`, P3)이 실릴 수 있다 |
 * | v11 | `version: 11` | v10 + `cards`(신용카드, P4) **필수**. 거래에 카드 연결(`money.cardId` · `cardCycle`)이 실릴 수 있다 |
 *
 * 없는 컬렉션을 빈 배열로 넘겨 짚지 않는다. v2·v3 파일에 `debts` 가 없다면 그건
 * 빈 백업이 아니라 깨진 파일이다.
 *
 * `budgets` · `reserves` 만 예외다. v2·v3 은 그 구조가 **없던** 시절의 파일이라 없는
 * 것이 정상이고 빈 배열로 읽는다. 그래도 들어 있으면 검증은 한다 — 손으로 고친 파일이
 * 검사 없이 새어 들어가지 않게. v4 에서는 없으면 잘린 파일로 본다.
 */
import { COLORS, MONEY_TYPES, STATUSES } from '../domain/constants';
import { MAX_YEAR, MIN_YEAR, MONTH_NOS } from '../domain/annualBudget';
import { isValidDate } from '../domain/date';
import { MONEY_FLOWS, MONEY_STATUSES, OUTFLOW_ONLY_FLOWS } from '../domain/ledger';
import type { BackupCollection } from '../domain/types';
import type { BackupData } from './backup';
import {
  accountFromDoc, budgetFromDoc, categoryBudgetFromDoc, categoryFromDoc, debtFromDoc,
  annualBudgetFromDoc, cardFromDoc, entryFromDoc, LEDGER_NOTE_MAX, ledgerNoteFromDoc, ledgerSettingsFromDoc, pinFromDoc, recoveryRuleFromDoc, reserveFromDoc,
} from './converters';
import { convertLegacyItems } from './migrate';

export const SUPPORTED_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const LATEST_VERSION = 12;

export type BackupFormat = 'legacy' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v8' | 'v9' | 'v10' | 'v11' | 'v12';

/** 파일 한 곳이 왜 들어갈 수 없는지. */
export interface FileProblem {
  /** 어디를 가리키는지. 'entries[3].startDate' 처럼 적는다. */
  where: string;
  reason: string;
}

/** 변환이 손댄 것. 조용히 넘기지 않고 사용자에게 보여 준다. */
export interface ConversionNote {
  id: string;
  reason: string;
}

export interface BackupFile {
  format: BackupFormat;
  version: number;
  data: BackupData;
  /**
   * 변환이 손댄 곳.
   *
   * legacy 는 제외·절단 항목, v2·v3 은 뜻이 흐려지는 보정(모르는 색 → 기본색)이 들어온다.
   * 뜻이 **바뀌는** 값(money.type · task.status)은 여기 오지 않는다 — 그건 거절한다.
   */
  notes: ConversionNote[];
}

export type ReadResult =
  | { ok: true; file: BackupFile }
  | { ok: false; problems: FileProblem[] };

/** 저장 규칙(`firestore.rules`)이 실제로 거부하는 한계. */
export const LIMITS = {
  title: 500,
  note: 20_000,
  tags: 50,
  ymSpan: 200,
  name: 100,
  pinText: 2_000,
  checkedAt: 40,
  categoryId: 200,
  method: 100,
  accountId: 200,
  refId: 200,
  reflected: 500,
  idBytes: 1_500,
} as const;

// ---------- 원시 값 검사기 ----------

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIntNum = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

class Collector {
  readonly problems: FileProblem[] = [];
  add(where: string, reason: string): void { this.problems.push({ where, reason }); }
  get ok(): boolean { return this.problems.length === 0; }
}

function checkId(c: Collector, where: string, raw: Raw, seen: Set<string>): boolean {
  const id = raw.id;
  if (id === undefined || id === null) { c.add(`${where}.id`, 'id 가 없습니다.'); return false; }
  if (typeof id !== 'string') { c.add(`${where}.id`, `id 가 문자열이 아닙니다: ${typeof id}`); return false; }
  if (!id) { c.add(`${where}.id`, 'id 가 비어 있습니다.'); return false; }
  if (id.includes('/')) { c.add(`${where}.id`, "id 에 '/' 가 들어 있습니다."); return false; }
  if (id === '.' || id === '..') { c.add(`${where}.id`, 'id 가 . 또는 .. 입니다.'); return false; }
  if (/^__.*__$/.test(id)) { c.add(`${where}.id`, 'id 가 Firestore 예약어(__x__) 모양입니다.'); return false; }
  // 반복 전개분의 id 모양(`원본id@날짜`)과 구분되지 않으면 편집·삭제가 엉뚱한 문서를 향한다.
  if (id.includes('@')) { c.add(`${where}.id`, "id 에 '@' 가 들어 있습니다."); return false; }
  if (new TextEncoder().encode(id).length > LIMITS.idBytes) { c.add(`${where}.id`, 'id 가 너무 깁니다.'); return false; }
  if (seen.has(id)) { c.add(`${where}.id`, `id 가 파일 안에서 겹칩니다: ${id}`); return false; }
  seen.add(id);
  return true;
}

/** 필수 문자열. 없으면 문제. */
function reqStr(c: Collector, where: string, v: unknown, max?: number): void {
  if (typeof v !== 'string') { c.add(where, `문자열이 아닙니다: ${describe(v)}`); return; }
  if (max !== undefined && v.length > max) c.add(where, `${max}자를 넘습니다 (${v.length}자).`);
}

/** 있으면 문자열이어야 한다. 없으면 넘어간다. */
function optStr(c: Collector, where: string, v: unknown, max?: number): void {
  if (v === undefined || v === null) return;
  reqStr(c, where, v, max);
}

function reqInt(c: Collector, where: string, v: unknown): void {
  if (typeof v === 'string') {
    // 숫자로 보이는 문자열을 조용히 바꾸지 않는다. 금액은 최소 단위 정수여야 한다.
    c.add(where, `금액이 문자열입니다: ${JSON.stringify(v)}`);
    return;
  }
  if (typeof v !== 'number') { c.add(where, `숫자가 아닙니다: ${describe(v)}`); return; }
  if (!Number.isFinite(v)) { c.add(where, `숫자가 아닙니다: ${String(v)}`); return; }
  if (!Number.isSafeInteger(v)) { c.add(where, `정수가 아닙니다: ${v} — 최소 단위 정수여야 합니다.`); }
}

function optInt(c: Collector, where: string, v: unknown): void {
  if (v === undefined || v === null) return;
  reqInt(c, where, v);
}

function reqDate(c: Collector, where: string, v: unknown): void {
  if (typeof v !== 'string') { c.add(where, `날짜가 문자열이 아닙니다: ${describe(v)}`); return; }
  if (!isValidDate(v)) c.add(where, `날짜(YYYY-MM-DD)가 아닙니다: ${v}`);
}

function optDate(c: Collector, where: string, v: unknown): void {
  if (v === undefined || v === null) return;
  reqDate(c, where, v);
}

function optTime(c: Collector, where: string, v: unknown): void {
  if (v === undefined || v === null) return;
  if (typeof v !== 'string') { c.add(where, `시각이 문자열이 아닙니다: ${describe(v)}`); return; }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) c.add(where, `시각(HH:mm)이 아닙니다: ${v}`);
}

function optStrArray(c: Collector, where: string, v: unknown, max: number): void {
  if (v === undefined || v === null) return;
  if (!Array.isArray(v)) { c.add(where, `배열이 아닙니다: ${describe(v)}`); return; }
  if (v.length > max) { c.add(where, `${max}개를 넘습니다 (${v.length}개).`); return; }
  v.forEach((x, i) => { if (typeof x !== 'string') c.add(`${where}[${i}]`, `문자열이 아닙니다: ${describe(x)}`); });
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '없음';
  if (Array.isArray(v)) return '배열';
  if (typeof v === 'object') return '객체';
  return `${typeof v} ${JSON.stringify(v)}`;
}

// ---------- 컬렉션별 원시 검증 ----------

const KINDS = ['task', 'idea', 'money'];
const FREQS = ['daily', 'weekly', 'monthly'];
/*
  뜻이 바뀌는 값들. 이것들은 "문자열이면 통과" 로 두면 안 된다.

  converters 는 읽기 계층이라 방어적이다 — 모르는 money.type 은 'expense' 로,
  모르는 task.status 는 'planned' 로 조용히 바뀐다. 입금이 지출이 되고 완료가 예정이
  되는데도 사용자는 "가져왔습니다" 만 본다. 그래서 여기서 막는다.
*/
const MONEY_TYPE_IDS: readonly string[] = MONEY_TYPES.map((t) => t.id);
const STATUS_IDS: readonly string[] = STATUSES.map((s) => s.id);
/*
  색은 뜻이 바뀌지 않는다 (기본색으로 떨어질 뿐이다). 거절하지 않고 보고만 한다 —
  조용히 바꾸면 사용자는 자기가 칠한 색이 사라진 이유를 알 수 없다.
*/
const COLOR_IDS: readonly string[] = COLORS.map((c) => c.id);

function colorNotes(rows: readonly Raw[]): ConversionNote[] {
  const out: ConversionNote[] = [];
  for (const r of rows) {
    const color = r.color;
    if (typeof color !== 'string' || !color || COLOR_IDS.includes(color)) continue;
    out.push({ id: String(r.id), reason: `모르는 색 '${color}' 이라 기본색으로 들어갑니다.` });
  }
  return out;
}

function checkEntryRaw(c: Collector, where: string, e: Raw): void {
  const kind = e.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) {
    c.add(`${where}.kind`, `종류를 알 수 없습니다: ${describe(kind)}`);
    return; // 종류를 모르면 나머지를 판정할 수 없다.
  }

  reqStr(c, `${where}.title`, e.title ?? '', LIMITS.title);
  optStr(c, `${where}.note`, e.note, LIMITS.note);
  optStr(c, `${where}.location`, e.location);
  optStr(c, `${where}.color`, e.color);
  optStrArray(c, `${where}.tags`, e.tags, LIMITS.tags);
  optStrArray(c, `${where}.ymSpan`, e.ymSpan, LIMITS.ymSpan);

  reqDate(c, `${where}.startDate`, e.startDate);
  optDate(c, `${where}.endDate`, e.endDate);
  if (typeof e.startDate === 'string' && typeof e.endDate === 'string'
      && isValidDate(e.startDate) && isValidDate(e.endDate) && e.endDate < e.startDate) {
    c.add(`${where}.endDate`, `종료일이 시작일보다 앞섭니다: ${e.endDate} < ${e.startDate}`);
  }
  optTime(c, `${where}.startTime`, e.startTime);
  optTime(c, `${where}.endTime`, e.endTime);

  if (e.recurrence !== undefined && e.recurrence !== null) {
    const r = e.recurrence;
    if (!isObj(r)) {
      c.add(`${where}.recurrence`, `반복 규칙이 객체가 아닙니다: ${describe(r)}`);
    } else {
      if (typeof r.freq !== 'string' || !FREQS.includes(r.freq)) {
        c.add(`${where}.recurrence.freq`, `반복 주기를 알 수 없습니다: ${describe(r.freq)}`);
      }
      if (!isIntNum(r.interval) || r.interval < 1) {
        c.add(`${where}.recurrence.interval`, `1 이상의 정수가 아닙니다: ${describe(r.interval)}`);
      }
      optDate(c, `${where}.recurrence.until`, r.until);
      if (r.count !== undefined && r.count !== null && (!isIntNum(r.count) || r.count < 1)) {
        c.add(`${where}.recurrence.count`, `1 이상의 정수가 아닙니다: ${describe(r.count)}`);
      }
    }
  }

  if (kind === 'money') {
    const m = e.money;
    if (!isObj(m)) { c.add(`${where}.money`, `가계부 항목에 금액이 없습니다: ${describe(m)}`); return; }
    reqInt(c, `${where}.money.amountMinor`, m.amountMinor);
    if (isIntNum(m.amountMinor) && m.amountMinor < 0) {
      c.add(`${where}.money.amountMinor`, `음수입니다: ${m.amountMinor} — 부호는 종류가 정합니다.`);
    }
    reqStr(c, `${where}.money.currency`, m.currency);
    // 부호를 정하는 값이다. 모르는 값을 'expense' 로 바꾸면 입금이 지출이 된다.
    if (typeof m.type !== 'string' || !MONEY_TYPE_IDS.includes(m.type)) {
      c.add(
        `${where}.money.type`,
        `가계부 종류를 알 수 없습니다: ${describe(m.type)} — `
        + `쓸 수 있는 값: ${MONEY_TYPE_IDS.join(' · ')}`,
      );
    }
    for (const ref of ['linkedEntryId', 'budgetId', 'debtId'] as const) {
      const v = m[ref];
      if (v !== undefined && v !== null && typeof v !== 'string') {
        c.add(`${where}.money.${ref}`, `문자열이 아닙니다: ${describe(v)}`);
      }
    }
    if (m.priority !== undefined && m.priority !== null && typeof m.priority !== 'boolean') {
      c.add(`${where}.money.priority`, `참·거짓이 아닙니다: ${describe(m.priority)}`);
    }
    checkLedgerRaw(c, where, e, m);
  }

  if (kind === 'task' && e.task !== undefined && e.task !== null) {
    const t = e.task;
    if (!isObj(t)) {
      c.add(`${where}.task`, `객체가 아닙니다: ${describe(e.task)}`);
    } else {
      // 모르는 상태를 'planned' 로 바꾸면 끝낸 일이 안 끝난 일이 된다.
      if (t.status !== undefined && t.status !== null
          && (typeof t.status !== 'string' || !STATUS_IDS.includes(t.status))) {
        c.add(
          `${where}.task.status`,
          `할 일 상태를 알 수 없습니다: ${describe(t.status)} — `
          + `쓸 수 있는 값: ${STATUS_IDS.join(' · ')}`,
        );
      }
      for (const flag of ['important', 'urgent'] as const) {
        const v = t[flag];
        if (v !== undefined && v !== null && typeof v !== 'boolean') {
          c.add(`${where}.task.${flag}`, `참·거짓이 아닙니다: ${describe(v)}`);
        }
      }
      optInt(c, `${where}.task.order`, t.order);
    }
  }
}

/*
  가계부 원장 필드. 없으면 예정 · 일반으로 읽히는 것이 정상이고(v4 이전 파일), 있으면
  규칙(`firestore.rules` 의 validLedger)과 같은 것을 본다. 버전과 무관하게 본다 —
  손으로 고친 파일에서 실제 거래가 조용히 예정으로 바뀌면 같은 돈이 두 번 세어진다.
*/
const STATUS_VALUES: readonly string[] = MONEY_STATUSES;
const FLOW_VALUES: readonly string[] = MONEY_FLOWS;
const OUTFLOW_ONLY: readonly string[] = OUTFLOW_ONLY_FLOWS;

function checkLedgerRaw(c: Collector, where: string, e: Raw, m: Raw): void {
  const at = `${where}.money`;
  if (m.status !== undefined && m.status !== null
      && (typeof m.status !== 'string' || !STATUS_VALUES.includes(m.status))) {
    c.add(`${at}.status`, `상태를 알 수 없습니다: ${describe(m.status)} — 쓸 수 있는 값: ${STATUS_VALUES.join(' · ')}`);
  }
  if (m.flow !== undefined && m.flow !== null
      && (typeof m.flow !== 'string' || !FLOW_VALUES.includes(m.flow))) {
    c.add(`${at}.flow`, `흐름을 알 수 없습니다: ${describe(m.flow)} — 쓸 수 있는 값: ${FLOW_VALUES.join(' · ')}`);
  }
  optStr(c, `${at}.categoryId`, m.categoryId, LIMITS.categoryId);
  optStr(c, `${at}.method`, m.method, LIMITS.method);
  optStr(c, `${at}.accountId`, m.accountId, LIMITS.accountId);
  for (const key of ['highlight', 'outsidePocket'] as const) {
    if (m[key] !== undefined && m[key] !== null && typeof m[key] !== 'boolean') {
      c.add(`${at}.${key}`, `참·거짓이 아닙니다: ${describe(m[key])}`);
    }
  }

  /*
    세이브 연결 (P3). 앱은 일반 지출 · 반복 아님 · 생활비 · 대출 연결 없음에만 이 값을 적는다. 그 밖의 모양은
    손으로 고친 파일이고, 규칙도 거절한다 — 저장하며 조용히 떼어 내면 세이브 사용이 말없이 사라지므로 먼저 막는다.
  */
  optStr(c, `${at}.reserveId`, m.reserveId, LIMITS.refId);
  const hasCard = typeof m.cardId === 'string' && !!m.cardId;
  if (typeof m.reserveId === 'string' && m.reserveId) {
    if (m.type !== 'expense') c.add(`${at}.reserveId`, `세이브는 지출에만 겁니다: ${describe(m.type)}`);
    // 일반 지출, 또는 등록한 카드의 카드 사용(P4).
    if (m.flow !== undefined && m.flow !== null && m.flow !== 'normal' && !(m.flow === 'cardSpend' && hasCard)) {
      c.add(`${at}.reserveId`, `세이브는 일반 지출 · 카드를 정한 카드 사용에만 겁니다: ${describe(m.flow)}`);
    }
    if ((typeof m.budgetId === 'string' && m.budgetId) || (typeof m.debtId === 'string' && m.debtId)) {
      c.add(`${at}.reserveId`, '세이브와 생활비 · 대출을 함께 걸 수 없습니다 — 사용처는 하나입니다.');
    }
    if (e.recurrence !== undefined && e.recurrence !== null) {
      c.add(`${at}.reserveId`, '반복 항목은 세이브에 걸지 않습니다.');
    }
  }

  /*
    카드 연결 (P4). 카드 사용 · 카드 대금에만 붙고, 대금의 회차는 `YYYY-MM` 이다. 규칙도 같은 모양만 받는다.
    없는 카드를 가리키는 연결은 받는다 — 계산이 무시하고 입력 창이 '지워진 카드' 로 보여 준다.
  */
  optStr(c, `${at}.cardId`, m.cardId, LIMITS.refId);
  if (hasCard && !(m.type === 'expense' && (m.flow === 'cardSpend' || m.flow === 'cardPayment'))) {
    c.add(`${at}.cardId`, `카드는 카드 사용 · 카드 대금에만 붙습니다: ${describe(m.flow)}`);
  }
  if (m.cardCycle !== undefined && m.cardCycle !== null) {
    if (typeof m.cardCycle !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m.cardCycle)) {
      c.add(`${at}.cardCycle`, `YYYY-MM 이 아닙니다: ${describe(m.cardCycle)}`);
    } else if (!hasCard || m.flow !== 'cardPayment') {
      c.add(`${at}.cardCycle`, '청구 회차는 카드를 정한 카드 대금에만 붙습니다.');
    } else if (e.recurrence !== undefined && e.recurrence !== null) {
      c.add(`${at}.cardCycle`, '반복 대금은 회차마다 그 달을 갚습니다 — 회차를 박아 둘 수 없습니다.');
    }
  }

  const actual = m.status === 'actual';
  const ref = m.plannedRef;
  if (ref !== undefined && ref !== null) {
    if (!isObj(ref)) {
      c.add(`${at}.plannedRef`, `객체가 아닙니다: ${describe(ref)}`);
    } else {
      if (typeof ref.entryId !== 'string' || !ref.entryId || ref.entryId.length > LIMITS.refId) {
        c.add(`${at}.plannedRef.entryId`, `예정 항목 id 가 아닙니다: ${describe(ref.entryId)}`);
      }
      reqDate(c, `${at}.plannedRef.date`, ref.date);
      if (!actual) c.add(`${at}.plannedRef`, '확정한 회차는 실제 거래에만 붙습니다.');
    }
  }
  if (actual) {
    if (e.recurrence !== undefined && e.recurrence !== null) {
      c.add(`${where}.recurrence`, '실제 거래는 반복할 수 없습니다.');
    }
    if (e.endDate !== undefined && e.endDate !== null) {
      c.add(`${where}.endDate`, '실제 거래는 기간을 가질 수 없습니다.');
    }
    if (m.type !== 'income' && m.type !== 'expense') {
      c.add(`${at}.type`, `실제 거래는 입금 · 출금으로만 적습니다: ${describe(m.type)}`);
    }
  }
  if (typeof m.flow === 'string' && OUTFLOW_ONLY.includes(m.flow) && m.type !== 'expense') {
    c.add(`${at}.flow`, `'${m.flow}' 는 나가는 돈에만 붙습니다: ${describe(m.type)}`);
  }
}

function checkAccountRaw(c: Collector, where: string, a: Raw): void {
  reqStr(c, `${where}.name`, a.name, LIMITS.name);
  reqInt(c, `${where}.balanceMinor`, a.balanceMinor);
  reqStr(c, `${where}.currency`, a.currency);
  reqDate(c, `${where}.asOf`, a.asOf);
  optStr(c, `${where}.checkedAt`, a.checkedAt, LIMITS.checkedAt);
  optInt(c, `${where}.order`, a.order);
  optStrArray(c, `${where}.reflectedEntryIds`, a.reflectedEntryIds, LIMITS.reflected);
}

function checkDebtRaw(c: Collector, where: string, d: Raw): void {
  reqStr(c, `${where}.name`, d.name, LIMITS.name);
  reqInt(c, `${where}.balanceMinor`, d.balanceMinor);
  reqInt(c, `${where}.monthlyMinor`, d.monthlyMinor);
  if (d.rate !== undefined && d.rate !== null && typeof d.rate !== 'number') {
    c.add(`${where}.rate`, `숫자가 아닙니다: ${describe(d.rate)}`);
  }
  optInt(c, `${where}.currentRound`, d.currentRound);
  optInt(c, `${where}.totalRounds`, d.totalRounds);
}

function checkPinRaw(c: Collector, where: string, p: Raw): void {
  if (typeof p.lens !== 'string' || !KINDS.includes(p.lens)) {
    c.add(`${where}.lens`, `렌즈를 알 수 없습니다: ${describe(p.lens)}`);
  }
  reqStr(c, `${where}.text`, p.text, LIMITS.pinText);
  optInt(c, `${where}.order`, p.order);
}

function checkBudgetRaw(c: Collector, where: string, b: Raw): void {
  reqStr(c, `${where}.name`, b.name, LIMITS.name);
  reqInt(c, `${where}.amountMinor`, b.amountMinor);
  if (isIntNum(b.amountMinor) && b.amountMinor < 0) {
    c.add(`${where}.amountMinor`, `음수입니다: ${b.amountMinor} — 예산은 0 이상이어야 합니다.`);
  }
  reqStr(c, `${where}.currency`, b.currency);
  reqDate(c, `${where}.startDate`, b.startDate);
  reqDate(c, `${where}.endDate`, b.endDate);
  // 기간이 뒤집힌 예산은 어떤 지출도 품지 못한다. 조용히 바로잡으면 연결된 지출이
  // 전부 일반 지출로 떨어져 한도가 두 번 깎인다.
  if (typeof b.startDate === 'string' && typeof b.endDate === 'string'
      && isValidDate(b.startDate) && isValidDate(b.endDate) && b.endDate < b.startDate) {
    c.add(`${where}.endDate`, `종료일이 시작일보다 앞섭니다: ${b.endDate} < ${b.startDate}`);
  }
  optStr(c, `${where}.createdAt`, b.createdAt, LIMITS.checkedAt);
  optStr(c, `${where}.updatedAt`, b.updatedAt, LIMITS.checkedAt);
}

function checkReserveRaw(c: Collector, where: string, r: Raw): void {
  reqStr(c, `${where}.name`, r.name, LIMITS.name);
  reqInt(c, `${where}.amountMinor`, r.amountMinor);
  if (isIntNum(r.amountMinor) && r.amountMinor < 0) {
    c.add(`${where}.amountMinor`, `음수입니다: ${r.amountMinor} — 세이브는 0 이상이어야 합니다.`);
  }
  reqStr(c, `${where}.currency`, r.currency);
  /*
    보호 · 목표 · 보관(v8). 없는 것이 정상이다(예전 파일 — 보호 켬으로 읽는다). 있으면 형태를 본다.
    보호는 뜻이 바뀌는 값이라 모르는 값을 "켬" 으로 떨어뜨리지 않고 거절한다 — 꺼 둔 세이브가
    가져온 뒤 말없이 한도에서 빠지면 안 된다.
  */
  if (r.protected !== undefined && typeof r.protected !== 'boolean') {
    c.add(`${where}.protected`, `참/거짓이 아닙니다: ${describe(r.protected)}`);
  }
  optInt(c, `${where}.targetAmountMinor`, r.targetAmountMinor);
  if (isIntNum(r.targetAmountMinor) && r.targetAmountMinor < 0) {
    c.add(`${where}.targetAmountMinor`, `음수입니다: ${r.targetAmountMinor} — 목표 금액은 0 이상이어야 합니다.`);
  }
  if (r.targetDate !== undefined && r.targetDate !== null) reqDate(c, `${where}.targetDate`, r.targetDate);
  if (r.archivedAt !== undefined && r.archivedAt !== null) {
    reqStr(c, `${where}.archivedAt`, r.archivedAt, LIMITS.checkedAt);
    if (r.archivedAt === '') c.add(`${where}.archivedAt`, '보관 시각이 비어 있습니다.');
  }
  optStr(c, `${where}.createdAt`, r.createdAt, LIMITS.checkedAt);
  optStr(c, `${where}.updatedAt`, r.updatedAt, LIMITS.checkedAt);
}

function checkCategoryRaw(c: Collector, where: string, r: Raw): void {
  reqStr(c, `${where}.name`, r.name, LIMITS.name);
  if (typeof r.name === 'string' && !r.name.trim()) c.add(`${where}.name`, '이름이 비어 있습니다.');
  // 흐름은 뜻이 바뀌는 값이다. 모르는 값을 지출로 떨어뜨리면 수입 카테고리가 지출 쪽에 선다.
  if (r.kind !== 'income' && r.kind !== 'expense') {
    c.add(`${where}.kind`, `흐름을 알 수 없습니다: ${describe(r.kind)} — 쓸 수 있는 값: income · expense`);
  }
  optInt(c, `${where}.order`, r.order);
  if (r.archived !== undefined && r.archived !== null && typeof r.archived !== 'boolean') {
    c.add(`${where}.archived`, `참·거짓이 아닙니다: ${describe(r.archived)}`);
  }
  optStr(c, `${where}.createdAt`, r.createdAt, LIMITS.checkedAt);
  optStr(c, `${where}.updatedAt`, r.updatedAt, LIMITS.checkedAt);
}

function checkCategoryBudgetRaw(c: Collector, where: string, r: Raw): void {
  reqStr(c, `${where}.categoryId`, r.categoryId, LIMITS.categoryId);
  if (r.scope !== 'default' && r.scope !== 'period') {
    c.add(`${where}.scope`, `범위를 알 수 없습니다: ${describe(r.scope)} — 쓸 수 있는 값: default · period`);
  }
  if (typeof r.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period)) {
    c.add(`${where}.period`, `기간(YYYY-MM)이 아닙니다: ${describe(r.period)}`);
  }
  if (r.amountMinor !== null) {
    reqInt(c, `${where}.amountMinor`, r.amountMinor);
    if (isIntNum(r.amountMinor) && r.amountMinor < 0) {
      c.add(`${where}.amountMinor`, `음수입니다: ${r.amountMinor}`);
    }
  }
  reqStr(c, `${where}.currency`, r.currency);
  optStr(c, `${where}.createdAt`, r.createdAt, LIMITS.checkedAt);
  optStr(c, `${where}.updatedAt`, r.updatedAt, LIMITS.checkedAt);
  // 문서 id 는 카테고리 · 범위 · 기간으로 정해진다. 규칙이 그 모양만 받으므로, 다른 id 는
  // 검증을 지나 저장하는 순간 거절된다 — 여기서 미리 말한다.
  const expected = `${String(r.categoryId)}~${String(r.scope)}~${String(r.period)}`;
  if (typeof r.id === 'string' && r.id !== expected) {
    c.add(`${where}.id`, `카테고리 예산의 id 는 '${expected}' 이어야 합니다: ${r.id}`);
  }
}

function checkLedgerNoteRaw(c: Collector, where: string, r: Raw): void {
  if (typeof r.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period)) {
    c.add(`${where}.period`, `기간(YYYY-MM)이 아닙니다: ${describe(r.period)}`);
  }
  reqStr(c, `${where}.text`, r.text, LEDGER_NOTE_MAX);
  optStr(c, `${where}.createdAt`, r.createdAt, LIMITS.checkedAt);
  optStr(c, `${where}.updatedAt`, r.updatedAt, LIMITS.checkedAt);
  // 문서 id 가 곧 기간이다. 규칙이 그 모양만 받으므로 쓰기 전에 말한다.
  if (typeof r.id === 'string' && r.id !== r.period) {
    c.add(`${where}.id`, `기간 메모의 id 는 기간(${String(r.period)})과 같아야 합니다: ${r.id}`);
  }
}

/**
 * 연간 카테고리 예산(v9). 규칙이 거절할 모양을 쓰기 전에 말한다 — id 는 `카테고리id~연도`, 금액 · 배분은
 * 0 이상 정수, 배분 열쇠는 '01' ~ '12', 배분 합은 연간 예산 이하.
 */
function checkAnnualBudgetRaw(c: Collector, where: string, r: Raw): void {
  reqStr(c, `${where}.categoryId`, r.categoryId, LIMITS.categoryId);
  if (typeof r.categoryId === 'string' && r.categoryId.length === 0) c.add(`${where}.categoryId`, '카테고리가 비어 있습니다.');
  if (!isIntNum(r.year) || r.year < MIN_YEAR || r.year > MAX_YEAR) {
    c.add(`${where}.year`, `${MIN_YEAR}~${MAX_YEAR} 의 정수가 아닙니다: ${describe(r.year)}`);
  }
  reqInt(c, `${where}.amountMinor`, r.amountMinor);
  if (isIntNum(r.amountMinor) && r.amountMinor < 0) c.add(`${where}.amountMinor`, `음수입니다: ${r.amountMinor}`);
  let allocated = 0;
  if (!isObj(r.monthAllocations)) {
    c.add(`${where}.monthAllocations`, `객체가 아닙니다: ${describe(r.monthAllocations)}`);
  } else {
    for (const [k, v] of Object.entries(r.monthAllocations)) {
      if (!(MONTH_NOS as readonly string[]).includes(k)) {
        c.add(`${where}.monthAllocations.${k}`, '달은 01 ~ 12 여야 합니다.');
        continue;
      }
      reqInt(c, `${where}.monthAllocations.${k}`, v);
      if (isIntNum(v) && v < 1) c.add(`${where}.monthAllocations.${k}`, `1 이상이어야 합니다: ${v}`);
      if (isIntNum(v)) allocated += v;
    }
    if (isIntNum(r.amountMinor) && allocated > r.amountMinor) {
      c.add(`${where}.monthAllocations`, `월별 배분 합(${allocated})이 연간 예산(${r.amountMinor})을 넘습니다.`);
    }
  }
  reqStr(c, `${where}.currency`, r.currency);
  optStr(c, `${where}.createdAt`, r.createdAt, LIMITS.checkedAt);
  optStr(c, `${where}.updatedAt`, r.updatedAt, LIMITS.checkedAt);
  const expected = `${String(r.categoryId)}~${String(r.year)}`;
  if (typeof r.id === 'string' && r.id !== expected) {
    c.add(`${where}.id`, `연간 예산의 id 는 '${expected}' 이어야 합니다: ${r.id}`);
  }
}

/**
 * 신용카드(v11). 이름 · 마감일 · 결제일(1~31) · 결제 달 수(0~2, 0 이면 결제일 > 마감일) — 규칙이 받는 모양과 같다.
 */
function checkCardRaw(c: Collector, where: string, r: Raw): void {
  reqStr(c, `${where}.name`, r.name, LIMITS.name);
  if (typeof r.name === 'string' && !r.name.trim()) c.add(`${where}.name`, '카드 이름이 비어 있습니다.');
  for (const k of ['closeDay', 'payDay'] as const) {
    if (!isIntNum(r[k]) || (r[k] as number) < 1 || (r[k] as number) > 31) c.add(`${where}.${k}`, `1~31 의 정수가 아닙니다: ${describe(r[k])}`);
  }
  const off = r.payMonthOffset;
  if (!isIntNum(off) || off < 0 || off > 2) c.add(`${where}.payMonthOffset`, `0~2 의 정수가 아닙니다: ${describe(off)}`);
  else if (off === 0 && isIntNum(r.payDay) && isIntNum(r.closeDay) && r.payDay <= r.closeDay) {
    c.add(`${where}.payDay`, '마감한 그 달에 결제하려면 결제일이 마감일보다 뒤여야 합니다.');
  }
  optStr(c, `${where}.accountId`, r.accountId, LIMITS.accountId);
  reqStr(c, `${where}.currency`, r.currency);
  if (r.order !== undefined && r.order !== null && typeof r.order !== 'number') c.add(`${where}.order`, `숫자가 아닙니다: ${describe(r.order)}`);
  optStr(c, `${where}.archivedAt`, r.archivedAt, LIMITS.checkedAt);
  optStr(c, `${where}.createdAt`, r.createdAt, LIMITS.checkedAt);
  optStr(c, `${where}.updatedAt`, r.updatedAt, LIMITS.checkedAt);
}

const CHECKERS: Record<BackupCollection, (c: Collector, where: string, v: Raw) => void> = {
  entries: checkEntryRaw,
  accounts: checkAccountRaw,
  debts: checkDebtRaw,
  pins: checkPinRaw,
  budgets: checkBudgetRaw,
  reserves: checkReserveRaw,
  categories: checkCategoryRaw,
  categoryBudgets: checkCategoryBudgetRaw,
  ledgerNotes: checkLedgerNoteRaw,
  annualBudgets: checkAnnualBudgetRaw,
  cards: checkCardRaw,
};

/** 컬렉션 하나를 통째로 본다. 없으면 그 자체가 문제다 (v2·v3 명세). */
function checkCollection(c: Collector, name: BackupCollection, value: unknown): Raw[] {
  if (value === undefined) {
    c.add(name, `이 형식의 백업에는 ${name} 가 반드시 있어야 합니다. 파일이 잘렸을 수 있습니다.`);
    return [];
  }
  if (!Array.isArray(value)) {
    c.add(name, `배열이 아닙니다: ${describe(value)}`);
    return [];
  }
  const seen = new Set<string>();
  const rows: Raw[] = [];
  value.forEach((item, at) => {
    const where = `${name}[${at}]`;
    if (!isObj(item)) { c.add(where, `객체가 아닙니다: ${describe(item)}`); return; }
    if (!checkId(c, where, item, seen)) return;
    CHECKERS[name](c, where, item);
    rows.push(item);
  });
  return rows;
}

/**
 * v2·v3 파일의 `budgets` · `reserves`.
 *
 * 없는 것이 정상이다 (그 구조가 없던 시절의 파일이다). 있으면 v4 와 똑같이 검증한다 —
 * 손으로 고친 파일이 검사 없이 통과하면 잘못된 예산이 한도를 조용히 깎는다.
 */
function checkOptionalCollection(c: Collector, name: BackupCollection, value: unknown): Raw[] {
  if (value === undefined || value === null) return [];
  return checkCollection(c, name, value);
}

// ---------- 파일 읽기 ----------

/**
 * 파일 문자열에서 도메인 데이터까지.
 *
 * 문제가 하나라도 있으면 `{ ok: false }` 를 돌려주고 **변환하지 않는다.**
 * 부르는 쪽은 저장소를 건드리기 전에 이 결과를 봐야 한다.
 *
 * 판정 순서: JSON → app → version → 형식(legacy / v2·v3) → 컬렉션 → 항목.
 * app·version 이 items 보다 앞에 있어야 남의 앱 백업이 이관 갈래로 새지 않는다.
 */
export function readBackupFile(text: string): ReadResult {
  const c = new Collector();

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, problems: [{ where: '파일', reason: 'JSON 형식이 아닙니다. 백업 파일이 맞는지 확인해 주세요.' }] };
  }
  if (!isObj(obj)) {
    return { ok: false, problems: [{ where: '파일', reason: `백업 파일의 내용을 읽을 수 없습니다: ${describe(obj)}` }] };
  }

  /*
    ---- 앱과 버전을 **items 보다 먼저** 본다 ----

    예전에는 `items` 배열이 보이면 그 자리에서 이관 전 형식으로 넘겼다. 그러면
    `app` 도 `version` 도 보지 않은 채 남의 앱 백업이나 아직 모르는 버전의 파일이
    이관 변환기로 새어 들어갔다 — 변환기는 방어적이라 거절하지 않고 무언가를 만들어 낸다.

    메타데이터가 아예 없던 진짜 옛 백업은 그대로 받아 준다. 그 파일에는 `app` 도
    `version` 도 없고 `items` 만 있다.
  */
  if (obj.app !== undefined && obj.app !== 'Dada Calendar') {
    return { ok: false, problems: [{ where: 'app', reason: `이 앱의 백업이 아닙니다: ${describe(obj.app)}` }] };
  }

  const version = obj.version;
  if (version !== undefined) {
    if (!isIntNum(version)) {
      return { ok: false, problems: [{ where: 'version', reason: `버전이 정수가 아닙니다: ${describe(version)}` }] };
    }
    if (version > LATEST_VERSION) {
      return {
        ok: false,
        problems: [{
          where: 'version',
          reason: `이 앱이 아직 모르는 버전입니다 (파일 ${version} · 지원 ${LATEST_VERSION}). `
            + '앱을 새로고침해 최신 버전으로 다시 시도해 주세요.',
        }],
      };
    }
    if (!(SUPPORTED_VERSIONS as readonly number[]).includes(version)) {
      return { ok: false, problems: [{ where: 'version', reason: `지원하지 않는 버전입니다: ${version}` }] };
    }
  }

  // ---- 이관 전 형식 (version 1 또는 메타데이터 없는 옛 파일) ----
  if (version === undefined || version === 1) {
    if (Array.isArray(obj.items)) return readLegacy(c, obj.items);
    if (version === 1) {
      return {
        ok: false,
        problems: [{
          where: 'items',
          reason: '이관 전(version 1) 백업인데 items 배열이 없습니다. 파일이 잘렸을 수 있습니다.',
        }],
      };
    }
    return { ok: false, problems: [{ where: 'version', reason: '버전이 없습니다. 백업 파일이 맞는지 확인해 주세요.' }] };
  }

  const format: BackupFormat = version >= 12 ? 'v12' : version === 11 ? 'v11' : version === 10 ? 'v10' : version === 9 ? 'v9' : version === 8 ? 'v8' : version === 7 ? 'v7' : version === 6 ? 'v6' : version === 5 ? 'v5'
    : version === 4 ? 'v4' : version === 3 ? 'v3' : 'v2';
  const hasPockets = version >= 4;
  const hasCategories = version >= 6;
  const hasNotes = version >= 7;
  const hasAnnual = version >= 9;
  const hasCards = version >= 11;

  // ---- 컬렉션 ----
  const entries = checkCollection(c, 'entries', obj.entries);
  const accounts = checkCollection(c, 'accounts', obj.accounts);
  const debts = checkCollection(c, 'debts', obj.debts);
  const pins = checkCollection(c, 'pins', obj.pins);
  const budgets = hasPockets
    ? checkCollection(c, 'budgets', obj.budgets)
    : checkOptionalCollection(c, 'budgets', obj.budgets);
  const reserves = hasPockets
    ? checkCollection(c, 'reserves', obj.reserves)
    : checkOptionalCollection(c, 'reserves', obj.reserves);
  // v6 부터 필수다. 그 앞 파일에는 없는 것이 정상이고, 있으면 검증은 한다.
  const categories = hasCategories
    ? checkCollection(c, 'categories', obj.categories)
    : checkOptionalCollection(c, 'categories', obj.categories);
  const categoryBudgets = hasCategories
    ? checkCollection(c, 'categoryBudgets', obj.categoryBudgets)
    : checkOptionalCollection(c, 'categoryBudgets', obj.categoryBudgets);
  // v7 부터 필수다. v6 까지는 그 구조가 없던 시절이라 없는 것이 정상이다.
  const ledgerNotes = hasNotes
    ? checkCollection(c, 'ledgerNotes', obj.ledgerNotes)
    : checkOptionalCollection(c, 'ledgerNotes', obj.ledgerNotes);
  // v9 부터 필수다. v8 까지는 연간 예산이 없던 시절이라 없는 것이 정상이다.
  const annualBudgets = hasAnnual
    ? checkCollection(c, 'annualBudgets', obj.annualBudgets)
    : checkOptionalCollection(c, 'annualBudgets', obj.annualBudgets);
  // v11 부터 필수다. v10 까지는 카드가 없던 시절이라 없는 것이 정상이다.
  const cards = hasCards
    ? checkCollection(c, 'cards', obj.cards)
    : checkOptionalCollection(c, 'cards', obj.cards);
  if (obj.ledger !== undefined && obj.ledger !== null) {
    if (!isObj(obj.ledger)) {
      c.add('ledger', `객체가 아닙니다: ${describe(obj.ledger)}`);
    } else {
      const d = obj.ledger.settleDay;
      if (!isIntNum(d) || d < 1 || d > 31) c.add('ledger.settleDay', `1~31 의 정수가 아닙니다: ${describe(d)}`);
    }
  }

  // v2 에는 recovery 가 없다. v3 에서는 있어도 되고 null 이어도 된다.
  if (format === 'v2' && obj.recovery !== undefined && obj.recovery !== null) {
    c.add('recovery', 'version 2 백업에는 회복 설정이 들어 있을 수 없습니다.');
  }
  if (obj.recovery !== undefined && obj.recovery !== null && !isObj(obj.recovery)) {
    c.add('recovery', `객체가 아닙니다: ${describe(obj.recovery)}`);
  }

  if (!c.ok) return { ok: false, problems: c.problems };

  // ---- 여기서부터 변환. 검증을 통과한 값에만 닿는다 ----
  return {
    ok: true,
    file: {
      format,
      version,
      notes: colorNotes(entries),
      data: {
        entries: entries.map((r) => entryFromDoc(r.id as string, r)),
        accounts: accounts.map((r) => accountFromDoc(r.id as string, r)),
        debts: debts.map((r) => debtFromDoc(r.id as string, r)),
        pins: pins.map((r) => pinFromDoc(r.id as string, r)),
        budgets: budgets.map((r) => budgetFromDoc(r.id as string, r)),
        reserves: reserves.map((r) => reserveFromDoc(r.id as string, r)),
        categories: categories.map((r) => categoryFromDoc(r.id as string, r)),
        categoryBudgets: categoryBudgets.map((r) => categoryBudgetFromDoc(r.id as string, r)),
        ledgerNotes: ledgerNotes.map((r) => ledgerNoteFromDoc(r.id as string, r)),
        annualBudgets: annualBudgets.map((r) => annualBudgetFromDoc(r.id as string, r)),
        cards: cards.map((r) => cardFromDoc(r.id as string, r)),
        ledger: isObj(obj.ledger) ? ledgerSettingsFromDoc(obj.ledger) : null,
        recovery: isObj(obj.recovery) ? recoveryRuleFromDoc(obj.recovery) : null,
      },
    },
  };
}

/**
 * 이관 전 형식.
 *
 * 변환기(`convertLegacyItems`)가 제외하거나 자른 항목을 그대로 돌려준다.
 * 이건 조용한 보정이 아니라 **보고되는** 변환이라 사용자가 무엇이 달라졌는지 알 수 있다.
 */
function readLegacy(c: Collector, items: unknown[]): ReadResult {
  items.forEach((item, at) => {
    if (!isObj(item)) c.add(`items[${at}]`, `객체가 아닙니다: ${describe(item)}`);
  });
  if (!c.ok) return { ok: false, problems: c.problems };

  const converted = convertLegacyItems(items as Raw[]);
  const notes: ConversionNote[] = [
    ...converted.skipped.map((s) => ({ id: s.id, reason: s.reason })),
    ...converted.trimmed.map((t) => ({ id: t.id, reason: t.reason })),
  ];

  return {
    ok: true,
    file: {
      format: 'legacy',
      version: 1,
      notes,
      data: {
        entries: converted.entries,
        accounts: converted.accounts,
        debts: converted.debts,
        pins: converted.pins,
        // 이관 전 구조에는 예산·세이브·회복이 없었다.
        budgets: [],
        reserves: [],
        categories: [],
        categoryBudgets: [],
        ledgerNotes: [],
        annualBudgets: [],
        cards: [],
        ledger: null,
        recovery: null,
      },
    },
  };
}

export function describeFileProblem(p: FileProblem): string {
  return `${p.where} — ${p.reason}`;
}
