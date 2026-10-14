/**
 * 다른 가계부의 지난 거래를 실제 거래로 옮겨 온다.
 *
 * 받는 모양은 한 가지다 — 첫 줄이 열 이름이고 `일자 · 구분 · 금액` 이 반드시 있으며
 * `수단 · 설명 · 카테고리 · 메모` 는 있으면 읽는다. 실제로 받은 이관 파일(엑셀, 정산
 * 기간마다 한 파일)이 이 모양이고, 같은 열 이름의 CSV 도 같은 길로 들어온다.
 *
 * ── 한 행이라도 못 읽으면 그 파일을 받지 않는다 ────────────────────
 *
 * 백업 가져오기와 같은 기준이다. 날짜가 깨진 행 · 모르는 구분 · 0원 같은 행을 건너뛰고
 * 나머지만 넣으면, 그 기간의 합계가 원본과 조용히 달라진다. 무엇이 왜 안 되는지 적고
 * 아무것도 쓰지 않는다. 합계 줄 같은 군더더기도 같은 이유로 거절된다.
 *
 * ── 같은 행 두 줄은 두 건이다 ─────────────────────────────────
 *
 * 받은 파일에 날짜 · 금액 · 설명이 완전히 같은 행이 실제로 있다(같은 날 담배 두 갑).
 * 내용만으로 id 를 만들면 둘이 한 건으로 합쳐져 돈이 사라진다. 그래서 id 는
 * "그 파일에서 같은 내용이 몇 번째로 나왔는가" 까지 넣어 만든다 — 같은 파일을 다시
 * 가져오면 같은 id 가 나와 두 번 들어가지 않고, 두 줄은 끝까지 두 건이다.
 *
 * ── 넘겨짚지 않는 것 ─────────────────────────────────────────
 *
 * - 카테고리는 원본 이름 그대로 붙인다. 같은 이름(대소문자 · 공백 무시)이 있으면 그것에,
 *   없으면 새로 만든다. 다른 이름끼리 묶지 않는다 — 묶은 분류는 되돌릴 수 없다.
 * - 카테고리 `대출` 은 대출 원금으로 센다(사용자가 정했다). 원본은 원금과 이자를 한
 *   금액으로 적어 가를 수 없으므로, 금융비용은 실제보다 작게 잡힌다. 화면이 그 사실을 적는다.
 * - 이미 있는 실제 거래와 날짜 · 구분 · 금액이 같은 행은 "겹쳐 보인다" 로 따로 보여 주고
 *   기본으로 빼 둔다. 같은 거래를 손으로 이미 적었을 수 있다. 넣을지는 사용자가 고른다.
 * - 잔고를 적은 날 당일이거나 그 뒤의 행은 한도를 움직인다. 미리 건수를 알린다.
 */
import { isValidDate, normalizeDate, pad2 } from './date';
import { findCategoryByName, LOAN_CATEGORY_NAMES } from './category';
import { newEntry, newMoney } from './entry';
import { isActual } from './ledger';
import type { Account, Category, DateISO, Entry, MoneyFlow } from './types';

/** 열 이름. 왼쪽이 화면에 적는 이름이다. */
const COLUMNS = {
  date: ['일자', '날짜'],
  type: ['구분'],
  amount: ['금액'],
  method: ['수단', '결제수단'],
  title: ['설명', '내용', '내역'],
  category: ['카테고리', '분류'],
  memo: ['메모'],
} as const;
type ColumnKey = keyof typeof COLUMNS;
const REQUIRED: readonly ColumnKey[] = ['date', 'type', 'amount'];

/** 이 카테고리 이름의 지출은 대출 원금으로 센다. 입력 화면의 '대출' 흐름과 같은 이름이다. */
export const LOAN_PRINCIPAL_CATEGORY_NAMES: readonly string[] = LOAN_CATEGORY_NAMES;

/** 엑셀 날짜 일련번호의 기준(1900 체계, 1900-02-29 버그 포함). */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

export interface ImportRow {
  /** 어느 파일의 몇 번째 줄인가 (1부터, 열 이름 줄 포함). */
  file: string;
  line: number;
  date: DateISO;
  type: 'income' | 'expense';
  amountMinor: number;
  title: string;
  /** 원본의 설명 칸이 비어 있었는가. 제목은 카테고리나 구분으로 메운다. */
  untitled: boolean;
  categoryName: string | null;
  method: string | null;
  memo: string;
  /** 그 파일에서 같은 내용이 몇 번째로 나왔는가 (0부터). */
  occurrence: number;
  id: string;
}

export interface ImportProblem {
  file: string;
  /** 줄 번호. 파일 전체의 문제면 null. */
  line: number | null;
  reason: string;
}

