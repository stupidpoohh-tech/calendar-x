/**
 * 잔고 정산 — 실제 화면에서 확인한다.
 *
 * 도메인 함수(`settle`)만 보면 기준일이 맞는지까지는 알 수 있어도, 그 기준일이
 * 실제로 화면에 뜨는지 · 자료가 모자랄 때 확정 차액을 감추는지 · 자정을 넘긴 뒤
 * 적은 잔고에 어느 날짜가 박히는지는 알 수 없다. 여기서는 카드를 그대로 렌더링해
 * 사람이 누르는 순서대로 누른다.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newEntry } from '../domain/entry';
import type { Account, Entry } from '../domain/types';
import { DialogHost } from './Dialog';
import { TideBar } from './TideBar';

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1', name: '주계좌', balanceMinor: 1_000_000, currency: 'KRW',
  asOf: '2026-09-01', checkedAt: '2026-09-01T09:00:00+09:00',
  order: 0, createdAt: '', updatedAt: '', ...over,
});

const expense = (amountMinor: number, startDate: string, title: string): Entry =>
  newEntry('money', {
    title, startDate,
    money: { type: 'expense', amountMinor, currency: 'KRW', linkedEntryId: null },
  });

function mount(props: {
  todayISO: string; accounts: Account[]; entries: Entry[]; tideFrom?: string | null;
  onSaveAccount: (a: Account) => void;
}) {
  return render(
    <DialogHost>
      <TideBar
        todayISO={props.todayISO}
        accounts={props.accounts}
        entries={props.entries}
        tideFrom={props.tideFrom}
        hasBalance
        onSaveAccount={props.onSaveAccount}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />
    </DialogHost>,
  );
}

/** 큰 숫자를 눌러 편집을 열고 새 잔고를 적은 뒤 Enter. 사람이 하는 그대로다. */
function editBalance(text: string) {
  fireEvent.click(screen.getByLabelText('잔고 고치기'));
  const input = screen.getByLabelText('잔고 금액');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('자료가 모자랄 때', () => {
  it('확정 차액 대신 무엇이 빠졌는지 말하고 잔고만 바꾼다', async () => {
    const saved: Account[] = [];
    // 기준일 09-01 이 계산 구간 시작(09-05)보다 앞선다 → 그 사이 한 번짜리 지출이 없다.
    mount({
      todayISO: '2026-09-10',
      accounts: [account({ asOf: '2026-09-01', checkedAt: '2026-09-01T09:00:00+09:00' })],
      entries: [expense(50_000, '2026-09-20', '보험료')],
      tideFrom: '2026-09-05',
      onSaveAccount: (a) => saved.push(a),
    });

    editBalance('850000');

    await screen.findByText('정산 금액을 확정할 수 없습니다');
    const dlg = document.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('01일');
    expect(dlg.textContent).toContain('05일');
    // 그럴듯하게 틀린 숫자를 내지 않는다 — 차액도 예정 목록도 적지 않는다.
    expect(dlg.textContent).not.toContain('차이');
    expect(dlg.textContent).not.toContain('예정대로면');
    expect(saved).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '잔고만 바꾸기' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.balanceMinor).toBe(850_000);
  });

  it('취소하면 잔고도 바뀌지 않는다', async () => {
    const saved: Account[] = [];
    mount({
      todayISO: '2026-09-10',
      accounts: [account({ asOf: '2026-09-01' })],
      entries: [],
      tideFrom: '2026-09-05',
      onSaveAccount: (a) => saved.push(a),
    });

    editBalance('850000');
    await screen.findByText('정산 금액을 확정할 수 없습니다');
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByText('정산 금액을 확정할 수 없습니다')).toBeNull());
    expect(saved).toHaveLength(0);
  });
});

describe('자료가 충분할 때', () => {
  it('지나간 예정을 세어 차액을 낸다', async () => {
    const saved: Account[] = [];
    mount({
      todayISO: '2026-09-10',
      accounts: [account({ asOf: '2026-09-01', balanceMinor: 1_000_000 })],
      entries: [expense(100_000, '2026-09-05', '월세')],
      tideFrom: '2026-09-01',
      onSaveAccount: (a) => saved.push(a),
    });

    editBalance('850000');

    await screen.findByText('잔고 정산');
    const dlg = document.querySelector('.dlg')!;
    // 예정대로면 1,000,000 − 100,000 = 900,000. 실제 850,000 → −50,000.
    expect(dlg.textContent).toContain('900,000');
    expect(dlg.textContent).toContain('−50,000');
    expect(dlg.textContent).toContain('예정에 없던 지출');

    fireEvent.click(screen.getByRole('button', { name: '이 금액으로 정산' }));
    await waitFor(() => expect(saved).toHaveLength(1));
  });
});

describe('기준일', () => {
  it('한국 시간 아침에 적어도 어제로 밀리지 않는다', async () => {
    // 08:00 KST 는 UTC 로 전날 23:00 이다. 예전에는 checkedAt 을 UTC 로 잘라 하루가 밀렸다.
    vi.setSystemTime(new Date('2026-09-10T08:00:00+09:00'));
    const saved: Account[] = [];
    mount({
      todayISO: '2026-09-10',
      accounts: [account({ asOf: '2026-09-01', balanceMinor: 1_000_000 })],
      entries: [expense(100_000, '2026-09-05', '월세')],
      tideFrom: '2026-09-01',
      onSaveAccount: (a) => saved.push(a),
    });

    editBalance('850000');
    await screen.findByText('잔고 정산');
    fireEvent.click(screen.getByRole('button', { name: '이 금액으로 정산' }));
    await waitFor(() => expect(saved).toHaveLength(1));

    // 화면이 내려준 오늘이 그대로 기준일이 된다.
    expect(saved[0]?.asOf).toBe('2026-09-10');
  });

  it('저장한 기준일을 카드가 그대로 보여 준다', () => {
    mount({
      todayISO: '2026-09-10',
      accounts: [account({ asOf: '2026-09-08' })],
      entries: [],
      tideFrom: '2026-09-01',
      onSaveAccount: () => {},
    });
    expect(screen.getByText('잔고 2026-09-08 기준')).toBeTruthy();
  });
});
