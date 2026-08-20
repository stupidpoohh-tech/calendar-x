import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { getFirebase } from '../data/firebase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: User }
  | { status: 'error'; message: string };

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let auth;
    try {
      auth = getFirebase().auth;
    } catch (err) {
      // 환경변수가 없으면 흰 화면 대신 무엇이 빠졌는지 보여 준다.
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    return onAuthStateChanged(
      auth,
      (user) => setState(user ? { status: 'signed-in', user } : { status: 'signed-out' }),
      (err) => setState({ status: 'error', message: err.message }),
    );
  }, []);

  const logout = useCallback(async () => {
    await signOut(getFirebase().auth);
  }, []);

  return { state, logout };
}
