import { useState } from 'react';

export type OnboardingOutcome = 'skip' | 'complete' | 'dismiss';
const PREFIX = 'calendarx.onboarding.v1.';

function scopeOf(uid: string | null) {
  return uid ? `user.${uid}` : 'guest';
}

function shouldOpen(scope: string): boolean {
  try {
    if (localStorage.getItem(PREFIX + scope) === 'done') return false;
  } catch { /* Storage can be unavailable; the guide must still be usable. */ }
  try {
    return sessionStorage.getItem(PREFIX + scope) !== 'seen';
  } catch {
    return true;
  }
}

/** Browser-local, account-scoped UI preference. Never writes financial or shared data. */
export function useOnboarding(uid: string | null) {
  const scope = scopeOf(uid);
  const [state, setState] = useState(() => ({ scope, open: shouldOpen(scope) }));
  if (state.scope !== scope) setState({ scope, open: shouldOpen(scope) });

  const finish = (outcome: OnboardingOutcome): boolean => {
    let persisted = true;
    try { sessionStorage.setItem(PREFIX + scope, 'seen'); } catch { /* In-memory dismissal still works. */ }
    if (outcome !== 'skip') {
      try { localStorage.setItem(PREFIX + scope, 'done'); } catch { persisted = false; }
    }
    setState({ scope, open: false });
    return persisted;
  };

  return {
    open: state.scope === scope && state.open,
    reopen: () => setState({ scope, open: true }),
    finish,
  };
}
