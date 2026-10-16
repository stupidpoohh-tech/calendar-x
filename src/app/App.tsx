import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  backupFilename, buildBackup, countBackup, downloadJSON, type BackupData,
} from '../data/backup';
import { describeFileProblem, readBackupFile } from '../data/backupFile';
import {
  describeFirestoreError, isPermissionDenied, RULES_CONSOLE_PATH, RULES_DEPLOY_COMMAND,
} from '../data/errors';
import { getFirebase } from '../data/firebase';
import { LEDGER_BATCH_MAX, ledgerBatchSize } from '../data/pendingWrites';
import { planFromFiles, readImportFiles, writeLedgerImport, type ImportIO } from '../data/ledgerImportRun';
import { convertLegacyItems, readLegacyItems, summarize } from '../data/migrate';
import {
  createManyIfAbsent, fetchAll, fetchConfirmationsOf, fetchEntry, fetchLedgerFromServer, fetchLedgerSettings, fetchPocketEntries, markMigrated,
  subscribeActualEntries,
  readMigrationMark, writeMany,
} from '../data/repo';
import {
  MERGE_SKIPS_RECOVERY, mergeSkipsLedger, recoveryDiffers, REPLACE_DISABLED_REASON, safeMerge, type RestoreIO,
} from '../data/restore';
import { LENSES, LENS_BY_ID, SHARED_TABS } from '../domain/constants';
import { calendarAmountCaption, lensVisible } from '../domain/layout';
import { endOfMonth, fmtMonthTitle, startOfMonth, toISO } from '../domain/date';
import { convertKind, displayTitle, effectiveEndDate, newEntry, newMoney, uid as newId, withDerived } from '../domain/entry';
import {
  INVITE_PARAM, isShareableTask, newNote, repinNotes, sharedChange, sharedTitle,
} from '../domain/shared';
import { formatAmount } from '../domain/money';
import { applyFilters, collectTags, emptyFilters, hasActiveFilter } from '../domain/filters';
import { baseIdOf, isVirtualEntry, materialize, occurrenceDateOf } from '../domain/recurrence';
import { defaultCategories } from '../domain/category';
import {
  confirmBlockOf, confirmationOf, confirmationsOfPlan, lostConfirmations, planScheduleChanged, reflectedAfterRename, repairLink,
} from '../domain/confirm';
import { applyReflectChoice, isActual, reflectChoiceFor } from '../domain/ledger';
import {
  movedToPocket, pocketPeriodImpact, reserveLinkedEntries, reservePatchOf, reservePatchSummary, unlinkedFromPocket,
  unlinkedFromReserve,
} from '../domain/budget';
import { daySummary } from '../domain/daySummary';
import { balanceViewOn, calcScopeOf } from '../domain/tide';
import { ymOf } from '../domain/date';
import { isRecoveryEntry } from '../domain/recovery';
import type {
  AnnualBudget, Account, Budget, Card, Category, CategoryBudget, Entry, Filters, LedgerNote, LedgerTabId, LensId, Reserve, SharedInvite, SharedNote, SharedTodoItem,
  TaskStatus, ViewId, YearMonth,
} from '../domain/types';
import { ConfirmSheet } from '../ui/ConfirmSheet';
import { LedgerScreen, type SubscribeAll } from '../ui/LedgerScreen';
import { PocketSheet } from '../ui/PocketSheet';
import { CardLine, CardSheet } from '../ui/CardSheet';
import { linkPlannedToCard, type CycleState } from '../domain/card';
import { LoanCategorySheet } from '../ui/LoanCategorySheet';
import { PastPlanSheet } from '../ui/PastPlanSheet';
import type { PocketFocus } from '../ui/BudgetPanel';
import { LedgerImportPreview, LedgerImportProblems } from '../ui/LedgerImport';
import { monthsOfPeriods, periodByKey, periodOf, periodsBetween, periodsOfYear, shiftPeriodKey } from '../domain/period';
import { combineFeeds, FEED_DEMO } from './useStore';
import { useLedgerFeed } from './useLedgerFeed';
import { Auth } from '../ui/Auth';
import { Onboarding } from '../ui/Onboarding';
import { useOnboarding } from './useOnboarding';
import { BrandFooter } from '../ui/BrandFooter';
import { DaySheet } from '../ui/DaySheet';
import { calcStateOf, type CalcState } from '../ui/calcState';
import { TideBar } from '../ui/TideBar';
import { EntryModal, type SaveOptions } from '../ui/EntryModal';
import { FilterPanel } from '../ui/FilterPanel';
import { Icon } from '../ui/Icon';
import { ListView } from '../ui/ListView';
import { MonthCalendar } from '../ui/MonthCalendar';
import { MonthPicker } from '../ui/MonthPicker';
import { MoneyPanel } from '../ui/MoneyPanel';
import { FailedWrites } from '../ui/FailedWrites';
import { PinnedSection } from '../ui/PinnedSection';
import { RecoveryDebtBar } from '../ui/RecoveryDebtBar';
import { RecoverySheet } from '../ui/RecoverySheet';
import { SpaceSwitch } from '../ui/SpaceSwitch';
import { SharedScreen } from '../ui/SharedScreen';
import { SharedJoinSheet, SharedSettingsSheet, SharedStartSheet } from '../ui/SharedInvite';
import { SettingsSheet } from '../ui/SettingsSheet';
import { TodayPanel } from '../ui/TodayPanel';
import { useDialog } from '../ui/Dialog';
import { useAuth } from './useAuth';
import { usePrefs } from './usePrefs';
import { useDemoStore } from './useDemoStore';
import { useLayout } from './useLayout';
import { useRecovery } from './useRecovery';
import { useSharedBoard } from './useSharedBoard';
import { useWriteQueue } from './useWriteQueue';
import { useStore } from './useStore';
import { useToday } from './useToday';

export function App() {
  const { state, logout } = useAuth();

  if (state.status === 'loading') return <div className="splash">캘린더X</div>;

  if (state.status === 'error') {
    return (
      <div className="fatal">
        <Icon.Alert size={24} />
        <h1>앱을 시작할 수 없습니다</h1>
        <pre>{state.message}</pre>
      </div>
    );
  }

  // 로그인 여부와 무관하게 홈 화면을 보여 준다. 로그아웃 상태는 데모 데이터로
  // 채워지고, 저장·편집 시도가 나오는 순간 로그인 팝업이 뜬다.
  const signedIn = state.status === 'signed-in';
  return (
    <Workspace
      uid={signedIn ? state.user.uid : null}
      user={signedIn ? state.user : null}
      onSignOut={logout}
    />
  );
}

interface WorkspaceProps {
  uid: string | null;
  user: import('firebase/auth').User | null;
  onSignOut: () => void | Promise<void>;
}

/** 매 렌더 새 배열을 만들면 달력이 헛돈다. */
const EMPTY_MONTHS: YearMonth[] = [];

