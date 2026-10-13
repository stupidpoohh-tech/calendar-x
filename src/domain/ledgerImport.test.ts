/**
 * 이관 가져오기 — 받은 파일의 모양을 그대로 본뜬 표로 검사한다(실제 자료는 저장소에 두지 않는다).
 *
 * 못 박는 것:
 *  - 한 행이라도 못 읽으면 파일 전체를 받지 않는다
 *  - 같은 행 두 줄은 두 건이고, 같은 파일을 다시 읽으면 id 가 같다
 *  - 카테고리는 원본 이름 그대로 · 같은 이름에 붙는다 · '대출' 은 대출 원금
 *  - 이미 있는 실제 거래와 겹쳐 보이는 행은 기본으로 빠진다
 *  - 지난 거래를 넣어도 잔고 기준일 앞이면 한도가 그대로다
 */
import { describe, expect, it } from 'vitest';
import { newCategory } from './category';
import { newEntry, newMoney } from './entry';
import { importCategoryId, planLedgerImport, readLedgerTable, type ImportRow } from './ledgerImport';
import { actualsIn, totalsOf } from './ledgerStats';
import { periodByKey } from './period';
import { headlineLimit } from './tide';
import type { Account, Entry } from './types';

const H = ['일자', '구분', '금액', '수단', '설명', '카테고리', '메모'];
const FILE = [
  H,
  ['2026.03.25', '수입', '3,405,940', '-', '회사', '월급', ''],
  ['2026.03.25', '지출', '9,871', '-', '초밥', '배달', ''],
  ['2026.03.26', '지출', '4,800', '-', '담배', '술담배', ''],
  ['2026.03.26', '지출', '4,800', '-', '담배', '술담배', ''],
  ['2026.03.30', '지출', '30,000', '-', '친구', '-', ''],
  ['2026.04.10', '지출', '2,446,660', '-', '대출', '대출', ''],
  ['2026.04.11', '지출', '5,000', '현금', '떡볶이', '식비', '시장'],
  ['2026.04.12', '수입', '55', '-', '', '-', ''],
];

const read = (table = FILE, file = '3월.xlsx') => readLedgerTable(table, file);

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-10-12', checkedAt: '2026-10-12T09:00:00.000Z', reflectedEntryIds: [],
  order: 0, createdAt: '', updatedAt: '', ...over,
});

const plan = (rows: ImportRow[], over: Partial<Parameters<typeof planLedgerImport>[1]> = {}) =>
  planLedgerImport(rows, { categories: [], entries: [], accounts: [], includeOverlaps: false, now: '2026-10-12T00:00:00.000Z', ...over });

