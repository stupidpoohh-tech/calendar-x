/**
 * 가계부 이관 — 파일 읽기와 쓰기 순서.
 *
 * 뜻을 붙이는 일(`domain/ledgerImport.ts`)과 저장소에 닿는 일을 나눈다. 여기는
 * (1) 파일을 표로 읽고, (2) 카테고리 → 거래 순서로 "없을 때만 만들기" 를 부르고,
 * (3) 건수가 파일 총계와 맞는지 맞춰 보고한다.
 *
 * 카테고리를 먼저 쓴다. 거래가 먼저 들어가고 카테고리가 실패하면 거래가 없는 카테고리를
 * 가리켜 결산에서 미분류처럼 보인다. 카테고리가 하나라도 실패하면 거래는 쓰지 않는다.
 */
import { planLedgerImport, readLedgerTable, type ImportPlan, type ImportProblem, type ImportRow, type PlanContext } from '../domain/ledgerImport';
import type { Category, Entry } from '../domain/types';
import { CsvError, decodeText, parseCsv } from './csvTable';
import type { CreateManyResult } from './repo';
import { readXlsxTable, XlsxError } from './xlsx';

export interface PickedFile { name: string; bytes: Uint8Array }

export interface ReadFilesResult {
  rows: ImportRow[];
  problems: ImportProblem[];
  ignoredColumns: string[];
}

/** 고른 파일 전부를 읽는다. 하나라도 문제가 있으면 problems 가 차고, 그때는 쓰지 않는다. */
export async function readImportFiles(files: readonly PickedFile[]): Promise<ReadFilesResult> {
  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  const ignored = new Set<string>();
  for (const f of files) {
    const lower = f.name.toLowerCase();
    let table: string[][];
    try {
      if (lower.endsWith('.xlsx')) table = await readXlsxTable(f.bytes);
      else if (lower.endsWith('.csv')) table = parseCsv(decodeText(f.bytes));
      else {
        problems.push({ file: f.name, line: null, reason: '엑셀(.xlsx) 또는 CSV(.csv) 파일만 받습니다.' });
        continue;
      }
    } catch (err) {
      const reason = err instanceof XlsxError || err instanceof CsvError
        ? err.message
        : '파일을 읽지 못했습니다. 엑셀에서 다시 저장한 뒤 시도해 주세요.';
      problems.push({ file: f.name, line: null, reason });
      continue;
    }
    const r = readLedgerTable(table, f.name);
    rows.push(...r.rows);
    problems.push(...r.problems);
    r.ignoredColumns.forEach((c) => ignored.add(c));
  }
  return { rows, problems, ignoredColumns: [...ignored] };
}

export interface ImportIO {
  /** 지금 계정의 카테고리 · 거래 전량. 서버에서 읽는다. */
  fetchExisting: () => Promise<{ categories: Category[]; entries: Entry[]; accounts: PlanContext['accounts'] }>;
  createIfAbsent: (payload: { categories?: Category[]; entries?: Entry[] }) => Promise<CreateManyResult>;
}

export interface ImportOutcome {
  kind: 'ok' | 'partial' | 'categories-failed' | 'all-failed' | 'nothing';
  /** 새로 만든 거래. */
  created: number;
  /** 쓰는 순간 이미 있어 건드리지 않은 거래(다른 탭이 먼저 넣었다). */
  conflicts: number;
  failed: CreateManyResult['failed'];
  categoriesCreated: number;
  /** 만들지 못한 카테고리. 하나라도 있으면 거래를 쓰지 않는다. */
  categoryFailures: CreateManyResult['failed'];
  /** 계획 단계에서 쓰지 않기로 한 것 — 전에 가져옴 · 두 번 고름 · 겹쳐 보여 뺌. */
  skippedBefore: number;
  /** 파일 총계. created + conflicts + failed + skippedBefore 와 같다. */
  total: number;
}

export function skippedBeforeWrite(plan: ImportPlan): number {
  return plan.already.length + plan.repeated.length + (plan.overlapsIncluded ? 0 : plan.overlaps.length);
}

export async function writeLedgerImport(plan: ImportPlan, io: Pick<ImportIO, 'createIfAbsent'>): Promise<ImportOutcome> {
  const skippedBefore = skippedBeforeWrite(plan);
  const base = { skippedBefore, total: plan.total, categoriesCreated: 0, categoryFailures: [] as CreateManyResult['failed'] };
  if (plan.entries.length === 0) {
    return { ...base, kind: 'nothing', created: 0, conflicts: 0, failed: [] };
  }

  if (plan.newCategories.length > 0) {
    const c = await io.createIfAbsent({ categories: plan.newCategories });
    if (c.failed.length > 0) {
      // 거래는 한 건도 쓰지 않았다 — 파일 총계 중 거래 몫은 전부 "쓰지 못함" 으로 센다.
      return {
        ...base, kind: 'categories-failed', created: 0, conflicts: 0, categoriesCreated: c.created,
        categoryFailures: c.failed,
        failed: plan.entries.map((e) => ({ collection: 'entries', id: e.id, reason: '카테고리를 만들지 못해 쓰지 않았습니다.' })),
      };
    }
    base.categoriesCreated = c.created;
  }

  const r = await io.createIfAbsent({ entries: plan.entries });
  const kind = r.failed.length === 0 ? 'ok' : r.created === 0 && r.conflicts.length === 0 ? 'all-failed' : 'partial';
  return { ...base, kind, created: r.created, conflicts: r.conflicts.length, failed: r.failed };
}

/** 읽기 → 계획. 겹쳐 보이는 것을 뺀 것과 넣은 것 둘 다 만든다 — 화면이 고르게 한다. */
export async function planFromFiles(read: ReadFilesResult, io: Pick<ImportIO, 'fetchExisting'>): Promise<{ skip: ImportPlan; all: ImportPlan }> {
  const existing = await io.fetchExisting();
  const ctx = { categories: existing.categories, entries: existing.entries, accounts: existing.accounts };
  return {
    skip: planLedgerImport(read.rows, { ...ctx, includeOverlaps: false }),
    all: planLedgerImport(read.rows, { ...ctx, includeOverlaps: true }),
  };
}