function Workspace({ uid, user, onSignOut }: WorkspaceProps) {
  const onboarding = useOnboarding(uid);
  const dialog = useDialog();
  const { prefs, set } = usePrefs();
  const [cursor, setCursor] = useState(() => new Date());
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [daySheet, setDaySheet] = useState<string | null>(null);
  // 지난 예정 정리 창 — 설정 > 데이터에서만 연다.
  const [pastPlanOpen, setPastPlanOpen] = useState(false);
  const [loanCatOpen, setLoanCatOpen] = useState(false);
  // 생활비 · 세이브 창. 카드의 확보 줄 · 달력의 생활비 막대 · '+ 생활비' 가 모두 이 하나를 연다.
  const [pocketFocus, setPocketFocus] = useState<PocketFocus | null>(null);
  // 카드대금 창(P4). 현금흐름 카드 안의 '카드대금' 줄에서 연다.
  const [cardSheetOpen, setCardSheetOpen] = useState(false);
  const [modal, setModal] = useState<{
    open: boolean; mode: 'create' | 'edit'; entry: Entry | null;
    /** 반복 발생분을 눌렀으면 그 회차 날짜. 편집은 원본을 향하지만 확정은 이 회차를 향한다. */
    occurrence?: string | null;
  }>({ open: false, mode: 'create', entry: null });
  /** 실제 거래로 확정할 예정 회차. 편집 창을 닫고 이것을 연다 — 창을 겹쳐 띄우지 않는다. */
  const [confirming, setConfirming] = useState<{ plan: Entry; date: string } | null>(null);
  const [legacy, setLegacy] = useState<{ count: number; migratedAt: string | null } | null>(null);
  /** 회복 상세를 띄운 항목의 id. 항목 자체가 아니라 id 를 들고 있어야 스냅샷을 따라간다. */
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  /*
    같이 보기.

    ── 렌즈가 아니라 **공간**이다 ───────────────────────────────

    렌즈 칸을 하나 더 만들면 축이 다섯 개라는 뜻이 되고, 실제로는 같은 축을 거르는 것이
    아니라 **다른 자료를 보는 다른 화면**이다. 그래서 렌즈보다 한 층 위에 두고
    👤 / 👥 두 그림으로 오간다 (`SpaceSwitch`).

    보드가 없으면 공유 공간은 열리지 않는다 — 빈 공간을 미리 만들어 보여 주지 않고,
    👥+ 가 만들기·초대 흐름으로 간다. 보드가 사라진 뒤(나가기 · 삭제)에도 같은 규칙이라
    아래 `space` 가 내 공간으로 물러난다.
  */
  const setSharedOpen = useCallback(
    (open: boolean) => set('space', open ? 'shared' : 'me'),
    [set],
  );
  /** 사용자가 가려는 공간. 보드가 실제로 있는지는 아래에서 본다. */
  const wantsShared = prefs.space === 'shared';
  const [sharedSheet, setSharedSheet] = useState<'start' | 'settings' | null>(null);
  const [invite, setInvite] = useState<SharedInvite | null>(null);
  const [invitesReady, setInvitesReady] = useState(false);
  /** `?join=` 로 들어온 초대. 코드는 주소에서 한 번만 읽고 그 뒤에는 상태가 든다. */
  const [join, setJoin] = useState<
    { code: string; state: 'loading' | 'ready' | 'not-found' | 'joining'; invite: SharedInvite | null } | null
  >(null);

  // 자정을 넘기거나 백그라운드에서 돌아오면 다시 잰다. 이 값이 계산 창·한도·정산 기준을 정한다.
  const today = useToday();
  /*
    서버 쓰기. 거절당하면 적은 값을 붙잡아 계정별 목록에 남긴다 —
    Firestore 는 거절된 쓰기를 로컬 캐시에서도 되돌린다 (`useWriteQueue` 참고).
  */
  const writes = useWriteQueue(uid);
  const commit = writes.commit;
  /*
    내 캘린더 구성(`users/{uid}.layout`). 보이는가만 정한다 — 숨겨도 자료 · 계산 · 권한은 그대로다.
    로그아웃 데모는 늘 전부 보인다(`LEGACY_LAYOUT`).
  */
  const layoutApi = useLayout({ uid, commit });
  const layout = layoutApi.layout;
  const setLayout = layoutApi.set;
  const cursorISO = toISO(cursor);
  const isAnon = uid === null;
  // 훅은 조건부 호출이 안 된다. 둘 다 부르고 로그인 상태에 따라 결과를 고른다.
  const liveStore = useStore(uid, cursorISO, today);
  const demoStore = useDemoStore();
  const store = isAnon ? demoStore : liveStore;
  const { db } = getFirebase();

  /*
    회복. 예정일이 코앞에 오면 항목 한 건이 생기고, 그 밖의 시간에는 아무것도 없다.
    렌즈를 하나 더 만들지 않는다 — 회복 항목은 kind 가 'task' 라 기존 캘린더·리스트·
    오늘 카드에 그대로 얹힌다.
  */
  const recovery = useRecovery({
    uid,
    todayISO: today,
    onError: (message) => dialog.toast(message, 'bad'),
    commit,
  });

  /*
    Recovery 일시중지. 오늘 · 앞날에 잡힌 회차가 풀릴 때만 묻는다 — 풀 것이 없으면 확인창 없이
    멈춘다(토글마다 확인을 받지 않는다). 기록과 빚은 그대로다(`pauseRecovery`).
  */
  const pauseRecovery = useCallback(async () => {
    if (recovery.pauseReleases) {
      const ok = await dialog.confirm({
        title: 'Recovery를 일시중지할까요?',
        body: 'Recovery를 일시중지하면 예정된 회복 일정이 해제됩니다. 기존 기록과 회복 부채는 유지됩니다.',
        confirmLabel: '일시중지',
      });
      if (!ok) return;
    }
    recovery.pause();
    dialog.toast('Recovery를 일시중지했습니다.');
  }, [recovery, dialog]);

  /*
    같이 보기. 보드 문서만 늘 구독하고, 항목·고정메모·D-Day 는 화면이 열려 있을 때만
    받는다 (`open`). 이 훅이 들고 있는 보드가 "TODO 저장을 공유에도 보낼지" 를 정한다.
  */
  const accountName = user?.displayName || user?.email || '';
  const shared = useSharedBoard({
    uid,
    todayISO: today,
    accountName,
    // 스위처를 숨기면 공유 화면도 열지 않는다 — 보드 문서 구독(저장을 공유에도 보낼지)은 그대로다.
    open: wantsShared && layout.sharedSwitcher,
    onError: (message) => dialog.toast(message, 'bad'),
    commit,
  });

  /*
    공유 공간은 보드가 있을 때만 열린다.

    보드 구독이 아직 안 왔으면(`ready === false`) "없음" 을 확정할 수 없으므로 물러나지
    않는다 — 그때 되돌리면 새로고침마다 공유에 있던 사람이 내 공간으로 튕긴다.
  */
  const sharedOpen = wantsShared && layout.sharedSwitcher && !!uid && !!shared.board;

  /*
    보드가 사라졌으면(나가기 · 삭제 · 계정 변경) 기억해 둔 공간도 되돌린다. 남겨 두면
    다음 접속 때마다 열리지 않는 공간을 향한다.
  */
  useEffect(() => {
    if (wantsShared && shared.ready && !shared.board) set('space', 'me');
  }, [wantsShared, shared.ready, shared.board, set]);

  /*
    스위처를 숨겼으면 내 공간으로 돌아간다. 연결 · 자료 · 권한은 그대로이고, 다시 표시하면
    👥 로 돌아갈 수 있다. 구독이 확인한 구성에서만 기억을 고친다 — 기기에 남긴 옛 값으로
    공간 기억을 지우지 않는다(그 사이 화면은 위 `sharedOpen` 이 이미 내 공간을 그린다).
  */
  useEffect(() => {
    if (wantsShared && layoutApi.ready && !layout.sharedSwitcher) set('space', 'me');
  }, [wantsShared, layoutApi.ready, layout.sharedSwitcher, set]);

  // 저장·편집 시도 시 로그인 유도 팝업. 사용자가 실제 앱을 만져 보다가
  // 남기려는 순간에만 계정이 필요하다는 것을 자연스럽게 전달한다.
  const [showAuth, setShowAuth] = useState(false);
  const promptLogin = useCallback(async () => {
    const ok = await dialog.confirm({
      title: '계정을 만들어 저장하세요',
      body: '지금 보이는 것은 미리보기 데이터입니다. 계정을 만들면 이 화면 그대로 시작해 이어서 쓸 수 있습니다.',
      confirmLabel: '로그인 · 가입',
      cancelLabel: '계속 둘러보기',
    });
    if (ok) setShowAuth(true);
    return ok;
  }, [dialog]);

  /*
    숨긴 렌즈(가계부 · 노트)를 기억하고 있으면 캘린더로 연다 — 직접 · 낡은 링크도 같다. 기억 자체는
    구독이 확인한 구성으로만 고친다(아래 effect). 다시 표시하면 그 렌즈 탭이 그대로 돌아온다.
  */
  const lens: LensId = lensVisible(prefs.lens, layout) ? prefs.lens : 'task';
  useEffect(() => {
    if (layoutApi.ready && !lensVisible(prefs.lens, layout)) set('lens', 'task');
  }, [layoutApi.ready, prefs.lens, layout, set]);
  const view = prefs.view;
  const rangeFrom = toISO(startOfMonth(cursor));
  const rangeTo = toISO(endOfMonth(cursor));

  /*
    ── 화면용과 계산용은 다른 목록이다 ──────────────────────────────

    materialized  보고 있는 구간으로 펼친 **화면용** 발생분. 저장하지 않는다.
    visible       거기에 렌즈·필터를 건 것. 역시 화면용이다.
    store.tideEntries  금액 계산용 **원본**. 반복을 펼치지 않았고, 커서가 아니라
                  오늘을 기준으로 받는다.

    계산에 materialized 를 넘기면 tide 가 발생분을 다시 반복 전개해 같은 입출금을
    여러 번 센다 (주간 반복 1만원 한 달치가 −4만이 아니라 −14만이 된다).
    tide 쪽이 `virtual` 표식을 보고 거절하므로 이 규칙을 어기면 테스트가 깨진다.
  */
  const materialized = useMemo(
    () => materialize(store.entries, rangeFrom, rangeTo),
    [store.entries, rangeFrom, rangeTo],
  );

  /*
    가계부를 숨기면 전체 렌즈에서도 가계부 항목을 그리지 않는다. 화면용 목록만 거르므로 한도 ·
    정산(계산용 원본)은 그대로다.
  */
  const shownEntries = useMemo(
    () => (layout.ledger ? materialized : materialized.filter((e) => e.kind !== 'money')),
    [materialized, layout.ledger],
  );
  const visible = useMemo(
    () => applyFilters(shownEntries, lens, filters, today),
    [shownEntries, lens, filters, today],
  );

  const allTags = useMemo(() => collectTags(store.entries), [store.entries]);
  const linkableTasks = useMemo(
    () => store.entries.filter((e) => e.kind === 'task' && !e.isRecurring).slice(0, 100),
    [store.entries],
  );

  const hasBalance = store.accounts.length > 0;
  /** 계산 목록이 덮는 가장 이른 날. 정산이 "자료가 모자라다" 를 판정하는 기준이다. */
  const tideFrom = store.tideMonths[0] ? `${store.tideMonths[0]}-01` : null;
  /*
    계산용 자료가 손에 들어왔는가. 화면용(`loading`)과 따로 본다.

    `store.calc` 는 세 구독(계산용 월 항목 · 반복 항목 · 잔고)을 종합한 값이다. 그것을
    `ready` 하나로 눌러 담지 않는다 — 캐시에서 온 값과 서버가 확인한 값은 다르고,
    캐시가 비어 있는 것은 자료 없음이 아니다. `calcStateOf` 가 네 갈래로 나눈다.
  */
  const calcState: CalcState = calcStateOf(store.calc);

  /*
    ── 초대 링크로 들어온 경우 ────────────────────────────────────

    주소에서 코드를 **한 번만** 읽고 바로 지운다. 남겨 두면 새로고침마다 수락 창이 다시
    뜨고, 그 주소를 누군가에게 보낼 때 초대 코드가 함께 나간다.
  */
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get(INVITE_PARAM);
    if (!code) return;
    setJoin({ code, state: 'loading', invite: null });
    const url = new URL(window.location.href);
    url.searchParams.delete(INVITE_PARAM);
    window.history.replaceState(null, '', url.toString());
  }, []);

  /*
    같이 보기 API 는 자료가 바뀔 때마다 새 객체가 된다. effect 의 의존성에 넣으면 조회가
    헛돌므로 ref 로 받는다 — 아래 effect 들은 "언제 물어볼지" 만 판정한다.
  */
  const sharedRef = useRef(shared);
  sharedRef.current = shared;

  // 초대장은 로그인해야 읽을 수 있다. 로그아웃 상태면 먼저 로그인 창을 띄운다.
  useEffect(() => {
    if (!join || join.state !== 'loading') return;
    if (isAnon) { setShowAuth(true); return; }
    let alive = true;
    const code = join.code;
    void sharedRef.current.peek(code).then((found) => {
      if (!alive) return;
      setJoin((j) => (j && j.code === code
        ? { ...j, state: found ? 'ready' : 'not-found', invite: found }
        : j));
    });
    return () => { alive = false; };
  }, [join, isAnon]);

  /*
    초대 링크는 문서 id 가 코드라, 목록 조회 없이는 되찾을 수 없다. 설정 창을 열 때
    한 번 읽어 온다 — 아직 못 읽은 동안 "링크 없음" 으로 보이지 않게 준비 상태를 따로 둔다.
  */
  useEffect(() => {
    if (sharedSheet !== 'settings') return;
    setInvitesReady(false);
    let alive = true;
    void sharedRef.current.listInvites().then((list) => {
      if (!alive) return;
      setInvite(list[0] ?? null);
      setInvitesReady(true);
    });
    return () => { alive = false; };
  }, [sharedSheet]);

  const acceptJoin = useCallback(async () => {
    if (!join) return;
    const code = join.code;
    setJoin((j) => (j ? { ...j, state: 'joining' } : j));
    const result = await shared.accept(code);
    if (result === 'ok') {
      setJoin(null);
      // 같이 보기를 고른 순간이므로 숨겨 둔 공간 전환을 다시 띄운다 — 안 그러면 들어갈 길이 없다.
      if (!layout.sharedSwitcher) setLayout({ sharedSwitcher: true });
      setSharedOpen(true);
      dialog.toast('초대를 수락했습니다. 같이 보기가 열렸습니다.');
      return;
    }
    // 실패해도 창을 닫지 않는다 — 무엇이 막혔는지 읽고 다시 시도할 수 있어야 한다.
    setJoin((j) => (j ? { ...j, state: result === 'not-found' ? 'not-found' : 'ready' } : j));
  }, [join, shared, dialog, setSharedOpen, layout.sharedSwitcher, setLayout]);

  const startShare = useCallback((name: string) => {
    const created = shared.createBoard(name);
    if (!created) return;
    // 링크를 바로 보여 준다. 만들고 나서 어디서 찾는지 헤매지 않도록.
    setInvite(created);
    setInvitesReady(true);
    setSharedSheet('settings');
    if (!layout.sharedSwitcher) setLayout({ sharedSwitcher: true });
    setSharedOpen(true);
  }, [shared, setSharedOpen, layout.sharedSwitcher, setLayout]);

  // 이관 전 컬렉션이 남아 있는지, 이미 옮겼는지 한 번만 확인한다.
  const checkedLegacy = useRef(false);
  useEffect(() => {
    if (checkedLegacy.current || isAnon || !uid) return;
    checkedLegacy.current = true;
    Promise.all([readLegacyItems(db, uid), readMigrationMark(db, uid)])
      .then(([items, migratedAt]) => setLegacy({ count: items.length, migratedAt }))
      .catch(() => setLegacy(null));
  }, [db, uid, isAnon]);

  // ---------- 액션 ----------

  const openCreate = useCallback((patch: Partial<Entry> = {}) => {
    if (isAnon) { void promptLogin(); return; }
    const kind = LENS_BY_ID[lens]?.kind ?? 'task';
    const startDate = patch.startDate ?? cursorISOForCreate(today, cursor);
    /*
      가계부는 날짜로 시작 상태를 정한다. 오늘까지는 이미 일어난 돈(실제 거래)이고, 앞날은
      예정이다. 편집 창 맨 위에서 언제든 바꿀 수 있고, 고른 쪽이 늘 보인다.
    */
    const entry = newEntry(kind, { startDate, ...patch });
    if (entry.money && !patch.money) {
      entry.money = { ...entry.money, status: startDate <= today ? 'actual' : 'planned' };
    }
    setModal({ open: true, mode: 'create', entry: withDerived(entry) });
  }, [lens, today, cursor, isAnon, promptLogin]);

  /** 원본 찾기. 화면용 목록에 없으면(창 밖의 달) 계산용 목록에서 찾는다. */
  const findBase = useCallback((id: string): Entry | undefined => {
    const base = baseIdOf(id);
    return store.entries.find((x) => x.id === base) ?? store.tideEntries.find((x) => x.id === base);
  }, [store.entries, store.tideEntries]);

  const openEdit = useCallback((e: Entry) => {
    // 반복 전개분을 눌러도 편집은 항상 원본을 향한다.
    const base = findBase(e.id) ?? e;
    // 회복은 저장·삭제가 아니라 완료·옮기기·건너뛰기가 기본 행동이라 전용 상세로 보낸다.
    if (isRecoveryEntry(base)) { setRecoveryId(base.id); return; }
    setModal({ open: true, mode: 'edit', entry: base, occurrence: occurrenceDateOf(e.id) ?? base.startDate });
  }, [findBase]);

  const closeModal = useCallback(() => setModal((m) => ({ ...m, open: false })), []);

  /**
   * 항목 저장 + 같이 보기 갱신.
   *
   * 공유 갱신은 **따로 한 건 더** 보낸다. 한 배치로 묶으면 공유 쪽이 규칙에 걸리는 순간
   * 개인 TODO 저장까지 함께 실패한다 — 공유 기능 때문에 기존 CRUD 가 멈추는 것은 어떤
   * 정합성보다 나쁘다. 실패한 공유 갱신은 다른 쓰기와 같은 목록에 남고, 남은 차이는
   * 같이 보기 화면을 열 때 맞추기가 메운다.
   *
   * 공유 대상이 아닌 항목은 공유에서 **지운다.** 할 일을 아이디어 · 가계부로 옮겼거나,
   * 비공개로 표시했으면 상대 화면에 남을 이유가 없다. 보드가 없으면 두 호출 모두
   * 아무것도 하지 않는다.
   *
   * **올라간 적 없는 것은 지우지 않는다** (`sharedChange`). 무엇을 보낼지는 저장 전
   * 값과 함께 봐야 정해진다 — 그 판정은 도메인에 있다.
   */
  const persist = useCallback((e: Entry, accounts: readonly Account[] = []) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    /*
      계좌의 반영 목록이 함께 바뀌면 한 배치로 보낸다. 거래만 들어가고 목록이 실패하면(또는
      그 반대) 같은 돈이 한도에서 두 번 빠지거나 한 번도 안 빠진다. 배치는 오프라인 큐에서도
      한 덩어리로 나가고, 거절되면 통째로 "저장하지 못한 것" 에 남아 다시 보낼 수 있다.
    */
    if (accounts.length > 0) {
      commit({
        kind: 'ledgerBatch', label: '거래 · 잔고 반영', summary: displayTitle(e),
        payload: { entries: [e], deleteIds: [], accounts: [...accounts] },
      });
    } else {
      commit({ kind: 'entry', label: '항목', summary: displayTitle(e), payload: e });
    }
    // 저장 전 값. 새 항목이면 없고, 없으면 보드에도 없다.
    const before = store.entries.find((x) => x.id === baseIdOf(e.id)) ?? null;
    const change = sharedChange(before, e, today);
    if (change === 'push') shared.pushEntry(e);
    else if (change === 'remove') shared.removeEntry(e.id);
  }, [uid, isAnon, promptLogin, commit, shared, today, store.entries]);

  /**
   * 예정의 날짜 · 반복을 고치면 확정해 둔 실제 거래가 없는 회차를 가리키게 된다.
   * 저장 **전에** 서버에서 그 예정의 확정 거래를 모두 찾아(화면 구독은 보고 있는 달 근처뿐이다)
   * 연결을 잃는 것을 보여 주고, 다시 이을지 끊을지 고르게 한다. 예정 · 확정 거래 · 계좌 반영
   * 목록은 한 배치로 나간다 — 예정만 들어가면 같은 돈이 두 번 세어진다.
   *
   * true 면 저장했다(또는 고칠 연결이 없었다). false 면 사용자가 취소했다 — 편집 창을 닫지 않는다.
   */
  const saveWithLinks = useCallback(async (after: Entry): Promise<boolean> => {
    if (isAnon || !uid) { void promptLogin(); return false; }
    let found: Entry[] = [];
    let complete = true;
    try {
      const r = await fetchConfirmationsOf(db, uid, after.id);
      found = r.entries;
      complete = r.complete;
    } catch {
      complete = false;
    }
    // 이 기기에서 방금 적어 아직 서버에 닿지 않은 확정도 함께 본다.
    const known = new Map<string, Entry>();
    for (const x of [...found, ...confirmationsOfPlan([...store.entries, ...store.tideEntries], after.id)]) known.set(x.id, x);
    const lost = lostConfirmations(after, [...known.values()]);
    if (lost.length === 0) {
      persist(after);
      return true;
    }

    const n = (v: number) => v.toLocaleString('ko-KR');
    const day = (d: string) => d.slice(5).replace('-', '.');
    const relinkable = lost.filter((l) => l.candidate).length;
    const choice = await dialog.choose(`확정한 거래 ${n(lost.length)}건이 예정과의 연결을 잃습니다`, [
      ...(relinkable > 0 ? [{
        id: 'relink' as const,
        label: relinkable === lost.length ? '새 회차에 다시 잇고 저장' : `${n(relinkable)}건은 새 회차에 다시 잇고, 나머지는 끊고 저장`,
        hint: '이은 회차는 예정에서 빠져 두 번 세지 않습니다. 실제 날짜 · 금액 · 분류는 그대로입니다.',
      }] : []),
      {
        id: 'unlink' as const,
        label: '연결을 끊고 저장',
        hint: '실제 거래는 그대로 남습니다. 새 회차는 확정 전 예정으로 다시 계산됩니다.',
      },
    ], (
      <>
        <p>예정의 날짜나 반복을 바꾸면, 이미 확정한 회차가 새 규칙에 없게 됩니다. 그대로 두면 실제 거래와 새 회차의 예정이 함께 계산됩니다.</p>
        <ul className="dlg-skips">
          {lost.slice(0, 8).map((l) => (
            <li key={l.actual.id}>
              <span className="num">{day(l.from)} 회차 · {formatAmount(l.actual.money!.amountMinor)}</span> {l.actual.title.trim() || '(제목 없음)'}
              {' → '}{l.candidate ? <b>{day(l.candidate)} 회차에 이을 수 있음</b> : '이을 새 회차 없음 (끊습니다)'}
            </li>
          ))}
          {lost.length > 8 && <li>그 외 {n(lost.length - 8)}건</li>}
        </ul>
        {!complete && (
          <p className="dlg-warn">서버에 닿지 못해 이 기기에 있는 확정만 확인했습니다. 다른 기기에서 확정한 회차가 더 있을 수 있습니다.</p>
        )}
      </>
    ));
    if (!choice) return false;

    const repairs = lost.map((l) => repairLink(l, choice === 'relink' && l.candidate ? 'relink' : 'unlink', after.id, newId));
    const renamed = new Map(repairs.map((r) => [r.removeId, r.entry.id] as const));
    const payload = {
      entries: [after, ...repairs.map((r) => r.entry)],
      deleteIds: repairs.map((r) => r.removeId),
      accounts: reflectedAfterRename(store.accounts, renamed),
    };
    if (ledgerBatchSize(payload) > LEDGER_BATCH_MAX) {
      dialog.toast(`한 번에 고칠 거래가 너무 많습니다(${n(ledgerBatchSize(payload))}건). 반복을 나눠 고쳐 주세요.`, 'bad');
      return false;
    }
    commit({ kind: 'ledgerBatch', label: '예정 · 확정 거래', summary: `${displayTitle(after)} · 확정 ${n(lost.length)}건`, payload });
    return true;
  }, [isAnon, uid, promptLogin, db, store.entries, store.tideEntries, store.accounts, persist, dialog, commit]);

  /** "이 잔고에 이미 반영됨" 을 고른 대로 바뀌는 계좌. 손대지 않았거나 고를 일이 없으면 빈 목록. */
  const reflectChanges = useCallback((e: Entry, reflected: boolean | undefined): Account[] => {
    if (reflected === undefined) return [];
    const choice = reflectChoiceFor(e, store.accounts);
    if (choice.kind !== 'ok') return [];
    return applyReflectChoice(store.accounts, e.id, choice.account.id, reflected);
  }, [store.accounts]);

  const handleSave = useCallback(async (e: Entry, opts?: SaveOptions) => {
    const before = findBase(e.id);
    if (before && planScheduleChanged(before, e)) {
      if (await saveWithLinks(e)) closeModal();
      return;
    }
    persist(e, reflectChanges(e, opts?.reflected));
    closeModal();
  }, [findBase, saveWithLinks, persist, closeModal, reflectChanges]);

  /**
   * 실제 거래를 지운다. 계좌의 반영 목록에 그 id 가 남아 있으면 함께 뺀다 — 확정 거래 · 이관
   * 거래는 id 가 정해져 있어, 같은 회차를 다시 확정하거나 같은 파일을 다시 가져오면 같은 id 가
   * 옛 목록에 걸려 고르지도 않았는데 "반영됨" 이 된다.
   */
  const deleteActual = useCallback((id: string, label: string, summary: string) => {
    const accounts = store.accounts
      .filter((a) => (a.reflectedEntryIds ?? []).includes(id))
      .map((a) => ({ ...a, reflectedEntryIds: (a.reflectedEntryIds ?? []).filter((x) => x !== id), updatedAt: new Date().toISOString() }));
    if (accounts.length > 0) {
      commit({ kind: 'ledgerBatch', label, summary, payload: { entries: [], deleteIds: [id], accounts } });
    } else {
      commit({ kind: 'entryDelete', label, summary, payload: { id } });
    }
  }, [store.accounts, commit]);

  /**
   * 예정 회차를 확정하러 간다. 이미 확정된 회차면 새로 만들지 않고 그 실제 거래를 연다 —
   * 같은 회차는 같은 문서라 덮어쓰기는 되지만, 고친 실제 금액을 예정 값으로 되돌리게 된다.
   */
  const startConfirm = useCallback((plan: Entry, date: string) => {
    closeModal();
    const existing = confirmationOf([...store.entries, ...store.tideEntries], plan.id, date);
    if (existing) {
      dialog.toast('이미 확정한 회차입니다. 그 실제 거래를 엽니다.');
      setModal({ open: true, mode: 'edit', entry: existing, occurrence: null });
      return;
    }
    setConfirming({ plan, date });
  }, [closeModal, store.entries, store.tideEntries, dialog]);

  /** 확정 취소 = 실제 거래 삭제. 예정 원본은 처음부터 그대로라 그 회차가 다시 보인다. */
  const unconfirm = useCallback(async (actual: Entry) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const ok = await dialog.confirm({
      title: '확정을 취소할까요?',
      body: '이 실제 거래를 지우고 예정 회차를 되살립니다. 여기서 고친 실제 금액 · 날짜 · 카테고리는 함께 사라집니다.',
      confirmLabel: '확정 취소',
      danger: true,
    });
    if (!ok) return;
    closeModal();
    deleteActual(actual.id, '확정 취소', displayTitle(actual));
    dialog.toast('확정을 취소했습니다. 예정이 다시 보입니다.');
  }, [isAnon, uid, promptLogin, dialog, closeModal, deleteActual]);

  /**
   * 기본 카테고리 만들기. id 가 정해져 있어 두 기기에서 동시에 눌러도 같은 문서로 모인다.
   * 이미 있는 것은 다시 쓰지 않는다 — 고쳐 둔 이름 · 보관 상태를 덮지 않는다.
   */
  const seedCategories = useCallback(() => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const have = new Set(store.categories.map((c) => c.id));
    const items = defaultCategories().filter((c) => !have.has(c.id));
    if (items.length === 0) return;
    commit({ kind: 'categories', label: '카테고리', summary: `기본 카테고리 ${items.length}개`, payload: { items } });
    dialog.toast('기본 카테고리를 만들었습니다. 설정에서 이름을 바꾸거나 보관할 수 있습니다.');
  }, [isAnon, uid, promptLogin, store.categories, commit, dialog]);

  const saveCategory = useCallback((c: Category) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    commit({ kind: 'category', label: '카테고리', summary: c.name, payload: c });
  }, [isAnon, uid, promptLogin, commit]);

  /** 순서 바꾸기처럼 여럿이 한꺼번에 바뀌는 것. 한 배치로 쓴다 — 반쯤 옮겨진 순서가 남지 않게. */
  const saveCategories = useCallback((list: Category[]) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    if (list.length === 0) return;
    commit({ kind: 'categories', label: '카테고리 순서', summary: `${list.length}개`, payload: { items: list } });
  }, [isAnon, uid, promptLogin, commit]);

  const saveSettleDay = useCallback((day: number) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    commit({ kind: 'ledgerSettings', label: '정산 시작일', summary: `매월 ${day}일`, payload: { settleDay: day } });
  }, [isAnon, uid, promptLogin, commit]);

  const saveCategoryBudget = useCallback((b: CategoryBudget) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    commit({ kind: 'categoryBudget', label: '카테고리 예산', summary: b.period, payload: b });
  }, [isAnon, uid, promptLogin, commit]);

  /*
    연간 카테고리 예산(P2). 한 해 한 카테고리 한 장이라 문서 전체를 쓴다. 지우기는 그 해를 월간으로 되돌리는 것이고
    월간 예산 문서는 건드리지 않는다. 다른 저장과 같은 쓰기 큐 — 거절되면 '저장하지 못한 것' 에 남는다.
  */
  const saveAnnualBudget = useCallback((b: AnnualBudget) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    commit({ kind: 'annualBudget', label: '연간 예산', summary: `${b.year}년`, payload: b });
  }, [isAnon, uid, promptLogin, commit]);
  const deleteAnnualBudget = useCallback((b: AnnualBudget) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    commit({ kind: 'annualBudgetDelete', label: '연간 예산 지우기', summary: `${b.year}년`, payload: { id: b.id } });
  }, [isAnon, uid, promptLogin, commit]);

  /*
    '달력에 표시' — 그 날 셀에 띄울 주요 거래를 직접 고른다. 하루에 한 건만 뜨므로, 켤 때는
    같은 날 켜 둔 다른 거래를 함께 끈다. 여러 문서가 함께 바뀌어야 뜻이 맞는 쓰기라 한 배치다.
  */
  const toggleHighlight = useCallback((e: Entry) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const base = store.entries.find((x) => x.id === e.id);
    if (!base?.money || !isActual(base)) return;
    const on = base.money.highlight !== true;
    const now = new Date().toISOString();
    const others = on
      ? store.entries.filter((x) => x.id !== base.id && isActual(x) && x.startDate === base.startDate && x.money?.highlight === true)
      : [];
    const changed = [base, ...others].map((x) => ({
      ...x, updatedAt: now, money: { ...x.money!, highlight: x.id === base.id ? on : false },
    }));
    commit({
      kind: 'ledgerBatch', label: on ? '달력에 표시' : '달력 표시 해제', summary: displayTitle(base),
      payload: { entries: changed, deleteIds: [], accounts: [] },
    });
  }, [isAnon, uid, promptLogin, store.entries, commit]);

  const saveLedgerNote = useCallback((n: LedgerNote) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    commit({ kind: 'ledgerNote', label: '기간 메모', summary: n.period, payload: n });
  }, [isAnon, uid, promptLogin, commit]);

  /** 생활비에 연결되지 않은 실제 지출을 그 주머니에 건다. 사용처는 하나만 — 대출 연결은 푼다. */
  /*
    사용처를 정하지 않은 실제 지출을 주머니에 건다. 여러 건이면 **한 배치** — 반쯤 걸리면 남은
    생활비가 화면의 미리보기와 다르다. 금액 · 날짜 · 분류는 건드리지 않고 사용처만 바꾼다.
  */
  const linkToPocket = useCallback((es: Entry[], b: Budget) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const now = new Date().toISOString();
    const changed = es
      .map((e) => findBase(e.id) ?? e)
      .filter((x) => x.money)
      .map((x) => withDerived({ ...x, updatedAt: now, money: { ...x.money!, budgetId: b.id, outsidePocket: false, debtId: null } }));
    if (changed.length === 0) return;
    if (changed.length === 1) persist(changed[0]!);
    else commit({ kind: 'ledgerBatch', label: '생활비 연결', summary: `${b.name} · ${changed.length}건`, payload: { entries: changed, deleteIds: [], accounts: [] } });
    dialog.toast(`'${b.name}'에 ${changed.length}건 연결했습니다.`);
  }, [isAnon, uid, promptLogin, findBase, persist, commit, dialog]);

  /** "생활비 외" 로 명시한다 — 미결정 목록에서 빠지고, 다음에도 자동 선택이 덮지 않는다. */
  const markOutsidePocket = useCallback((e: Entry) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const base = findBase(e.id) ?? e;
    if (!base.money) return;
    persist(withDerived({ ...base, updatedAt: new Date().toISOString(), money: { ...base.money, budgetId: null, outsidePocket: true } }));
  }, [isAnon, uid, promptLogin, findBase, persist]);

  /**
   * 그 주머니를 가리키는 거래 — 서버 전량에 이 기기에서 방금 적은 것을 겹친다.
   * 서버에 닿지 못하면 complete: false — 화면이 그 사실을 함께 적는다.
   */
  const pocketLinks = useCallback(async (budgetId: string): Promise<{ entries: Entry[]; complete: boolean }> => {
    const known = new Map<string, Entry>();
    let complete = true;
    if (uid) {
      try {
        const r = await fetchPocketEntries(db, uid, budgetId);
        for (const e of r.entries) known.set(e.id, e);
        complete = r.complete;
      } catch {
        complete = false;
      }
    }
    for (const e of [...store.entries, ...store.tideEntries]) {
      if (isVirtualEntry(e)) continue;
      if (e.money?.budgetId === budgetId) known.set(e.id, e);
      else if (known.has(e.id)) known.delete(e.id); // 이 기기에서 방금 연결을 바꿨다
    }
    return { entries: [...known.values()], complete };
  }, [uid, db, store.entries, store.tideEntries]);

  /**
   * 생활비 저장 (P1-E). 금액만 바꾸면 그대로 쓰고 계산이 다시 돈다. 기간을 바꿔 걸린 거래가
   * 기간 밖으로 나가면 저장 전에 묻는다 — 유지 · 해제 · 옮기기. 주머니와 거래는 한 배치로 쓴다.
   */
  const saveBudget = useCallback(async (b: Budget) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const before = store.budgets.find((x) => x.id === b.id);
    if (!before || (before.startDate === b.startDate && before.endDate === b.endDate)) {
      commit({ kind: 'budget', label: '생활비', summary: b.name, payload: b });
      return;
    }
    const { entries: linked, complete } = await pocketLinks(b.id);
    const after = store.budgets.map((x) => (x.id === b.id ? b : x));
    const impact = pocketPeriodImpact(before, b, linked, after);
    const n = (v: number) => v.toLocaleString('ko-KR');
    const sum = (es: Entry[]) => es.reduce((t, e) => t + (e.money?.amountMinor ?? 0), 0);
    const incomplete = !complete && (
      <p className="dlg-warn">서버에 닿지 못해 이 기기에 있는 거래만 확인했습니다. 다른 기기에서 연결한 거래가 더 있을 수 있습니다.</p>
    );
    if (impact.leaving.length === 0) {
      if (impact.entering.length > 0 || !complete) {
        const ok = await dialog.confirm({
          title: '생활비 기간을 바꿀까요?',
          body: (
            <>
              {impact.entering.length > 0 && (
                <p>연결해 둔 거래 {n(impact.entering.length)}건({formatAmount(sum(impact.entering))})이 새 기간에 들어와 이 생활비에서 다시 셉니다.</p>
              )}
              {incomplete}
            </>
          ),
          confirmLabel: '저장',
        });
        if (!ok) return;
      }
      commit({ kind: 'budget', label: '생활비', summary: b.name, payload: b });
      return;
    }

    const day = (d: string) => d.slice(5).replace('-', '.');
    const target = impact.targets ? store.budgets.find((x) => x.id === [...impact.targets!.values()][0]) : undefined;
    const oneTarget = impact.targets && new Set(impact.targets.values()).size === 1 ? target : undefined;
    const choice = await dialog.choose(`연결된 거래 ${n(impact.leaving.length)}건이 새 기간 밖으로 나갑니다`, [
      {
        id: 'keep' as const,
        label: '연결 유지하고 저장',
        hint: '연결은 남지만 기간 밖이라 이 생활비에서 세지 않고 일반 지출로 셉니다. 기간을 다시 늘리면 돌아옵니다.',
      },
      {
        id: 'unlink' as const,
        label: '연결 해제하고 저장',
        hint: '사용처를 정하지 않은 지출로 돌아갑니다. 다른 생활비 기간에 들면 그쪽 확인 목록에 뜹니다.',
      },
      ...(impact.targets ? [{
        id: 'move' as const,
        label: oneTarget ? `'${oneTarget.name}'(으)로 옮기고 저장` : '그 날의 다른 생활비로 옮기고 저장',
        hint: '거래마다 그 날짜를 품는 다른 생활비가 하나뿐이라 옮길 곳이 정해져 있습니다.',
      }] : []),
    ], (
      <>
        <p>기간 밖 거래는 어느 쪽을 골라도 지워지지 않고, 금액은 일반 지출로든 다른 생활비로든 한 번만 셉니다.</p>
        <ul className="dlg-skips">
          {impact.leaving.slice(0, 8).map((e) => (
            <li key={e.id}><span className="num">{day(e.startDate)} · {formatAmount(e.money!.amountMinor)}</span> {e.title.trim() || '(제목 없음)'}{isActual(e) ? '' : ' (예정)'}</li>
          ))}
          {impact.leaving.length > 8 && <li>그 외 {n(impact.leaving.length - 8)}건</li>}
        </ul>
        <p className="num">합계 {formatAmount(sum(impact.leaving))}</p>
        {impact.entering.length > 0 && (
          <p>새 기간에 다시 들어오는 연결 거래 {n(impact.entering.length)}건({formatAmount(sum(impact.entering))})은 이 생활비에서 셉니다.</p>
        )}
        {!impact.targets && (
          <p>그 날짜를 품는 다른 생활비가 없거나 여럿인 거래가 있어 옮기기는 고를 수 없습니다.</p>
        )}
        {incomplete}
      </>
    ));
    if (!choice) return;
    if (choice === 'keep') {
      commit({ kind: 'budget', label: '생활비', summary: b.name, payload: b });
      return;
    }
    const now = new Date().toISOString();
    const changed = impact.leaving.map((e) => withDerived(choice === 'move' && impact.targets
      ? movedToPocket(e, impact.targets.get(e.id)!, now)
      : unlinkedFromPocket(e, now)));
    const payload = { entries: changed, deleteIds: [], accounts: [], budgets: [b] };
    if (ledgerBatchSize(payload) > LEDGER_BATCH_MAX) {
      dialog.toast(`한 번에 고칠 거래가 너무 많습니다(${n(changed.length)}건). 기간을 나눠 고쳐 주세요.`, 'bad');
      return;
    }
    commit({
      kind: 'ledgerBatch', label: '생활비 기간',
      summary: `${b.name} · ${choice === 'move' ? '옮김' : '연결 해제'} ${n(changed.length)}건`, payload,
    });
  }, [isAnon, uid, promptLogin, store.budgets, pocketLinks, commit, dialog]);

  /**
   * 생활비 삭제 (P1-E). 거래는 지우지 않는다. 걸린 거래의 연결을 같은 배치에서 풀어 사용처
   * 미결정으로 돌린다 — 없는 주머니를 가리키는 연결을 남기지 않는다.
   */
  const deleteBudget = useCallback(async (b: Budget) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const { entries: linked, complete } = await pocketLinks(b.id);
    const n = (v: number) => v.toLocaleString('ko-KR');
    const sum = linked.reduce((t, e) => t + (e.money?.amountMinor ?? 0), 0);
    const ok = await dialog.confirm({
      title: `'${b.name}'을(를) 삭제할까요?`,
      body: (
        <>
          {linked.length > 0
            ? <p>연결된 거래 {n(linked.length)}건({formatAmount(sum)})은 지워지지 않습니다. 연결만 풀려 사용처를 정하지 않은 지출로 돌아가고, 일반 지출로 셉니다.</p>
            : <p>이 생활비에 연결된 거래는 없습니다.</p>}
          {!complete && (
            <p className="dlg-warn">서버에 닿지 못해 이 기기에 있는 거래만 확인했습니다. 다른 기기에서 연결한 거래는 연결이 남지만 일반 지출로 셉니다.</p>
          )}
        </>
      ),
      danger: true, confirmLabel: '삭제',
    });
    if (!ok) return;
    const now = new Date().toISOString();
    const payload = {
      entries: linked.map((e) => withDerived(unlinkedFromPocket(e, now))),
      deleteIds: [], accounts: [], deleteBudgetIds: [b.id],
    };
    if (linked.length === 0 || ledgerBatchSize(payload) > LEDGER_BATCH_MAX) {
      // 거래가 너무 많으면 주머니만 지운다. 남은 연결은 없는 주머니를 가리켜 일반 지출로 센다.
      commit({ kind: 'budgetDelete', label: '생활비 삭제', summary: b.name, payload: { id: b.id } });
      return;
    }
    commit({ kind: 'ledgerBatch', label: '생활비 삭제', summary: `${b.name} · 연결 해제 ${n(linked.length)}건`, payload });
  }, [isAnon, uid, promptLogin, pocketLinks, dialog, commit]);

  /**
   * 세이브 삭제 (P3). 연결된 거래가 있으면 보관을 먼저 권한다 — 보관하면 연결과 사용 기록이 그대로 남는다.
   * 그래도 지우면 걸린 거래의 연결을 같은 배치에서 푼다. 거래는 지우지 않고 금액 · 날짜도 그대로다.
   * 연결된 거래는 날짜와 무관하게 전량 구독한 목록(`reserveLinked`)에서 센다.
   */
  const deleteReserve = useCallback(async (r: Reserve) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const linked = reserveLinkedEntries(r.id, store.reserveLinked);
    if (linked.length === 0) {
      const ok = await dialog.confirm({ title: `'${r.name}'을(를) 삭제할까요?`, danger: true, confirmLabel: '삭제' });
      if (ok) commit({ kind: 'reserveDelete', label: '세이브 삭제', summary: r.name, payload: { id: r.id } });
      return;
    }
    const n = (v: number) => v.toLocaleString('ko-KR');
    const sum = linked.reduce((t, e) => t + Math.abs(e.money?.amountMinor ?? 0), 0);
    const choice = await dialog.choose(`'${r.name}'에 연결된 거래가 ${n(linked.length)}건 있습니다`, [
      { id: 'archive', label: '보관하기', hint: '연결과 사용 기록이 그대로 남습니다. 보관을 풀면 다시 보입니다.' },
      { id: 'delete', label: '삭제하고 연결 풀기', hint: `거래 ${n(linked.length)}건(${formatAmount(sum)})은 지워지지 않고, 이 세이브와의 연결만 풀립니다.`, danger: true },
    ], <p>보관하면 가용 한도에서 빠지지 않습니다. 거래는 어느 쪽이든 원장에 그대로 남고 잔고 · 예상 잔고는 바뀌지 않습니다.</p>);
    const now = new Date().toISOString();
    if (choice === 'archive') {
      const patch = reservePatchOf(r, { ...r, archivedAt: now, updatedAt: now });
      if (patch) {
        commit({
          kind: 'reservePatch', label: '세이브', summary: `${r.name} — ${reservePatchSummary(patch)}`,
          payload: { id: r.id, patch, updatedAt: now },
        });
      }
      return;
    }
    if (choice !== 'delete') return;
    const payload = {
      entries: linked.map((e) => withDerived(unlinkedFromReserve(e, now))),
      deleteIds: [], accounts: [], deleteReserveIds: [r.id],
    };
    if (ledgerBatchSize(payload) > LEDGER_BATCH_MAX) {
      dialog.toast(`연결된 거래가 너무 많아(${n(linked.length)}건) 한 번에 풀 수 없습니다. 보관을 써 주세요.`, 'bad');
      return;
    }
    commit({ kind: 'ledgerBatch', label: '세이브 삭제', summary: `${r.name} · 연결 해제 ${n(linked.length)}건`, payload });
  }, [isAnon, uid, promptLogin, store.reserveLinked, dialog, commit]);

  /** 카드 저장(P4). 문서 전체를 쓴다. */
  const saveCard = useCallback((c: Card) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    commit({ kind: 'card', label: '카드', summary: c.name, payload: c });
  }, [isAnon, uid, promptLogin, commit]);

  /**
   * 카드 삭제(P4). 연결된 거래가 있으면 지우지 않고 보관을 권한다 — 카드를 지우면 그 거래들의 회차를 셀 수 없어
   * 미결제가 말없이 사라지고 한도가 부푼다. 보관은 고르는 자리에서만 빼고 미결제 계산은 그대로다.
   */
  const deleteCard = useCallback(async (c: Card) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const linked = store.cardLinked.filter((e) => e.money?.cardId === c.id);
    if (linked.length === 0) {
      const ok = await dialog.confirm({ title: `'${c.name}'을(를) 삭제할까요?`, danger: true, confirmLabel: '삭제' });
      if (ok) commit({ kind: 'cardDelete', label: '카드 삭제', summary: c.name, payload: { id: c.id } });
      return;
    }
    const ok = await dialog.confirm({
      title: `'${c.name}'에 연결된 거래가 ${linked.length.toLocaleString('ko-KR')}건 있습니다`,
      body: <p>지우면 그 거래들의 미결제를 셀 수 없게 됩니다. 대신 보관하면 고르는 자리에서만 빠지고, 남은 미결제는 그대로 가용 한도에서 빠집니다.</p>,
      confirmLabel: '보관',
    });
    if (ok) commit({ kind: 'card', label: '카드 보관', summary: c.name, payload: { ...c, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  }, [isAnon, uid, promptLogin, store.cardLinked, dialog, commit]);

  /**
   * 카드에 연결되지 않은 예정 카드대금을 사용자가 고른 카드에 잇는다(P4 마감). 확인창이 무엇이 바뀌는지 먼저 말한다 —
   * 흐름과 카드만 바뀌고 금액 · 날짜 · 반복은 그대로다. 자동으로 부르는 길은 없다.
   */
  const linkPlannedCard = useCallback(async (e: Entry, c: Card) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const ok = await dialog.confirm({
      title: `'${e.title.trim() || '예정'}'을(를) ${c.name} 대금으로 이을까요?`,
      body: <p>금액 · 날짜 · 반복은 그대로이고, 이 예정이 그 카드의 회차 대금이 됩니다. 그 회차의 미결제와 한 번만 셉니다.{e.money?.budgetId ? ' 생활비 연결은 풀립니다(대금은 생활비에서 나가지 않습니다).' : ''}</p>,
      confirmLabel: '잇기',
    });
    if (ok) commit({ kind: 'entry', label: '카드 대금 연결', summary: e.title, payload: withDerived(linkPlannedToCard(e, c.id)) });
  }, [isAnon, uid, promptLogin, dialog, commit]);

  /** 대금을 거래 창으로 적는다(P4). 금액은 그 회차의 남은 금액, 계좌는 카드의 결제 계좌. 창에서 고친다. */
  const openCardPayment = useCallback((c: Card, cycle: CycleState, planned: boolean) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const date = planned && cycle.payDate > today ? cycle.payDate : today;
    const entry = newEntry('money', {
      title: `${c.name} 대금`, startDate: date,
      money: newMoney({
        status: planned ? 'planned' : 'actual', type: 'expense', flow: 'cardPayment',
        cardId: c.id, cardCycle: cycle.key, amountMinor: cycle.remainingMinor, accountId: c.accountId,
      }),
    });
    setCardSheetOpen(false);
    setModal({ open: true, mode: 'create', entry: withDerived(entry) });
  }, [isAnon, uid, promptLogin, today]);

  /*
    ── 가계부 상세(내역 · 예산 · 월별 · 통계) ──────────────────────────

    고른 기간과 연도가 걸친 달만 구독한다. 가계부 렌즈가 열려 있을 때만 붙는다 — 다른
    렌즈를 보는 동안 지난 해의 거래를 읽어 들일 이유가 없다.
  */
  const settleDay = store.ledger.settleDay;
  const currentPeriod = periodOf(today, settleDay).key;
  const [ledgerPeriodPick, setLedgerPeriod] = useState<string | null>(null);
  const ledgerPeriod = ledgerPeriodPick ?? currentPeriod;
  const ledgerMonths = useMemo(() => {
    const ps = [
      ...periodsBetween(shiftPeriodKey(ledgerPeriod, -11), ledgerPeriod, settleDay),
      ...periodsOfYear(Number(ledgerPeriod.slice(0, 4)), settleDay),
    ];
    const p = periodByKey(ledgerPeriod, settleDay);
    // 연간 예산(P2)은 달력 연도로 센다 — 정산 연도의 달과 대개 겹치지만, 경계가 달라도 빠지지 않게 열두 달을 함께 받는다.
    const year = ledgerPeriod.slice(0, 4);
    const calendar = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    return [...new Set([...monthsOfPeriods(p ? [...ps, p] : ps), ...calendar])].sort();
  }, [ledgerPeriod, settleDay]);
  const ledgerOn = lens === 'money' && !sharedOpen;
  // 필터는 달력 · 리스트에 그리는 항목을 거른다. 가계부에서는 그 달력이 있는 현금흐름에서만 뜻이 있다.
  // 마지막 보기는 세션 동안만 기억한다. 앱을 새로 열면 현금흐름부터 — 가계부의 기본 화면이다.
  const [ledgerTab, setLedgerTab] = useState<LedgerTabId>('cashflow');
  const filterUsable = !ledgerOn || ledgerTab === 'cashflow';
  const ledgerRange = useLedgerFeed(uid, ledgerMonths, ledgerOn && !isAnon);
  const ledgerEntries = useMemo(() => {
    if (isAnon) return store.entries;
    // 반복 원본은 첫 달 조회에만 걸린다. 계산용 목록이 전량 들고 있으니 거기서 더한다.
    const byId = new Map<string, Entry>();
    for (const e of ledgerRange.items) byId.set(e.id, e);
    for (const e of store.tideEntries) if (e.isRecurring) byId.set(e.id, e);
    return [...byId.values()];
  }, [isAnon, store.entries, store.tideEntries, ledgerRange.items]);
  const ledgerFeed = useMemo(
    () => (isAnon ? FEED_DEMO : combineFeeds([ledgerRange.feed, store.ledgerMeta])),
    [isAnon, ledgerRange.feed, store.ledgerMeta],
  );
  /**
   * 내역에서 누른 항목. 화면용 · 계산용 목록에 없는 지난 해 항목이면 결산 목록에서 원본을
   * 찾는다. 원본을 못 찾으면 열지 않는다 — 펼친 발생분(`원본id@날짜`)을 편집해 저장하면
   * 그 id 로 새 문서가 생긴다.
   */
  const openLedgerEntry = useCallback(async (e: Entry) => {
    /*
      원본 찾기 순서: 화면 · 계산 목록 → 결산 목록 → (펼친 발생분이 아니면) 받은 항목 그 자체
      → 서버에서 한 건. 전체 검색 결과는 구독 창 밖의 지난 거래라 앞의 둘에 없다 — 예전에는
      거기서 멈춰 열리지 않았다. 펼친 발생분(`원본id@날짜`)은 그대로 열지 않는다. 그 id 로
      저장하면 새 문서가 생긴다.
    */
    let base = findBase(e.id) ?? ledgerEntries.find((x) => x.id === baseIdOf(e.id))
      ?? (isVirtualEntry(e) || e.id !== baseIdOf(e.id) ? undefined : e);
    if (!base && !isAnon && uid) {
      try { base = (await fetchEntry(db, uid, baseIdOf(e.id))) ?? undefined; } catch { /* 아래에서 알린다 */ }
    }
    if (!base) { dialog.toast('이 항목의 원본을 찾지 못했습니다. 연결을 확인한 뒤 다시 눌러 주세요.', 'bad'); return; }
    if (isRecoveryEntry(base)) { setRecoveryId(base.id); return; }
    setModal({ open: true, mode: 'edit', entry: base, occurrence: occurrenceDateOf(e.id) ?? base.startDate });
  }, [findBase, ledgerEntries, dialog, isAnon, uid, db]);

  /** 전체 검색. 켜 둔 동안 실제 거래를 구독해, 결과에서 고치거나 지운 것이 곧바로 반영된다. */
  const subscribeAllActuals = useCallback<SubscribeAll>((cb, onError) => {
    if (isAnon || !uid) { cb(store.entries.filter(isActual)); return () => undefined; }
    return subscribeActualEntries(db, uid, (items) => cb(items), () => onError());
  }, [isAnon, uid, db, store.entries]);

  /** 카테고리가 "없음" 을 확정할 수 있는가. 캐시가 비어 있으면 아직 모른다. */
  const categoriesReady = store.ledgerMeta.ready
    && !(store.ledgerMeta.fromCache && store.categories.length === 0);

  /**
   * 내가 올린 항목을 보드에서 내린다.
   *
   * 감추기로는 모자란 자리가 있다. 상대에게 보이기 싫은 항목이 이미 올라가 있다면
   * 필요한 것은 내 화면에서 접는 것이 아니라 **상대 화면에서 없애는 것**이다.
   *
   * 공유 항목만 지우면 다음 맞추기가 같은 것을 다시 올린다. 그래서 원본에 '나만 보기'
   * (`keepPrivate`)를 켜는 쓰기를 함께 보낸다 — 그 표식이 맞추기와 저장 양쪽에서
   * 공유 대상을 가르는 값이다. 두 건을 한 배치로 묶지 않는 이유는 평소 저장과 같다.
   *
   * 원본 전체가 아니라 표식 한 칸만 쓴다. 이 화면은 원본을 들고 있지 않고, 창 밖의
   * 달에 있는 항목이면 메모리에도 없다.
   */
  const unshareItem = useCallback(async (item: SharedTodoItem) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const entryId = item.sourceEntryId;
    if (!entryId) return;
    const ok = await dialog.confirm({
      title: '이 항목을 공유에서 내릴까요?',
      body: '상대 화면에서 사라집니다. 내 캘린더에는 그대로 남고, 여기서 고쳐 둔 내용은 함께 지워집니다.'
        + ' 다시 올리려면 내 캘린더에서 이 항목의 \'나만 보기\' 를 끄면 됩니다.',
      confirmLabel: '내리기',
      danger: true,
    });
    if (!ok) return;
    commit({
      kind: 'entryPrivate', label: '나만 보기',
      summary: sharedTitle(item), payload: { id: entryId, keepPrivate: true },
    });
    shared.removeEntry(entryId);
    dialog.toast('공유에서 내렸습니다.');
  }, [uid, isAnon, promptLogin, dialog, commit, shared]);

  /**
   * 고정을 옮긴다. **살아 있는 고정은 하나다.**
   *
   * 앞의 고정이 함께 풀리므로 쓰기가 둘일 수 있다. `repinNotes` 가 바뀐 글만 돌려주고,
   * 여기서는 그만큼만 저장한다 — 안 바뀐 글까지 다시 쓰면 상대의 편집을 덮는다.
   */
  const pinNote = useCallback((n: SharedNote, pinned: boolean) => {
    for (const next of repinNotes(shared.notes, n.id, pinned)) shared.saveNote(next);
  }, [shared]);

  /**
   * 예전 고정메모를 메모 글로 옮긴다.
   *
   * 조용히 옮기지 않는다 — 사용자가 적은 글이 본인도 모르게 다른 자리로 가면 안 된다.
   * 누른 뒤에야 글이 만들어지고, 그때 옛 자리를 비운다.
   */
  const adoptLegacyMemo = useCallback(() => {
    if (!uid) return;
    const text = shared.memoText.trim();
    if (!text) return;
    const note = { ...newNote(newId(), uid, '', text), pinned: true };
    shared.saveNote(note);
    // 옛 자리를 비운다. 두 곳에 같은 글이 남으면 어느 것이 진짜인지 알 수 없다.
    shared.saveMemo('');
    dialog.toast('메모로 옮겼습니다.');
  }, [uid, shared, dialog]);

  /** 목록을 지우면 그 안의 항목도 함께 사라진다. 그 사실을 먼저 말한다. */
  const deleteCollection = useCallback(async (c: { id: string; title: string }) => {
    const n = shared.collectionItems.filter((i) => i.collectionId === c.id).length;
    const ok = await dialog.confirm({
      title: `'${c.title || '이름 없음'}' 목록을 지울까요?`,
      body: n > 0
        ? `안에 있는 ${n.toLocaleString('ko-KR')}개 항목도 함께 사라집니다. 되돌릴 수 없습니다.`
        : '되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    const target = shared.collections.find((x) => x.id === c.id);
    if (target) shared.removeCollection(target);
  }, [shared, dialog]);

  const deleteNote = useCallback(async (n: SharedNote) => {
    const ok = await dialog.confirm({
      title: '이 메모를 지울까요?',
      body: '되돌릴 수 없습니다. 상대 화면에서도 사라집니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (ok) shared.removeNote(n);
  }, [shared, dialog]);

  /** 잔고 저장. 전체 렌즈(오늘 카드)와 가계부 렌즈(며칠 버티나 카드)가 같이 쓴다. */
  const saveBalance = useCallback((a: Account) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    commit({
      kind: 'account', label: '잔고',
      summary: `${a.name} ${formatAmount(a.balanceMinor, a.currency)}`,
      payload: a,
    });
  }, [uid, isAnon, promptLogin, commit]);

  const handleDelete = useCallback(async (e: Entry) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    // 회복을 지우면 빚이 증발한다. 삭제 대신 건너뛰기로 보낸다 — 지나간 회복은 세어야 한다.
    if (isRecoveryEntry(e)) {
      const skip = await dialog.confirm({
        title: '이 회복을 건너뛸까요?',
        body: '밀린 회복 1회로 셉니다. 다른 날로 옮기면 밀린 것으로 세지 않습니다.',
        confirmLabel: '건너뛰기',
        cancelLabel: '그만두기',
        danger: true,
      });
      if (!skip) return;
      closeModal();
      setRecoveryId(null);
      recovery.skip(e);
      dialog.toast('건너뛰었습니다. 밀린 회복이 하나 늘었습니다.');
      return;
    }
    /*
      같이 보기에서도 사라진다는 것을 먼저 말한다.

      원본이 사라진 자리에 공유 항목을 남기면 뜻이 없는 줄이 상대 화면에 남는다 —
      유령 항목을 만들지 않는 쪽을 골랐다. 공유 화면에서 고쳐 둔 값이 있었다면 그것도
      함께 사라지므로, 그 사실을 삭제 전에 알린다.
    */
    const sharedNote = shared.board && isShareableTask(e, today)
      ? ' 같이 보기에서도 사라집니다 — 거기서 고쳐 둔 내용이 있으면 함께 지워집니다.'
      : '';
    const confirmedFrom = isActual(e) ? e.money?.plannedRef : null;
    const ok = await dialog.confirm({
      title: '이 항목을 삭제할까요?',
      body: (e.isRecurring
        ? '반복 항목입니다. 이 날짜 하나가 아니라 앞으로의 회차까지 모든 발생분이 함께 사라집니다 — 한 회차만 지우는 기능은 없습니다. 이미 실제 거래로 확정한 회차는 그대로 남습니다.'
        : confirmedFrom
          ? '예정 회차를 확정한 실제 거래입니다. 지우면 그 예정 회차가 다시 보입니다.'
          : '되돌릴 수 없습니다.') + sharedNote,
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    closeModal();
    /*
      삭제도 다른 쓰기와 같은 길로 보낸다.

      예전에는 여기서 `await deleteEntry` 를 했다. 오프라인에서는 그 promise 가 영영
      resolve 하지 않아 아무 반응도 없었고, 서버가 거절하면 토스트 한 줄로 끝나 무엇을
      지우려 했는지가 사라졌다. 지금은 실패하면 "저장하지 못한 것" 목록에 남는다.

      아래 토스트는 **이 기기에 반영됐다**는 뜻이다. 서버 확정은 다른 사건이라,
      거절당하면 그 목록이 뜬다.
    */
    if (isActual(e)) deleteActual(baseIdOf(e.id), '항목 삭제', displayTitle(e));
    else {
      commit({
        kind: 'entryDelete', label: '항목 삭제',
        summary: displayTitle(e), payload: { id: baseIdOf(e.id) },
      });
    }
    // 올라간 적 없는 항목은 지울 것도 없다 — 보내 봐야 규칙이 거절한다.
    if (isShareableTask(e, today)) shared.removeEntry(baseIdOf(e.id));
    dialog.toast('삭제했습니다.');
  }, [uid, isAnon, promptLogin, dialog, closeModal, recovery, commit, shared, today, deleteActual]);

  const handleStatus = useCallback((e: Entry, status: TaskStatus) => {
    const base = store.entries.find((x) => x.id === baseIdOf(e.id)) ?? e;
    if (!base.task) return;
    /*
      오늘 카드의 체크박스는 회복을 완료하는 가장 짧은 길이다. 여기서 상태만 바꾸면
      항목은 완료로 보이는데 다음 예정일과 빚은 그대로 남아, 규칙이 조용히 멈춘다.
    */
    if (isRecoveryEntry(base) && status === 'done') {
      recovery.complete(base, today);
      dialog.toast('회복을 완료했습니다. 잘못 눌렀으면 체크를 다시 풀면 됩니다.');
      return;
    }
    /*
      체크를 푸는 길도 같다. 완료가 빚과 예정일까지 옮겼으므로, 상태만 되돌리면 규칙은
      앞서 나간 채로 남는다 — 잘못 누른 사람이 되돌릴 방법이 없어진다.

      다음 회차가 이미 만들어졌으면 되돌리지 않는다. 그때 되돌리면 같은 규칙이 회차 둘을
      동시에 가리키므로, 조용히 지나가지 않고 왜 안 되는지 말한다.
    */
    if (isRecoveryEntry(base) && base.task.status === 'done') {
      if (!recovery.canUndo(base)) {
        dialog.toast('다음 회복이 이미 잡혀 있어 되돌릴 수 없습니다.', 'bad');
        return;
      }
      recovery.undoComplete(base);
      dialog.toast('완료를 되돌렸습니다.');
      return;
    }
    persist(withDerived({ ...base, task: { ...base.task, status } }));
  }, [store.entries, persist, recovery, today, dialog]);

  /** 아이디어를 할 일로 승격. 축 간 이동이 필드 하나 변경으로 끝난다. */
  const handlePromote = useCallback((e: Entry) => {
    const base = store.entries.find((x) => x.id === baseIdOf(e.id)) ?? e;
    persist(convertKind(base, 'task'));
    dialog.toast('할 일로 옮겼습니다.');
  }, [store.entries, persist, dialog]);

  /**
   * 정렬 순서 저장. (F-02)
   * 이전에는 로컬 상태만 바꿔서 다음 스냅샷이 오면 원위치했다.
   */
  const handleReorder = useCallback((dragId: string, overId: string, position: 'before' | 'after') => {
    if (isAnon || !uid) { void promptLogin(); return; }
    const tasks = materialized
      .filter((e) => e.kind === 'task')
      .sort((a, b) => (a.task?.order ?? 0) - (b.task?.order ?? 0));
    const from = tasks.findIndex((e) => e.id === dragId);
    const to = tasks.findIndex((e) => e.id === overId);
    if (from < 0 || to < 0) return;

    const next = [...tasks];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    const insertAt = position === 'before'
      ? to - (from < to ? 1 : 0)
      : to + (from < to ? 0 : 1);
    next.splice(Math.max(0, insertAt), 0, moved);

    commit({
      kind: 'taskOrder', label: '순서',
      summary: `할 일 ${next.length.toLocaleString('ko-KR')}건의 순서`,
      payload: { ordered: next.map((e, i) => ({ id: baseIdOf(e.id), order: i })) },
    });
  }, [materialized, uid, isAnon, promptLogin, commit]);

  // ---------- 백업 / 복원 / 이관 ----------

  const handleExport = useCallback(async (): Promise<boolean> => {
    if (isAnon || !uid) { void promptLogin(); return false; }
    try {
      const [all, ledger] = await Promise.all([fetchAll(db, uid), fetchLedgerSettings(db, uid)]);
      // 회복 규칙 · 정산 시작일은 users/{uid} 문서에 있어 fetchAll 이 보지 않는다.
      // 회복 규칙은 구독으로 이미 들고 있으니 그대로 실어 보낸다.
      downloadJSON(buildBackup({ ...all, ledger, recovery: recovery.rule }), backupFilename());
      dialog.toast(`${countBackup(all).toLocaleString('ko-KR')}건을 내려받았습니다.`);
      return true;
    } catch (err) {
      dialog.toast(`백업하지 못했습니다. ${describeFirestoreError(err)}`, 'bad');
      return false;
    }
  }, [db, uid, isAnon, promptLogin, dialog, recovery]);

  /**
   * 지난 예정 정리 — 고른 id 를 묶음으로 지운다. 기존 쓰기 큐(`ledgerBatch`)를 그대로 쓰므로
   * 거절된 묶음은 "저장하지 못한 것" 목록에 남는다. 묶음마다 서버 확정을 기다려 센다 —
   * 이 기기에 반영된 것과 서버에 반영된 것은 다른 사건이다.
   */
  const deletePastPlans = useCallback(async (ids: string[]) => {
    if (isAnon || !uid) { void promptLogin(); return { ok: 0, failed: ids.length }; }
    const unique = [...new Set(ids)];
    const CHUNK = 400;
    const results = await Promise.all(Array.from({ length: Math.ceil(unique.length / CHUNK) }, (_, i) => {
      const part = unique.slice(i * CHUNK, (i + 1) * CHUNK);
      return commit({
        kind: 'ledgerBatch', label: '지난 예정 정리',
        summary: `예정 ${part.length.toLocaleString('ko-KR')}건`,
        payload: { entries: [], deleteIds: part, accounts: [] },
      }).then((ok) => ({ ok, n: part.length }));
    }));
    return {
      ok: results.filter((r) => r.ok).reduce((t, r) => t + r.n, 0),
      failed: results.filter((r) => !r.ok).reduce((t, r) => t + r.n, 0),
    };
  }, [isAnon, uid, promptLogin, commit]);

  /**
   * 고친 거래를 묶음으로 쓴다(일괄 정리 · 입력 리스트). 기존 쓰기 큐 그대로 — 거절된 묶음은
   * '저장하지 못한 것' 목록에 남는다. 서버가 받은 건수와 거절된 건수를 돌려준다.
   */
  const writeLedgerEntries = useCallback(async (list: Entry[], label: string) => {
    if (isAnon || !uid) { void promptLogin(); return { ok: 0, failed: list.length }; }
    const CHUNK = 400;
    const results = await Promise.all(Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => {
      const part = list.slice(i * CHUNK, (i + 1) * CHUNK);
      return commit({
        kind: 'ledgerBatch', label, summary: `${part.length.toLocaleString('ko-KR')}건`,
        payload: { entries: part, deleteIds: [], accounts: [] },
      }).then((ok) => ({ ok, n: part.length }));
    }));
    return {
      ok: results.filter((r) => r.ok).reduce((t, r) => t + r.n, 0),
      failed: results.filter((r) => !r.ok).reduce((t, r) => t + r.n, 0),
    };
  }, [isAnon, uid, promptLogin, commit]);

  /**
   * 백업 가져오기.
   *
   * 순서: 파일 읽기·검증 → (병합만) 없는 것만 만들기 → 결과 보고.
   * 검증은 **변환 전** 원시 JSON 을 본다. 변환기가 먼저 돌면 잘못된 날짜·금액이
   * 기본값으로 바뀐 뒤라 검증기에 원래 오류가 닿지 않는다.
   *
   * 전체 교체는 꺼져 있다 — 파일로 덮어쓴 기존 항목의 원래 내용을 되돌릴 방법이 없다.
   */
  const importing = useRef(false);
  const handleImport = useCallback(async () => {
    if (isAnon || !uid) { void promptLogin(); return; }
    // 같은 가져오기가 두 번 겹쳐 돌면 서로의 중간 상태를 읽는다.
    if (importing.current) {
      dialog.toast('가져오기가 이미 돌고 있습니다. 끝난 뒤에 다시 시도해 주세요.', 'bad');
      return;
    }

    /*
      깃발을 **파일 고르기 전에** 세운다.

      예전에는 고르고 난 뒤에 세웠다. 파일 선택 창은 사용자가 파일을 고를 때까지 열려
      있는데, 그 사이에 설정에서 가져오기를 한 번 더 누르면 두 번째도 그대로 통과했다.
      둘 다 파일을 고르면 서로의 중간 상태를 읽는다.

      취소하거나 실패해도 반드시 내린다 — 안 그러면 그 뒤로 영영 가져올 수 없다.
    */
    importing.current = true;
    try {
      const file = await pickFile('application/json');
      if (!file) return;
      const read = readBackupFile(await file.text());
      if (!read.ok) {
        await dialog.confirm({
          title: `이 파일은 가져올 수 없습니다 — ${read.problems.length.toLocaleString('ko-KR')}곳이 규칙에 맞지 않습니다`,
          body: (
            <>
              <ul className="dlg-skips">
                {read.problems.slice(0, 8).map((p, i) => (
                  <li key={`${p.where}-${i}`}>{describeFileProblem(p)}</li>
                ))}
                {read.problems.length > 8 && (
                  <li>그 외 {(read.problems.length - 8).toLocaleString('ko-KR')}곳</li>
                )}
              </ul>
              <p className="dlg-note">지금 데이터는 그대로입니다. 파일을 고친 뒤 다시 시도해 주세요.</p>
            </>
          ),
          confirmLabel: '알겠습니다',
          cancelLabel: '닫기',
        });
        return;
      }

      const incoming: BackupData = read.file.data;

      // 예전 형식 변환에서 제외되거나 잘린 항목을 숨기지 않는다.
      if (read.file.notes.length > 0) {
        const go = await dialog.confirm({
          title: `예전 형식을 옮기면서 ${read.file.notes.length.toLocaleString('ko-KR')}건이 달라집니다`,
          body: (
            <>
              <ul className="dlg-skips">
                {read.file.notes.slice(0, 8).map((n, i) => <li key={`${n.id}-${i}`}>{n.reason}</li>)}
                {read.file.notes.length > 8 && (
                  <li>그 외 {(read.file.notes.length - 8).toLocaleString('ko-KR')}건</li>
                )}
              </ul>
              <p className="dlg-note">이대로 가져올까요? 원본 파일은 바뀌지 않습니다.</p>
            </>
          ),
          confirmLabel: '이대로 가져오기',
        });
        if (!go) return;
      }

      /*
        정산 시작일은 설정이라 '더하기' 가 조용히 바꾸지 않는다. 다만 새 계정으로 옮기는
        경우에는 파일 값을 써야 지난 결산이 원래 기간으로 묶인다 — 그래서 고르는 자리를
        따로 둔다. 값이 같으면 고를 것이 없다.
      */
      const fileDay = incoming.ledger?.settleDay ?? null;
      const ledgerDiffers = fileDay !== null && fileDay !== store.ledger.settleDay;
      const mode = await dialog.choose('가져온 데이터를 어떻게 할까요?', [
        { id: 'merge', label: '기존 데이터에 더하기', hint: '같은 항목은 지금 것을 남깁니다. 아무것도 지우지 않습니다.' },
        ...(ledgerDiffers ? [{
          id: 'merge-ledger' as const,
          label: `더하고 정산 시작일도 매월 ${fileDay}일로 바꾸기`,
          hint: `지금은 매월 ${store.ledger.settleDay}일입니다. 지난 결산이 파일과 같은 기간으로 묶입니다.`,
        }] : []),
        { id: 'replace', label: '전체 교체 (지금은 사용할 수 없습니다)', hint: '안전하게 되돌릴 방법이 없어 막아 두었습니다.' },
      ], (
        <>
          <p>파일에 {countBackup(incoming).toLocaleString('ko-KR')}건이 들어 있습니다.</p>
          {/* 회복 규칙은 컬렉션이 아니라 계정 설정이라 병합 경로가 건드리지 않는다. */}
          {recoveryDiffers(incoming.recovery, recovery.rule) && <p className="dlg-warn">{MERGE_SKIPS_RECOVERY}</p>}
          {/* 정산 시작일도 설정이다. 다를 때만 알린다 — 같으면 덮을 것이 없다. */}
          {incoming.ledger && incoming.ledger.settleDay !== store.ledger.settleDay && (
            <p className="dlg-warn">{mergeSkipsLedger(incoming.ledger.settleDay, store.ledger.settleDay)}</p>
          )}
          {/*
            평소 편집은 오프라인에서도 되지만 가져오기는 다르다. 이미 있는 문서를 덮지
            않으려면 "읽고 나서 없을 때만 쓰기" 를 한 번에 해야 하고(트랜잭션),
            트랜잭션은 서버가 있어야 돈다. 오프라인이면 조용히 매달리는 대신 미리 알린다.
          */}
          <p className="dlg-note">
            가져오기는 <b>온라인일 때만</b> 됩니다. 이미 있는 항목을 덮지 않으려면 읽기와
            쓰기를 한 번에 해야 하는데(트랜잭션), 그것은 서버가 있어야 돌아갑니다.
            평소 편집은 오프라인에서도 그대로 됩니다.
          </p>
          {!navigator.onLine && (
            <p className="dlg-warn">지금 오프라인으로 보입니다. 연결한 뒤에 다시 시도해 주세요.</p>
          )}
        </>
      ));
      if (!mode) return;

      if (mode === 'replace') {
        // 저장소를 한 번도 부르지 않는다.
        await dialog.confirm({
          title: '전체 교체는 지금 사용할 수 없습니다',
          body: (
            <>
              <p>{REPLACE_DISABLED_REASON}</p>
              <p className="dlg-note">아무것도 저장하거나 지우지 않았습니다.</p>
            </>
          ),
          confirmLabel: '알겠습니다',
          cancelLabel: '닫기',
        });
        return;
      }

      const io: RestoreIO = {
        fetchAll: () => fetchAll(db, uid),
        createIfAbsent: (payload) => createManyIfAbsent(db, uid, payload),
      };
      const outcome = await safeMerge(incoming, io);
      /*
        고른 경우에만 정산 시작일을 바꾼다. 파일이 규칙에 맞지 않아 아무것도 쓰지 않았거나
        한 건도 못 넣었으면 설정도 그대로 둔다 — 반쯤 옮긴 상태에 설정만 바뀌면 지금
        결산이 엉뚱하게 묶인다.
      */
      if (mode === 'merge-ledger' && fileDay !== null && (outcome.kind === 'ok' || outcome.kind === 'partial')) {
        commit({ kind: 'ledgerSettings', label: '정산 시작일', summary: `매월 ${fileDay}일`, payload: { settleDay: fileDay } });
      }

      if (outcome.kind === 'invalid') {
        dialog.toast('파일을 다시 확인해 주세요.', 'bad');
        return;
      }
      if (outcome.kind === 'all-failed') {
        await dialog.confirm({
          title: '한 건도 저장하지 못했습니다',
          body: (
            <>
              <ul className="dlg-skips">
                {outcome.created.failed.slice(0, 6).map((f: { collection: string; id: string; reason: string }) => (
                  <li key={`${f.collection}/${f.id}`}><code>{f.collection}/{f.id}</code> — {f.reason}</li>
                ))}
              </ul>
              {outcome.skippedExisting > 0 && (
                <p>같은 id 가 이미 있어 {outcome.skippedExisting.toLocaleString('ko-KR')}건은 애초에 쓰지 않았습니다.</p>
              )}
              <p className="dlg-note">
                <b>기존 데이터는 하나도 바뀌지 않았습니다.</b> 연결을 확인한 뒤 같은 파일로 다시 시도해 주세요.
              </p>
            </>
          ),
          confirmLabel: '알겠습니다',
          cancelLabel: '닫기',
        });
        return;
      }
      if (outcome.kind === 'partial') {
        const { created, conflicts, failed } = outcome.created;
        const alreadyThere = conflicts.length + outcome.skippedExisting;
        await dialog.confirm({
          title: `${created.toLocaleString('ko-KR')}건을 더했습니다`,
          body: (
            <>
              {alreadyThere > 0 && (
                <p>
                  같은 id 가 이미 있어 <b>{alreadyThere.toLocaleString('ko-KR')}건</b>은 건너뛰었습니다 —
                  {' '}지금 내용을 그대로 두었습니다.
                </p>
              )}
              {outcome.skippedLinks > 0 && (
                <p>
                  같은 회차를 두 번 세게 될 확정 거래 <b>{outcome.skippedLinks.toLocaleString('ko-KR')}건</b>은 넣지 않았습니다 —
                  {' '}예정을 고치며 다시 잇거나 끊은 거래의 옛 사본입니다.
                </p>
              )}
              {failed.length > 0 && (
                <>
                  <p><b>{failed.length.toLocaleString('ko-KR')}건</b>은 저장하지 못했습니다.</p>
                  <ul className="dlg-skips">
                    {failed.slice(0, 6).map((f: { collection: string; id: string; reason: string }) => (
                      <li key={`${f.collection}/${f.id}`}><code>{f.collection}/{f.id}</code> — {f.reason}</li>
                    ))}
                    {failed.length > 6 && <li>그 외 {(failed.length - 6).toLocaleString('ko-KR')}건</li>}
                  </ul>
                  <p className="dlg-note">
                    같은 파일로 다시 가져오면 못 들어간 것만 이어서 들어갑니다. 이미 있는 항목은 건드리지 않습니다.
                  </p>
                </>
              )}
            </>
          ),
          confirmLabel: '알겠습니다',
          cancelLabel: '닫기',
        });
        return;
      }

      const linkNote = outcome.skippedLinks > 0
        ? ` 같은 회차를 두 번 세게 될 확정 거래 ${outcome.skippedLinks.toLocaleString('ko-KR')}건은 넣지 않았습니다(예정을 고치며 다시 잇거나 끊은 거래의 옛 사본).`
        : '';
      dialog.toast(
        (outcome.created.created > 0
          ? `${outcome.created.created.toLocaleString('ko-KR')}건을 더했습니다.`
            + (outcome.skippedExisting > 0
              ? ` 이미 있는 ${outcome.skippedExisting.toLocaleString('ko-KR')}건은 그대로 두었습니다.`
              : '')
          : '더할 것이 없습니다. 파일의 항목이 모두 이미 있습니다.') + linkNote,
      );
    } catch (err) {
      dialog.toast(
        `가져오지 못했습니다. ${describeFirestoreError(err)} 기존 데이터는 바뀌지 않았습니다.`,
        'bad',
      );
    } finally {
      importing.current = false;
    }
  }, [db, uid, isAnon, promptLogin, dialog, store.ledger.settleDay, commit, recovery.rule]);

  /**
   * 가계부 이관 — 다른 가계부에서 내보낸 엑셀 · CSV 를 실제 거래로 더한다.
   *
   * 순서: 파일 읽기 · 검증(한 행이라도 못 읽으면 중단) → 지금 자료 읽기 → 미리보기에서
   * 고르기 → 카테고리 → 거래 순서로 없는 것만 만들기 → 건수 보고. 백업 가져오기와 같은
   * 깃발을 쓴다 — 둘이 겹쳐 돌면 서로의 중간 상태를 읽는다.
   */
  const handleLedgerImport = useCallback(async () => {
    if (isAnon || !uid) { void promptLogin(); return; }
    if (importing.current) {
      dialog.toast('가져오기가 이미 돌고 있습니다. 끝난 뒤에 다시 시도해 주세요.', 'bad');
      return;
    }
    importing.current = true;
    try {
      const files = await pickFiles('.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (files.length === 0) return;
      const read = await readImportFiles(await Promise.all(
        files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
      ));
      if (read.problems.length > 0) {
        await dialog.confirm({
          title: `가져올 수 없습니다 — ${read.problems.length.toLocaleString('ko-KR')}곳을 읽지 못했습니다`,
          body: <LedgerImportProblems problems={read.problems} />,
          confirmLabel: '알겠습니다',
          cancelLabel: '닫기',
        });
        return;
      }

      const io: ImportIO = {
        fetchExisting: async () => {
          const all = await fetchAll(db, uid);
          return { categories: all.categories, entries: all.entries, accounts: all.accounts };
        },
        createIfAbsent: (payload) => createManyIfAbsent(db, uid, payload),
      };
      const plans = await planFromFiles(read, io);
      if (plans.all.entries.length === 0) {
        dialog.toast(`더할 것이 없습니다. 파일의 ${plans.all.total.toLocaleString('ko-KR')}건이 모두 이미 들어 있습니다.`);
        return;
      }

      const overlap = plans.skip.overlaps.length;
      const mode = await dialog.choose('가계부 내역을 가져올까요?', [
        {
          id: 'skip' as const,
          label: `${plans.skip.entries.length.toLocaleString('ko-KR')}건 가져오기`,
          hint: overlap > 0 ? `겹쳐 보이는 ${overlap.toLocaleString('ko-KR')}건은 빼고 넣습니다.` : '이미 있는 항목은 건드리지 않습니다.',
        },
        ...(overlap > 0 ? [{
          id: 'all' as const,
          label: `겹쳐 보이는 것까지 ${plans.all.entries.length.toLocaleString('ko-KR')}건 가져오기`,
          hint: '손으로 적어 둔 것과 다른 거래라면 이쪽입니다.',
        }] : []),
      ], <LedgerImportPreview plan={plans.skip} ignoredColumns={read.ignoredColumns} />);
      if (!mode) return;
      const plan = mode === 'all' ? plans.all : plans.skip;
      if (plan.entries.length === 0) {
        dialog.toast('더할 것이 없습니다.');
        return;
      }

      const out = await writeLedgerImport(plan, io);
      const n = (v: number) => v.toLocaleString('ko-KR');
      if (out.kind === 'ok') {
        const kept = out.conflicts + out.skippedBefore;
        dialog.toast(`${n(out.created)}건을 더했습니다.` + (kept > 0 ? ` ${n(kept)}건은 넣지 않았습니다(이미 있거나 뺀 것).` : ''));
        return;
      }
      await dialog.confirm({
        title: out.kind === 'partial' ? `${n(out.created)}건을 더했고 ${n(out.failed.length)}건은 저장하지 못했습니다` : '한 건도 저장하지 못했습니다',
        body: (
          <>
            {out.kind === 'categories-failed' && (
              <p>카테고리를 만들지 못해 거래를 쓰지 않았습니다 — 거래가 없는 카테고리를 가리키지 않게 하려는 것입니다.</p>
            )}
            <ul className="dlg-skips">
              {[...out.categoryFailures, ...out.failed].slice(0, 6).map((f) => (
                <li key={`${f.collection}/${f.id}`}><code>{f.collection}/{f.id}</code> — {f.reason}</li>
              ))}
            </ul>
            <p className="dlg-note">
              같은 파일로 다시 가져오면 못 들어간 것만 이어서 들어갑니다. 이미 들어간 것은 다시 쓰지 않습니다.
            </p>
          </>
        ),
        confirmLabel: '알겠습니다',
        cancelLabel: '닫기',
      });
    } catch (err) {
      dialog.toast(`가져오지 못했습니다. ${describeFirestoreError(err)} 기존 데이터는 바뀌지 않았습니다.`, 'bad');
    } finally {
      importing.current = false;
    }
  }, [db, uid, isAnon, promptLogin, dialog]);

  const handleMigrate = useCallback(async () => {
    if (isAnon || !uid) { void promptLogin(); return; }
    try {
      const items = await readLegacyItems(db, uid);
      if (items.length === 0) { setLegacy({ count: 0, migratedAt: legacy?.migratedAt ?? null }); return; }

      const result = convertLegacyItems(items);
      const notes = [...result.skipped, ...result.trimmed];
      const ok = await dialog.confirm({
        title: '이관 전 데이터를 새 구조로 옮길까요?',
        body: (
          <>
            <p>{summarize(result)}</p>
            {notes.length > 0 && (
              <ul className="dlg-skips">
                {notes.slice(0, 5).map((n, i) => <li key={`${n.id}-${i}`}>{n.reason}</li>)}
                {notes.length > 5 && <li>그 외 {notes.length - 5}건</li>}
              </ul>
            )}
            <p className="dlg-note">예전 <code>items</code> 컬렉션은 지우지 않습니다. 문제가 있으면 되돌릴 수 있습니다.</p>
          </>
        ),
        confirmLabel: '옮기기',
      });
      if (!ok) return;

      const written = await writeMany(db, uid, result);

      if (written.allFailed) {
        await dialog.confirm({
          title: '한 건도 옮기지 못했습니다',
          body: (
            <>
              <p>Firestore 가 새 컬렉션에 쓰는 것을 막고 있습니다. 보안 규칙이 아직 배포되지 않은 상태로 보입니다.</p>
              <p className="dlg-note">{RULES_CONSOLE_PATH}</p>
              <pre className="dlg-cmd">{RULES_DEPLOY_COMMAND}</pre>
              <p className="dlg-note">기존 데이터는 예전 items 컬렉션에 그대로 있습니다.</p>
            </>
          ),
          confirmLabel: '알겠습니다',
          cancelLabel: '닫기',
        });
        return;
      }

      // 표식을 남겨야 안내가 사라진다. 원본 items 는 지우지 않으므로
      // 표식이 없으면 안내가 계속 떠서 한 번 더 누르게 된다.
      const at = new Date().toISOString();
      await markMigrated(db, uid, at);
      setLegacy({ count: items.length, migratedAt: at });
      setShowSettings(false);

      if (written.failed.length > 0) {
        // 일부만 옮겨진 상태를 성공으로 보고하면 사라진 항목을 눈치채지 못한다.
        await dialog.confirm({
          title: `${written.written.toLocaleString('ko-KR')}건을 옮겼고, ${written.failed.length.toLocaleString('ko-KR')}건이 남았습니다`,
          body: (
            <>
              <p>아래 항목은 저장하지 못했습니다. 원본은 <code>items</code> 에 그대로 있습니다.</p>
              <ul className="dlg-skips">
                {written.failed.slice(0, 6).map((f) => (
                  <li key={`${f.collection}/${f.id}`}><code>{f.collection}/{f.id}</code> — {f.reason}</li>
                ))}
                {written.failed.length > 6 && <li>그 외 {written.failed.length - 6}건</li>}
              </ul>
            </>
          ),
          confirmLabel: '알겠습니다',
          cancelLabel: '닫기',
        });
        return;
      }

      dialog.toast(`${summarize(result)} — 옮겼습니다.`);
    } catch (err) {
      if (isPermissionDenied(err)) {
        await dialog.confirm({
          title: '보안 규칙이 아직 배포되지 않았습니다',
          body: (
            <>
              <p>Firestore 가 새 컬렉션에 쓰는 것을 막고 있어 이관할 수 없습니다.</p>
              <p>규칙을 올린 뒤 다시 시도해 주세요.</p>
              <p className="dlg-note">{RULES_CONSOLE_PATH}</p>
              <pre className="dlg-cmd">{RULES_DEPLOY_COMMAND}</pre>
              <p className="dlg-note">기존 데이터는 예전 items 컬렉션에 그대로 있습니다.</p>
            </>
          ),
          confirmLabel: '알겠습니다',
          cancelLabel: '닫기',
        });
        return;
      }
      dialog.toast(`옮기지 못했습니다: ${describeFirestoreError(err)}`, 'bad');
    }
  }, [db, uid, isAnon, promptLogin, dialog, legacy]);

  // ---------- 렌더 ----------

  const lensDef = LENS_BY_ID[lens] ?? LENSES[0]!;
  // 스냅샷이 바뀌면 상세도 같이 갱신돼야 한다. 항목이 사라지면 상세도 닫힌다.
  const recoveryEntry = recoveryId
    ? store.entries.find((e) => e.id === recoveryId && isRecoveryEntry(e)) ?? null
    : null;
  const monthLabel = fmtMonthTitle(cursor);
  const daySheetEntries = daySheet
    ? visible.filter((e) => e.startDate <= daySheet && (e.endDate ?? e.startDate) >= daySheet)
    : [];
  /*
    가계부 달력의 날짜 요약. 화면용 자료를 "다 받았다" 고 말할 수 있을 때만 숫자를 낸다 — 캐시가
    비어 있어 없음을 확정할 수 없거나 아직 받는 중이면 셀 · 상세 모두 합계를 적지 않는다.
  */
  const ledgerDayReady = store.display.ready && !(store.display.empty && store.display.fromCache);
  // 달력 칸의 가용 · 생활비 잔여가 보는 예약. 카드 · 날짜 상세와 같은 값이다.
  const reservations = useMemo(
    () => ({
      budgets: store.budgets, reserves: store.reserves, reserveUsage: store.reserveUsage,
      cards: store.cards, cardEntries: store.cardLinked,
    }),
    [store.budgets, store.reserves, store.reserveUsage, store.cards, store.cardLinked],
  );
  const ledgerSummary = useMemo(
    () => ({ entries: store.entries, ready: ledgerDayReady }),
    [store.entries, ledgerDayReady],
  );
  /*
    오늘 · 앞날의 잔고 보기 — 예상 잔고와 생활비 외 가용을 함께 적는다. 달력 셀은 예상 잔고
    하나만 적으므로 쓸 수 있는 돈은 여기서 본다. 계산 자료가 준비되지 않았거나 그 달이
    계산 창 밖이면 내지 않는다(달력 셀과 같은 조건).
  */
  const daySheetBalance = useMemo(() => {
    if (!daySheet || !ledgerOn || daySheet < today || !hasBalance || calcState.kind !== 'ready') return null;
    if (!store.tideMonths.includes(ymOf(daySheet))) return null;
    const res = reservations;
    if (!calcScopeOf(store.accounts, store.tideEntries, res).ok) return null;
    return balanceViewOn(store.accounts, store.tideEntries, daySheet, today, res);
  }, [daySheet, ledgerOn, today, hasBalance, calcState.kind, store.tideMonths, store.accounts, store.tideEntries, reservations]);
  // 가계부 날짜 상세는 필터와 무관하게 그 날의 가계부 항목을 빠짐없이 보여 준다(소액 포함).
  const ledgerDayEntries = daySheet && ledgerOn
    ? materialized.filter((e) => e.kind === 'money' && e.startDate <= daySheet && effectiveEndDate(e) >= daySheet)
    : [];

  // 렌즈에 따라 단독 카드가 되기도 하고, 며칠 버티나 카드 안에 접힌 줄로 들어가기도 한다.
  const pinnedSection = (
    <PinnedSection
      lens={lens}
      pins={store.pins}
      collapsed={prefs.pinCollapsed[lens] ?? true}
      onToggleCollapsed={() => set('pinCollapsed', { ...prefs.pinCollapsed, [lens]: !(prefs.pinCollapsed[lens] ?? true) })}
      onSave={(p) => {
        if (isAnon || !uid) { void promptLogin(); return; }
        commit({ kind: 'pin', label: '고정 메모', summary: p.text.slice(0, 40) || '(빈 메모)', payload: p });
      }}
      onDelete={(p) => {
        if (isAnon || !uid) { void promptLogin(); return; }
        commit({
          kind: 'pinDelete', label: '고정 메모 삭제',
          summary: p.text.slice(0, 40) || '(빈 메모)', payload: { id: p.id },
        });
      }}
    />
  );

  const quickActions = (
        <div className="mobile-actions">
          {!sharedOpen && <button className="add-btn" aria-label={ledgerOn ? '거래 추가' : '일정 추가'} onClick={() => openCreate()}><Icon.Plus size={16} /></button>}
          <details className="mobile-more" onKeyDown={(e) => {
            if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus(); }
          }}>
            <summary aria-label="더보기">···</summary>
            <div className="mobile-more-panel" onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) e.currentTarget.closest('details')?.removeAttribute('open');
            }}>
              {!sharedOpen && !ledgerOn && <>
                <button onClick={() => set('view', 'calendar')} aria-pressed={view === 'calendar'}><Icon.Calendar size={16} />월간 보기</button>
                <button onClick={() => set('view', 'list')} aria-pressed={view === 'list'}><Icon.List size={16} />리스트 보기</button>
              </>}
              {!sharedOpen && filterUsable && (
                <button onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters}><Icon.Filter size={16} />필터{hasActiveFilter(filters) ? ' · 적용 중' : ''}</button>
              )}
              {isAnon
                ? <button onClick={() => setShowAuth(true)}>로그인 · 가입</button>
                : <button onClick={() => setShowSettings(true)}><Icon.Settings size={16} />설정</button>}
            </div>
          </details>
        </div>
  );

  return (
    <div className="app" data-lens={lens} style={{ ['--lens' as string]: `var(${lensDef.accentVar})` }}>
      <header className="topbar" data-space={sharedOpen ? 'shared' : 'me'}>
        <div className="header-left">
        <div className="brand">
          {/*
            글리프 'X' 대신 획을 직접 긋는다. 글꼴의 X 는 굵기를 font-weight 로만
            건드릴 수 있어 로고로 쓰기에는 획이 가늘다.
          */}
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
                 strokeWidth="4.2" strokeLinecap="round">
              <path d="M5.5 5.5 19 19M19 5.5 5.5 19" />
            </svg>
          </span>
          <span className="brand-name">캘린더X</span>
        </div>

        {/*
          공간 전환. 탭보다 **위**이지만 자리는 작다 — 머리가 한 줄 더 늘면 모바일에서
          캘린더가 그만큼 밀린다. 로그인해야 공유가 뜻이 있으므로 그 전에는 띄우지 않는다.
        */}
        {/*
          연결이 있으면 설정의 '같이보기 공간 전환' 을 따른다. 연결이 없으면 고를 것이 없으므로 지금처럼
          시작하는 칸(👥+)이 남는다.
        */}
        {!isAnon && (layout.sharedSwitcher || !shared.board) && (
          <div className="space-context"><SpaceSwitch
            space={sharedOpen ? 'shared' : 'me'}
            hasBoard={!!shared.board}
            ready={shared.ready}
            onChange={(next) => setSharedOpen(next === 'shared')}
            onStart={() => setSharedSheet('start')}
          /></div>
        )}

          {/* 가계부는 보기마다 자기 기간 도구를 가진다 — 위에 달력 월을 하나 더 두면 무엇이 무엇을 바꾸는지 흐려진다. */}
          {!sharedOpen && !ledgerOn && (
        <div className="tool-l">
          <button className="ico-btn sm" aria-label="이전 달"
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
            <Icon.Chevron size={16} dir="left" />
          </button>
          <button className="month-btn" onClick={() => setShowPicker(true)}>
            {monthLabel}<Icon.Chevron size={12} dir="down" />
          </button>
          <button className="ico-btn sm" aria-label="다음 달"
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
            <Icon.Chevron size={16} />
          </button>
          <button className="today-btn" onClick={() => setCursor(new Date())}>오늘</button>
        </div>
          )}
        </div>
        {/*
          **두 공간이 같은 탭 줄을 쓴다.**

          공유에 있을 때 그 보드의 탭을 화면 안쪽에 한 줄 더 그리면, 탭처럼 생긴 줄이
          둘이 되고 공간을 옮길 때마다 본문이 위아래로 튄다. 자리는 하나고 내용만
          바뀐다 — 지금 어느 공간인지는 위의 👤 / 👥 가 말한다.
        */}
        {sharedOpen ? (
          <nav className="lenses" role="tablist" aria-label="같이 보기">
            {SHARED_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={prefs.sharedTab === t.id}
                className={'lens' + (prefs.sharedTab === t.id ? ' on' : '')}
                style={{ ['--ac' as string]: `var(${t.accentVar})` }}
                onClick={() => set('sharedTab', t.id)}
              >
                <span className="lens-dot" />{t.label}
              </button>
            ))}
          </nav>
        ) : (
          <nav className="lenses" role="tablist" aria-label="렌즈">
            {LENSES.filter((l) => lensVisible(l.id, layout)).map((l) => (
              <button
                key={l.id}
                role="tab"
                aria-selected={lens === l.id}
                className={'lens' + (lens === l.id ? ' on' : '')}
                style={{ ['--ac' as string]: `var(${l.accentVar})` }}
                onClick={() => { set('lens', l.id); setFilters(emptyFilters()); }}
              >
                <span className="lens-dot" />{l.label}
              </button>
            ))}
          </nav>
        )}

        {/*
          좁은 화면의 추가(+) · 더보기(···). 가계부에서는 머리에 두지 않고 보기의 기간 도구 옆으로
          내려간다 — 가계부는 월 이동을 머리에서 숨기므로, 여기 두면 이 둘만으로 한 줄을 차지했다.
        */}
        {!ledgerOn && quickActions}
        <div className="header-right">
          {!sharedOpen && (
        <div className="tool-r">
          {!ledgerOn && (
          <div className="seg">
            {(['calendar', 'list'] as ViewId[]).map((v) => (
              <button key={v} className={'seg-btn' + (view === v ? ' on' : '')} aria-label={v === 'calendar' ? '캘린더 보기' : '리스트 보기'} aria-pressed={view === v} onClick={() => set('view', v)}>
                {v === 'calendar' ? <Icon.Calendar size={14} /> : <Icon.List size={14} />}
                <span className="lbl">{v === 'calendar' ? '월간' : '리스트'}</span>
              </button>
            ))}
          </div>
          )}
          {filterUsable && (
          <button
            className={'ico-btn' + (showFilters || hasActiveFilter(filters) ? ' on' : '')}
            onClick={() => setShowFilters((x) => !x)}
            aria-label="필터" aria-expanded={showFilters}
          >
            <Icon.Filter size={15} />
            {hasActiveFilter(filters) && <span className="badge" />}
          </button>
          )}
          <button className="add-btn" aria-label="일정 추가" onClick={() => openCreate()}>
            <Icon.Plus size={16} /><span className="lbl">추가</span>
          </button>
        </div>
          )}
        {isAnon ? (
          <button className="landing-cta-sm" onClick={() => setShowAuth(true)}>로그인 · 가입</button>
        ) : (
          <button className="ico-btn" onClick={() => setShowSettings(true)} aria-label="설정">
            <Icon.Settings size={16} />
          </button>
        )}
        </div>
      </header>

      {/*
        저장하지 못한 것은 **어느 화면에서도** 보여야 한다. 그래서 같이 보기 화면으로
        갈리는 자리보다 위에 둔다 — 공유 항목 저장이 거절당했는데 그 목록이 안 보이면,
        적은 내용이 어디로 갔는지 알 방법이 없다.

        확인창으로 한 번 알리고 말지 않는 이유도 같다. 두 건이 동시에 실패하면 뒤엣것이
        앞엣것을 밀어내고 밀려난 값은 다시 찾을 길이 없다. 남은 것이 없으면 이 줄도
        화면에 없다.
      */}
      <div className="side">
        <FailedWrites
          failed={writes.failed}
          durable={writes.durable}
          onRetry={writes.retry}
          onRetryAll={writes.retryAll}
          onDiscard={writes.discard}
        />
      </div>

      {/*
        같이 보기는 **본문을 대신 차지한다.** 상단 렌즈는 그대로 남아 있어 언제든
        돌아올 수 있고, 카드도 달력도 뜨지 않으므로 지금 보고 있는 것이 공유 화면임이
        분명하다. 보드가 없으면 열리지 않는다.
      */}
      {sharedOpen && shared.board && uid ? (
        <main className="main">
          <SharedScreen
            board={shared.board}
            partner={shared.partner}
            myUid={uid}
            items={shared.items}
            ddays={shared.ddays}
            contentReady={shared.contentReady}
            todayISO={today}
            // 커서는 개인 화면과 같은 값이다. 돌아가도 보고 있던 달에 그대로 있다.
            cursor={cursor}
            onCursorChange={setCursor}
            // 보기 방식만 따로 기억한다 — 공유에서 리스트로 바꿨다고 내 TODO 까지
            // 리스트가 되면 고친 적 없는 화면이 바뀐 것으로 보인다.
            view={prefs.sharedView}
            onViewChange={(v) => set('sharedView', v)}
            // 공간마다 마지막 탭을 따로 기억한다 — 👥 를 누르면 보던 자리로 돌아온다.
            tab={prefs.sharedTab}
            onTabChange={(t) => set('sharedTab', t)}
            weekStart={prefs.weekStart}
            onBack={() => setSharedOpen(false)}
            onOpenInvite={() => setSharedSheet('settings')}
            onSaveItem={shared.saveItem}
            onUnshareItem={(item) => { void unshareItem(item); }}
            onDeleteItem={shared.removeItem}
            onSaveDday={shared.saveDday}
            onDeleteDday={shared.removeDday}
            collections={shared.collections}
            collectionItems={shared.collectionItems}
            notes={shared.notes}
            legacyMemo={shared.memoText}
            onSaveCollection={shared.saveCollection}
            onDeleteCollection={(c) => { void deleteCollection(c); }}
            onSaveCollectionItem={shared.saveCollectionItem}
            onDeleteCollectionItem={shared.removeCollectionItem}
            onSaveNote={shared.saveNote}
            onDeleteNote={(n) => { void deleteNote(n); }}
            onPinNote={pinNote}
            onAdoptLegacyMemo={adoptLegacyMemo}
          />
        </main>
      ) : (
      <>


      {showFilters && filterUsable && (
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          entries={materialized}
          allTags={allTags}
          lens={lens}
          shownCount={visible.length}
        />
      )}

      {/*
        규칙 미배포는 배포 직후 가장 흔한 실패다. "Missing or insufficient permissions." 를
        그대로 보여 주면 원인을 알 수 없으므로, 무엇을 해야 하는지까지 적는다.
      */}
      {store.rulesBlocked && (
        <div className="setup" role="alert">
          <div className="setup-h"><Icon.Alert size={15} /><strong>보안 규칙이 아직 배포되지 않았습니다</strong></div>
          <p>
            Firestore 가 <code>entries</code> · <code>accounts</code> · <code>debts</code> · <code>pins</code> 컬렉션을
            막고 있습니다. 레포의 <code>firestore.rules</code> 를 한 번 올리면 됩니다.
          </p>
          <ol className="setup-ways">
            <li>
              <b>콘솔에서</b> — {RULES_CONSOLE_PATH}
            </li>
            <li>
              <b>터미널에서</b>
              <pre className="setup-cmd">{RULES_DEPLOY_COMMAND}</pre>
            </li>
          </ol>
          <p className="setup-note">
            기존 데이터는 예전 <code>items</code> 컬렉션에 그대로 있습니다. 사라진 것이 아닙니다.
          </p>
        </div>
      )}

      {store.error && (
        <div className="banner bad"><Icon.Alert size={14} />{store.error}</div>
      )}

      {/*
        전체 렌즈의 요약 카드는 TodayPanel 하나다. 잔고·대출·고정 메모를 그 아래 줄줄이
        세우면 모바일에서 캘린더가 화면 두 번 아래로 밀렸고, 잔고 금액이 오늘 카드와
        잔고 카드에 두 번 나왔다. 잔고는 카드 안으로, 대출과 고정 메모는 각자의 렌즈로.
      */}
      <div className="side">
        {/*
          빚이 0이면 아무것도 렌더링하지 않는다. 정상 상태에서 회복은 화면에 없어야 한다.
          렌즈와 무관하게 같은 자리에 두는 이유는, 밀렸다는 사실이 가계부를 보는 동안에도
          사라지면 안 되기 때문이다.
        */}
        <div className="utility-strip">
        {/* 일시중지 중에는 빚을 세지 않고 다시 잡기도 띄우지 않는다. 빚은 규칙에 그대로 남아 있다. */}
        {!isAnon && recovery.rule.enabled && (
          <RecoveryDebtBar
            rule={recovery.rule}
            todayISO={today}
            onSchedule={(dateISO, time) => {
              recovery.scheduleDebt(dateISO, time);
              dialog.toast('회복을 다시 잡았습니다.');
            }}
          />
        )}

        {pinnedSection}
        </div>

        {lens === 'all' && (
          <TodayPanel
            todayISO={today}
            entries={shownEntries}
            showMoney={layout.ledger}
            tideEntries={store.tideEntries}
            tideFrom={tideFrom}
            calcState={calcState}
            accounts={store.accounts}
            budgets={store.budgets}
            reserves={store.reserves}
            reserveUsage={store.reserveUsage}
            cards={store.cards}
            cardEntries={store.cardLinked}
            hasBalance={hasBalance}
            collapsed={prefs.todayCollapsed}
            onToggleCollapsed={() => set('todayCollapsed', !prefs.todayCollapsed)}
            moneyCollapsed={prefs.todayMoneyCollapsed}
            onToggleMoneyCollapsed={() => set('todayMoneyCollapsed', !prefs.todayMoneyCollapsed)}
            onEntryClick={openEdit}
            onStatusChange={handleStatus}
            onPromote={handlePromote}
            onQuickIdea={persist}
            onSaveAccount={saveBalance}
          />
        )}



      </div>

      <main className="main">
        {ledgerOn ? (
          <LedgerScreen
            todayISO={today}
            settleDay={settleDay}
            tab={ledgerTab}
            onTab={setLedgerTab}
            periodKey={ledgerPeriod}
            onPeriodKey={setLedgerPeriod}
            entries={ledgerEntries}
            feed={ledgerFeed}
            categories={store.categories}
            categoryBudgets={store.categoryBudgets}
            categoriesReady={categoriesReady}
            onSeedCategories={seedCategories}
            onEntryClick={openLedgerEntry}
            actions={quickActions}
            onSaveMany={writeLedgerEntries}
            onSaveCategoryBudget={saveCategoryBudget}
            annualBudgets={store.annualBudgets}
            onSaveAnnualBudget={saveAnnualBudget}
            onDeleteAnnualBudget={deleteAnnualBudget}
            ledgerNotes={store.ledgerNotes}
            notesFeed={store.ledgerNotesFeed}
            onSaveLedgerNote={saveLedgerNote}
            subscribeAll={subscribeAllActuals}
            cashflow={(
              <div className="led-cashflow">
                {/* 현금흐름의 기간 도구는 달력 월 하나다. 한도 자체는 오늘의 함수라 월을 넘겨도 카드 숫자는 그대로다. */}
                <div className="led-toolbar">
                  <div className="led-period">
                    <button className="ico-btn sm" aria-label="이전 달"
                      onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
                      <Icon.Chevron size={15} dir="left" />
                    </button>
                    <button className="led-period-t month-btn" onClick={() => setShowPicker(true)}>
                      <strong>{monthLabel}</strong><Icon.Chevron size={12} dir="down" />
                    </button>
                    <button className="ico-btn sm" aria-label="다음 달"
                      onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
                      <Icon.Chevron size={15} />
                    </button>
                    <button className="today-btn" onClick={() => setCursor(new Date())}>오늘</button>
                  </div>
                  {/* 추가(+) · 더보기(···). 머리의 같은 단추가 가계부에서는 여기로 내려온다. */}
                  {quickActions}
                </div>
          <TideBar
            todayISO={today}
            accounts={store.accounts}
            entries={store.tideEntries}
            budgets={store.budgets}
            reserves={store.reserves}
            reserveUsage={store.reserveUsage}
            cards={store.cards}
            cardEntries={store.cardLinked}
            tideFrom={tideFrom}
            calcState={calcState}
            hasBalance={hasBalance}
            onSaveAccount={saveBalance}
            onEntryClick={openEdit}
            collapsed={prefs.moneyCardCollapsed}
            onToggleCollapsed={() => set('moneyCardCollapsed', !prefs.moneyCardCollapsed)}
            onOpenPockets={setPocketFocus}
            onOpenCards={() => setCardSheetOpen(true)}
          >
            <CardLine cards={store.cards} cardEntries={store.cardLinked} plans={store.tideEntries} todayISO={today} onOpen={() => setCardSheetOpen(true)} />
            <MoneyPanel
              debts={store.debts}
              collapsed={prefs.debtsCollapsed}
              onToggleCollapsed={() => set('debtsCollapsed', !prefs.debtsCollapsed)}
              onSaveDebt={(d) => {
                if (isAnon || !uid) { void promptLogin(); return; }
                commit({ kind: 'debt', label: '대출', summary: d.name, payload: d });
              }}
              onDeleteDebt={async (d) => {
                if (isAnon || !uid) { void promptLogin(); return; }
                const ok = await dialog.confirm({ title: `'${d.name}'을(를) 삭제할까요?`, danger: true, confirmLabel: '삭제' });
                if (ok) commit({ kind: 'debtDelete', label: '대출 삭제', summary: d.name, payload: { id: d.id } });
              }}
            />
          </TideBar>
          <p className="led-note cal-legend">
            {hasBalance && <>{calendarAmountCaption(layout.calendarAmount)}. </>}
            날짜 숫자 → 그 날 상세 · 빈 칸 → 그 날짜로 거래 입력 · 점선 막대 → 생활비.
          </p>
          <MonthCalendar
            cursor={cursor}
            onCursorChange={setCursor}
            entries={visible}
            tideEntries={store.tideEntries}
            // 계산 자료를 못 받았으면 덮는 달이 없는 것과 같다 — 셀에 숫자를 적지 않는다.
            tideMonths={calcState.kind === 'ready' ? store.tideMonths : EMPTY_MONTHS}
            accounts={store.accounts}
            hasBalance={hasBalance}
            lens={lens}
            weekStart={prefs.weekStart}
            todayISO={today}
            onEntryClick={openEdit}
            onDayOpen={setDaySheet}
            onDayCreate={(iso) => openCreate({ startDate: iso })}
            ledgerSummary={ledgerSummary}
            pockets={store.budgets}
            onPocketClick={(id) => setPocketFocus({ kind: 'budget', id })}
            amountMode={layout.calendarAmount}
            reservations={reservations}
          />
              </div>
            )}
          />
        ) : view === 'calendar' ? (
          <MonthCalendar
            cursor={cursor}
            onCursorChange={setCursor}
            entries={visible}
            tideEntries={store.tideEntries}
            // 계산 자료를 못 받았으면 덮는 달이 없는 것과 같다 — 셀에 숫자를 적지 않는다.
            tideMonths={calcState.kind === 'ready' ? store.tideMonths : EMPTY_MONTHS}
            accounts={store.accounts}
            hasBalance={hasBalance}
            lens={lens}
            weekStart={prefs.weekStart}
            todayISO={today}
            onEntryClick={openEdit}
            onDayOpen={setDaySheet}
            onDayCreate={(iso) => openCreate({ startDate: iso })}
          />
        ) : (
          <ListView
            cursor={cursor}
            entries={visible}
            lens={lens}
            todayISO={today}
            onEntryClick={openEdit}
            onReorder={handleReorder}
          />
        )}
      </main>

      <button className="fab" onClick={() => openCreate()} aria-label="추가"><Icon.Plus size={22} /></button>
      </>
      )}

      {showPicker && (
        <MonthPicker
          cursor={cursor}
          onPick={(y, m) => { setCursor(new Date(y, m, 1)); setShowPicker(false); }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {pastPlanOpen && uid && !isAnon && (
        <PastPlanSheet
          todayISO={today}
          load={() => fetchLedgerFromServer(db, uid)}
          onBackup={handleExport}
          onDelete={deletePastPlans}
          onClose={() => setPastPlanOpen(false)}
        />
      )}
      {loanCatOpen && uid && !isAnon && (
        <LoanCategorySheet
          categories={store.categories}
          load={() => fetchLedgerFromServer(db, uid).then((d) => d.entries)}
          onBackup={handleExport}
          onApply={writeLedgerEntries}
          onClose={() => setLoanCatOpen(false)}
        />
      )}
      {cardSheetOpen && ledgerOn && (
        <CardSheet
          cards={store.cards}
          cardEntries={store.cardLinked}
          accounts={store.accounts}
          todayISO={today}
          onClose={() => setCardSheetOpen(false)}
          onSaveCard={saveCard}
          onDeleteCard={(c) => { void deleteCard(c); }}
          onEntryClick={(e) => { setCardSheetOpen(false); openEdit(e); }}
          onRecordPayment={openCardPayment}
          plans={store.tideEntries}
          onLinkPlanned={(e, c) => { void linkPlannedCard(e, c); }}
        />
      )}
      {pocketFocus && ledgerOn && (
        <PocketSheet
          focus={pocketFocus}
          onClose={() => setPocketFocus(null)}
          budgets={store.budgets}
          reserves={store.reserves}
          reserveUsage={store.reserveUsage}
          reserveLinked={store.reserveLinked}
          entries={store.tideEntries}
          accounts={store.accounts}
          todayISO={today}
          onSaveBudget={(b) => { void saveBudget(b); }}
          onDeleteBudget={(b) => { void deleteBudget(b); }}
          onSaveReserve={(r, prev) => {
            if (isAnon || !uid) { void promptLogin(); return; }
            // 새 세이브만 문서 전체를 쓴다. 이미 있는 세이브는 바꾼 칸만 — 다른 기기에서 바꾼
            // 보호 · 금액을 열어 둔 창의 옛 값으로 덮지 않는다.
            if (!prev) {
              commit({ kind: 'reserve', label: '세이브', summary: r.name, payload: r });
              return;
            }
            const patch = reservePatchOf(prev, r);
            if (!patch) return;
            commit({
              kind: 'reservePatch', label: '세이브', summary: `${prev.name} — ${reservePatchSummary(patch)}`,
              payload: { id: r.id, patch, updatedAt: r.updatedAt },
            });
          }}
          onDeleteReserve={(r) => { void deleteReserve(r); }}
          onEntryClick={(e) => { setPocketFocus(null); openEdit(e); }}
          onLinkEntries={linkToPocket}
          onMarkOutside={markOutsidePocket}
        />
      )}
      {daySheet && (
        <DaySheet
          dateISO={daySheet}
          todayISO={today}
          entries={ledgerOn ? ledgerDayEntries : daySheetEntries}
          moneyEntries={store.entries}
          ledger={ledgerOn ? {
            summary: ledgerDayReady ? daySummary(store.entries, daySheet) : null,
            balance: daySheetBalance,
            categories: store.categories,
            onToggleHighlight: toggleHighlight,
            planActions: {
              // 펼친 회차는 확정할 수 없다 — 원본 시리즈를 보고 그 날짜를 확정한다.
              canConfirm: (e) => confirmBlockOf(findBase(e.id) ?? e) === null,
              onConfirm: (e, date) => { setDaySheet(null); startConfirm(findBase(e.id) ?? e, date); },
              onDiscard: (e) => { setDaySheet(null); void handleDelete(e); },
            },
          } : undefined}
          onClose={() => setDaySheet(null)}
          onEntryClick={(e) => { setDaySheet(null); openEdit(e); }}
          onAdd={() => { const iso = daySheet; setDaySheet(null); openCreate({ startDate: iso }); }}
        />
      )}

      {recoveryEntry && (
        <RecoverySheet
          entry={recoveryEntry}
          rule={recovery.rule}
          todayISO={today}
          onSaveEntry={recovery.saveEntryOnly}
          onChangeRule={recovery.saveRule}
          onComplete={(e) => {
            recovery.complete(e, today);
            setRecoveryId(null);
            dialog.toast('회복을 완료했습니다. 잘못 눌렀으면 체크를 다시 풀면 됩니다.');
          }}
          canUndo={recovery.canUndo(recoveryEntry)}
          onUndo={(e) => {
            recovery.undoComplete(e);
            setRecoveryId(null);
            dialog.toast('완료를 되돌렸습니다.');
          }}
          onMove={(e, toDate, toTime) => {
            recovery.move(e, toDate, toTime);
            setRecoveryId(null);
            dialog.toast('회복을 옮겼습니다. 밀린 것으로 세지 않습니다.');
          }}
          onSkip={(e) => void handleDelete(e)}
          onClose={() => setRecoveryId(null)}
        />
      )}

      <EntryModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.entry}
        allTags={allTags}
        linkableTasks={linkableTasks}
        budgets={store.budgets}
        reserves={store.reserves}
        cards={store.cards}
        cardEntries={store.cardLinked}
        debts={store.debts}
        sharedActive={!!shared.board}
        categories={store.categories}
        categoriesReady={categoriesReady}
        onSeedCategories={seedCategories}
        accounts={store.accounts}
        occurrenceDate={modal.occurrence ?? null}
        onConfirm={startConfirm}
        onUnconfirm={(a) => void unconfirm(a)}
        onSave={handleSave}
        onDelete={(e) => void handleDelete(e)}
        onClose={closeModal}
        ledgerVisible={layout.ledger}
      />

      {confirming && (
        <ConfirmSheet
          plan={confirming.plan}
          occurrenceDate={confirming.date}
          categories={store.categories}
          categoriesReady={categoriesReady}
          onSeedCategories={seedCategories}
          accounts={store.accounts}
          budgets={store.budgets}
          reserves={store.reserves}
          cards={store.cards}
          cardEntries={store.cardLinked}
          debts={store.debts}
          onSave={(actual, opts) => {
            setConfirming(null);
            persist(actual, reflectChanges(actual, opts?.reflected));
            dialog.toast('실제 거래로 확정했습니다. 예정은 그대로 남고 이 회차만 빠집니다.');
          }}
          onClose={() => setConfirming(null)}
        />
      )}

      {sharedSheet === 'start' && (
        <SharedStartSheet
          defaultName="같이 보기"
          onCreate={(name) => { setSharedSheet(null); startShare(name); }}
          onClose={() => setSharedSheet(null)}
        />
      )}

      {sharedSheet === 'settings' && shared.board && uid && (
        <SharedSettingsSheet
          board={shared.board}
          myUid={uid}
          invite={invite}
          invitesReady={invitesReady}
          boardCount={shared.boardCount}
          onMakeInvite={() => {
            setInvitesReady(false);
            void shared.makeInvite().then((made) => { setInvite(made); setInvitesReady(true); });
          }}
          onDropInvite={(code) => { shared.dropInvite(code); setInvite(null); }}
          onLeave={async () => {
            const ok = await dialog.confirm({
              title: '이 보드에서 나갈까요?',
              body: '공유 화면의 TODO · 고정메모 · D-Day 는 그대로 남고, 더 이상 보이지 않습니다. 내 개인 자료는 영향을 받지 않습니다.',
              confirmLabel: '나가기', danger: true,
            });
            if (!ok) return;
            setSharedSheet(null);
            setSharedOpen(false);
            try {
              await shared.leave();
              dialog.toast('보드에서 나왔습니다.');
            } catch (err) {
              dialog.toast(`나가지 못했습니다. ${describeFirestoreError(err)}`, 'bad');
            }
          }}
          onDelete={async () => {
            const ok = await dialog.confirm({
              title: '공유를 그만둘까요?',
              // 원본은 건드리지 않는다. 사라지는 것은 공유 자료뿐이라는 것을 먼저 말한다.
              body: '공유 화면의 TODO 수정 · 같이 보기 전용 항목 · 고정메모 · D-Day 가 모두 지워집니다. 내 TODO 원본은 그대로 남습니다.',
              confirmLabel: '그만두기', danger: true,
            });
            if (!ok) return;
            setSharedSheet(null);
            setSharedOpen(false);
            try {
              await shared.removeBoard();
              dialog.toast('공유를 그만두었습니다. 내 TODO 는 그대로입니다.');
            } catch (err) {
              dialog.toast(`지우지 못했습니다. ${describeFirestoreError(err)}`, 'bad');
            }
          }}
          onClose={() => setSharedSheet(null)}
        />
      )}

      {join && !isAnon && (
        <SharedJoinSheet
          invite={join.invite}
          state={join.state}
          onAccept={() => void acceptJoin()}
          onClose={() => setJoin(null)}
        />
      )}

      {showAuth && (
        <div className="mod-back" onClick={() => setShowAuth(false)}>
          <div className="mod auth-mod" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <Auth onBack={() => setShowAuth(false)} />
          </div>
        </div>
      )}

      <BrandFooter />

      {onboarding.open && !showAuth && !showSettings && !join && !sharedSheet &&
        !new URLSearchParams(window.location.search).has(INVITE_PARAM) && (
        <Onboarding key={uid ?? 'guest'} onFinish={(outcome) => {
          if (!onboarding.finish(outcome)) {
            dialog.toast('이 브라우저에 안내 설정을 저장하지 못했습니다. 다음 접속 시 다시 표시될 수 있습니다.', 'bad');
          }
        }} />
      )}

      {showSettings && user && (
        <SettingsSheet
          onShowOnboarding={() => { setShowSettings(false); onboarding.reopen(); }}
          user={user}
          theme={prefs.theme}
          fontScale={prefs.fontScale}
          weekStart={prefs.weekStart}
          entryCount={store.entries.length}
          legacyCount={legacy?.count ?? null}
          migratedAt={legacy?.migratedAt ?? null}
          recoveryRule={recovery.rule}
          onRecoveryRule={recovery.saveRule}
          onRecoveryPause={() => void pauseRecovery()}
          onRecoveryResume={() => {
            recovery.resume();
            dialog.toast(recovery.rule.debtCount > 0
              ? `Recovery를 다시 활성화했습니다. 밀린 회복 ${recovery.rule.debtCount}회는 '다시 잡기'로 갚습니다.`
              : `Recovery를 활성화했습니다. ${recovery.rule.intervalDays}일 뒤로 잡습니다.`);
          }}
          layout={{
            layout,
            onLayout: setLayout,
            shared: {
              connected: !!shared.board,
              ready: shared.ready,
              onStart: () => { setShowSettings(false); setSharedSheet('start'); },
              onManage: () => { setShowSettings(false); setSharedSheet('settings'); },
            },
          }}
          onCleanPastPlans={isAnon || !uid ? undefined : () => { setShowSettings(false); setPastPlanOpen(true); }}
          onCleanLoanCategory={isAnon || !uid ? undefined : () => { setShowSettings(false); setLoanCatOpen(true); }}
          ledger={{
            todayISO: today,
            settleDay: store.ledger.settleDay,
            onSettleDay: saveSettleDay,
            categories: store.categories,
            categoriesReady,
            onSaveCategory: saveCategory,
            onSaveCategories: saveCategories,
            onSeedCategories: seedCategories,
          }}
          onTheme={(t) => set('theme', t)}
          onFontScale={(f) => set('fontScale', f)}
          onWeekStart={(w) => set('weekStart', w)}
          onExport={handleExport}
          onImport={handleImport}
          onImportLedger={handleLedgerImport}
          onMigrate={handleMigrate}
          onSignOut={() => { setShowSettings(false); void onSignOut(); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

/** 이번 달을 보고 있으면 오늘, 다른 달을 보고 있으면 그 달의 1일에 만든다. */
function cursorISOForCreate(today: string, cursor: Date): string {
  return today.startsWith(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    ? today
    : toISO(startOfMonth(cursor));
}

function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export type { LensId };
