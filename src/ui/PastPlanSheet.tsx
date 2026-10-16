/**
 * 지난 예정 정리 — 설정에서만 연다. 일회성 데이터 정리이고, 자동으로 돌지 않는다.
 *
 * 순서가 곧 안전장치다. 앞 단계가 끝나지 않으면 뒤 단계 버튼이 열리지 않는다.
 *   1. 서버에서 전부 읽어 가른다 (`scanPastPlanned`) — 후보 · 확인 필요 · 막힘. 캐시로 고르지 않는다
 *   2. 백업을 내려받고, **그 파일을 다시 골라** 고른 항목이 모두 들어 있는지 확인한다 — 내려받기를
 *      눌렀다는 것만으로는 파일이 저장됐는지 알 수 없다
 *   3. 고른 것을 모두 지운 뒤에도 보이는 숫자(한도 · 예상 잔고 · 생활비)가 같은지 확인한다
 *   4. 마지막 확인창 → 묶음 삭제(기존 쓰기 큐) → 서버 확정을 기다려 → 서버에서 다시 읽어 확인
 *
 * 지우는 것은 고른 한 번짜리 예정 문서뿐이다. 실제 거래 · 반복 예정 · 잔고 · 생활비 · 세이브에는
 * 쓰지 않는다.
 */
import { reserveUsageOf } from '../domain/budget';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readBackupFile } from '../data/backupFile';
import { MONEY_TYPE_BY_ID } from '../domain/constants';
import { displayTitle } from '../domain/entry';
import { flowBadge } from '../domain/ledgerStats';
import { formatAmount } from '../domain/money';
import {
  impactOfRemoving, pastPlanTotals, scanPastPlanned, type PastPlanItem,
} from '../domain/pastPlanned';
import type { Account, Budget, Card, Entry, Reserve } from '../domain/types';
import { useDialog } from './Dialog';
import { Icon } from './Icon';

export interface PastPlanData {
  entries: Entry[]; accounts: Account[]; budgets: Budget[]; reserves: Reserve[];
  /** 신용카드(P4). 미결제를 같은 원장 전량에서 센다. */
  cards?: Card[];
}

interface Props {
  todayISO: string;
  /** 서버에서만 읽는다. 오프라인이면 던진다. */
  load: () => Promise<PastPlanData>;
  /** 전체 백업 파일을 내려받는다. 실패하면 false. */
  onBackup: () => Promise<boolean>;
  /** 고른 id 를 묶음으로 지운다. 서버가 받은 묶음 · 거절된 묶음의 항목 수를 돌려준다. */
  onDelete: (ids: string[]) => Promise<{ ok: number; failed: number }>;
  onClose: () => void;
}

/** 정리 대상은 몇 달 · 몇 해 전일 수 있다 — 달을 늘 적고, 올해가 아니면 해도 적는다. */
function dayLabel(iso: string, todayISO: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const md = `${Number(m)}월 ${Number(d)}일`;
  return y === todayISO.slice(0, 4) ? md : `${y}년 ${md}`;
}

type Phase = 'loading' | 'error' | 'ready' | 'deleting';

