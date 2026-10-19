import type { ComponentProps } from 'react';
import type { User } from 'firebase/auth';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_LAYOUT } from '../domain/layout';
import { defaultRecoveryRule } from '../domain/recovery';
import { SettingsSheet } from './SettingsSheet';

afterEach(cleanup);

function setup(overrides: Partial<ComponentProps<typeof SettingsSheet>> = {}) {
  const props: ComponentProps<typeof SettingsSheet> = {
    user: { email: 'demo@example.com', emailVerified: true } as User,
    theme: 'system', fontScale: 'auto', weekStart: 'mon',
    entryCount: 312, legacyCount: 351, migratedAt: '2026-08-24',
    recoveryRule: defaultRecoveryRule(),
    onRecoveryRule: vi.fn(), onRecoveryPause: vi.fn(), onRecoveryResume: vi.fn(),
    layout: { layout: LEGACY_LAYOUT, onLayout: vi.fn(), shared: { connected: true, ready: true, onStart: vi.fn(), onManage: vi.fn() } },
    ledger: { todayISO: '2026-10-16', settleDay: 25, categories: [], categoriesReady: true, onSettleDay: vi.fn(), onSaveCategory: vi.fn(), onSaveCategories: vi.fn(), onSeedCategories: vi.fn() },
    onTheme: vi.fn(), onFontScale: vi.fn(), onWeekStart: vi.fn(), onExport: vi.fn(),
    onImport: vi.fn(), onImportLedger: vi.fn(), onCleanPastPlans: vi.fn(), onCleanLoanCategory: vi.fn(),
    onMigrate: vi.fn(), onSignOut: vi.fn(), onClose: vi.fn(), onShowOnboarding: vi.fn(),
    ...overrides,
  };
  render(<SettingsSheet {...props} />);
  return props;
}

describe('설정 화면 위계', () => {
  it('첫 화면에는 목적별 목록만 표시하고 상세 조작은 숨긴다', () => {
    setup();
    expect(screen.getByRole('region', { name: '설정 목록' })).toBeVisible();
    expect(screen.getByRole('button', { name: /화면과 캘린더/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /가계부 정산/ })).toBeVisible();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: '다시 옮기기' })).toBeNull();
    expect(screen.queryByRole('button', { name: /로그아웃/ })).toBeNull();
  });

  it('세부 페이지 제목으로 포커스를 옮기고 뒤로 가면 메뉴로 복구한다', () => {
    const props = setup();
    const menu = screen.getByRole('button', { name: /화면과 캘린더/ });
    fireEvent.click(menu);
    expect(screen.getByRole('heading', { level: 2, name: '화면과 캘린더' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '블랙' }));
    expect(props.onTheme).toHaveBeenCalledWith('dark');
    fireEvent.click(screen.getByRole('button', { name: '설정 목록으로' }));
    expect(menu).toHaveFocus();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('가계부 안에서 정산 기준과 달력 금액을 그대로 저장한다', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /가계부 정산/ }));
    fireEvent.change(screen.getByLabelText('정산 시작일'), { target: { value: '10' } });
    expect(props.ledger.onSettleDay).toHaveBeenCalledWith(10);
    fireEvent.click(screen.getByRole('radio', { name: /생활비 잔여/ }));
    expect(props.layout.onLayout).toHaveBeenCalledWith({ calendarAmount: 'pocket' });
  });

  it('같이 보기 설정은 표시 변경과 연결 관리 동작을 구분한다', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /같이 보기 공간 전환/ }));
    fireEvent.click(within(screen.getByRole('group', { name: '같이보기 공간 전환 표시' })).getByRole('button', { name: '숨김' }));
    expect(props.layout.onLayout).toHaveBeenCalledWith({ sharedSwitcher: false });
    expect(props.layout.shared.onManage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /공유 연결 관리/ }));
    expect(props.layout.shared.onManage).toHaveBeenCalledOnce();
  });

  it('데이터 정리와 이관은 펼친 뒤에만 조작할 수 있다', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /데이터 관리 백업/ }));
    expect(screen.getByRole('button', { name: /지난 예정 정리/ })).not.toBeVisible();
    fireEvent.click(screen.getByText('데이터 정리 및 이전 데이터 이관'));
    fireEvent.click(screen.getByRole('button', { name: /지난 예정 정리/ }));
    expect(props.onCleanPastPlans).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '다시 옮기기' }));
    expect(props.onMigrate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '한 번 더 옮기기' })).toBeVisible();
  });

  it('숨긴 가계부의 설정과 도구는 목록에서도 숨긴다', () => {
    setup({ layout: { layout: { ...LEGACY_LAYOUT, ledger: false }, onLayout: vi.fn(), shared: { connected: false, ready: true, onStart: vi.fn(), onManage: vi.fn() } } });
    expect(screen.queryByRole('button', { name: /가계부 정산/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /데이터 관리 백업/ }));
    expect(screen.queryByRole('button', { name: /가계부 내역 가져오기/ })).toBeNull();
  });

  it('사용 안내에서 튜토리얼을 열고 Escape는 목록을 거쳐 닫는다', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /사용 안내 튜토리얼/ }));
    fireEvent.click(screen.getByRole('button', { name: /튜토리얼 다시 보기/ }));
    expect(props.onShowOnboarding).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: /클리어위크 살펴보기/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole('heading', { level: 2, name: '사용 안내' }), { key: 'Escape' });
    expect(screen.getByRole('heading', { level: 2, name: '설정' })).toBeVisible();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('클리어위크는 연결 서비스에서 독립적으로 열고 사진과 서비스 링크를 보여 준다', () => {
    setup();
    expect(screen.getByRole('heading', { name: '연결 서비스' })).toBeVisible();
    const menu = screen.getByRole('button', { name: /클리어위크 이번 주/ });
    fireEvent.click(menu);
    expect(screen.getByRole('heading', { level: 2, name: '클리어위크' })).toHaveFocus();
    expect(screen.getByRole('img', { name: /Clear Week — 이번 주를 한 장에/ })).toHaveAttribute('src', '/clear-week-guide.png');
    expect(screen.getByRole('link', { name: /클리어위크 살펴보기/ })).toHaveAttribute('href', 'https://clear-week.pages.dev/');
    expect(screen.queryByRole('button', { name: /튜토리얼 다시 보기/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '설정 목록으로' }));
    expect(menu).toHaveFocus();
  });
  it('백업 작업 실패는 화면에 표시한다', async () => {
    setup({ onExport: () => Promise.reject(new Error('백업 연결 실패')) });
    fireEvent.click(screen.getByRole('button', { name: /데이터 관리 백업/ }));
    fireEvent.click(screen.getByRole('button', { name: /JSON으로 백업/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('백업 연결 실패');
  });
});
