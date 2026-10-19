import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { watchDevice } from '../data/deviceStore';
import { backupDevice, deviceCount } from '../data/deviceBackup';
import { getFirebase } from '../data/firebase';

export function DeviceBackup({ user, onSignIn }: { user: User | null; onSignIn: () => void }) {
  const [count, setCount] = useState(0);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const progress = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (busy) progress.current?.showModal();
    else progress.current?.close();
  }, [busy]);
  useEffect(() => watchDevice(d => ({ count: deviceCount(d), locked: !!d.transferTo }),
    d => { setCount(d.count); setLocked(d.locked); }, e => setError(String(e))), []);
  const backup = async () => {
    if (!user) return;
    setBusy(true); setError('');
    try { await backupDevice(getFirebase().db, user.uid); setDone(true); }
    catch (e) { setError(e instanceof Error ? e.message : '백업하지 못했습니다. 기기 원본은 그대로 있습니다.'); }
    finally { setBusy(false); }
  };
  if (user && count === 0 && !error && !done && !busy) return null;
  return <section className="device-notice" aria-label="기기 저장과 계정 백업">
    <dialog ref={progress} className="device-backup-progress" aria-label="계정 백업 중" onCancel={e => e.preventDefault()}>
      <h2>계정에 백업하는 중입니다</h2>
      <p role="status">완료될 때까지 잠시 기다려 주세요. 기기 원본은 보관됩니다.</p>
    </dialog>
    <div>
      <strong>{busy ? '계정에 백업하는 중…' : done ? '계정 백업 완료' : user ? '이 기기에 저장한 기록이 있습니다' : '이 기기에 저장 중'}</strong>
      <small>{busy ? '완료될 때까지 이 화면을 열어 두세요. 기기 원본은 보관됩니다.'
        : done ? '이제 계정에서 이어서 사용할 수 있습니다.'
        : user ? count + '개 기록 · ' + (user.email ?? '현재 계정') + '에 백업'
        : locked ? '진행 중인 백업을 완료하려면 처음 백업한 계정으로 로그인해 주세요.'
        : '가입 없이 사용 · 브라우저 데이터를 지우면 기록도 삭제됩니다.'}</small>
      {error && <p role="alert">{error}</p>}
    </div>
    {!done && <button className="btn" disabled={busy} onClick={user ? () => void backup() : onSignIn}>
      {user ? '기기 기록 계정에 백업' : '가입하고 백업'}
    </button>}
    {done && <button className="ico-btn" aria-label="백업 완료 안내 닫기" onClick={() => setDone(false)}>×</button>}
  </section>;
}