describe('표 읽기', () => {
  it('받은 모양을 그대로 읽는다 — 날짜 · 구분 · 쉼표 금액 · "-" 는 빈 값', () => {
    const r = read();
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(8);
    expect(r.rows[0]).toMatchObject({
      line: 2, date: '2026-03-25', type: 'income', amountMinor: 3_405_940, title: '회사',
      categoryName: '월급', method: null, memo: '',
    });
    expect(r.rows[4]).toMatchObject({ title: '친구', categoryName: null });
    expect(r.rows[6]).toMatchObject({ method: '현금', memo: '시장' });
  });

  it('설명이 비면 카테고리나 구분으로 제목을 메운다 — 메운 것은 표시해 둔다', () => {
    const last = read().rows[7]!;
    expect(last).toMatchObject({ title: '수입', untitled: true, categoryName: null, amountMinor: 55 });
  });

  it('같은 행 두 줄은 두 건이다 — id 가 다르다', () => {
    const [a, b] = read().rows.filter((x) => x.title === '담배');
    expect(a!.occurrence).toBe(0);
    expect(b!.occurrence).toBe(1);
    expect(a!.id).not.toBe(b!.id);
  });

  it('같은 파일을 다시 읽으면 id 가 같다 — 파일 이름이 달라도', () => {
    expect(read(FILE, '다시.xlsx').rows.map((x) => x.id)).toEqual(read().rows.map((x) => x.id));
    expect(read().rows[0]!.id).toMatch(/^imp-20260325-[0-9a-z]+$/);
  });

  it('다른 날짜 표기와 엑셀 날짜 숫자', () => {
    const r = read([['날짜', '구분', '금액'], ['2026-3-5', '지출', '1000원'], ['2026/03/06', '지출', '₩ 2,000'], ['46087', '수입', '3000']]);
    expect(r.problems).toEqual([]);
    expect(r.rows.map((x) => [x.date, x.amountMinor])).toEqual([['2026-03-05', 1000], ['2026-03-06', 2000], ['2026-03-06', 3000]]);
  });

  it('한 행이라도 못 읽으면 그 이유를 줄 번호와 함께 남긴다', () => {
    const r = read([
      H,
      ['2026.02.30', '지출', '1,000', '-', 'a', '-', ''],
      ['2026.03.01', '이체', '1,000', '-', 'b', '-', ''],
      ['2026.03.01', '지출', '0', '-', 'c', '-', ''],
      ['2026.03.01', '지출', '-1,000', '-', 'd', '-', ''],
      ['2026.03.01', '지출', '1,000.5', '-', 'e', '-', ''],
      ['합계', '', '2,000', '', '', '', ''],
      ['2026.03.02', '지출', '1,000', '-', 'ok', '-', ''],
    ]);
    expect(r.problems.map((p) => p.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(r.problems[1]!.reason).toContain('이체');
  });

  it('필수 열이 없으면 행을 읽지 않는다. 모르는 열은 알린다', () => {
    const r = read([['일자', '금액', '잔액'], ['2026.03.01', '1,000', '5,000']]);
    expect(r.rows).toEqual([]);
    expect(r.problems[0]!.reason).toContain("'구분'");
    expect(r.ignoredColumns).toEqual(['잔액']);
  });

  it('빈 파일 · 열 이름만 있는 파일', () => {
    expect(read([]).problems[0]!.reason).toContain('빈 파일');
    expect(read([H, ['', '']]).problems[0]!.reason).toContain('한 줄도 없습니다');
  });
});

describe('가져오기 계획', () => {
  it('실제 거래로 만든다 — 카테고리는 원본 이름, 대출은 대출 원금', () => {
    const p = plan(read().rows);
    expect(p.entries).toHaveLength(8);
    expect(p.entries.every((e) => e.money?.status === 'actual' && e.isRecurring === false)).toBe(true);
    const loan = p.entries.find((e) => e.title === '대출')!;
    expect(loan.money).toMatchObject({ flow: 'loanPrincipal', type: 'expense', categoryId: importCategoryId('expense', '대출') });
    expect(p.loan).toEqual({ count: 1, amountMinor: 2_446_660 });
    expect(p.newCategories.map((c) => `${c.kind}:${c.name}`).sort())
      .toEqual(['expense:대출', 'expense:배달', 'expense:술담배', 'expense:식비', 'income:월급']);
    expect(p.entries.find((e) => e.title === '친구')!.money!.categoryId).toBeNull();
  });

  it('같은 이름의 카테고리가 있으면 거기에 붙인다 — 보관한 것이면 그렇다고 알린다', () => {
    const food = newCategory('expense', '식비', 0, 'default-food');
    const salary = { ...newCategory('income', ' 월급 ', 3, 'my-salary'), archived: true };
    const p = plan(read().rows, { categories: [food, salary] });
    expect(p.entries.find((e) => e.title === '떡볶이')!.money!.categoryId).toBe('default-food');
    expect(p.categories.find((c) => c.name.trim() === '월급')).toMatchObject({ categoryId: 'my-salary', created: false, archived: true });
    expect(p.newCategories.some((c) => c.name === '식비' || c.name === '월급')).toBe(false);
    // 새로 만드는 것은 기존 순서 뒤에 선다.
    expect(Math.min(...p.newCategories.filter((c) => c.kind === 'expense').map((c) => c.order))).toBe(1);
  });

  it('이미 가져온 행은 쓰지 않는다 — 같은 파일을 두 번 골라도 한 번만', () => {
    const rows = read().rows;
    const first = plan(rows);
    const again = plan([...rows, ...rows], { entries: first.entries });
    expect(again.entries).toEqual([]);
    expect(again.already).toHaveLength(8);
    expect(again.repeated).toHaveLength(8);
    expect(again.overlaps).toEqual([]);
    expect(again.total).toBe(16);
  });

  it('반쯤 들어간 상태에서 다시 가져와도, 들어간 행을 다른 행의 "겹침" 으로 쓰지 않는다', () => {
    const rows = read().rows;
    const [firstSmoke] = plan(rows).entries.filter((e) => e.title === '담배');
    const p = plan(rows, { entries: [firstSmoke!] });
    expect(p.already).toHaveLength(1);
    expect(p.overlaps).toEqual([]);
    expect(p.entries).toHaveLength(7);
  });

  it('손으로 적어 둔 같은 날 · 같은 금액 거래는 겹쳐 보인다 — 기본은 빼고, 고르면 넣는다', () => {
    const manual = newEntry('money', {
      id: 'manual', title: '점심', startDate: '2026-03-25',
      money: newMoney({ status: 'actual', type: 'expense', amountMinor: 9_871 }),
    });
    const planned = newEntry('money', {
      id: 'plan', title: '예정', startDate: '2026-03-30', money: newMoney({ type: 'expense', amountMinor: 30_000 }),
    });
    const skip = plan(read().rows, { entries: [manual, planned] });
    expect(skip.overlaps.map((o) => [o.row.title, o.existing.id])).toEqual([['초밥', 'manual']]);
    expect(skip.entries).toHaveLength(7);
    expect(skip.expense.count).toBe(5);
    const take = plan(read().rows, { entries: [manual, planned], includeOverlaps: true });
    expect(take.entries).toHaveLength(8);
  });

  it('기존 한 건은 한 행만 설명한다 — 같은 날 두 번 산 것 중 하나만 겹친다', () => {
    const manual = newEntry('money', {
      id: 'manual', title: '담배', startDate: '2026-03-26',
      money: newMoney({ status: 'actual', type: 'expense', amountMinor: 4_800 }),
    });
    const p = plan(read().rows, { entries: [manual] });
    expect(p.overlaps).toHaveLength(1);
    expect(p.entries.filter((e) => e.title === '담배')).toHaveLength(1);
  });

  it('잔고를 적은 날 당일 · 그 뒤의 행은 한도를 움직인다고 미리 센다', () => {
    expect(plan(read().rows).afterBalance).toBeNull();
    expect(plan(read().rows, { accounts: [account()] }).afterBalance).toEqual({ asOf: '2026-10-12', count: 0 });
    expect(plan(read().rows, { accounts: [account(), account({ id: 'a2', asOf: '2026-04-10' })] }).afterBalance)
      .toEqual({ asOf: '2026-04-10', count: 3 });
  });

  it('파일별 범위와 합계', () => {
    const p = plan([...read().rows, ...read([H, ['2026.04.25', '지출', '1,000', '-', 'x', '-', '']], '4월.xlsx').rows]);
    expect(p.files).toEqual([
      { file: '3월.xlsx', count: 8, from: '2026-03-25', to: '2026-04-12' },
      { file: '4월.xlsx', count: 1, from: '2026-04-25', to: '2026-04-25' },
    ]);
    expect(p.income).toEqual({ count: 2, amountMinor: 3_405_995 });
    expect(p.expense.count).toBe(7);
  });
});

describe('넣은 뒤의 숫자', () => {
  const entries: Entry[] = plan(read().rows).entries;

  it('결산: 대출은 소비가 아니다 — 원본 합계에서 대출을 뺀 것이 지출이다', () => {
    const p = periodByKey('2026-04', 25)!;
    const t = totalsOf(actualsIn(entries, p.start, p.end));
    expect(t.income).toBe(3_405_940 + 55);
    expect(t.principal).toBe(2_446_660);
    expect(t.spending).toBe(9_871 + 4_800 * 2 + 30_000 + 5_000);
  });

  it('잔고 기준일 앞의 지난 거래는 한도를 움직이지 않는다', () => {
    const today = '2026-10-12';
    const before = headlineLimit([account()], [], today);
    expect(headlineLimit([account()], entries, today)).toBe(before);
  });
});
