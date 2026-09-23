import { useCallback, useEffect, useState } from 'react';
import type { Prefs } from '../domain/types';

const PREF_KEY = 'dada.pref.v2';

const DEFAULTS: Prefs = {
  theme: 'system',
  fontScale: 'auto',
  /*
    처음 여는 사람에게는 내 공간이 기본이다. 공유는 보드가 있어야 열리고, 그 전에는
    만들기 자리(👥+)만 보인다.
  */
  space: 'me',
  lens: 'all',
  sharedTab: 'calendar',
  view: 'calendar',
  /*
    공유 일정은 리스트가 기본이다. 둘이 보는 목록은 "지금 뭐가 남았나" 가 먼저이고,
    달력은 날짜가 붙은 항목을 볼 때 켠다. 개인 화면은 그대로 달력이 기본이다 —
    한쪽을 바꿨다고 다른 쪽까지 바뀌면 고친 적 없는 화면이 바뀐 것으로 보인다.
  */
  sharedView: 'list',
  weekStart: 'mon',
  pinCollapsed: {},
  debtsCollapsed: false,
  budgetsCollapsed: false,
  todayCollapsed: true,
  todayMoneyCollapsed: false,
  moneyCardCollapsed: false,
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

  // 테마와 같은 규칙. 'auto' 면 속성을 지워 html 의 font-size 를 브라우저에 맡긴다.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.fontScale === 'auto') delete root.dataset.fontScale;
    else root.dataset.fontScale = prefs.fontScale;
  }, [prefs.fontScale]);

  return { prefs, set };
}
