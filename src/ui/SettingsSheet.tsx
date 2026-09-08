import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { RecoveryRule, ThemePref, WeekStart } from '../domain/types';
import { Icon } from './Icon';
import { RecoverySettings } from './RecoverySettings';

interface Props {
  user: User;
  theme: ThemePref;
  weekStart: WeekStart;
  entryCount: number;
  legacyCount: number | null;
  /** 이관을 이미 끝냈으면 그 시각. 안내를 다시 띄우지 않기 위한 표식이다. */
  migratedAt: string | null;
  recoveryRule: RecoveryRule;
  onRecoveryRule: (next: RecoveryRule) => void;
  onTheme: (t: ThemePref) => void;
  onWeekStart: (w: WeekStart) => void;
  onExport: () => void | Promise<void>;
  onImport: () => void | Promise<void>;
  onMigrate: () => void | Promise<void>;
  onSignOut: () => void;
  onClose: () => void;
}

export function SettingsSheet({
  user, theme, weekStart, entryCount, legacyCount, migratedAt,
  recoveryRule, onRecoveryRule,
  onTheme, onWeekStart, onExport, onImport, onMigrate, onSignOut, onClose,
}: Props) {
  const [showRedo, setShowRedo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => void | Promise<void>) => {
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

          <RecoverySettings rule={recoveryRule} onChange={onRecoveryRule} />

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
                <span className="set-row-s">기존 데이터에 병합하거나 전체를 교체합니다. 예전 형식도 받습니다.</span>
              </span>
            </button>
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
