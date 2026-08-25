/**
 * 잔고캘린더 (/tide).
 *
 * tide-over 저장소의 앱을 화면째로 옮겨 왔다. 이전 이식판은 계산(lib/calc.ts)만
 * 가져오고 화면은 캘린더X 토큰으로 새로 그렸는데, 그래서 '달력' 탭에 달력이
 * 없었다 — 월 그리드도, 날짜별 한도도, 기간 예산 띠도 원본에만 있었다.
 * 지금은 컴포넌트 · lib · styles.css 를 전부 원본 그대로 쓴다.
 *
 * 캘린더X 와는 코드도 데이터도 나누지 않는다. 이 화면은 자기 lib/ 와
 * styles.css 만 보고, 계정도 서버도 쓰지 않는다.
 */
import { useEffect, useState } from 'react';
import { CalendarScreen } from './components/CalendarScreen';
import { Onboarding } from './components/Onboarding';
import { RestoreDialog } from './components/RestoreDialog';
import { SettingsScreen } from './components/SettingsScreen';
import { todayISO } from './lib/date';
import { useStore } from './store';

type Tab = 'calendar' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'calendar', label: '달력' },
  { id: 'settings', label: '설정' },
];

export function TideApp() {
  const store = useStore();
  const [tab, setTab] = useState<Tab>('calendar');
  const today = useToday();

  if (!store.ready) return <div className="boot" aria-busy="true" />;

  const { state } = store;

  return (
    <div className="app">
      <header className="app__header">
        <h1>잔고캘린더</h1>
        {state && (
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`tab ${tab === t.id ? 'is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      {store.loadIssue && (
        <p className="banner banner--warn" role="alert">
          {store.loadIssue}
        </p>
      )}
      {!store.canStore && (
        <p className="banner banner--warn" role="alert">
          이 브라우저에서는 저장이 되지 않습니다(시크릿 모드일 수 있습니다). 창을 닫으면 입력한
          내용이 사라집니다.
        </p>
      )}

      <main>
        {state === null ? (
          <Onboarding
            wasWiped={store.wasWiped}
            onStart={store.setState}
            onRestoreLink={store.offerRestore}
          />
        ) : tab === 'calendar' ? (
          <CalendarScreen state={state} today={today} onSave={store.setState} />
        ) : (
          <SettingsScreen
            state={state}
            persistence={store.persistence}
            canStore={store.canStore}
            backupTakenAt={store.backupTakenAt}
            onBackupTaken={store.noteBackupTaken}
            onRestoreLink={store.offerRestore}
            onReset={store.reset}
            onToast={store.showToast}
          />
        )}
      </main>

      {store.pendingRestore && (
        <RestoreDialog
          incoming={store.pendingRestore.state}
          exportedAt={store.pendingRestore.exportedAt}
          current={state}
          onConfirm={store.confirmRestore}
          onCancel={store.cancelRestore}
        />
      )}

      {store.toast && (
        <div className="toast" role="status" onClick={store.dismissToast}>
          {store.toast}
        </div>
      )}

      <footer className="app-footer">
        {/* 원본에 없던 유일한 추가. 한 방향 링크일 뿐 데이터는 오가지 않는다. */}
        <a className="ghost-btn" href="/">캘린더X 로</a>
        <span>만든사람 DADA</span>
        <a
          className="icon-btn"
          href={CREATOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="만든 사람 포트폴리오"
        >
          <HomeIcon />
        </a>
      </footer>
    </div>
  );
}

const CREATOR_URL = 'https://dada-town.com/';

/** 집 글리프. 외부 리소스를 쓰지 않으려고 인라인 SVG로 그린다. */
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 11.5 12 4l8 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 오늘이 바뀌면 화면도 바뀌어야 한다 — 이 앱의 경계는 전부 오늘 기준이라
 * 자정을 넘긴 탭을 그대로 두면 어제의 한도를 보여주게 된다.
 */
function useToday(): string {
  const [today, setToday] = useState(() => todayISO());

  useEffect(() => {
    let timer = 0;

    const check = () => {
      setToday((prev) => {
        const now = todayISO();
        return now === prev ? prev : now;
      });
      schedule();
    };

    const schedule = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      window.clearTimeout(timer);
      // 브라우저 타이머는 백그라운드에서 밀리므로 1초 여유를 둔다.
      timer = window.setTimeout(check, midnight.getTime() - now.getTime() + 1000);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return today;
}
