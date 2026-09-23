import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  backupFilename, buildBackup, countBackup, downloadJSON, type BackupData,
} from '../data/backup';
import { describeFileProblem, readBackupFile } from '../data/backupFile';
import {
  describeFirestoreError, isPermissionDenied, RULES_CONSOLE_PATH, RULES_DEPLOY_COMMAND,
} from '../data/errors';
import { getFirebase } from '../data/firebase';
import { convertLegacyItems, readLegacyItems, summarize } from '../data/migrate';
import {
  createManyIfAbsent, fetchAll, markMigrated, readMigrationMark, writeMany,
} from '../data/repo';
import {
  MERGE_SKIPS_RECOVERY, REPLACE_DISABLED_REASON, safeMerge, type RestoreIO,
} from '../data/restore';
import { LENSES, LENS_BY_ID, SHARED_TABS } from '../domain/constants';
import { endOfMonth, fmtMonthTitle, startOfMonth, toISO } from '../domain/date';
import { convertKind, displayTitle, newEntry, uid as newId, withDerived } from '../domain/entry';
import {
  INVITE_PARAM, isShareableTask, newNote, repinNotes, sharedTitle,
} from '../domain/shared';
import { formatAmount } from '../domain/money';
import { applyFilters, collectTags, emptyFilters, hasActiveFilter } from '../domain/filters';
import { baseIdOf, materialize } from '../domain/recurrence';
import { isRecoveryEntry } from '../domain/recovery';
import type {
  Account, Entry, Filters, LensId, SharedInvite, SharedNote, SharedTodoItem,
  TaskStatus, ViewId, YearMonth,
} from '../domain/types';
import { Auth } from '../ui/Auth';
import { BrandFooter } from '../ui/BrandFooter';
import { DaySheet } from '../ui/DaySheet';
import { calcStateOf, type CalcState } from '../ui/calcState';
import { TideBar } from '../ui/TideBar';
import { EntryModal } from '../ui/EntryModal';
import { FilterPanel } from '../ui/FilterPanel';
import { Icon } from '../ui/Icon';
import { ListView } from '../ui/ListView';
import { MonthCalendar } from '../ui/MonthCalendar';
import { MonthPicker } from '../ui/MonthPicker';
import { MoneyPanel } from '../ui/MoneyPanel';
import { BudgetPanel } from '../ui/BudgetPanel';
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
  const dialog = useDialog();
  const { prefs, set } = usePrefs();
  const [cursor, setCursor] = useState(() => new Date());
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [daySheet, setDaySheet] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; mode: 'create' | 'edit'; entry: Entry | null }>(
    { open: false, mode: 'create', entry: null },
  );
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
    같이 보기. 보드 문서만 늘 구독하고, 항목·고정메모·D-Day 는 화면이 열려 있을 때만
    받는다 (`open`). 이 훅이 들고 있는 보드가 "TODO 저장을 공유에도 보낼지" 를 정한다.
  */
  const accountName = user?.displayName || user?.email || '';
  const shared = useSharedBoard({
    uid,
    todayISO: today,
    accountName,
    open: wantsShared,
    onError: (message) => dialog.toast(message, 'bad'),
    commit,
  });

  /*
    공유 공간은 보드가 있을 때만 열린다.

    보드 구독이 아직 안 왔으면(`ready === false`) "없음" 을 확정할 수 없으므로 물러나지
    않는다 — 그때 되돌리면 새로고침마다 공유에 있던 사람이 내 공간으로 튕긴다.
  */
  const sharedOpen = wantsShared && !!uid && !!shared.board;

  /*
    보드가 사라졌으면(나가기 · 삭제 · 계정 변경) 기억해 둔 공간도 되돌린다. 남겨 두면
    다음 접속 때마다 열리지 않는 공간을 향한다.
  */
  useEffect(() => {
    if (wantsShared && shared.ready && !shared.board) set('space', 'me');
  }, [wantsShared, shared.ready, shared.board, set]);

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

  const lens = prefs.lens;
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

  const visible = useMemo(
    () => applyFilters(materialized, lens, filters),
    [materialized, lens, filters],
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
      setSharedOpen(true);
      dialog.toast('초대를 수락했습니다. 같이 보기가 열렸습니다.');
      return;
    }
    // 실패해도 창을 닫지 않는다 — 무엇이 막혔는지 읽고 다시 시도할 수 있어야 한다.
    setJoin((j) => (j ? { ...j, state: result === 'not-found' ? 'not-found' : 'ready' } : j));
  }, [join, shared, dialog, setSharedOpen]);

  const startShare = useCallback((name: string) => {
    const created = shared.createBoard(name);
    if (!created) return;
    // 링크를 바로 보여 준다. 만들고 나서 어디서 찾는지 헤매지 않도록.
    setInvite(created);
    setInvitesReady(true);
    setSharedSheet('settings');
    setSharedOpen(true);
  }, [shared, setSharedOpen]);

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
    setModal({ open: true, mode: 'create', entry: newEntry(kind, { startDate: cursorISOForCreate(today, cursor), ...patch }) });
  }, [lens, today, cursor, isAnon, promptLogin]);

  const openEdit = useCallback((e: Entry) => {
    // 반복 전개분을 눌러도 편집은 항상 원본을 향한다.
    const base = store.entries.find((x) => x.id === baseIdOf(e.id)) ?? e;
    // 회복은 저장·삭제가 아니라 완료·옮기기·건너뛰기가 기본 행동이라 전용 상세로 보낸다.
    if (isRecoveryEntry(base)) { setRecoveryId(base.id); return; }
    setModal({ open: true, mode: 'edit', entry: base });
  }, [store.entries]);

  const closeModal = useCallback(() => setModal((m) => ({ ...m, open: false })), []);

  /**
   * 항목 저장 + 같이 보기 갱신.
   *
   * 공유 갱신은 **따로 한 건 더** 보낸다. 한 배치로 묶으면 공유 쪽이 규칙에 걸리는 순간
   * 개인 TODO 저장까지 함께 실패한다 — 공유 기능 때문에 기존 CRUD 가 멈추는 것은 어떤
   * 정합성보다 나쁘다. 실패한 공유 갱신은 다른 쓰기와 같은 목록에 남고, 남은 차이는
   * 같이 보기 화면을 열 때 맞추기가 메운다.
   *
   * 공유 대상이 아닌 항목은 공유에서 **지운다.** 아이디어 · 가계부로 옮겼거나, 날짜를
   * 지난 날로 고쳤거나, 애초에 지난 일정이면 상대 화면에 남을 이유가 없다. 보드가
   * 없으면 두 호출 모두 아무것도 하지 않는다.
   */
  const persist = useCallback((e: Entry) => {
    if (isAnon || !uid) { void promptLogin(); return; }
    commit({ kind: 'entry', label: '항목', summary: displayTitle(e), payload: e });
    if (isShareableTask(e, today)) shared.pushEntry(e);
    else shared.removeEntry(e.id);
  }, [uid, isAnon, promptLogin, commit, shared, today]);

  const handleSave = useCallback((e: Entry) => {
    persist(e);
    closeModal();
  }, [persist, closeModal]);

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
    const ok = await dialog.confirm({
      title: '이 항목을 삭제할까요?',
      body: (e.isRecurring
        ? '반복 항목입니다. 모든 발생분이 함께 사라집니다.'
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
    commit({
      kind: 'entryDelete', label: '항목 삭제',
      summary: displayTitle(e), payload: { id: baseIdOf(e.id) },
    });
    shared.removeEntry(baseIdOf(e.id));
    dialog.toast('삭제했습니다.');
  }, [uid, isAnon, promptLogin, dialog, closeModal, recovery, commit, shared, today]);

  const handleStatus = useCallback((e: Entry, status: TaskStatus) => {
    const base = store.entries.find((x) => x.id === baseIdOf(e.id)) ?? e;
    if (!base.task) return;
    /*
      오늘 카드의 체크박스는 회복을 완료하는 가장 짧은 길이다. 여기서 상태만 바꾸면
      항목은 완료로 보이는데 다음 예정일과 빚은 그대로 남아, 규칙이 조용히 멈춘다.
    */
    if (isRecoveryEntry(base) && status === 'done') {
      recovery.complete(base, today);
      dialog.toast('회복을 완료했습니다.');
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

  const handleExport = useCallback(async () => {
    if (isAnon || !uid) { void promptLogin(); return; }
    try {
      const all = await fetchAll(db, uid);
      // 회복 규칙은 users/{uid} 문서에 있어 fetchAll 이 보지 않는다.
      // 구독으로 이미 들고 있으니 그대로 실어 보낸다.
      downloadJSON(buildBackup({ ...all, recovery: recovery.rule }), backupFilename());
      dialog.toast(`${countBackup(all).toLocaleString('ko-KR')}건을 내려받았습니다.`);
    } catch (err) {
      dialog.toast(`백업하지 못했습니다. ${describeFirestoreError(err)}`, 'bad');
    }
  }, [db, uid, isAnon, promptLogin, dialog, recovery]);

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

      const mode = await dialog.choose('가져온 데이터를 어떻게 할까요?', [
        { id: 'merge', label: '기존 데이터에 더하기', hint: '같은 항목은 지금 것을 남깁니다. 아무것도 지우지 않습니다.' },
        { id: 'replace', label: '전체 교체 (지금은 사용할 수 없습니다)', hint: '안전하게 되돌릴 방법이 없어 막아 두었습니다.' },
      ], (
        <>
          <p>파일에 {countBackup(incoming).toLocaleString('ko-KR')}건이 들어 있습니다.</p>
          {/* 회복 규칙은 컬렉션이 아니라 계정 설정이라 병합 경로가 건드리지 않는다. */}
          {incoming.recovery && <p className="dlg-warn">{MERGE_SKIPS_RECOVERY}</p>}
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

      dialog.toast(
        outcome.created.created > 0
          ? `${outcome.created.created.toLocaleString('ko-KR')}건을 더했습니다.`
            + (outcome.skippedExisting > 0
              ? ` 이미 있는 ${outcome.skippedExisting.toLocaleString('ko-KR')}건은 그대로 두었습니다.`
              : '')
          : '더할 것이 없습니다. 파일의 항목이 모두 이미 있습니다.',
      );
    } catch (err) {
      dialog.toast(
        `가져오지 못했습니다. ${describeFirestoreError(err)} 기존 데이터는 바뀌지 않았습니다.`,
        'bad',
      );
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

  return (
    <div className="app" data-lens={lens} style={{ ['--lens' as string]: `var(${lensDef.accentVar})` }}>
      <header className="topbar">
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
        {!isAnon && (
          <SpaceSwitch
            space={sharedOpen ? 'shared' : 'me'}
            hasBoard={!!shared.board}
            ready={shared.ready}
            onChange={(next) => setSharedOpen(next === 'shared')}
            onStart={() => setSharedSheet('start')}
          />
        )}

          {!sharedOpen && (
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
            {LENSES.map((l) => (
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

        <div className="mobile-actions">
          {!sharedOpen && <button className="add-btn" aria-label="일정 추가" onClick={() => openCreate()}><Icon.Plus size={16} /></button>}
          <details className="mobile-more" onKeyDown={(e) => {
            if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus(); }
          }}>
            <summary aria-label="더보기">···</summary>
            <div className="mobile-more-panel" onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) e.currentTarget.closest('details')?.removeAttribute('open');
            }}>
              {!sharedOpen && <>
                <button onClick={() => set('view', 'calendar')} aria-pressed={view === 'calendar'}><Icon.Calendar size={16} />캘린더 보기</button>
                <button onClick={() => set('view', 'list')} aria-pressed={view === 'list'}><Icon.List size={16} />리스트 보기</button>
                <button onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters}><Icon.Filter size={16} />필터{hasActiveFilter(filters) ? ' · 적용 중' : ''}</button>
              </>}
              {isAnon
                ? <button onClick={() => setShowAuth(true)}>로그인 · 가입</button>
                : <button onClick={() => setShowSettings(true)}><Icon.Settings size={16} />설정</button>}
            </div>
          </details>
        </div>
        <div className="header-right">
          {!sharedOpen && (
        <div className="tool-r">
          <div className="seg">
            {(['calendar', 'list'] as ViewId[]).map((v) => (
              <button key={v} className={'seg-btn' + (view === v ? ' on' : '')} aria-label={v === 'calendar' ? '캘린더 보기' : '리스트 보기'} aria-pressed={view === v} onClick={() => set('view', v)}>
                {v === 'calendar' ? <Icon.Calendar size={14} /> : <Icon.List size={14} />}
                <span className="lbl">{v === 'calendar' ? '캘린더' : '리스트'}</span>
              </button>
            ))}
          </div>
          <button
            className={'ico-btn' + (showFilters || hasActiveFilter(filters) ? ' on' : '')}
            onClick={() => setShowFilters((x) => !x)}
            aria-label="필터" aria-expanded={showFilters}
          >
            <Icon.Filter size={15} />
            {hasActiveFilter(filters) && <span className="badge" />}
          </button>
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


      {showFilters && (
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
        {!isAnon && (
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
            entries={materialized}
            tideEntries={store.tideEntries}
            tideFrom={tideFrom}
            calcState={calcState}
            accounts={store.accounts}
            budgets={store.budgets}
            reserves={store.reserves}
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

        {/* 가계부 렌즈도 카드 하나다. 대출과 고정 메모는 며칠 버티나 카드 안쪽에 접힌다. */}
        {lens === 'money' && (
          <TideBar
            todayISO={today}
            accounts={store.accounts}
            entries={store.tideEntries}
            budgets={store.budgets}
            reserves={store.reserves}
            tideFrom={tideFrom}
            calcState={calcState}
            hasBalance={hasBalance}
            onSaveAccount={saveBalance}
            onEntryClick={openEdit}
            collapsed={prefs.moneyCardCollapsed}
            onToggleCollapsed={() => set('moneyCardCollapsed', !prefs.moneyCardCollapsed)}
          >
            <BudgetPanel
              budgets={store.budgets}
              reserves={store.reserves}
              entries={store.tideEntries}
              collapsed={prefs.budgetsCollapsed}
              onToggleCollapsed={() => set('budgetsCollapsed', !prefs.budgetsCollapsed)}
              onSaveBudget={(b) => {
                if (isAnon || !uid) { void promptLogin(); return; }
                commit({ kind: 'budget', label: '생활비', summary: b.name, payload: b });
              }}
              onDeleteBudget={async (b) => {
                if (isAnon || !uid) { void promptLogin(); return; }
                const ok = await dialog.confirm({
                  title: `'${b.name}'을(를) 삭제할까요?`,
                  // 연결된 지출은 남는다. 예산이 사라지면 그 돈들은 일반 지출로 돌아간다 —
                  // 사라지지 않고 계산 자리만 바뀐다는 사실을 미리 말해 둔다.
                  body: '이 생활비에서 쓴 지출은 지워지지 않고 별도 지출로 남습니다.',
                  danger: true, confirmLabel: '삭제',
                });
                if (ok) commit({ kind: 'budgetDelete', label: '생활비 삭제', summary: b.name, payload: { id: b.id } });
              }}
              onSaveReserve={(r) => {
                if (isAnon || !uid) { void promptLogin(); return; }
                commit({ kind: 'reserve', label: '세이브', summary: r.name, payload: r });
              }}
              onDeleteReserve={async (r) => {
                if (isAnon || !uid) { void promptLogin(); return; }
                const ok = await dialog.confirm({ title: `'${r.name}'을(를) 삭제할까요?`, danger: true, confirmLabel: '삭제' });
                if (ok) commit({ kind: 'reserveDelete', label: '세이브 삭제', summary: r.name, payload: { id: r.id } });
              }}
              onEntryClick={openEdit}
            />
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
        )}


      </div>

      <main className="main">
        {view === 'calendar' ? (
          <MonthCalendar
            cursor={cursor}
            onCursorChange={setCursor}
            entries={visible}
            tideEntries={store.tideEntries}
            budgets={store.budgets}
            reserves={store.reserves}
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

      {daySheet && (
        <DaySheet
          dateISO={daySheet}
          todayISO={today}
          entries={daySheetEntries}
          moneyEntries={store.entries}
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
            dialog.toast('회복을 완료했습니다.');
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
        debts={store.debts}
        sharedActive={!!shared.board}
        onSave={handleSave}
        onDelete={(e) => void handleDelete(e)}
        onClose={closeModal}
      />

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

      {showSettings && user && (
        <SettingsSheet
          user={user}
          theme={prefs.theme}
          fontScale={prefs.fontScale}
          weekStart={prefs.weekStart}
          entryCount={store.entries.length}
          legacyCount={legacy?.count ?? null}
          migratedAt={legacy?.migratedAt ?? null}
          recoveryRule={recovery.rule}
          onRecoveryRule={recovery.saveRule}
          onTheme={(t) => set('theme', t)}
          onFontScale={(f) => set('fontScale', f)}
          onWeekStart={(w) => set('weekStart', w)}
          onExport={handleExport}
          onImport={handleImport}
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
