/**
 * 내 캘린더 구성 — 화면 조각 테스트.
 *
 * 시나리오(명세 A~I) 중 화면 조각에서 확인할 수 있는 것을 여기서 본다.
 *   A  가계부 숨김: 오늘 카드의 가계부 칸 · 입력 창의 가계부 칸이 빠진다(이미 가계부인 항목은 남는다)
 *   C/D Recovery: 활성화 / 일시중지 이름, 일시중지 중 상태 문구
 *   E  스위처: 연결이 있으면 표시 / 숨김 + 공유 연결 관리, 없으면 시작하기
 *   F  달력 금액: 고른 기준으로 칸을 채운다
 * 숫자 자체는 `domain/layout.test.ts`, 회복 전이는 `domain/recovery.test.ts` 가 본다.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBudget } from '../domain/budget';
import { newEntry, newMoney, withDerived } from '../domain/entry';
import { LEGACY_LAYOUT, type Layout } from '../domain/layout';
import { defaultRecoveryRule } from '../domain/recovery';
import type { Account, RecoveryRule } from '../domain/types';
import { DialogHost } from './Dialog';
import { EntryModal } from './EntryModal';
import { LayoutSettings } from './LayoutSettings';
import { MonthCalendar } from './MonthCalendar';
import { RecoverySettings } from './RecoverySettings';
import { TodayPanel } from './TodayPanel';

afterEach(cleanup);

const TODAY = '2026-10-14';

function settings(layout: Layout, shared: { connected: boolean; ready?: boolean }) {
  const onLayout = vi.fn();
  const onStart = vi.fn();
  const onManage = vi.fn();
  render(
    <LayoutSettings
      layout={layout}
      onLayout={onLayout}
      shared={{ connected: shared.connected, ready: shared.ready ?? true, onStart, onManage }}
    />,
  );
  return { onLayout, onStart, onManage };
}

const rowOf = (name: string) => screen.getByText(name, { selector: '.set-row-inline > span' }).closest('.set-row-inline') as HTMLElement;

describe('내 캘린더 구성', () => {
  it('캘린더는 항상 사용 — 끄는 자리가 없다', () => {
    settings(LEGACY_LAYOUT, { connected: true });
    expect(screen.getByText('필요한 기능만 선택해서 사용하세요.')).toBeInTheDocument();
    const row = rowOf('캘린더');
    expect(within(row).getByText('항상 사용')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('가계부 · 노트는 표시 / 숨김으로 고른다 — 한 번 누르면 그 칸 하나만 바뀐다', () => {
    const { onLayout } = settings(LEGACY_LAYOUT, { connected: true });
    fireEvent.click(within(rowOf('가계부')).getByRole('button', { name: '숨김' }));
    expect(onLayout).toHaveBeenLastCalledWith({ ledger: false });
    fireEvent.click(within(rowOf('노트')).getByRole('button', { name: '숨김' }));
    expect(onLayout).toHaveBeenLastCalledWith({ notes: false });
    // 이미 고른 쪽을 다시 눌러도 쓰기를 내지 않는다.
    fireEvent.click(within(rowOf('가계부')).getByRole('button', { name: '표시' }));
    expect(onLayout).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/ON|OFF/)).toBeNull();
  });

  it('가계부를 숨기면 자료가 남는다고 적고, 캘린더 표시(금액 기준) 그룹이 빠진다', () => {
    settings({ ...LEGACY_LAYOUT, ledger: false }, { connected: true });
    expect(within(rowOf('가계부')).getByText(/계산은 그대로 남아 있습니다/)).toBeInTheDocument();
    expect(screen.queryByText('캘린더 표시')).toBeNull();
  });

  it('E — 연결이 있으면 공간 전환 표시 / 숨김과 공유 연결 관리. 숨겨도 연결은 그대로라고 적는다', () => {
    const { onLayout, onManage } = settings({ ...LEGACY_LAYOUT, sharedSwitcher: false }, { connected: true });
    const row = rowOf('같이보기 공간 전환');
    expect(within(row).getByText(/공유 연결 · 자료 · 권한은 그대로입니다/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: '표시' }));
    expect(onLayout).toHaveBeenLastCalledWith({ sharedSwitcher: true });
    fireEvent.click(screen.getByRole('button', { name: /공유 연결 관리/ }));
    expect(onManage).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '같이보기 시작하기' })).toBeNull();
  });

  it('E — 연결이 없으면 토글 대신 같이보기 시작하기. 공유 연결 관리도 없다', () => {
    const { onStart } = settings(LEGACY_LAYOUT, { connected: false });
    const row = rowOf('같이보기 공간 전환');
    expect(within(row).queryByRole('button', { name: '숨김' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: '같이보기 시작하기' }));
    expect(onStart).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /공유 연결 관리/ })).toBeNull();
  });

  it('연결을 아직 확인하지 못했으면 아무것도 고르게 하지 않는다', () => {
    settings(LEGACY_LAYOUT, { connected: false, ready: false });
    const row = rowOf('같이보기 공간 전환');
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('F — 달력 금액은 네 가지 중 하나를 고른다', () => {
    const { onLayout } = settings(LEGACY_LAYOUT, { connected: false });
    const group = screen.getByRole('radiogroup', { name: '달력 칸의 금액' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.querySelector('.set-row-t')?.textContent)).toEqual(['전체 보유액', '예상 잔고', '가용 잔액', '생활비 잔여']);
    expect(within(group).getByRole('radio', { name: /예상 잔고/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(group).getByRole('radio', { name: /가용 잔액/ }));
    expect(onLayout).toHaveBeenLastCalledWith({ calendarAmount: 'available' });
  });
});

describe('Recovery — 활성화 / 일시중지', () => {
  const mount = (rule: RecoveryRule) => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    render(<RecoverySettings rule={rule} onChange={vi.fn()} onPause={onPause} onResume={onResume} />);
    return { onPause, onResume };
  };

  it('켜져 있으면 일시중지를 누르면 일시중지 경로로 간다(규칙 통째 쓰기가 아니다)', () => {
    const { onPause, onResume } = mount({ ...defaultRecoveryRule(), enabled: true, nextDueAt: '2026-10-17' });
    expect(screen.getByRole('button', { name: '활성화' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '일시중지' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '활성화' }));
    expect(onResume).not.toHaveBeenCalled();
  });

  it('일시중지 중이면 다시 활성화 — 규칙 · 기록 · 빚이 남아 있다고 적고 설정은 그대로 보인다', () => {
    const { onResume } = mount({ ...defaultRecoveryRule(), enabled: false, lastCompletedAt: '2026-10-01', debtCount: 2 });
    expect(screen.getByText(/일시중지 중 — 규칙 · 메모 · OFF 항목 · 지난 기록 · 밀린 회복은 그대로/)).toBeInTheDocument();
    expect(screen.getByText(/밀린 회복 2회 — 일시중지 중에도 그대로 남고/)).toBeInTheDocument();
    expect(screen.getByLabelText('회복 간격')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 활성화' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('한 번도 쓴 적 없으면 첫 활성화 — 상세 설정은 켠 뒤에 보인다', () => {
    mount(defaultRecoveryRule());
    expect(screen.getByRole('button', { name: '활성화' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: '다시 활성화' })).toBeNull();
    expect(screen.queryByLabelText('회복 간격')).toBeNull();
  });
});

describe('A — 가계부를 숨기면', () => {
  it('오늘 카드에서 가계부 칸이 빠진다. 할 일 · 노트는 그대로다', () => {
    render(
      <DialogHost>
        <TodayPanel
          todayISO={TODAY} entries={[]} tideEntries={[]} tideFrom={null} accounts={[]} hasBalance={false}
          collapsed={false} onToggleCollapsed={vi.fn()} moneyCollapsed={false} onToggleMoneyCollapsed={vi.fn()}
          onEntryClick={vi.fn()} onStatusChange={vi.fn()} onPromote={vi.fn()} onQuickIdea={vi.fn()} onSaveAccount={vi.fn()}
          showMoney={false}
        />
      </DialogHost>,
    );
    expect(screen.getByText('할 일', { selector: '.tp-ct' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /가계부 (접기|펼치기)/ })).toBeNull();
    expect(document.querySelector('.tp-col[data-axis="money"]')).toBeNull();
  });

  const modal = (props: Partial<React.ComponentProps<typeof EntryModal>>) => render(
    <EntryModal
      open mode="create" initial={newEntry('task', { startDate: TODAY })} allTags={[]} linkableTasks={[]} budgets={[]} debts={[]}
      onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()}
      {...props}
    />,
  );

  it('새 항목 창에 가계부 칸이 없다 — 할 일 · 아이디어(노트를 숨겨도)는 그대로다', () => {
    modal({ ledgerVisible: false });
    const kinds = within(screen.getByRole('tablist', { name: '항목 종류' })).getAllByRole('tab').map((t) => t.textContent);
    expect(kinds).toEqual(['할 일', '아이디어']);
  });

  it('이미 가계부인 항목을 열면 칸이 남는다 — 무엇인지 보여야 하고 저장 동작도 같다', () => {
    const tx = withDerived(newEntry('money', { id: 'm1', startDate: TODAY, money: newMoney({ status: 'actual', amountMinor: 1_000 }) }));
    modal({ ledgerVisible: false, mode: 'edit', initial: tx });
    const kinds = within(screen.getByRole('tablist', { name: '항목 종류' })).getAllByRole('tab').map((t) => t.textContent);
    expect(kinds).toContain('가계부');
  });
});

describe('F — 달력 칸', () => {
  const accounts: Account[] = [{
    id: 'a1', name: '주계좌', balanceMinor: 250_000, currency: 'KRW',
    asOf: TODAY, checkedAt: `${TODAY}T09:00:00.000Z`, order: 0, createdAt: '', updatedAt: '',
  }];
  const pocket = newBudget({ id: 'b1', startDate: '2026-10-10', endDate: '2026-10-20', amountMinor: 200_000 });
  const cell = (iso: string) => document.querySelector(`[aria-label^="${iso} "].cal-limit`)?.textContent ?? null;
  const mount = (amountMode?: React.ComponentProps<typeof MonthCalendar>['amountMode']) => render(
    <MonthCalendar
      cursor={new Date(2026, 9, 1)} onCursorChange={vi.fn()}
      entries={[]} tideEntries={[]} tideMonths={['2026-10', '2026-11']} accounts={accounts} hasBalance
      lens="money" weekStart="mon" todayISO={TODAY}
      onEntryClick={vi.fn()} onDayOpen={vi.fn()} onDayCreate={vi.fn()}
      amountMode={amountMode} reservations={{ budgets: [pocket], reserves: [] }}
    />,
  );

  it('기준을 주지 않으면 예상 잔고 — 지금까지와 같다', () => {
    mount();
    expect(cell(TODAY)).toBe('25만');
    expect(document.querySelector(`[aria-label="${TODAY} 예상 잔고 250,000원"]`)).not.toBeNull();
  });

  it('가용 잔액은 생활비를 뺀 값, 생활비가 끝난 뒤에는 풀린다', () => {
    mount('available');
    expect(cell(TODAY)).toBe('5만');
    expect(cell('2026-10-21')).toBe('25만');
    expect(document.querySelector(`[aria-label="${TODAY} 가용 잔액 50,000원"]`)).not.toBeNull();
  });

  it('전체 보유액은 오늘 칸에만', () => {
    mount('balance');
    expect(cell(TODAY)).toBe('25만');
    expect(cell('2026-10-15')).toBe(null);
  });

  it('생활비 잔여는 주머니가 품는 날에만', () => {
    mount('pocket');
    expect(cell(TODAY)).toBe('20만');
    expect(cell('2026-10-21')).toBe(null);
  });
});
