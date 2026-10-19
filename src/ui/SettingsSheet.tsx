import { useEffect, useRef, useState, type ComponentType } from 'react';
import type { User } from 'firebase/auth';
import type { Category, FontScale, RecoveryRule, ThemePref, WeekStart } from '../domain/types';
import { Icon } from './Icon';
import { LayoutSettings, type LayoutSettingsProps } from './LayoutSettings';
import { LedgerSettings } from './LedgerSettings';
import { RecoverySettings } from './RecoverySettings';
import '../styles/settings.css';

interface Props {
  user: User;
  theme: ThemePref;
  fontScale: FontScale;
  weekStart: WeekStart;
  entryCount: number;
  legacyCount: number | null;
  /** 이관을 이미 끝냈으면 그 시각. 안내를 다시 띄우지 않기 위한 표식이다. */
  migratedAt: string | null;
  recoveryRule: RecoveryRule;
  onRecoveryRule: (next: RecoveryRule) => void;
  onRecoveryPause: () => void;
  onRecoveryResume: () => void;
  /** 내 캘린더 구성 · 캘린더 표시. 가계부를 숨기면 아래 가계부 설정 · 가계부 도구도 빠진다. */
  layout: LayoutSettingsProps;
  /** 가계부 — 정산 시작일 · 카테고리. */
  ledger: {
    todayISO: string;
    settleDay: number;
    onSettleDay: (day: number) => void;
    categories: readonly Category[];
    categoriesReady: boolean;
    onSaveCategory: (c: Category) => void;
    onSaveCategories: (list: Category[]) => void;
    onSeedCategories: () => void;
  };
  onTheme: (t: ThemePref) => void;
  onFontScale: (f: FontScale) => void;
  onWeekStart: (w: WeekStart) => void;
  onExport: () => unknown;
  onImport: () => void | Promise<void>;
  /** 다른 가계부의 엑셀 · CSV 를 실제 거래로 더한다. */
  onImportLedger: () => void | Promise<void>;
  /** 지난 예정 정리 창을 연다. 로그인했을 때만 준다. */
  onCleanPastPlans?: () => void;
  /** 예전 '대출' 카테고리 지출 정리 창을 연다. 로그인했을 때만 준다. */
  onCleanLoanCategory?: () => void;
  onMigrate: () => void | Promise<void>;
  onSignOut: () => void;
  onClose: () => void;
  onShowOnboarding?: () => void;
}

const FONT_SCALES: Array<[FontScale, string]> = [
  ['auto', '자동'],
  ['sm', '작게'],
  ['md', '중간'],
  ['lg', '크게'],
];


type Page = 'home' | 'appearance' | 'ledger' | 'sharing' | 'recovery' | 'data' | 'account' | 'help' | 'clearweek';
const TITLES: Record<Page, string> = {
  home: '설정', appearance: '화면과 캘린더', ledger: '가계부', sharing: '같이 보기',
  recovery: '회복 · Recovery', data: '데이터 관리', account: '계정', help: '사용 안내', clearweek: '클리어위크',
};
const DESCRIPTIONS: Record<Exclude<Page, 'home'>, string> = {
  appearance: '사용할 기능과 화면의 표시 방식을 선택합니다.',
  ledger: '정산 기준과 카테고리, 현금흐름 달력의 표시 금액을 관리합니다.',
  sharing: '공간 전환 표시와 공유 연결을 관리합니다.',
  recovery: '회복 일정의 간격과 기본 내용을 설정합니다.',
  data: '기록을 백업하거나 가져오고, 필요한 경우 정리합니다.',
  account: '로그인한 계정과 이 기기의 연결을 확인합니다.',
  help: '캘린더 X의 주요 기능을 다시 살펴봅니다.',
  clearweek: '이번 주를 한 장에 정리하는 별도 서비스를 소개합니다.',
};

