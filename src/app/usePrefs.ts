import { useCallback, useEffect, useState } from 'react';
import type { Prefs } from '../domain/types';

const PREF_KEY = 'dada.pref.v2';

const DEFAULTS: Prefs = {
  theme: 'system',
  lens: 'all',
  view: 'calendar',
  weekStart: 'mon',
  pinCollapsed: {},
  debtsCollapsed: false,
  todayCollapsed: false,
  todayMoneyCollapsed: false,
};

function read(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULTS, ...parsed, pinCollapsed: { ...(parsed.pinCollapsed ?? {}) } };
  } catch {
    return DEFAULTS;
  }
}

/** 기기별 UI 설정. 사용자 데이터가 아니므로 Firestore 로 올리지 않는다. */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(read);

  const set = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* 저장소 접근 불가 */ }
  }, [prefs]);

  // 'system' 이면 data-theme 을 지워 prefers-color-scheme 이 결정하게 둔다.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = prefs.theme;
  }, [prefs.theme]);

  return { prefs, set };
}
