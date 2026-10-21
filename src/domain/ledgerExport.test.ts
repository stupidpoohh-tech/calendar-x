/**
 * 가계부 내려받기 — 표 모양과, 내려받은 파일을 그대로 가져오면 같은 거래가 되는가.
 */
import { describe, expect, it } from 'vitest';
import { readXlsxTable } from '../data/xlsx';
import { buildXlsx } from '../data/xlsxWrite';
import { newCard } from './card';
import { newCategory } from './category';
import { newEntry, newMoney } from './entry';
import { EXPORT_COLUMNS, EXPORT_WIDTHS, ledgerExportRows } from './ledgerExport';
import { readLedgerTable } from './ledgerImport';
import { historyItems } from './ledgerStats';
import type { MoneyFields } from './types';

const tx = (id: string, date: string, amount: number, m: Partial<MoneyFields>, title = id, note = '') => newEntry('money', {
  id, title, note, startDate: date, money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }),
});
const cats = [newCategory('expense', '식비', 0, 'food'), newCategory('income', '급여', 0, 'salary')];
const card = newCard({ id: 'life', name: '생활 카드' });

const entries = [
  tx('salary', '2026-09-25', 3_000_000, { type: 'income', categoryId: 'salary' }, '9월 급여'),
  tx('lunch', '2026-10-01', 12_000, { categoryId: 'food', method: '현금' }, '점심', '팀 점심'),
  tx('shirt', '2026-10-02', 45_000, { flow: 'cardSpend', cardId: 'life', categoryId: 'food' }, '셔츠'),
  tx('loan', '2026-10-03', 300_000, { flow: 'loanPrincipal' }, '전세대출'),
  newEntry('money', { id: 'plan', title: '보험료', startDate: '2026-10-20', money: newMoney({ amountMinor: 50_000 }) }),
];
const items = () => historyItems(entries, '2026-09-25', '2026-10-24');

describe('가계부 내려받기', () => {
  it('실제 거래만 날짜순으로, 가져오기와 같은 열 이름으로 싣는다', () => {
    const out = ledgerExportRows(items(), cats, [card]);
    expect(out.rows[0]).toEqual([...EXPORT_COLUMNS]);
    expect(EXPORT_WIDTHS).toHaveLength(EXPORT_COLUMNS.length);
    expect(out.rows.slice(1)).toEqual([
      ['2026-09-25', '수입', 3_000_000, '급여', '9월 급여', '', '', ''],
      ['2026-10-01', '지출', 12_000, '식비', '점심', '현금', '', '팀 점심'],
      ['2026-10-02', '지출', 45_000, '식비', '셔츠', '생활 카드', '카드 사용', ''],
      // 대출 원금은 카테고리 '대출' — 가져오기가 대출 원금으로 센다.
      ['2026-10-03', '지출', 300_000, '대출', '전세대출', '', '대출 원금', ''],
    ]);
    expect(out.count).toBe(4);
    expect(out.skippedPlanned).toBe(1);
  });

  it('내려받은 파일을 가져오기로 다시 읽으면 같은 날짜 · 구분 · 금액 · 카테고리 · 설명 · 메모가 된다', async () => {
    const out = ledgerExportRows(items(), cats, [card]);
    const table = await readXlsxTable(buildXlsx(out.rows, { sheetName: '가계부', widths: EXPORT_WIDTHS }));
    const read = readLedgerTable(table, '캘린더X-가계부.xlsx');
    expect(read.problems).toEqual([]);
    // '유형' 은 보기 위한 열이라 가져오기가 읽지 않고 알린다.
    expect(read.ignoredColumns).toEqual(['유형']);
    expect(read.rows.map((r) => [r.date, r.type, r.amountMinor, r.categoryName, r.title, r.method, r.memo])).toEqual([
      ['2026-09-25', 'income', 3_000_000, '급여', '9월 급여', null, ''],
      ['2026-10-01', 'expense', 12_000, '식비', '점심', '현금', '팀 점심'],
      ['2026-10-02', 'expense', 45_000, '식비', '셔츠', '생활 카드', ''],
      ['2026-10-03', 'expense', 300_000, '대출', '전세대출', null, ''],
    ]);
  });

  it('글자에 섞인 특수 문자 · 줄바꿈도 그대로 돌아온다', async () => {
    const rows = [['설명'], ['A & B <C> "D"'], ['첫 줄\n둘째 줄']];
    expect(await readXlsxTable(buildXlsx(rows))).toEqual(rows);
  });
});