export interface ReadResult {
  rows: ImportRow[];
  problems: ImportProblem[];
  /** 읽지 않고 넘긴 열 이름. 뜻을 모르는 열을 조용히 버리지 않고 알린다. */
  ignoredColumns: string[];
}

const blank = (s: string | undefined) => {
  const t = (s ?? '').trim();
  return t === '-' ? '' : t;
};

function parseDateCell(raw: string): DateISO | null {
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    // 날짜 서식의 숫자 셀. 1990 ~ 2100 사이만 날짜로 본다 — 그 밖의 숫자는 날짜가 아니다.
    const serial = Math.floor(Number(s));
    if (serial < 32874 || serial > 73051) return null;
    const d = new Date(EXCEL_EPOCH_UTC + serial * 86_400_000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const m = /^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?$/.exec(s);
  if (!m) return null;
  const iso = normalizeDate(`${m[1]}-${m[2]}-${m[3]}`);
  return iso && isValidDate(iso) ? iso : null;
}

/** "3,405,940" · "3405940원" · "₩ 22,000" → 정수. 음수 · 소수 · 0 은 받지 않는다. */
function parseAmountCell(raw: string): number | null {
  const s = raw.trim().replace(/^₩\s*/, '').replace(/\s*원$/, '');
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * 문자열 해시(cyrb53). 암호용이 아니라 같은 입력에 같은 id 를 내기 위한 것이다.
 * id 앞에 날짜가 붙으므로 겹침은 같은 날 안에서만 문제가 되고, 53비트면 충분하다.
 */
function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const SEP = '\u0001';

/**
 * 옮겨 온 거래의 id. 날짜 + 내용 + 같은 내용 안에서의 순번.
 * `title` 은 원본 설명 칸 그대로다(비어 있으면 '') — 화면에 메운 제목이 아니다.
 */
export function importEntryId(r: Omit<ImportRow, 'id' | 'file' | 'line' | 'untitled'>): string {
  const content = [r.type, r.amountMinor, r.title, r.categoryName ?? '', r.method ?? '', r.memo, r.occurrence].join(SEP);
  return `imp-${r.date.replace(/-/g, '')}-${hash53(content)}`;
}

/** 새로 만드는 카테고리의 id. 이름으로 정해져 두 번 가져와도 하나로 모인다. */
export function importCategoryId(kind: Category['kind'], name: string): string {
  return `imp-cat-${kind}-${hash53(name.trim().replace(/\s+/g, ' ').toLowerCase())}`;
}

/** 표 한 장을 행으로. 못 읽는 행이 있으면 problems 에 남는다 — 그때 rows 는 쓰지 않는다. */
export function readLedgerTable(table: readonly (readonly string[])[], file: string): ReadResult {
  const problems: ImportProblem[] = [];
  const headerAt = table.findIndex((r) => r.some((c) => c.trim() !== ''));
  if (headerAt < 0) return { rows: [], problems: [{ file, line: null, reason: '빈 파일입니다.' }], ignoredColumns: [] };

  const header = table[headerAt]!.map((c) => c.trim());
  const col: Partial<Record<ColumnKey, number>> = {};
  const ignoredColumns: string[] = [];
  header.forEach((name, i) => {
    if (name === '') return;
    const key = (Object.keys(COLUMNS) as ColumnKey[]).find((k) => (COLUMNS[k] as readonly string[]).includes(name));
    if (!key) { ignoredColumns.push(name); return; }
    if (col[key] !== undefined) {
      problems.push({ file, line: headerAt + 1, reason: `'${name}' 열이 두 번 있습니다.` });
      return;
    }
    col[key] = i;
  });
  const missing = REQUIRED.filter((k) => col[k] === undefined).map((k) => COLUMNS[k][0]);
  if (missing.length > 0) {
    problems.push({
      file, line: headerAt + 1,
      reason: `첫 줄에 ${missing.map((m) => `'${m}'`).join(' · ')} 열이 없습니다. 받는 열: 일자 · 구분 · 금액 (수단 · 설명 · 카테고리 · 메모는 선택)`,
    });
  }
  if (problems.length > 0) return { rows: [], problems, ignoredColumns };

  const cell = (r: readonly string[], k: ColumnKey) => (col[k] === undefined ? '' : r[col[k]!] ?? '');
  const seen = new Map<string, number>();
  const rows: ImportRow[] = [];

  for (let i = headerAt + 1; i < table.length; i++) {
    const r = table[i]!;
    if (!r.some((c) => c.trim() !== '')) continue;
    const line = i + 1;
    const bad = (reason: string) => problems.push({ file, line, reason });

    const date = parseDateCell(cell(r, 'date'));
    if (!date) { bad(`일자 '${cell(r, 'date')}' 를 날짜로 읽지 못했습니다.`); continue; }

    const typeRaw = cell(r, 'type').trim();
    const type = typeRaw === '수입' ? 'income' : typeRaw === '지출' ? 'expense' : null;
    if (!type) { bad(`구분 '${typeRaw}' 은 받지 않습니다. 수입 · 지출만 받습니다.`); continue; }

    const amountMinor = parseAmountCell(cell(r, 'amount'));
    if (amountMinor === null) {
      bad(`금액 '${cell(r, 'amount')}' 를 읽지 못했습니다. 0보다 큰 원 단위 정수여야 합니다.`);
      continue;
    }

    const categoryName = blank(cell(r, 'category')) || null;
    const method = blank(cell(r, 'method')) || null;
    const memo = blank(cell(r, 'memo'));
    const given = blank(cell(r, 'title'));
    const title = given || categoryName || (type === 'income' ? '수입' : '지출');

    if (title.length > 500) { bad('설명이 500자를 넘습니다.'); continue; }
    if (categoryName && categoryName.length > 100) { bad('카테고리 이름이 100자를 넘습니다.'); continue; }
    if (method && method.length > 100) { bad('수단이 100자를 넘습니다.'); continue; }
    if (memo.length > 20000) { bad('메모가 너무 깁니다.'); continue; }

    const content = [date, type, amountMinor, given, categoryName ?? '', method ?? '', memo].join(SEP);
    const occurrence = seen.get(content) ?? 0;
    seen.set(content, occurrence + 1);
    const base = { date, type, amountMinor, title, categoryName, method, memo, occurrence } as const;
    rows.push({ ...base, file, line, untitled: !given, id: importEntryId({ ...base, title: given }) });
  }

  if (rows.length === 0 && problems.length === 0) {
    problems.push({ file, line: null, reason: '열 이름 아래에 거래가 한 줄도 없습니다.' });
  }
  return { rows, problems, ignoredColumns };
}

// ---------- 계획 ----------

export interface FileSummary {
  file: string;
  count: number;
  from: DateISO;
  to: DateISO;
}

export interface CategoryUse {
  kind: Category['kind'];
  name: string;
  count: number;
  /** 붙을 카테고리. 새로 만드는 것이면 `created` 가 참. */
  categoryId: string;
  created: boolean;
  archived: boolean;
}

export interface Overlap {
  row: ImportRow;
  existing: Entry;
}

export interface ImportPlan {
  /** 고른 파일 전체에서 읽은 행. 아래 갈래를 더하면 이 수가 된다. */
  total: number;
  /** 새로 쓸 거래. 겹쳐 보이는 것을 넣기로 했으면 그것도 포함. */
  entries: Entry[];
  /** 이미 같은 id 로 들어 있는 행 — 같은 파일을 전에 가져왔다. 쓰지 않는다. */
  already: ImportRow[];
  /** 같은 파일을 한 번에 두 번 골라 겹친 행. 쓰지 않는다. */
  repeated: ImportRow[];
  /** 이미 있는 실제 거래와 날짜 · 구분 · 금액이 같은 행. */
  overlaps: Overlap[];
  /** overlaps 를 entries 에 넣었는가. */
  overlapsIncluded: boolean;
  newCategories: Category[];
  categories: CategoryUse[];
  /** 대출 원금으로 셀 행 수와 합계. */
  loan: { count: number; amountMinor: number };
  /** 잔고를 적은 날 당일이거나 그 뒤라 한도를 움직이는 행. 잔고가 없으면 null. */
  afterBalance: { asOf: DateISO; count: number } | null;
  files: FileSummary[];
  /** 설명 칸이 비어 제목을 메운 행 (쓸 것 중). */
  untitled: number;
  income: { count: number; amountMinor: number };
  expense: { count: number; amountMinor: number };
}

export interface PlanContext {
  categories: readonly Category[];
  /** 지금 계정의 거래 전량. 실제 거래만 골라 본다. */
  entries: readonly Entry[];
  accounts: readonly Account[];
  includeOverlaps: boolean;
  now?: string;
}

const isLoanCategory = (name: string | null) =>
  name != null && LOAN_PRINCIPAL_CATEGORY_NAMES.some((n) => n === name.trim());

export function planLedgerImport(rows: readonly ImportRow[], ctx: PlanContext): ImportPlan {
  const now = ctx.now ?? new Date().toISOString();
  const existingIds = new Set(ctx.entries.map((e) => e.id));
  const actuals = ctx.entries.filter((e) => isActual(e));

  const repeated: ImportRow[] = [];
  const already: ImportRow[] = [];
  const fresh: ImportRow[] = [];
  const picked = new Set<string>();
  for (const r of rows) {
    if (picked.has(r.id)) { repeated.push(r); continue; }
    picked.add(r.id);
    if (existingIds.has(r.id)) already.push(r);
    else fresh.push(r);
  }

  // 겹쳐 보이는 것: 날짜 · 구분 · 금액이 같은 실제 거래. 한 건의 기존 거래는 한 행만 짝짓는다 —
  // 같은 날 같은 금액을 두 번 썼으면 기존 한 건은 둘 중 하나만 설명한다.
  // 이 파일들의 행이 이미 들어가 있는 거래(already)는 그 행이 짝이다 — 다른 행의 짝으로 쓰지 않는다.
  const pool = new Map<string, Entry[]>();
  for (const e of actuals) {
    if (picked.has(e.id)) continue;
    const k = `${e.startDate}|${e.money!.type}|${e.money!.amountMinor}`;
    pool.set(k, [...(pool.get(k) ?? []), e]);
  }
  const overlaps: Overlap[] = [];
  const clean: ImportRow[] = [];
  for (const r of fresh) {
    const list = pool.get(`${r.date}|${r.type}|${r.amountMinor}`);
    const hit = list?.shift();
    if (hit) overlaps.push({ row: r, existing: hit });
    else clean.push(r);
  }
  const toWrite = ctx.includeOverlaps ? [...clean, ...overlaps.map((o) => o.row)] : clean;

  // 카테고리: 같은 이름이 있으면 그것, 없으면 새로.
  const uses = new Map<string, CategoryUse>();
  const newCategories: Category[] = [];
  const nextOrder = { income: 0, expense: 0 };
  for (const c of ctx.categories) nextOrder[c.kind] = Math.max(nextOrder[c.kind], c.order + 1);
  for (const r of toWrite) {
    if (!r.categoryName) continue;
    const key = `${r.type}|${r.categoryName.trim().replace(/\s+/g, ' ').toLowerCase()}`;
    const use = uses.get(key);
    if (use) { use.count += 1; continue; }
    const found = findCategoryByName(ctx.categories, r.type, r.categoryName);
    if (found) {
      uses.set(key, { kind: r.type, name: found.name, count: 1, categoryId: found.id, created: false, archived: found.archived });
      continue;
    }
    const id = importCategoryId(r.type, r.categoryName);
    const cat: Category = {
      id, kind: r.type, name: r.categoryName.trim(), order: nextOrder[r.type]++,
      archived: false, createdAt: now, updatedAt: now,
    };
    newCategories.push(cat);
    uses.set(key, { kind: r.type, name: cat.name, count: 1, categoryId: id, created: true, archived: false });
  }
  const categoryIdOf = (r: ImportRow) =>
    r.categoryName ? uses.get(`${r.type}|${r.categoryName.trim().replace(/\s+/g, ' ').toLowerCase()}`)?.categoryId ?? null : null;

  const loan = { count: 0, amountMinor: 0 };
  const entries = toWrite.map((r) => {
    const flow: MoneyFlow = r.type === 'expense' && isLoanCategory(r.categoryName) ? 'loanPrincipal' : 'normal';
    if (flow === 'loanPrincipal') { loan.count += 1; loan.amountMinor += r.amountMinor; }
    return newEntry('money', {
      id: r.id,
      title: r.title,
      note: r.memo,
      startDate: r.date,
      createdAt: now,
      updatedAt: now,
      money: newMoney({
        status: 'actual',
        type: r.type,
        amountMinor: r.amountMinor,
        categoryId: categoryIdOf(r),
        method: r.method,
        flow,
      }),
    });
  });

  // 잔고를 적은 날 당일 · 그 뒤의 행은 잔고 밖이라 한도를 움직인다(기준일 당일은 고른 것만 안).
  const asOf = ctx.accounts.length > 0 ? ctx.accounts.map((a) => a.asOf).sort()[0]! : null;
  const afterBalance = asOf ? { asOf, count: toWrite.filter((r) => r.date >= asOf).length } : null;

  const files = new Map<string, FileSummary>();
  for (const r of rows) {
    const f = files.get(r.file);
    if (!f) files.set(r.file, { file: r.file, count: 1, from: r.date, to: r.date });
    else {
      f.count += 1;
      if (r.date < f.from) f.from = r.date;
      if (r.date > f.to) f.to = r.date;
    }
  }
  const sum = (type: ImportRow['type']) => {
    const list = toWrite.filter((r) => r.type === type);
    return { count: list.length, amountMinor: list.reduce((t, r) => t + r.amountMinor, 0) };
  };

  return {
    total: rows.length,
    entries,
    already,
    repeated,
    overlaps,
    overlapsIncluded: ctx.includeOverlaps,
    newCategories,
    categories: [...uses.values()].sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind === 'income' ? -1 : 1)),
    loan,
    afterBalance,
    files: [...files.values()],
    untitled: toWrite.filter((r) => r.untitled).length,
    income: sum('income'),
    expense: sum('expense'),
  };
}