export function SettingsSheet({
  user, theme, fontScale, weekStart, entryCount, legacyCount, migratedAt,
  recoveryRule, onRecoveryRule, onRecoveryPause, onRecoveryResume, layout, ledger,
  onTheme, onFontScale, onWeekStart, onExport, onImport, onImportLedger, onCleanPastPlans, onCleanLoanCategory, onMigrate, onSignOut, onClose, onShowOnboarding,
}: Props) {
  const [page, setPage] = useState<Page>('home');
  const [showRedo, setShowRedo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Page | null>(null);
  const menuButtons = useRef<Partial<Record<Page, HTMLButtonElement | null>>>({});

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    if (page === 'home' && returnTo.current) menuButtons.current[returnTo.current]?.focus();
    else title.current?.focus();
  }, [page]);

  const open = (next: Page) => { returnTo.current = next; setPage(next); };
  const run = async (key: string, fn: () => unknown) => {
    setBusy(key);
    setError('');
    try { await fn(); }
    catch (err) { setError(err instanceof Error ? err.message : '작업을 완료하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(null); }
  };
  const menu = (id: Exclude<Page, 'home'>, Glyph: ComponentType<{ size?: number }>, summary: string, badge?: string) => (
    <button className="settings-link" onClick={() => open(id)} ref={(node) => { menuButtons.current[id] = node; }}>
      <span className="settings-link-icon"><Glyph size={19} /></span>
      <span className="settings-link-copy"><span className="settings-link-title">{TITLES[id]}</span><span className="settings-link-summary">{summary}</span></span>
      {badge && <span className="settings-badge">{badge}</span>}
      <Icon.Chevron size={16} />
    </button>
  );

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="sheet set settings-hub" role="dialog" aria-modal="true" aria-label="설정"
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.stopPropagation();
            if (busy) return;
            if (page === 'home') onClose(); else setPage('home');
          }
        }}>
        <header className="sheet-h settings-header">
          {page !== 'home' && <button className="ico-btn settings-back" aria-label="설정 목록으로" disabled={busy != null} onClick={() => setPage('home')}><Icon.Chevron dir="left" size={20} /></button>}
          <div className="settings-heading">
            {page !== 'home' && <span className="settings-breadcrumb">설정</span>}
            <h2 className="sheet-t" ref={title} tabIndex={-1}>{TITLES[page]}</h2>
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="설정 닫기"><Icon.X size={18} /></button>
        </header>
        <div className="sheet-b settings-body" ref={body}>
          {error && <p role="alert" className="settings-error">{error}</p>}
          {page !== 'home' && <p className="settings-intro">{DESCRIPTIONS[page]}</p>}
          <section className="settings-page settings-home" hidden={page !== 'home'} aria-label="설정 목록">
            <p className="settings-intro">필요한 설정을 선택하세요.</p>
            <h3 className="settings-group-title">사용 환경</h3>
            <div className="settings-menu">
              {menu('appearance', Icon.Calendar, '사용할 기능 · 테마 · 글씨 크기 · 주 시작')}
              {layout.layout.ledger && menu('ledger', Icon.Wallet, '정산 시작일 · 카테고리 · 달력 금액', '매월 ' + ledger.settleDay + '일')}
              {menu('sharing', Icon.Users, '공간 전환 · 참여자 · 초대 링크', !layout.shared.ready ? '확인 중' : layout.shared.connected ? '연결됨' : '미연결')}
              {menu('recovery', Icon.Repeat, '회복 주기 · 기본 메모 · 옵션', recoveryRule.enabled ? '활성화' : '일시중지')}
            </div>
            <h3 className="settings-group-title">관리 및 도움말</h3>
            <div className="settings-menu">
              {menu('data', Icon.Download, '백업 · 가져오기 · 데이터 정리', legacyCount && !migratedAt ? '이관 가능' : undefined)}
              {menu('account', Icon.User, user.email ?? '로그인 계정')}
              {menu('help', Icon.Bulb, '튜토리얼 다시 보기')}
            </div>
            <h3 className="settings-group-title">연결 서비스</h3>
            <div className="settings-menu">
              {menu('clearweek', Icon.Calendar, '이번 주를 한 장에 · Clear Week')}
            </div>
          </section>

          <section className="settings-page" hidden={page !== 'appearance'} aria-label="화면과 캘린더 설정">
            <LayoutSettings {...layout} section="features" />
          <div className="set-grp">
            <h3 className="set-gt">표시</h3>
            <div className="set-row-inline">
              <span>테마</span>
              <div className="seg" role="group" aria-label="테마">
                {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
                  <button key={t} aria-pressed={theme === t} className={'seg-btn' + (theme === t ? ' on' : '')} onClick={() => onTheme(t)}>
                    {t === 'system' ? '시스템' : t === 'light' ? '화이트' : '블랙'}
                  </button>
                ))}
              </div>
            </div>
            {/*
              작게 → 크게 순으로 늘어놓는다. '자동' 이 맨 앞인 것은 테마의 '시스템' 과
              같은 자리이기 때문이다.
            */}
            <div className="set-row-inline">
              <span>글씨 크기</span>
              <div className="seg" role="group" aria-label="글씨 크기">
                {FONT_SCALES.map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={fontScale === id}
                    className={'seg-btn' + (fontScale === id ? ' on' : '')}
                    onClick={() => onFontScale(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="set-note">
              {fontScale === 'auto'
                ? '브라우저·휴대폰의 글씨 크기 설정을 따릅니다.'
                : '브라우저 설정과 무관하게 이 크기로 고정합니다.'}
            </p>

            <div className="set-row-inline">
              <span>주 시작</span>
              <div className="seg" role="group" aria-label="주 시작">
                {(['mon', 'sun'] as WeekStart[]).map((w) => (
                  <button key={w} aria-pressed={weekStart === w} className={'seg-btn' + (weekStart === w ? ' on' : '')} onClick={() => onWeekStart(w)}>
                    {w === 'mon' ? '월요일' : '일요일'}
                  </button>
                ))}
              </div>
            </div>
          </div>


          </section>
          <section className="settings-page" hidden={page !== 'ledger'} aria-label="가계부 설정">
            {layout.layout.ledger && <><LedgerSettings {...ledger} /><LayoutSettings {...layout} section="calendar" /></>}
          </section>
          <section className="settings-page" hidden={page !== 'sharing'} aria-label="같이 보기 설정">
            <LayoutSettings {...layout} section="sharing" />
          </section>
          <section className="settings-page" hidden={page !== 'recovery'} aria-label="회복 설정">
          <RecoverySettings
            rule={recoveryRule}
            onChange={onRecoveryRule}
            onPause={onRecoveryPause}
            onResume={onRecoveryResume}
          />


          </section>
          <section className="settings-page" hidden={page !== 'data'} aria-label="데이터 관리">
          <div className="set-grp">
            <h3 className="set-gt">백업과 가져오기</h3>
            <button className="set-row" disabled={busy != null} onClick={() => run('export', onExport)}>
              <span className="set-ico"><Icon.Download size={16} /></span>
              <span className="set-row-b">
                <span className="set-row-t">{busy === 'export' ? '내보내는 중…' : 'JSON으로 백업 내려받기'}</span>
                <span className="set-row-s">계정에 저장된 전체 데이터를 한 파일로 받습니다.</span>
              </span>
            </button>
            <button className="set-row" disabled={busy != null} onClick={() => run('import', onImport)}>
              <span className="set-ico"><Icon.Upload size={16} /></span>
              <span className="set-row-b">
                <span className="set-row-t">{busy === 'import' ? '가져오는 중…' : '백업 파일 가져오기'}</span>
                <span className="set-row-s">기존 데이터에 더합니다. 같은 항목은 지금 것을 남깁니다. 예전 형식도 받습니다.</span>
              </span>
            </button>
            {layout.layout.ledger && <button className="set-row" disabled={busy != null} onClick={() => run('ledger-import', onImportLedger)}>
              <span className="set-ico"><Icon.Upload size={16} /></span>
              <span className="set-row-b">
                <span className="set-row-t">{busy === 'ledger-import' ? '가져오는 중…' : '가계부 내역 가져오기 (엑셀 · CSV)'}</span>
                <span className="set-row-s">다른 가계부에서 내보낸 일자 · 구분 · 금액 표를 실제 거래로 더합니다. 여러 파일을 한 번에 고를 수 있습니다.</span>
              </span>
            </button>}
          </div>
            <details className="settings-advanced">
              <summary>데이터 정리 및 이전 데이터 이관</summary>
              <p className="set-note">필요한 작업만 선택하세요. 정리 전에 백업을 내려받는 것을 권장합니다.</p>
            {layout.layout.ledger && onCleanPastPlans && (
              <button className="set-row" disabled={busy != null} onClick={onCleanPastPlans}>
                <span className="set-ico"><Icon.X size={16} /></span>
                <span className="set-row-b">
                  <span className="set-row-t">지난 예정 정리</span>
                  <span className="set-row-s">날짜가 지났는데 확정하지 않은 한 번짜리 예정을 골라 지웁니다. 백업을 확인하고 숫자가 그대로일 때만 지웁니다.</span>
                </span>
              </button>
            )}
            {layout.layout.ledger && onCleanLoanCategory && (
              <button className="set-row" disabled={busy != null} onClick={onCleanLoanCategory}>
                <span className="set-ico"><Icon.Repeat size={16} /></span>
                <span className="set-row-b">
                  <span className="set-row-t">예전 '대출' 카테고리 정리</span>
                  <span className="set-row-s">'대출' 카테고리로 적은 지출을 흐름 대출로 한꺼번에 옮깁니다. 잔고 · 한도는 그대로이고 소비에서 빠집니다.</span>
                </span>
              </button>
            )}

          {legacyCount != null && legacyCount > 0 && !migratedAt && (
            <div className="set-migrate">
              <div className="set-migrate-h">
                <Icon.Alert size={14} />
                <strong>이관 전 데이터 {legacyCount.toLocaleString('ko-KR')}건</strong>
              </div>
              <p>
                예전 구조(<code>items</code>)에 남아 있는 데이터입니다. 새 구조로 옮기면 잔고·대출이
                각각의 항목으로 분리되고, 저장만 되고 동작하지 않던 반복 일정이 살아납니다.
                원본은 지우지 않습니다.
              </p>
              <button className="btn primary" disabled={busy != null} onClick={() => run('migrate', onMigrate)}>
                {busy === 'migrate' ? '옮기는 중…' : '새 구조로 옮기기'}
              </button>
            </div>
          )}

          {migratedAt && (
            <div className="set-migrated">
              <span>
                <Icon.Check size={13} /> 이관 완료 · {migratedAt.slice(0, 10)}
                {legacyCount != null && legacyCount > 0 && ` · 원본 ${legacyCount.toLocaleString('ko-KR')}건은 그대로 있습니다`}
              </span>
              {showRedo ? (
                <button className="btn" disabled={busy != null} onClick={() => run('migrate', onMigrate)}>
                  {busy === 'migrate' ? '옮기는 중…' : '한 번 더 옮기기'}
                </button>
              ) : (
                <button className="set-redo" onClick={() => setShowRedo(true)}>다시 옮기기</button>
              )}
            </div>
          )}


              {!migratedAt && !(legacyCount != null && legacyCount > 0) && <p className="set-note">이관할 이전 데이터가 없습니다.</p>}
            </details>
          </section>
          <section className="settings-page" hidden={page !== 'account'} aria-label="계정 설정">
          <div className="set-acct">
            <div>
              <div className="set-acct-e">{user.email}</div>
              <div className="set-acct-s num">
                {entryCount.toLocaleString('ko-KR')}개 항목
                {!user.emailVerified && <span className="set-unverified">이메일 미인증</span>}
              </div>
            </div>
          </div>

          <div className="set-grp">
            <h3 className="set-gt">계정</h3>
            <button className="set-row" onClick={onSignOut}>
              <span className="set-ico"><Icon.Lock size={16} /></span>
              <span className="set-row-b">
                <span className="set-row-t">로그아웃</span>
                <span className="set-row-s">이 기기의 자동 로그인을 해제합니다.</span>
              </span>
            </button>
          </div>

          </section>
          <section className="settings-page" hidden={page !== 'help'} aria-label="사용 안내">
            <div className="set-grp">
              <h3 className="set-gt">처음 시작하기</h3>
              {onShowOnboarding && <button className="set-row" onClick={onShowOnboarding}>
                <span className="set-ico"><Icon.Calendar size={18} /></span>
                <span className="set-row-b"><span className="set-row-t">튜토리얼 다시 보기</span><span className="set-row-s">일정·회복, 노트, 가계부와 Clear Week를 5단계로 안내합니다. 상단에서 원하는 단계를 바로 열 수 있습니다.</span></span>
                <Icon.Chevron size={16} />
              </button>}
            </div>
          </section>
          <section className="settings-page" hidden={page !== 'clearweek'} aria-label="클리어위크 소개">
            <img className="settings-service-image" src="/clear-week-guide.png" width="1536" height="807" alt="Clear Week — 이번 주를 한 장에. 요일별 일정과 메모를 보여 주는 모바일 주간 플래너" loading="lazy" />
            <div className="settings-service">
              <span className="settings-service-eyebrow">Clear Week</span>
              <h3>한 주를 가볍게, 클리어위크</h3>
              <p>종이 플래너처럼 한 주의 할 일을 펼쳐 보고, 떠오른 생각을 여백에 적어 보세요. 주간 계획에 집중하고 싶을 때 이용할 수 있는 별도 서비스입니다.</p>
              <a href="https://clear-week.pages.dev/" target="_blank" rel="noopener noreferrer">클리어위크 살펴보기 <span>↗</span><span className="sr-only"> (새 탭)</span></a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
