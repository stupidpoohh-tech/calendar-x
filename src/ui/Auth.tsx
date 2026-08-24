/**
 * 로그인 · 가입 · 비밀번호 재설정.
 *
 * 이전 화면에는 재설정 경로가 없었다. 비밀번호를 잊으면 데이터에 영구히 접근할 수
 * 없었고, 이메일 인증도 없어 오타로 가입하면 복구 수단이 없었다. (F-07)
 */
import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword,
} from 'firebase/auth';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getFirebase } from '../data/firebase';
import { Icon } from './Icon';

type Mode = 'signin' | 'signup' | 'reset';

interface AuthProps {
  /** 랜딩 화면으로 돌아가는 콜백. 없으면 '돌아가기' 버튼을 숨긴다. */
  onBack?: () => void;
}

const LAST_EMAIL_KEY = 'dada.lastEmail';

/** Firebase 오류 코드를 사람이 읽고 다음 행동을 알 수 있는 문장으로 옮긴다. */
function messageFor(err: unknown): string {
  const code = err instanceof FirebaseError ? err.code : '';
  switch (code) {
    case 'auth/email-already-in-use':
      return '이미 가입된 이메일입니다. 로그인해 주세요.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return '이메일 또는 비밀번호가 맞지 않습니다.';
    case 'auth/weak-password':
      return '비밀번호가 너무 짧습니다. 6자 이상으로 정해 주세요.';
    case 'auth/invalid-email':
      return '이메일 형식을 확인해 주세요.';
    case 'auth/too-many-requests':
      return '시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.';
    case 'auth/network-request-failed':
      return '네트워크에 연결할 수 없습니다. 인터넷 상태를 확인해 주세요.';
    case 'auth/operation-not-allowed':
      return '이메일 로그인이 꺼져 있습니다. Firebase 콘솔에서 사용 설정을 켜 주세요.';
    default:
      return err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
  }
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function Auth({ onBack }: AuthProps = {}) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) ?? '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => emailRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [mode]);

  const fail = (msg: string) => {
    setError(msg);
    setNotice('');
    setShake(true);
    setTimeout(() => setShake(false), 420);
  };

  const go = (next: Mode) => {
    setMode(next);
    setError('');
    setNotice('');
    setPw('');
    setPw2('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (!isEmail(email)) return fail('이메일 형식을 확인해 주세요.');

    const { auth } = getFirebase();
    setBusy(true);
    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email.trim());
        setNotice('재설정 메일을 보냈습니다. 받은편지함을 확인해 주세요.');
        setBusy(false);
        return;
      }

      if (!pw) { setBusy(false); return fail('비밀번호를 입력해 주세요.'); }

      if (mode === 'signup') {
        if (pw.length < 6) { setBusy(false); return fail('비밀번호는 6자 이상이어야 합니다.'); }
        if (pw !== pw2) { setBusy(false); return fail('비밀번호가 서로 다릅니다.'); }
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), pw);
        // 인증 메일은 실패해도 가입 자체를 막지 않는다.
        void sendEmailVerification(cred.user).catch(() => {});
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), pw);
      }
      localStorage.setItem(LAST_EMAIL_KEY, email.trim());
      // onAuthStateChanged 가 화면을 넘긴다.
    } catch (err) {
      setBusy(false);
      fail(messageFor(err));
      return;
    }
    setBusy(false);
  };

  const brand = (
    <div className="lock-brand">
      <div className="lock-logo"><Icon.Calendar size={18} /></div>
      <div className="lock-app">캘린더X</div>
    </div>
  );

  const copy = {
    signin: { title: '로그인', sub: '저장된 데이터에 접근하려면 로그인하세요.', cta: '로그인' },
    signup: { title: '계정 만들기', sub: '이메일과 비밀번호를 한 번만 정하면 다음부터 자동으로 로그인됩니다.', cta: '계정 만들고 시작하기' },
    reset: { title: '비밀번호 재설정', sub: '가입한 이메일로 재설정 링크를 보냅니다.', cta: '재설정 메일 보내기' },
  }[mode];

  return (
    <div className="lock-root">
      <form className={'lock-card' + (shake ? ' shake' : '')} onSubmit={submit} noValidate>
        {brand}
        <h1 className="lock-title">{copy.title}</h1>
        <p className="lock-sub">{copy.sub}</p>

        <div className="lock-fields">
          <label className="lock-field">
            <span className="lock-fl">이메일</span>
            <input
              ref={emailRef} type="email" autoComplete="email" inputMode="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" required disabled={busy}
            />
          </label>

          {mode !== 'reset' && (
            <label className="lock-field">
              <span className="lock-fl">비밀번호</span>
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder={mode === 'signup' ? '6자 이상' : ''} required disabled={busy}
              />
            </label>
          )}

          {mode === 'signup' && (
            <label className="lock-field">
              <span className="lock-fl">비밀번호 확인</span>
              <input
                type="password" autoComplete="new-password"
                value={pw2} onChange={(e) => setPw2(e.target.value)} required disabled={busy}
              />
            </label>
          )}
        </div>

        <div className="lock-msg" aria-live="polite">
          {error && <span className="lock-err">{error}</span>}
          {notice && <span className="lock-ok">{notice}</span>}
          {!error && !notice && ' '}
        </div>

        <button className="lock-submit" type="submit" disabled={busy}>
          {busy ? '확인 중…' : copy.cta}
        </button>

        <div className="lock-foot">
          {onBack && (
            <button type="button" className="lock-link" onClick={onBack}>← 홈</button>
          )}
          {mode === 'signin' && (
            <button type="button" className="lock-link" onClick={() => go('signup')}>새 계정 만들기</button>
          )}
          {mode === 'signup' && (
            <button type="button" className="lock-link" onClick={() => go('signin')}>기존 계정으로 로그인</button>
          )}
          {mode === 'signin' && (
            <button type="button" className="lock-link" onClick={() => go('reset')}>비밀번호를 잊으셨나요?</button>
          )}
          {mode === 'reset' && (
            <button type="button" className="lock-link" onClick={() => go('signin')}>로그인으로</button>
          )}
        </div>

        <div className="lock-note">
          <Icon.Lock size={10} /> 데이터는 계정에 묶여 저장되고, 이 기기에서는 자동으로 로그인됩니다.
        </div>
      </form>
    </div>
  );
}
