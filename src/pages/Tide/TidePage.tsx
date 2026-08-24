/**
 * /tide — 잔고캘린더.
 *
 * tide-over 앱을 캘린더X 안에 이식한 독립 서브페이지.
 *
 * 원본 원칙(tide-over CLAUDE.md §4 · §7):
 *   서버도, 계정도, 자동 동기화도 없다.
 *   localStorage 만 쓰고, 백업은 URL 프래그먼트에 상태 전체를 담는다.
 *
 * 캘린더X 로그인해서 가계부 렌즈로 가면 같은 계산을 계정에 얹어서 볼 수 있다 —
 * "여기는 익명, 저기는 계정" 이 두 앱의 관계다. 데이터는 오가지 않는다.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { addDaysISO, fmtDayShort, todayISO } from '../../domain/date';
import { formatAmount, formatSigned, minorToInput, parseAmountToMinor } from '../../domain/money';
import { headlineLimit, horizonOf, summarize, upcomingInHorizon } from '../../domain/tide';
import { MONEY_TYPES } from '../../domain/constants';
import { newEntry, uid } from '../../domain/entry';
import type { Entry, MoneyType } from '../../domain/types';
import { useDialog } from '../../ui/Dialog';
import { BrandFooter } from '../../ui/BrandFooter';
import { Icon } from '../../ui/Icon';
import {
  clearTide, decodeBackupHash, emptyTideState, encodeBackupHash,
  loadTide, saveTide, type TideState,
} from '../../data/tideLocal';

export function TidePage() {
  const [state, setState] = useState<TideState>(() => loadTide());
  const [tab, setTab] = useState<'calendar' | 'settings'>('calendar');
  const dialog = useDialog();

  useEffect(() => { saveTide(state); }, [state]);

  // 탭 제목까지 갈라 놓는다. index.html 의 '캘린더X' 를 그대로 두면 주소만 다르고
  // 브라우저에는 같은 앱으로 보인다 — 여기는 계정도 서버도 없는 별개 앱이다.
  useEffect(() => { document.title = '잔고캘린더'; }, []);

  // 첫 방문 시 URL 프래그먼트에 백업 링크가 있으면 복원 제안
  useEffect(() => {
    const incoming = decodeBackupHash(location.hash);
    if (!incoming) return;
    const hasLocalData = state.account.balanceMinor !== 0 || state.entries.length > 0;
    (async () => {
      const ok = await dialog.confirm({
        title: '백업 링크로 복원',
        body: hasLocalData
          ? '지금 이 브라우저에 있는 데이터를 백업 링크의 내용으로 교체합니다. 되돌릴 수 없습니다.'
          : '백업 링크의 데이터를 이 브라우저에 불러옵니다.',
        confirmLabel: '복원',
        danger: hasLocalData,
      });
      if (ok) setState(incoming);
      history.replaceState(null, '', location.pathname);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = useMemo(() => todayISO(), []);
  const horizon = useMemo(() => horizonOf(state.entries, today), [state.entries, today]);
  const limit = useMemo(
    () => headlineLimit([state.account], state.entries, today),
    [state, today],
  );
  const upcoming = useMemo(
    () => summarize(upcomingInHorizon(state.entries, today, horizon)),
    [state.entries, today, horizon],
  );

  return (
    <div className="tp-root">
      <header className="tp-top">
        <h1 className="tp-brand">잔고캘린더</h1>
        <nav className="tp-tabs">
          {(['calendar', 'settings'] as const).map((t) => (
            <button
              key={t}
              className={'tp-tab' + (tab === t ? ' on' : '')}
              onClick={() => setTab(t)}
            >
              {t === 'calendar' ? '달력' : '설정'}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'calendar' ? (
        <CalendarTab
          state={state}
          onChange={setState}
          today={today}
          limit={limit}
          horizon={horizon}
          upcoming={upcoming}
        />
      ) : (
        <SettingsTab state={state} onReset={() => { clearTide(); setState(emptyTideState()); }} />
      )}

      <footer className="tp-foot">
        <a href="/" className="tp-back"><Icon.ArrowUpRight size={12} /> 캘린더X 로</a>
      </footer>
      <BrandFooter />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 달력 탭 — 최소 스코프. 헤드라인 + 잔고 편집 + 남은 예정 + 추가 다이얼로그.

interface CalendarTabProps {
  state: TideState;
  onChange: (s: TideState) => void;
  today: string;
  limit: number;
  horizon: ReturnType<typeof horizonOf>;
  upcoming: ReturnType<typeof summarize>;
}

function CalendarTab({ state, onChange, today, limit, horizon, upcoming }: CalendarTabProps) {
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceText, setBalanceText] = useState('');
  const [entryDialog, setEntryDialog] = useState<Entry | null>(null);

  const daysLeft = Math.max(1, Math.round(
    (new Date(horizon.end).getTime() - new Date(today).getTime()) / 86_400_000,
  ) + 1);
  const perDay = Math.floor(limit / daysLeft);

  const startEditBalance = () => {
    setBalanceText(minorToInput(state.account.balanceMinor));
    setEditingBalance(true);
  };

  const commitBalance = () => {
    const minor = parseAmountToMinor(balanceText);
    setEditingBalance(false);
    if (minor === null) return;
    const now = new Date().toISOString();
    onChange({
      ...state,
      account: {
        ...state.account,
        balanceMinor: minor,
        asOf: now.slice(0, 10),
        checkedAt: now,
        updatedAt: now,
      },
    });
  };

  const addOrUpdateEntry = (entry: Entry) => {
    setEntryDialog(null);
    onChange({
      ...state,
      entries: state.entries.some((e) => e.id === entry.id)
        ? state.entries.map((e) => (e.id === entry.id ? entry : e))
        : [...state.entries, entry],
    });
  };

  const deleteEntry = (id: string) => {
    setEntryDialog(null);
    onChange({ ...state, entries: state.entries.filter((e) => e.id !== id) });
  };

  return (
    <div className="tp-body">
      <section className={'tp-head' + (limit < 0 ? ' bad' : '')}>
        <p className="tp-head-l">
          {horizon.nextIncome
            ? <>다음 입금(<b>{fmtDayShort(horizon.nextIncome)}</b>) 전날까지</>
            : '앞으로 30일'}
        </p>
        <strong className="tp-head-v num">₩ {formatAmount(limit)}</strong>
        <p className="tp-head-s num">
          이 돈으로 <b>{daysLeft}일</b> 버티기 · 하루 <b>{formatAmount(perDay)}원</b>
        </p>
      </section>

      <section className="tp-bal">
        <span className="tp-bal-l"><Icon.Wallet size={14} /> 통장 잔고</span>
        {editingBalance ? (
          <input
            className="tp-bal-in num" type="text" inputMode="numeric" autoFocus
            value={balanceText} onChange={(e) => setBalanceText(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') commitBalance();
              if (e.key === 'Escape') setEditingBalance(false);
            }}
            onBlur={commitBalance}
          />
        ) : (
          <button className="tp-bal-v num" onClick={startEditBalance}>
            ₩ {formatAmount(state.account.balanceMinor)}
          </button>
        )}
        <span className="tp-bal-at">{state.account.asOf} 기록</span>
      </section>

      <section className="tp-list-wrap">
        <div className="tp-list-h">
          <h2>남은 예정</h2>
          <button className="btn primary" onClick={() => setEntryDialog(newEntry('money', { startDate: today }))}>
            <Icon.Plus size={13} /> 추가
          </button>
        </div>
        {upcoming.length === 0 ? (
          <p className="tp-empty">이 구간에 예정된 입금·출금이 없습니다.</p>
        ) : (
          <ul className="tp-list">
            {upcoming.map((u) => {
              const money = u.entry.money!;
              const sign = money.type === 'income' ? 1 : -1;
              const isSpan = u.from !== u.to;
              return (
                <li key={u.key}>
                  <button className="tp-item" onClick={() => setEntryDialog(u.entry)}>
                    <span className="tp-item-when num">
                      {isSpan ? `${fmtDayShort(u.from)}–${fmtDayShort(u.to)}` : fmtDayShort(u.from)}
                    </span>
                    <span className="tp-item-name">{u.entry.title || moneyTypeLabel(money.type)}</span>
                    <span className={'tp-item-amt num ' + (sign > 0 ? 'plus' : 'minus')}>
                      {formatSigned(sign * u.amountMinor)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {entryDialog && (
        <EntryDialog
          initial={entryDialog}
          today={today}
          onSave={addOrUpdateEntry}
          onDelete={state.entries.some((e) => e.id === entryDialog.id)
            ? () => deleteEntry(entryDialog.id)
            : undefined}
          onClose={() => setEntryDialog(null)}
        />
      )}
    </div>
  );
}

function moneyTypeLabel(type: MoneyType): string {
  return MONEY_TYPES.find((t) => t.id === type)?.label ?? '';
}

// ─────────────────────────────────────────────────────────────────
// 예정 추가·편집 다이얼로그. tide-over 원본의 EntryDialog 를 최소 구성으로.

interface EntryDialogProps {
  initial: Entry;
  today: string;
  onSave: (e: Entry) => void;
  onDelete?: () => void;
  onClose: () => void;
}

type ScheduleKind = 'once' | 'monthly' | 'every' | 'span';

function scheduleKindOf(e: Entry): ScheduleKind {
  if (e.recurrence?.freq === 'monthly') return 'monthly';
  if (e.recurrence) return 'every';
  if (e.endDate && e.endDate > e.startDate) return 'span';
  return 'once';
}

function EntryDialog({ initial, today, onSave, onDelete, onClose }: EntryDialogProps) {
  const isNew = !initial.title && !initial.money?.amountMinor;
  const [title, setTitle] = useState(initial.title);
  const [kind, setKind] = useState<'income' | 'expense'>(
    initial.money?.type === 'income' ? 'income' : 'expense',
  );
  const [amountText, setAmountText] = useState(
    initial.money?.amountMinor ? minorToInput(initial.money.amountMinor) : '',
  );
  const [schedKind, setSchedKind] = useState<ScheduleKind>(scheduleKindOf(initial));
  const [startDate, setStartDate] = useState(initial.startDate || today);
  const [endDate, setEndDate] = useState(initial.endDate ?? addDaysISO(today, 6));
  const [everyDays, setEveryDays] = useState(initial.recurrence?.interval ?? 7);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amountMinor = parseAmountToMinor(amountText);
    if (amountMinor == null || amountMinor === 0) return;

    let recurrence: Entry['recurrence'] = null;
    let finalEndDate: string | null = null;
    if (schedKind === 'monthly') {
      recurrence = { freq: 'monthly', interval: 1, until: null, count: null };
    } else if (schedKind === 'every') {
      recurrence = { freq: 'daily', interval: Math.max(1, everyDays), until: null, count: null };
    } else if (schedKind === 'span') {
      finalEndDate = endDate >= startDate ? endDate : startDate;
    }

    const now = new Date().toISOString();
    onSave({
      ...initial,
      id: initial.id || uid(),
      title: title.trim(),
      startDate,
      endDate: finalEndDate,
      recurrence,
      isRecurring: recurrence !== null,
      money: {
        type: kind === 'income' ? 'income' : 'expense',
        amountMinor: Math.abs(amountMinor),
        currency: 'KRW',
        linkedEntryId: null,
      },
      ymSpan: [startDate.slice(0, 7), ...(finalEndDate ? [finalEndDate.slice(0, 7)] : [])],
      updatedAt: now,
      createdAt: initial.createdAt || now,
    });
  };

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="mod tp-mod" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="mod-head">
          <h2 className="mod-t">{isNew ? '예정 추가' : '예정 편집'}</h2>
          <button className="ico-btn" onClick={onClose}><Icon.X size={16} /></button>
        </header>

        <form className="mod-body" onSubmit={submit}>
          <div className="tp-kinds">
            <button type="button"
              className={'tp-kind' + (kind === 'expense' ? ' on' : '')}
              data-k="expense" onClick={() => setKind('expense')}>나가는 돈</button>
            <button type="button"
              className={'tp-kind' + (kind === 'income' ? ' on' : '')}
              data-k="income" onClick={() => setKind('income')}>들어올 돈</button>
          </div>

          <label className="tp-field">
            <span>이름</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="예: 월세" />
          </label>

          <label className="tp-field">
            <span>금액</span>
            <div className="tp-amt-row">
              <input inputMode="numeric" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0" />
              <span>원</span>
            </div>
          </label>

          <div className="tp-field">
            <span>주기</span>
            <div className="tp-scheds">
              {([
                ['once', '한 번'],
                ['monthly', '매달'],
                ['every', 'N일마다'],
                ['span', '기간'],
              ] as [ScheduleKind, string][]).map(([id, label]) => (
                <button
                  type="button" key={id}
                  className={'chip' + (schedKind === id ? ' on' : '')}
                  onClick={() => setSchedKind(id)}
                >{label}</button>
              ))}
            </div>
          </div>

          <label className="tp-field">
            <span>{schedKind === 'span' ? '시작' : schedKind === 'once' ? '날짜' : schedKind === 'monthly' ? '매달 며칠(선택한 날짜의 일)' : '기준일'}</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>

          {schedKind === 'span' && (
            <label className="tp-field">
              <span>종료</span>
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          )}

          {schedKind === 'every' && (
            <label className="tp-field">
              <span>N 일마다</span>
              <input type="number" min={1} value={everyDays}
                onChange={(e) => setEveryDays(Number(e.target.value) || 1)} />
            </label>
          )}
        </form>

        <footer className="mod-foot">
          {onDelete && (
            <button type="button" className="btn danger ghost" onClick={onDelete}>
              <Icon.Trash size={14} /> 삭제
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" className="btn primary" onClick={(e) => submit(e as unknown as FormEvent)}>저장</button>
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 설정 탭 — 백업 링크, 저장소 상태, 초기화.

function SettingsTab({ state, onReset }: { state: TideState; onReset: () => void }) {
  const dialog = useDialog();
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(
    () => localStorage.getItem('calendarx.tide.backupAt'),
  );

  const copyBackup = async () => {
    const url = `${location.origin}/tide#${encodeBackupHash(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      const at = new Date().toISOString();
      localStorage.setItem('calendarx.tide.backupAt', at);
      setLastBackupAt(at);
      dialog.toast('백업 링크를 복사했습니다.');
    } catch {
      dialog.toast('복사에 실패했습니다. 링크가 너무 길거나 권한이 없습니다.', 'bad');
    }
  };

  const reset = async () => {
    const ok = await dialog.confirm({
      title: '모든 데이터를 지울까요?',
      body: '되돌릴 수 없습니다. 먼저 백업 링크를 복사해 두는 편이 안전합니다.',
      confirmLabel: '지우기',
      danger: true,
    });
    if (ok) onReset();
  };

  return (
    <div className="tp-body">
      <section className="tp-card">
        <h2>백업</h2>
        <p className="tp-hint">
          데이터는 이 브라우저에만 있습니다. 백업 링크는 상태 전체를 주소에 담은 것이라,
          링크만 있으면 어디서든 복원됩니다.
        </p>
        <button className="btn primary" onClick={copyBackup}>백업 링크 복사</button>
        {lastBackupAt && (
          <p className="tp-hint tp-when">마지막 백업: {new Date(lastBackupAt).toLocaleString('ko-KR')}</p>
        )}
      </section>

      <section className="tp-card">
        <h2>저장소</h2>
        <dl className="tp-info">
          <div><dt>저장 위치</dt><dd>이 브라우저 (localStorage)</dd></div>
          <div><dt>예정 항목</dt><dd className="num">{state.entries.length}건</dd></div>
        </dl>
      </section>

      <section className="tp-card tp-danger">
        <h2>초기화</h2>
        <button className="btn danger ghost" onClick={reset}>모든 데이터 지우기</button>
      </section>
    </div>
  );
}
