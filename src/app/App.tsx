import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  backupFilename, buildBackup, countBackup, downloadJSON,
  mergeBackup, parseBackup, type BackupData,
} from '../data/backup';
import { describeFirestoreError, isPermissionDenied, RULES_DEPLOY_COMMAND } from '../data/errors';
import { getFirebase } from '../data/firebase';
import { convertLegacyItems, readLegacyItems, summarize } from '../data/migrate';
import {
  deleteAllEntries, deleteDebt, deleteEntry, deletePin, fetchAll, markMigrated,
  readMigrationMark, saveAccount, saveDebt, saveEntry, savePin, saveTaskOrder, writeMany,
} from '../data/repo';
import { projectCashflow } from '../domain/cashflow';
import { LENSES, LENS_BY_ID } from '../domain/constants';
import {
  endOfMonth, fmtMonthTitle, startOfMonth, toISO, todayISO as computeToday,
} from '../domain/date';
import { convertKind, newEntry, withDerived } from '../domain/entry';
import { applyFilters, collectTags, emptyFilters, hasActiveFilter } from '../domain/filters';
import { baseIdOf, materialize } from '../domain/recurrence';
import type { Entry, Filters, LensId, TaskStatus, ViewId } from '../domain/types';
import { Auth } from '../ui/Auth';
import { CashflowBar } from '../ui/CashflowBar';
import { DaySheet } from '../ui/DaySheet';
import { EntryModal } from '../ui/EntryModal';
import { FilterPanel } from '../ui/FilterPanel';
import { Icon } from '../ui/Icon';
import { ListView } from '../ui/ListView';
import { MonthCalendar } from '../ui/MonthCalendar';
import { MonthPicker } from '../ui/MonthPicker';
import { MoneyPanel } from '../ui/MoneyPanel';
import { PinnedSection } from '../ui/PinnedSection';
import { SettingsSheet } from '../ui/SettingsSheet';
import { TodayPanel } from '../ui/TodayPanel';
import { useDialog } from '../ui/Dialog';
import { useAuth } from './useAuth';
import { usePrefs } from './usePrefs';
import { useStore } from './useStore';

export function App() {
  const { state, logout } = useAuth();

  if (state.status === 'loading') return <div className="splash">Dada Calendar</div>;

  if (state.status === 'error') {
    return (
      <div className="fatal">
        <Icon.Alert size={24} />
        <h1>앱을 시작할 수 없습니다</h1>
        <pre>{state.message}</pre>
      </div>
    );
  }

  if (state.status === 'signed-out') return <Auth />;

  return <Workspace uid={state.user.uid} user={state.user} onSignOut={logout} />;
}

