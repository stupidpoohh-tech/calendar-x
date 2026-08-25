import { useState } from 'react';
import { backupLink } from '../lib/backup';
import { formatInstant } from '../lib/date';
import { copyText } from '../lib/clipboard';
import type { PersistenceStatus } from '../lib/storage';
import type { State } from '../lib/types';
import { RestoreField, extractPayload } from './WipedNotice';

const LOAN_EARLY_URL = 'https://loan-early.vercel.app/';

type Props = {
  state: State;
  persistence: PersistenceStatus;
  canStore: boolean;
  backupTakenAt: string | null;
  onBackupTaken: () => void;
  onRestoreLink: (payload: string) => void;
  onReset: () => void;
  onToast: (message: string) => void;
};

/**
 * 예정 항목은 여기서 나열하지 않는다 — 쓸수록 끝없이 길어지기 때문이다.
 * 항목은 달력에서 날짜를 눌러 그 날 것만 보고 고친다.
 */
export function SettingsScreen({
  state,
  persistence,
  canStore,
  backupTakenAt,
  onBackupTaken,
  onRestoreLink,
  onReset,
  onToast,
}: Props) {
  const [link, setLink] = useState<string | null>(null);
  const [restoreInput, setRestoreInput] = useState('');
  const [confirmingReset, setConfirmingReset] = useState(false);

  async function makeBackup() {
    const url = backupLink(state);
    setLink(url);
    onBackupTaken();
    const copied = await copyText(url);
    onToast(
      copied
        ? '백업 링크를 복사했습니다. 안전한 곳에 붙여넣어 두세요.'
        : '복사에 실패했습니다. 아래 링크를 직접 복사해 주세요.',
    );
  }

  return (
    <div className="screen">
      {/*
        형제 서비스 안내. 데이터를 주고받지는 않는다 — 이 앱은 "다음 입금까지 버티기"고
        저쪽은 "몇 년 뒤 이자 아끼기"라 시간 축이 달라서, 링크로만 이어둔다.
      */}
      <section className="card">
        <h2 className="card__title">서비스 더보기</h2>
        <a className="promo" href={LOAN_EARLY_URL} target="_blank" rel="noopener noreferrer">
          <span className="promo__icon" aria-hidden="true">
            <CalculatorIcon />
          </span>
          <span className="promo__main">
            <b>조기상환 계산기</b>
            <span className="muted">대출을 미리 갚으면 이자를 얼마나 아끼는지 계산합니다.</span>
          </span>
          <span className="promo__go" aria-hidden="true">
            ›
          </span>
        </a>
      </section>

      <section className="card">
        <h2 className="card__title">백업</h2>
        <p className="muted">
          데이터는 이 브라우저에만 있습니다. 백업 링크는 상태 전체를 주소에 담은 것이라, 링크만
          있으면 어디서든 복원됩니다.
        </p>

        <button type="button" className="primary-btn" onClick={() => void makeBackup()}>
          백업 링크 복사
        </button>

        {backupTakenAt && (
          <p className="muted">마지막 백업: {formatInstant(backupTakenAt)}</p>
        )}

        {link && (
          <label className="field">
            <span className="field__label">백업 링크</span>
            <textarea readOnly rows={3} value={link} onFocus={(e) => e.currentTarget.select()} />
          </label>
        )}

        <hr className="rule" />

        <RestoreField
          label="백업 링크로 복원"
          value={restoreInput}
          onChange={setRestoreInput}
          onSubmit={() => {
            const payload = extractPayload(restoreInput);
            if (!payload) {
              onToast('백업 링크를 찾을 수 없습니다.');
              return;
            }
            onRestoreLink(payload);
            setRestoreInput('');
          }}
        />
      </section>

      <section className="card card--quiet">
        <h2 className="card__title">저장소</h2>
        <dl className="status-list">
          <div>
            <dt>저장 위치</dt>
            <dd>{canStore ? '이 브라우저 (localStorage)' : '사용할 수 없음'}</dd>
          </div>
          <div>
            <dt>영속 저장</dt>
            <dd>{describePersistence(persistence)}</dd>
          </div>
          <div>
            <dt>예정 항목</dt>
            <dd>{state.entries.length}건</dd>
          </div>
        </dl>
      </section>

      <section className="card card--danger">
        <h2 className="card__title">초기화</h2>
        {confirmingReset ? (
          <>
            <p>이 기기에 저장된 데이터를 지웁니다. 백업 링크가 없으면 되돌릴 수 없습니다.</p>
            <div className="row">
              <button
                type="button"
                className="danger-btn"
                onClick={() => {
                  onReset();
                  setConfirmingReset(false);
                }}
              >
                지우기
              </button>
              <button type="button" className="ghost-btn" onClick={() => setConfirmingReset(false)}>
                취소
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="ghost-btn" onClick={() => setConfirmingReset(true)}>
            모든 데이터 지우기
          </button>
        )}
      </section>
    </div>
  );
}

/** 계산기 글리프. 외부 리소스를 쓰지 않으려고 인라인 SVG로 그린다. */
function CalculatorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <rect x="7.5" y="6.5" width="9" height="3.5" rx="1" />
      <circle cx="8.5" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="17.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function describePersistence(status: PersistenceStatus): string {
  switch (status) {
    case 'persisted':
      return '켜짐';
    case 'denied':
      return '꺼짐 (브라우저가 거절)';
    case 'unsupported':
      return '지원하지 않음';
    default:
      return '확인 중';
  }
}
