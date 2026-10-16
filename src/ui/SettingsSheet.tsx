import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { Category, FontScale, RecoveryRule, ThemePref, WeekStart } from '../domain/types';
import { Icon } from './Icon';
import { LayoutSettings, type LayoutSettingsProps } from './LayoutSettings';
import { LedgerSettings } from './LedgerSettings';
import { RecoverySettings } from './RecoverySettings';

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

export function SettingsSheet({
  user, theme, fontScale, weekStart, entryCount, legacyCount, migratedAt,
  recoveryRule, onRecoveryRule, onRecoveryPause, onRecoveryResume, layout, ledger,
  onTheme, onFontScale, onWeekStart, onExport, onImport, onImportLedger, onCleanPastPlans, onCleanLoanCategory, onMigrate, onSignOut, onClose, onShowOnboarding,
}: Props) {
  const [showRedo, setShowRedo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => unknown) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="sheet set" role="dialog" aria-modal="true" aria-label="설정" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-h">
          <h2 className="sheet-t">설정</h2>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>

        <div className="sheet-b">
          <div className="set-acct">
            <div>
              <div className="set-acct-e">{user.email}</div>
              <div className="set-acct-s num">
                {entryCount.toLocaleString('ko-KR')}개 항목
                {!user.emailVerified && <span className="set-unverified">이메일 미인증</span>}
              </div>
            </div>
          </div>

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

          <LayoutSettings {...layout} />

          {onShowOnboarding && <div className="set-grp">
            <h3 className="set-gt">사용 안내</h3>
            <button className="set-row" onClick={onShowOnboarding}>
              <span className="set-ico"><Icon.Calendar size={16} /></span>
              <span className="set-row-b">
                <span className="set-row-t">튜토리얼 다시 보기</span>
                <span className="set-row-s">내 공간 · 같이 보기 · 기록 · 현금흐름 · 세이브를 안내합니다.</span>
              </span>
            </button>
          </div>}

          <div className="set-grp">
            <h3 className="set-gt">표시</h3>
            <div className="set-row-inline">
              <span>테마</span>
              <div className="seg">
                {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
                  <button key={t} className={'seg-btn' + (theme === t ? ' on' : '')} onClick={() => onTheme(t)}>
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
              <div className="seg">
                {FONT_SCALES.map(([id, label]) => (
                  <button
                    key={id}
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
              <div className="seg">
                {(['mon', 'sun'] as WeekStart[]).map((w) => (
                  <button key={w} className={'seg-btn' + (weekStart === w ? ' on' : '')} onClick={() => onWeekStart(w)}>
                    {w === 'mon' ? '월요일' : '일요일'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 가계부를 숨기면 가계부 설정 · 도구도 숨긴다 — 자료는 그대로이고 백업에도 그대로 실린다. */}
          {layout.layout.ledger && <LedgerSettings {...ledger} />}

          <RecoverySettings
            rule={recoveryRule}
            onChange={onRecoveryRule}
            onPause={onRecoveryPause}
            onResume={onRecoveryResume}
          />

          <div className="set-grp">
            <h3 className="set-gt">데이터</h3>
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
        </div>
      </div>
    </div>
  );
}
