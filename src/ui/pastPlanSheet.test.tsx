/**
 * 지난 예정 정리 창 — 앞 단계가 끝나야 뒤 단계가 열린다.
 *   고르기(후보만 미리) → 백업 파일 다시 골라 확인 → 계산 영향 그대로 → 마지막 확인 → 묶음 삭제
 *   → 서버에서 다시 읽어 확인. 막힌 것은 고를 수 없고, 백업이 없으면 지우지 않는다.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildBackup } from '../data/backup';
import { newBudget } from '../domain/budget';
import { newEntry, newMoney } from '../domain/entry';
import type { Account, Entry, MoneyFields } from '../domain/types';
import { DialogHost } from './Dialog';
import { PastPlanSheet, type PastPlanData } from './PastPlanSheet';

const TODAY = '2026-10-13';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00+09:00')); });
afterAll(() => { vi.useRealTimers(); });
afterEach(cleanup);

const acct: Account = {
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW', asOf: '2026-10-10',
  checkedAt: '2026-10-10T09:00:00+09:00', reflectedEntryIds: [], order: 0, createdAt: '', updatedAt: '',
};
const plan = (id: string, title: string, date: string, amount: number, m: Partial<MoneyFields> = {}, over: Partial<Entry> = {}): Entry =>
  newEntry('money', { id, title, startDate: date, money: newMoney({ type: 'expense', amountMinor: amount, ...m }), ...over });
const pocket = newBudget({ id: 'b1', name: '10월 생활비', startDate: '2026-10-01', endDate: '2026-10-31', amountMinor: 200_000 });

const ENTRIES: Entry[] = [
  plan('p1', '병원 예약', '2026-09-15', 50_000),
  plan('p2', '용돈', '2026-10-05', 100_000, { type: 'income' }),
  plan('pb', '장보기', '2026-10-05', 30_000, { budgetId: 'b1' }),
  plan('l1', '적금', '2026-09-10', 20_000, { type: 'save' }),
  plan('r1', '월세', '2026-01-25', 500_000, {}, { recurrence: { freq: 'monthly', interval: 1, until: null, count: null } }),
  newEntry('money', { id: 'a2', title: '점심', startDate: '2026-09-01', money: newMoney({ status: 'actual', type: 'expense', amountMinor: 9_000 }) }),
];
const DATA: PastPlanData = { entries: ENTRIES, accounts: [acct], budgets: [pocket], reserves: [] };

function backupFile(entries: Entry[], name = 'calendarx-backup.json') {
  const text = JSON.stringify(buildBackup({
    entries, accounts: [acct], debts: [], pins: [], budgets: [pocket], reserves: [], categories: [],
    categoryBudgets: [], ledgerNotes: [], annualBudgets: [], ledger: null, recovery: null,
  }));
  return fileOf(text, name);
}
function fileOf(text: string, name: string) {
  const f = new File([text], name, { type: 'application/json' });
  // jsdom 에 따라 Blob#text 가 없을 수 있다.
  if (typeof f.text !== 'function') Object.defineProperty(f, 'text', { value: () => Promise.resolve(text) });
  return f;
}
async function pick(file: File) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { fireEvent.change(input); });
}

function mount(over: { load?: () => Promise<PastPlanData>; onDelete?: (ids: string[]) => Promise<{ ok: number; failed: number }> } = {}) {
  const props = {
    load: over.load ?? vi.fn(() => Promise.resolve(DATA)),
    onBackup: vi.fn(() => Promise.resolve(true)),
    onDelete: over.onDelete ?? vi.fn((ids: string[]) => Promise.resolve({ ok: ids.length, failed: 0 })),
    onClose: vi.fn(),
  };
  render(<DialogHost><PastPlanSheet todayISO={TODAY} {...props} /></DialogHost>);
  return props;
}
const box = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const runBtn = () => screen.getByRole('button', { name: /건 정리$|지우는 중/ }) as HTMLButtonElement;

describe('고르기', () => {
  it('서버에서 읽어 가른다 — 후보만 미리 고르고, 막힌 것은 고를 수 없고, 반복 · 실제는 목록에 없다', async () => {
    mount();
    await screen.findByRole('region', { name: '정리 후보' });
    expect(box(/병원 예약/).checked).toBe(true);
    expect(box(/용돈/).checked).toBe(true);
    expect(box(/적금/).checked).toBe(false);
    expect(box(/장보기/).disabled).toBe(true);
    expect(within(screen.getByRole('region', { name: '지금은 정리할 수 없음' })).getByText(/생활비에 걸려 있어/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /월세|점심/ })).toBeNull();
    const sum = screen.getByLabelText('고른 항목 요약');
    expect(sum.textContent).toContain('고른 2건');
    expect(sum.textContent).toContain('+100,000');
    expect(sum.textContent).toContain('−50,000');
    expect(sum.textContent).toContain('반복 예정 1건');
  });

  it('전체 선택은 막힌 것을 넣지 않는다 · 모두 해제', async () => {
    mount();
    await screen.findByRole('region', { name: '정리 후보' });
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    expect(box(/적금/).checked).toBe(true);
    expect(box(/장보기/).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '모두 해제' }));
    expect(box(/병원 예약/).checked).toBe(false);
    expect(runBtn().disabled).toBe(true);
  });

  it('오프라인 · 서버 실패면 고르지 못한다 — 캐시로 가르지 않는다', async () => {
    mount({ load: () => Promise.reject(new Error('offline')) });
    expect((await screen.findByRole('alert')).textContent).toMatch(/읽지 못했습니다|연결이 없습니다/);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('백업 확인 → 계산 영향 → 지우기', () => {
  it('백업 파일을 확인하기 전에는 지우지 못한다', async () => {
    const p = mount();
    await screen.findByRole('region', { name: '정리 후보' });
    expect(runBtn().disabled).toBe(true);
    expect(screen.getByText('백업 파일 확인이 끝나야 지울 수 있습니다.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /백업 내려받기/ }));
    expect(p.onBackup).toHaveBeenCalled();
    // 내려받기만으로는 열리지 않는다.
    expect(runBtn().disabled).toBe(true);
  });

  it('고른 항목이 빠진 파일 · 내용이 다른 파일은 받지 않는다', async () => {
    mount();
    await screen.findByRole('region', { name: '정리 후보' });
    await pick(backupFile(ENTRIES.filter((e) => e.id !== 'p2'), 'old.json'));
    expect(await screen.findByText(/old\.json 에 고른 항목 1건이 없거나/)).toBeInTheDocument();
    expect(runBtn().disabled).toBe(true);
    await pick(backupFile(ENTRIES.map((e) => (e.id === 'p1' ? { ...e, money: { ...e.money!, amountMinor: 1 } } : e)), 'edited.json'));
    expect(await screen.findByText(/edited\.json 에 고른 항목 1건이/)).toBeInTheDocument();
    expect(runBtn().disabled).toBe(true);
    await pick(fileOf('{"nope":1}', 'x.json'));
    expect(await screen.findByText('이 파일은 캘린더X 백업으로 읽을 수 없습니다.')).toBeInTheDocument();
  });

  it('확인 → 숫자 그대로 → 마지막 확인 → 고른 id 만 지우고 서버에서 다시 읽어 센다', async () => {
    let call = 0;
    const load = vi.fn(() => Promise.resolve(call++ === 0 ? DATA : { ...DATA, entries: ENTRIES.filter((e) => e.id !== 'p1' && e.id !== 'p2') }));
    const p = mount({ load });
    await screen.findByRole('region', { name: '정리 후보' });
    await pick(backupFile(ENTRIES));
    expect(await screen.findByText(/고른 2건이 모두 들어 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '계산 영향' }).textContent).toContain('그대로입니다');
    expect(runBtn().disabled).toBe(false);

    fireEvent.click(runBtn());
    const dlg = await screen.findByRole('alertdialog');
    expect(dlg.textContent).toContain('고른 예정 2건을 지울까요?');
    expect(dlg.textContent).toContain('calendarx-backup.json');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: '지우기' })); });

    await waitFor(() => expect(p.onDelete).toHaveBeenCalledTimes(1));
    expect(p.onDelete).toHaveBeenCalledWith(['p1', 'p2']);
    const result = await screen.findByText('정리 결과');
    expect(result.parentElement!.textContent).toContain('서버가 받은 삭제 2건');
    expect(result.parentElement!.textContent).toContain('고른 항목이 모두 지워졌습니다');
    // 지운 뒤에는 백업 확인을 다시 요구한다.
    expect(runBtn().disabled).toBe(true);
  });

  it('마지막 확인에서 취소하면 아무것도 지우지 않는다', async () => {
    const p = mount();
    await screen.findByRole('region', { name: '정리 후보' });
    await pick(backupFile(ENTRIES));
    await screen.findByText(/모두 들어 있습니다/);
    fireEvent.click(runBtn());
    const dlg = await screen.findByRole('alertdialog');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: '취소' })); });
    expect(p.onDelete).not.toHaveBeenCalled();
  });

  it('거절된 묶음 · 남은 항목을 그대로 알린다', async () => {
    mount({ onDelete: () => Promise.resolve({ ok: 0, failed: 2 }) });
    await screen.findByRole('region', { name: '정리 후보' });
    await pick(backupFile(ENTRIES));
    await screen.findByText(/모두 들어 있습니다/);
    fireEvent.click(runBtn());
    await act(async () => { fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '지우기' })); });
    const result = (await screen.findByText('정리 결과')).parentElement!;
    expect(result.textContent).toContain('거절 2건');
    expect(result.textContent).toContain('2건이 아직 남아 있습니다');
  });
});