export function PastPlanSheet({ todayISO, load, onBackup, onDelete, onClose }: Props) {
  const dialog = useDialog();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [data, setData] = useState<PastPlanData | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [backup, setBackup] = useState<{ name: string; ids: ReadonlySet<string> } | null>(null);
  const [backupMsg, setBackupMsg] = useState('');
  const [result, setResult] = useState<{ ok: number; failed: number; remaining: number | null } | null>(null);
  const running = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setPhase('loading');
    try {
      const d = await load();
      setData(d);
      // 처음에는 후보만 골라 둔다. 확인 필요는 사용자가 직접 고른다. 막힘은 고를 수 없다.
      // 자료와 같은 순간에 정한다 — 그린 뒤 effect 로 고르면, 그 사이에 누른 '전체 선택' 을 덮는다.
      const sc = scanPastPlanned(d.entries, d.accounts, todayISO, {
        budgets: d.budgets, reserves: d.reserves, reserveUsage: reserveUsageOf(d.entries),
        cards: d.cards ?? [], cardEntries: d.entries.filter((e) => !!e.money?.cardId),
      });
      setSelected(new Set(sc.items.filter((i) => i.group === 'candidate').map((i) => i.entry.id)));
      setPhase('ready');
      return d;
    } catch {
      setError(navigator.onLine === false
        ? '연결이 없습니다. 정리는 서버에서 전부 읽은 목록으로만 고릅니다 — 연결한 뒤 다시 열어 주세요.'
        : '서버에서 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.');
      setPhase('error');
      return null;
    }
  };
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 세이브 사용액은 서버에서 읽은 원장 전량에서 센다 — 지울 후보는 예정뿐이라 이 값을 바꾸지 않는다.
  const res = useMemo(() => ({
    budgets: data?.budgets ?? [], reserves: data?.reserves ?? [], reserveUsage: reserveUsageOf(data?.entries ?? []),
    // 카드 미결제(P4)도 같은 원장 전량에서 센다. 지울 후보는 예정뿐이라 이 값도 바뀌지 않는다.
    cards: data?.cards ?? [], cardEntries: (data?.entries ?? []).filter((e) => !!e.money?.cardId),
  }), [data]);
  const scan = useMemo(
    () => (data ? scanPastPlanned(data.entries, data.accounts, todayISO, res) : null),
    [data, todayISO, res],
  );

  const byId = useMemo(() => new Map((scan?.items ?? []).map((i) => [i.entry.id, i])), [scan]);
  const picked = useMemo(() => [...selected].map((id) => byId.get(id)).filter((x): x is PastPlanItem => !!x), [selected, byId]);
  const totals = pastPlanTotals(picked);
  const impact = useMemo(
    () => (data && picked.length > 0 && data.accounts.length > 0
      ? impactOfRemoving(data.entries, data.accounts, todayISO, res, selected)
      : null),
    [data, picked.length, todayISO, res, selected],
  );
  const impactOk = picked.length > 0 && (impact === null || impact.same);
  const backupCovers = !!backup && picked.length > 0 && picked.every((i) => backup.ids.has(i.entry.id));
  const canRun = phase === 'ready' && picked.length > 0 && backupCovers && impactOk;

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const selectable = (scan?.items ?? []).filter((i) => i.group !== 'blocked');

  const verify = async (file: File) => {
    setBackupMsg('');
    let text: string;
    try { text = await file.text(); } catch {
      setBackup(null); setBackupMsg('파일을 읽지 못했습니다.'); return;
    }
    const read = readBackupFile(text);
    if (!read.ok) { setBackup(null); setBackupMsg('이 파일은 캘린더X 백업으로 읽을 수 없습니다.'); return; }
    const inFile = new Map(read.file.data.entries.map((e) => [e.id, e]));
    // 같은 id 이면서 같은 날짜 · 금액이어야 한다 — 이름만 같은 다른 파일을 받아들이지 않는다.
    // 목록 전체를 견줘 둔다 — 고른 것을 나중에 바꿔도 파일을 다시 고르지 않게.
    const ids = new Set((scan?.items ?? [])
      .filter((i) => {
        const f = inFile.get(i.entry.id);
        return f && f.startDate === i.entry.startDate && f.money?.amountMinor === i.entry.money?.amountMinor;
      })
      .map((i) => i.entry.id));
    setBackup({ name: file.name, ids });
    const missing = picked.filter((i) => !ids.has(i.entry.id)).length;
    setBackupMsg(missing === 0
      ? `확인했습니다 — ${file.name} 에 고른 ${picked.length.toLocaleString('ko-KR')}건이 모두 들어 있습니다.`
      : `${file.name} 에 고른 항목 ${missing.toLocaleString('ko-KR')}건이 없거나 내용이 다릅니다. 방금 내려받은 백업을 골라 주세요.`);
  };

  const run = async () => {
    if (!canRun || running.current || !data) return;
    const ok = await dialog.confirm({
      title: `고른 예정 ${picked.length.toLocaleString('ko-KR')}건을 지울까요?`,
      body: (
        <>
          <p>날짜가 지난 한 번짜리 예정만 지웁니다. 실제 거래 · 반복 예정 · 잔고 · 생활비 · 세이브는 그대로입니다.</p>
          <p>되돌리려면 확인한 백업 파일({backup?.name})을 설정 &gt; 데이터에서 가져오면 됩니다.</p>
        </>
      ),
      confirmLabel: '지우기', danger: true,
    });
    if (!ok || running.current) return;
    running.current = true;
    setPhase('deleting');
    const ids = picked.map((i) => i.entry.id);
    const sent = await onDelete(ids);
    // 서버에서 다시 읽어 실제로 사라졌는지 센다 — 큐에 넣은 것과 서버에 반영된 것은 다른 사건이다.
    const fresh = await reload();
    const left = fresh ? ids.filter((id) => fresh.entries.some((e) => e.id === id)).length : null;
    setResult({ ...sent, remaining: left });
    // 백업 확인은 지운 뒤 다시 받는다 — 다음 정리는 새 백업으로.
    setBackup(null);
    setBackupMsg('');
    running.current = false;
  };

  const row = (i: PastPlanItem) => {
    const e = i.entry;
    const m = e.money!;
    const links = [m.budgetId && '생활비 연결', m.debtId && '대출 연결', m.linkedEntryId && '할 일 연결'].filter(Boolean);
    const disabled = i.group === 'blocked' || phase !== 'ready';
    return (
      <li key={e.id} className={'pp-row' + (i.group === 'blocked' ? ' blocked' : '')}>
        <label>
          <input
            type="checkbox" checked={selected.has(e.id)} disabled={disabled}
            onChange={() => toggle(e.id)} aria-label={`${e.title.trim() || displayTitle(e)} ${e.startDate} 고르기`}
          />
          <span className="pp-d num">{dayLabel(e.startDate, todayISO)}{i.span && ` – ${dayLabel(e.endDate ?? e.startDate, todayISO)}`}</span>
          <span className="pp-t">
            <span className="pp-n">{e.title.trim() || displayTitle(e)}</span>
            <span className="pp-m">
              {[MONEY_TYPE_BY_ID[m.type].label + (MONEY_TYPE_BY_ID[m.type].legacy ? '(예전)' : ''), flowBadge(e), ...links, i.reason]
                .filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className={'pp-a num' + (i.sign > 0 ? ' plus' : i.sign < 0 ? ' minus' : '')}>
            {i.sign > 0 ? '+' : i.sign < 0 ? '−' : ''}{formatAmount(i.amount)}
          </span>
        </label>
      </li>
    );
  };

  const group = (g: PastPlanItem['group'], title: string, note: string) => {
    const list = (scan?.items ?? []).filter((i) => i.group === g);
    if (list.length === 0) return null;
    return (
      <section className="pp-grp" aria-label={title}>
        <h3 className="pp-gt">{title} <span className="num">{list.length.toLocaleString('ko-KR')}건</span></h3>
        <p className="pp-note">{note}</p>
        <ul>{list.map(row)}</ul>
      </section>
    );
  };

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="sheet pp" role="dialog" aria-modal="true" aria-label="지난 예정 정리" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-h">
          <div>
            <div className="sheet-eyebrow">데이터 정리 · 한 번만</div>
            <h2 className="sheet-t">지난 예정 정리</h2>
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>
        <div className="sheet-b">
          <p className="pp-note">
            날짜가 지났는데 확정하지 않은 <b>한 번짜리 예정</b>을 골라 지웁니다. 실제 거래 · 반복 예정 · 잔고 · 생활비 ·
            세이브는 건드리지 않습니다. 백업을 확인하고, 숫자가 그대로인지 본 뒤에만 지웁니다.
          </p>

          {phase === 'loading' && <p className="pp-state" role="status">서버에서 가계부 전체를 읽는 중입니다.</p>}
          {phase === 'error' && <p className="pp-state" role="alert">{error}</p>}

          {result && (
            <div className="pp-result" role="status">
              <b>정리 결과</b>
              <span className="num">
                서버가 받은 삭제 {result.ok.toLocaleString('ko-KR')}건
                {result.failed > 0 && ` · 거절 ${result.failed.toLocaleString('ko-KR')}건('저장하지 못한 것' 목록에 남았습니다)`}
              </span>
              {result.remaining !== null
                ? <span className="num">서버에서 다시 읽어 확인: {result.remaining === 0 ? '고른 항목이 모두 지워졌습니다' : `${result.remaining.toLocaleString('ko-KR')}건이 아직 남아 있습니다`}</span>
                : <span>서버에서 다시 읽지 못해 지워졌는지 확인하지 못했습니다.</span>}
            </div>
          )}

          {scan && (phase === 'ready' || phase === 'deleting') && (
            scan.items.length === 0 ? (
              <p className="pp-state">정리할 지난 예정이 없습니다.</p>
            ) : (
              <>
                <div className="pp-sum" aria-label="고른 항목 요약">
                  <span className="num">
                    고른 {totals.count.toLocaleString('ko-KR')}건
                    {totals.from && ` · ${dayLabel(totals.from, todayISO)} – ${dayLabel(totals.to ?? totals.from, todayISO)}`}
                  </span>
                  <span className="num">
                    예정 수입 {totals.incomeCount}건 <b className="plus">+{formatAmount(totals.income)}</b>
                    {' · '}예정 지출 {totals.outflowCount}건 <b className="minus">−{formatAmount(totals.outflow)}</b>
                  </span>
                  <span className="pp-note">
                    목록에 넣지 않은 것: 반복 예정 {scan.excluded.recurring}건(원본과 앞으로의 회차) · 확정한 예정 {scan.excluded.confirmed}건 ·
                    오늘 · 앞날 예정 {scan.excluded.todayOrLater}건 · 실제 거래 전부
                  </span>
                  <span className="pp-tools">
                    <button className="chip" disabled={phase !== 'ready'} onClick={() => setSelected(new Set(selectable.map((i) => i.entry.id)))}>전체 선택</button>
                    <button className="chip" disabled={phase !== 'ready'} onClick={() => setSelected(new Set())}>모두 해제</button>
                  </span>
                </div>

                {group('candidate', '정리 후보', '이미 잔고 안에 든 날짜의 예정이라 지워도 숫자가 바뀌지 않습니다. 실제로 받거나 낸 돈이었다면 지우기 전에 확정해 두세요.')}
                {group('review', '확인 필요', '기간 예정 · 예전 종류는 무엇이었는지 단정할 수 없어 미리 고르지 않았습니다.')}
                {group('blocked', '지금은 정리할 수 없음', '지우면 지금 보이는 한도 · 예상 잔고 · 생활비가 바뀝니다. 실제로 오간 돈이면 그 날짜 상세에서 확정하고, 아니면 잔고를 오늘 날짜로 다시 적은 뒤 정리하세요.')}

                <section className="pp-step" aria-label="백업 확인">
                  <h3 className="pp-gt">1. 백업</h3>
                  <p className="pp-note">전체 백업을 내려받은 뒤, 그 파일을 다시 골라 고른 항목이 모두 들어 있는지 확인합니다.</p>
                  <span className="pp-tools">
                    <button className="btn" disabled={phase !== 'ready'} onClick={() => { void onBackup(); }}>
                      <Icon.Download size={14} /> 백업 내려받기
                    </button>
                    <button className="btn" disabled={phase !== 'ready' || picked.length === 0} onClick={() => fileRef.current?.click()}>
                      받은 백업 파일 확인
                    </button>
                    <input
                      ref={fileRef} type="file" accept="application/json,.json" hidden
                      onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) void verify(f); }}
                    />
                  </span>
                  {backupMsg && <p className={'pp-note' + (backupCovers ? ' ok' : ' warn')} role="status">{backupMsg}</p>}
                </section>

                <section className="pp-step" aria-label="계산 영향">
                  <h3 className="pp-gt">2. 계산 영향</h3>
                  {picked.length === 0 ? <p className="pp-note">고른 항목이 없습니다.</p>
                    : impact === null ? <p className="pp-note">잔고가 없어 계산하는 숫자가 없습니다 — 영향이 없습니다.</p>
                      : (
                        <p className={'pp-note num' + (impact.same ? ' ok' : ' warn')}>
                          가용 한도 {formatAmount(impact.before.headline)} → {formatAmount(impact.after.headline)} ·
                          오늘 예상 잔고 {formatAmount(impact.before.projectedToday)} → {formatAmount(impact.after.projectedToday)}
                          {impact.before.pockets !== impact.after.pockets && ' · 생활비 숫자가 바뀝니다'}
                          {impact.same ? ' — 그대로입니다.' : ' — 바뀌므로 지금 고른 대로는 지울 수 없습니다. 생활비에 걸린 항목 등을 빼 주세요.'}
                        </p>
                      )}
                </section>

                <footer className="pp-run">
                  <button className="btn primary danger" disabled={!canRun} onClick={() => { void run(); }}>
                    {phase === 'deleting' ? '지우는 중 — 서버 확인을 기다립니다…' : `고른 ${picked.length.toLocaleString('ko-KR')}건 정리`}
                  </button>
                  {!canRun && phase === 'ready' && picked.length > 0 && (
                    <span className="pp-note">
                      {!backupCovers ? '백업 파일 확인이 끝나야 지울 수 있습니다.' : '계산 영향이 없어야 지울 수 있습니다.'}
                    </span>
                  )}
                </footer>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