interface WorkspaceProps {
  uid: string;
  user: import('firebase/auth').User;
  onSignOut: () => void | Promise<void>;
}

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

  const today = useMemo(() => computeToday(), []);
  const cursorISO = toISO(cursor);
  const store = useStore(uid, cursorISO);
  const { db } = getFirebase();

  const lens = prefs.lens;
  const view = prefs.view;
  const rangeFrom = toISO(startOfMonth(cursor));
  const rangeTo = toISO(endOfMonth(cursor));

  // 반복 항목을 보고 있는 구간에 맞춰 펼친다. 펼친 결과는 저장하지 않는다.
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

  // 현금흐름은 필터와 무관하게 전체 가계부 항목으로 계산한다.
  // 필터로 항목을 가렸다고 잔고가 늘어나면 안 된다.
  const cashflow = useMemo(
    () => projectCashflow(store.accounts, materialized, rangeFrom, rangeTo),
    [store.accounts, materialized, rangeFrom, rangeTo],
  );

  const hasBalance = store.accounts.length > 0;
  const hasMoneyData = hasBalance || store.debts.length > 0 || materialized.some((e) => e.kind === 'money');

  // 이관 전 컬렉션이 남아 있는지, 이미 옮겼는지 한 번만 확인한다.
  const checkedLegacy = useRef(false);
  useEffect(() => {
    if (checkedLegacy.current) return;
    checkedLegacy.current = true;
    Promise.all([readLegacyItems(db, uid), readMigrationMark(db, uid)])
      .then(([items, migratedAt]) => setLegacy({ count: items.length, migratedAt }))
      .catch(() => setLegacy(null));
  }, [db, uid]);

  // ---------- 액션 ----------

  const openCreate = useCallback((patch: Partial<Entry> = {}) => {
    const kind = LENS_BY_ID[lens]?.kind ?? 'task';
    setModal({ open: true, mode: 'create', entry: newEntry(kind, { startDate: cursorISOForCreate(today, cursor), ...patch }) });
  }, [lens, today, cursor]);

  const openEdit = useCallback((e: Entry) => {
    // 반복 전개분을 눌러도 편집은 항상 원본을 향한다.
    const base = store.entries.find((x) => x.id === baseIdOf(e.id)) ?? e;
    setModal({ open: true, mode: 'edit', entry: base });
  }, [store.entries]);

  const closeModal = useCallback(() => setModal((m) => ({ ...m, open: false })), []);

  const persist = useCallback((e: Entry) => {
    void saveEntry(db, uid, e).catch((err: unknown) => {
      dialog.toast(`저장하지 못했습니다. ${describeFirestoreError(err)}`, 'bad');
    });
  }, [db, uid, dialog]);

  const handleSave = useCallback((e: Entry) => {
    persist(e);
    closeModal();
  }, [persist, closeModal]);

  const handleDelete = useCallback(async (e: Entry) => {
    const ok = await dialog.confirm({
      title: '이 항목을 삭제할까요?',
      body: e.isRecurring
        ? '반복 항목입니다. 모든 발생분이 함께 사라집니다.'
        : '되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    closeModal();
    try {
      await deleteEntry(db, uid, baseIdOf(e.id));
      dialog.toast('삭제했습니다.');
    } catch (err) {
      dialog.toast(`삭제하지 못했습니다. ${describeFirestoreError(err)}`, 'bad');
    }
  }, [db, uid, dialog, closeModal]);

  const handleStatus = useCallback((e: Entry, status: TaskStatus) => {
    const base = store.entries.find((x) => x.id === baseIdOf(e.id)) ?? e;
    if (!base.task) return;
    persist(withDerived({ ...base, task: { ...base.task, status } }));
  }, [store.entries, persist]);

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

    void saveTaskOrder(db, uid, next.map((e, i) => ({ id: baseIdOf(e.id), order: i })))
      .catch((err: unknown) => dialog.toast(`순서를 저장하지 못했습니다. ${describeFirestoreError(err)}`, 'bad'));
  }, [materialized, db, uid, dialog]);

  // ---------- 백업 / 복원 / 이관 ----------

  const handleExport = useCallback(async () => {
    try {
      const all = await fetchAll(db, uid);
      downloadJSON(buildBackup(all), backupFilename());
      dialog.toast(`${countBackup(all).toLocaleString('ko-KR')}건을 내려받았습니다.`);
    } catch (err) {
      dialog.toast(`백업하지 못했습니다. ${describeFirestoreError(err)}`, 'bad');
    }
  }, [db, uid, dialog]);

  const handleImport = useCallback(async () => {
    const file = await pickFile('application/json');
    if (!file) return;

    let incoming: BackupData;
    try {
      incoming = parseBackup(await file.text());
    } catch (err) {
      dialog.toast(err instanceof Error ? err.message : '파일을 읽지 못했습니다.', 'bad');
      return;
    }

    const mode = await dialog.choose('가져온 데이터를 어떻게 할까요?', [
      { id: 'merge', label: '기존 데이터에 더하기', hint: '같은 항목은 지금 것을 남깁니다.' },
      { id: 'replace', label: '전체 교체', hint: '지금 항목을 모두 지우고 파일 내용으로 바꿉니다.', danger: true },
    ], `파일에 ${countBackup(incoming).toLocaleString('ko-KR')}건이 들어 있습니다.`);
    if (!mode) return;

    try {
      if (mode === 'replace') {
        const confirmed = await dialog.confirm({
          title: '지금 데이터를 모두 지울까요?',
          body: '되돌릴 수 없습니다. 먼저 백업을 받아 두는 편이 안전합니다.',
          confirmLabel: '지우고 교체',
          danger: true,
        });
        if (!confirmed) return;
        await deleteAllEntries(db, uid);
        await writeMany(db, uid, incoming);
      } else {
        const current = await fetchAll(db, uid);
        const merged = mergeBackup(current, incoming);
        await writeMany(db, uid, {
          entries: merged.entries.filter((e) => !current.entries.some((c) => c.id === e.id)),
          accounts: merged.accounts.filter((a) => !current.accounts.some((c) => c.id === a.id)),
          debts: merged.debts.filter((d) => !current.debts.some((c) => c.id === d.id)),
          pins: merged.pins.filter((p) => !current.pins.some((c) => c.id === p.id)),
        });
      }
      dialog.toast('가져왔습니다.');
    } catch (err) {
      dialog.toast(`가져오지 못했습니다. ${describeFirestoreError(err)}`, 'bad');
    }
  }, [db, uid, dialog]);

  const handleMigrate = useCallback(async () => {
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
              <p>레포에서 아래 명령을 실행한 뒤 다시 시도해 주세요.</p>
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
  }, [db, uid, dialog, legacy]);

  // ---------- 렌더 ----------

  const lensDef = LENS_BY_ID[lens] ?? LENSES[0]!;
  const monthLabel = fmtMonthTitle(cursor);
  const daySheetEntries = daySheet
    ? visible.filter((e) => e.startDate <= daySheet && (e.endDate ?? e.startDate) >= daySheet)
    : [];

  return (
    <div className="app" data-lens={lens} style={{ ['--lens' as string]: `var(${lensDef.accentVar})` }}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon.Calendar size={15} /></span>
          <span className="brand-name">Dada Calendar</span>
        </div>

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

        <button className="ico-btn" onClick={() => setShowSettings(true)} aria-label="설정">
          <Icon.Settings size={16} />
        </button>
      </header>

      <div className="toolbar">
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

        <div className="tool-r">
          <div className="seg">
            {(['calendar', 'list'] as ViewId[]).map((v) => (
              <button key={v} className={'seg-btn' + (view === v ? ' on' : '')} onClick={() => set('view', v)}>
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
          <button className="add-btn" onClick={() => openCreate()}>
            <Icon.Plus size={16} /><span className="lbl">추가</span>
          </button>
        </div>
      </div>

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
            막고 있습니다. 레포에서 아래 명령을 한 번 실행하면 됩니다.
          </p>
          <pre className="setup-cmd">{RULES_DEPLOY_COMMAND}</pre>
          <p className="setup-note">
            기존 데이터는 예전 <code>items</code> 컬렉션에 그대로 있습니다. 사라진 것이 아닙니다.
          </p>
        </div>
      )}

      {store.error && (
        <div className="banner bad"><Icon.Alert size={14} />{store.error}</div>
      )}

      <div className="side">
        {lens === 'all' && (
          <TodayPanel
            todayISO={today}
            entries={materialized}
            cashflow={cashflow}
            hasBalance={hasBalance}
            onEntryClick={openEdit}
            onStatusChange={handleStatus}
            onPromote={handlePromote}
            onQuickIdea={persist}
          />
        )}

        {/* 가계부 렌즈에서는 항상, 전체 렌즈에서는 실제로 쓰고 있을 때만 보여 준다. */}
        {(lens === 'money' || (lens === 'all' && hasMoneyData)) && (
          <>
            {lens === 'money' && (
              <CashflowBar result={cashflow} monthLabel={monthLabel} hasBalance={hasBalance} onPointClick={setDaySheet} />
            )}
            <MoneyPanel
              accounts={store.accounts}
              debts={store.debts}
              collapsed={prefs.debtsCollapsed}
              onToggleCollapsed={() => set('debtsCollapsed', !prefs.debtsCollapsed)}
              onSaveAccount={(a) => void saveAccount(db, uid, a)}
              onSaveDebt={(d) => void saveDebt(db, uid, d)}
              onDeleteDebt={async (d) => {
                const ok = await dialog.confirm({ title: `'${d.name}'을(를) 삭제할까요?`, danger: true, confirmLabel: '삭제' });
                if (ok) void deleteDebt(db, uid, d.id);
              }}
            />
          </>
        )}

        {lens !== 'money' && (
          <PinnedSection
            lens={lens}
            pins={store.pins}
            collapsed={!!prefs.pinCollapsed[lens]}
            onToggleCollapsed={() => set('pinCollapsed', { ...prefs.pinCollapsed, [lens]: !prefs.pinCollapsed[lens] })}
            onSave={(p) => void savePin(db, uid, p)}
            onDelete={(p) => void deletePin(db, uid, p.id)}
          />
        )}
      </div>

      <main className="main">
        {view === 'calendar' ? (
          <MonthCalendar
            cursor={cursor}
            onCursorChange={setCursor}
            entries={visible}
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
          cashflow={cashflow.points.find((p) => p.date === daySheet) ?? null}
          onClose={() => setDaySheet(null)}
          onEntryClick={(e) => { setDaySheet(null); openEdit(e); }}
          onAdd={() => { const iso = daySheet; setDaySheet(null); openCreate({ startDate: iso }); }}
        />
      )}

      <EntryModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.entry}
        allTags={allTags}
        linkableTasks={linkableTasks}
        onSave={handleSave}
        onDelete={(e) => void handleDelete(e)}
        onClose={closeModal}
      />

      {showSettings && (
        <SettingsSheet
          user={user}
          theme={prefs.theme}
          weekStart={prefs.weekStart}
          entryCount={store.entries.length}
          legacyCount={legacy?.count ?? null}
          migratedAt={legacy?.migratedAt ?? null}
          onTheme={(t) => set('theme', t)}
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
