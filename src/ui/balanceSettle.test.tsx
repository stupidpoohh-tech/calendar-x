/**
 * 잔고 정산 — 실제 화면에서 확인한다.
 *
 * 도메인 함수(`settle`)만 보면 기준일이 맞는지까지는 알 수 있어도, 그 기준일이
 * 실제로 화면에 뜨는지 · 자료가 모자랄 때 확정 차액을 감추는지 · 자정을 넘긴 뒤
 * 적은 잔고에 어느 날짜가 박히는지는 알 수 없다. 여기서는 카드를 그대로 렌더링해
 * 사람이 누르는 순서대로 누른다.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newEntry } from '../domain/entry';
import type { Account, Entry } from '../domain/types';
import { CALC_ERROR, CALC_LOADING, CALC_READY, CALC_UNCONFIRMED, type CalcState } from './calcState';
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

describe('계산용 자료의 상태에 따라', () => {
  const render0 = (calcState: CalcState) => render(
    <DialogHost>
      <TideBar
        todayISO="2026-09-10"
        accounts={[account()]}
        entries={[]}
        tideFrom="2026-09-01"
        calcState={calcState}
        hasBalance
        onSaveAccount={() => {}}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />
    </DialogHost>,
  );

  it('아직 못 받았으면 0원을 그리지 않고 무엇을 기다리는지 적는다', () => {
    render0(CALC_LOADING);
    expect(screen.queryByLabelText('잔고 고치기')).toBeNull();
    expect(screen.getByLabelText('며칠 버티나').textContent).toContain('불러오는 중');
  });

  it('조회가 실패하면 그 사실을 적는다 — 0원으로 감추지 않는다', () => {
    render0(CALC_ERROR);
    const card = screen.getByLabelText('며칠 버티나');
    expect(card.textContent).toContain('불러오지 못했습니다');
    expect(card.textContent).not.toContain('₩ 0');
  });

  it('캐시가 비어 있으면 "예정 없음" 으로 확정하지 않는다', () => {
    render0(CALC_UNCONFIRMED);
    const card = screen.getByLabelText('며칠 버티나');
    expect(card.textContent).toContain('가릴 수 없습니다');
    expect(screen.queryByLabelText('잔고 고치기')).toBeNull();
  });

  it('캐시에 자료가 있으면 숫자는 내되 완전성 한계를 적는다', () => {
    // 오프라인에서 앱을 통째로 막지 않는다. 대신 무엇을 못 봤는지 말한다.
    render0({ kind: 'ready', fromCache: true, pending: false });
    const card = screen.getByLabelText('며칠 버티나');
    expect(within(card).getByLabelText('잔고 고치기')).toHaveTextContent('1,000,000');
    expect(card.textContent).toContain('이 기기에 저장된 자료 기준입니다');
  });

  it('서버가 아직 확인하지 않은 변경이 섞이면 그 사실을 적는다', () => {
    render0({ kind: 'ready', fromCache: false, pending: true });
    expect(screen.getByLabelText('며칠 버티나').textContent)
      .toContain('아직 서버가 확인하지 않은 변경');
  });

  it('확정 상태에서는 아무 말도 덧붙이지 않는다', () => {
    render0(CALC_READY);
    const card = screen.getByLabelText('며칠 버티나');
    expect(card.textContent).not.toContain('기기에 저장된 자료 기준');
    expect(card.textContent).not.toContain('아직 서버가 확인하지 않은');
  });
});

describe('계좌가 여럿일 때', () => {
  const two = () => [
    account({ id: 'a1', name: '주계좌', balanceMinor: 600_000, asOf: '2026-09-01',
      checkedAt: '2026-09-01T09:00:00+09:00' }),
    account({ id: 'a2', name: '비상금', balanceMinor: 400_000, asOf: '2026-09-01',
      checkedAt: '2026-09-01T10:00:00+09:00' }),
  ];

  it('어느 계좌를 고치는지 고르게 한다', () => {
    mount({ todayISO: '2026-09-10', accounts: two(), entries: [], tideFrom: '2026-09-01',
      onSaveAccount: () => {} });

    fireEvent.click(screen.getByLabelText('잔고 고치기'));
    const pick = screen.getByLabelText('고칠 계좌') as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['주계좌', '비상금']);
    // 처음에는 첫 계좌, 금액칸도 그 계좌의 값이다.
    expect(pick.value).toBe('a1');
    expect((screen.getByLabelText('잔고 금액') as HTMLInputElement).value).toBe('600000');

    fireEvent.change(pick, { target: { value: 'a2' } });
    expect((screen.getByLabelText('잔고 금액') as HTMLInputElement).value).toBe('400000');
  });

  it('고른 계좌의 잔고만 바뀐다 — 합계를 그 계좌에 몰아 넣지 않는다', async () => {
    const saved: Account[] = [];
    mount({ todayISO: '2026-09-10', accounts: two(), entries: [expense(100_000, '2026-09-05', '월세')],
      tideFrom: '2026-09-01', onSaveAccount: (a) => saved.push(a) });

    fireEvent.click(screen.getByLabelText('잔고 고치기'));
    fireEvent.change(screen.getByLabelText('고칠 계좌'), { target: { value: 'a2' } });
    const input = screen.getByLabelText('잔고 금액');
    fireEvent.change(input, { target: { value: '250000' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // 총액 1,000,000 − 월세 100,000 = 900,000 이 예정. 새 총액은 600,000 + 250,000.
    await screen.findByText('잔고 정산');
    const dlg = document.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('900,000');
    expect(dlg.textContent).toContain('850,000');
    expect(dlg.textContent).toContain('−50,000');

    fireEvent.click(screen.getByRole('button', { name: '이 금액으로 정산' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.id).toBe('a2');
    expect(saved[0]?.name).toBe('비상금');
    expect(saved[0]?.balanceMinor).toBe(250_000);
  });

  it('기준일이 다르면 확정 차액 대신 왜인지 말한다', async () => {
    const saved: Account[] = [];
    const mixed = [
      account({ id: 'a1', name: '주계좌', balanceMinor: 600_000, asOf: '2026-09-01',
        checkedAt: '2026-09-01T09:00:00+09:00' }),
      account({ id: 'a2', name: '비상금', balanceMinor: 400_000, asOf: '2026-09-07',
        checkedAt: '2026-09-07T09:00:00+09:00' }),
    ];
    mount({ todayISO: '2026-09-10', accounts: mixed, entries: [], tideFrom: '2026-09-01',
      onSaveAccount: (a) => saved.push(a) });

    editBalance('700000');
    await screen.findByText('정산 금액을 확정할 수 없습니다');
    const dlg = document.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('마지막으로 적은 날이 다릅니다');
    expect(dlg.textContent).toContain('같은 날 함께');
    expect(dlg.textContent).not.toContain('차이');

    fireEvent.click(screen.getByRole('button', { name: '잔고만 바꾸기' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.id).toBe('a1');
    expect(saved[0]?.balanceMinor).toBe(700_000);
  });
});

describe('통화가 섞였을 때', () => {
  it('한도를 지어내지 않고 왜인지 적는다', () => {
    mount({
      todayISO: '2026-09-10',
      accounts: [
        account({ id: 'a1', name: '원화', balanceMinor: 1_000_000, currency: 'KRW' }),
        account({ id: 'a2', name: '달러', balanceMinor: 50_000, currency: 'USD' }),
      ],
      entries: [],
      tideFrom: '2026-09-01',
      onSaveAccount: () => {},
    });

    const card = screen.getByLabelText('며칠 버티나');
    expect(card.textContent).toContain('통화가 섞여 있습니다');
    expect(card.textContent).toContain('KRW · USD');
    expect(card.textContent).toContain('환율 변환을 하지 않으므로');
    // 최소 단위가 달라 더할 수 없다 — 합계를 그리지 않는다.
    expect(card.textContent).not.toContain('1,050,000');
  });

  it('그래도 잔고는 고칠 수 있다 — 막으면 빠져나올 수가 없다', () => {
    mount({
      todayISO: '2026-09-10',
      accounts: [
        account({ id: 'a1', name: '원화', currency: 'KRW' }),
        account({ id: 'a2', name: '달러', currency: 'USD' }),
      ],
      entries: [],
      tideFrom: '2026-09-01',
      onSaveAccount: () => {},
    });
    expect(screen.getByText(/원화 2026-09-01 기준/)).toBeTruthy();
  });
});
