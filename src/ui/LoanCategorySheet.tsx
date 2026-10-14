/**
 * 예전 '대출' 카테고리 지출 정리 — 설정 > 데이터에서만 연다. 자동으로 돌지 않는다(`domain/loanCategory.ts`).
 *
 * 서버에서 전부 읽어 미리보기를 보이고, 고른 것만 흐름을 대출(원금)로 바꾼다. 잔고 · 한도는 그대로이고
 * 분석의 소비 · 카테고리 예산 사용에서 빠져 대금으로 옮겨진다. 방금 바꾼 것은 이 창에서 되돌릴 수 있다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { scanLoanCategoryEntries, toLoanFlow, toNormalFlow } from '../domain/loanCategory';
import { isActual } from '../domain/ledger';
import { formatAmount } from '../domain/money';
import type { Category, Entry } from '../domain/types';
import { useDialog } from './Dialog';
import { Icon } from './Icon';

interface Props {
  categories: readonly Category[];
  /** 서버에서만 읽는다. 오프라인이면 던진다. */
  load: () => Promise<Entry[]>;
  onBackup: () => Promise<boolean>;
  /** 고친 거래를 묶음으로 쓴다. 서버가 받은 · 거절한 건수. */
  onApply: (entries: Entry[], label: string) => Promise<{ ok: number; failed: number }>;
  onClose: () => void;
}

const dayLabel = (iso: string) => `${iso.slice(0, 4)}. ${Number(iso.slice(5, 7))}. ${Number(iso.slice(8, 10))}.`;
const n = (v: number) => v.toLocaleString('ko-KR');

export function LoanCategorySheet({ categories, load, onBackup, onApply, onClose }: Props) {
  const dialog = useDialog();
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready' | 'running'>('loading');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<{ ok: number; failed: number; left: number | null; undo: boolean } | null>(null);
  /** 이 창에서 방금 대출로 바꾼 거래 — 되돌리기 대상. */
  const [moved, setMoved] = useState<string[]>([]);
  const running = useRef(false);

  const reload = async () => {
    setPhase('loading');
    try {
      const list = await load();
      setEntries(list);
      // 자료와 같은 순간에 고른다 — 그린 뒤 effect 로 고르면 그 사이의 선택을 덮는다.
      setSelected(new Set(scanLoanCategoryEntries(list, categories).convert.map((e) => e.id)));
      setPhase('ready');
      return list;
    } catch {
      setPhase('error');
      return null;
    }
  };
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = useMemo(() => scanLoanCategoryEntries(entries, categories), [entries, categories]);
  const picked = scan.convert.filter((e) => selected.has(e.id));
  const actual = picked.filter(isActual);
  const sum = (list: readonly Entry[]) => list.reduce((t, e) => t + Math.abs(e.money?.amountMinor ?? 0), 0);

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const run = async () => {
    if (running.current || picked.length === 0) return;
    const ok = await dialog.confirm({
      title: `${n(picked.length)}건을 대출로 바꿀까요?`,
      body: (
        <>
          <p>흐름만 지출 → 대출(원금)로 바뀝니다. 금액 · 날짜 · 카테고리 · 잔고 · 한도는 그대로입니다.</p>
          <p>분석의 소비와 카테고리 예산 사용에서 실제 거래 {n(actual.length)}건 · {formatAmount(sum(actual))}원이 빠지고 대금으로 옮겨집니다.</p>
        </>
      ),
      confirmLabel: '대출로 바꾸기',
    });
    if (!ok || running.current) return;
    running.current = true;
    setPhase('running');
    const now = new Date().toISOString();
    const ids = picked.map((e) => e.id);
    const sent = await onApply(picked.map((e) => toLoanFlow(e, now)), "예전 '대출' 카테고리 정리");
    const fresh = await reload();
    const left = fresh ? fresh.filter((e) => ids.includes(e.id) && e.money?.flow !== 'loanPrincipal').length : null;
    setMoved(fresh ? ids.filter((id) => fresh.some((e) => e.id === id && e.money?.flow === 'loanPrincipal')) : ids);
    setResult({ ...sent, left, undo: false });
    running.current = false;
  };

  const undo = async () => {
    if (running.current || moved.length === 0) return;
    running.current = true;
    setPhase('running');
    const now = new Date().toISOString();
    const back = entries.filter((e) => moved.includes(e.id) && e.money?.flow === 'loanPrincipal').map((e) => toNormalFlow(e, now));
    const sent = await onApply(back, "예전 '대출' 카테고리 정리 되돌리기");
    const fresh = await reload();
    const left = fresh ? fresh.filter((e) => moved.includes(e.id) && e.money?.flow === 'loanPrincipal').length : null;
    setMoved([]);
    setResult({ ...sent, left, undo: true });
    running.current = false;
  };

  const row = (e: Entry, checkable: boolean) => (
    <li key={e.id} className="pp-row">
      <label>
        {checkable
          ? <input type="checkbox" checked={selected.has(e.id)} disabled={phase !== 'ready'} onChange={() => toggle(e.id)} aria-label={`${e.title.trim() || '대출'} ${e.startDate} 고르기`} />
          : <input type="checkbox" disabled aria-hidden="true" />}
        <span className="pp-d num">{dayLabel(e.startDate)}</span>
        <span className="pp-t">
          <span className="pp-n">{e.title.trim() || '대출'}</span>
          <span className="pp-m">{isActual(e) ? '실제' : '예정'}{e.recurrence ? ' · 반복' : ''}</span>
        </span>
        <span className="pp-a num minus">−{formatAmount(Math.abs(e.money?.amountMinor ?? 0))}</span>
      </label>
    </li>
  );

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="sheet pp" role="dialog" aria-modal="true" aria-label="예전 대출 카테고리 정리" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-h">
          <div>
            <div className="sheet-eyebrow">데이터 정리 · 한 번만</div>
            <h2 className="sheet-t">예전 '대출' 카테고리 정리</h2>
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>
        <div className="sheet-b">
          <p className="pp-note">
            대출이 카테고리였을 때 지출로 적은 거래를 흐름 <b>대출</b>로 옮깁니다. 지금은 소비로 세어져 분석의 소비가
            그만큼 큽니다. 잔고 · 한도는 바뀌지 않습니다.
          </p>
          {phase === 'loading' && <p className="pp-state" role="status">서버에서 가계부 전체를 읽는 중입니다.</p>}
          {phase === 'error' && <p className="pp-state" role="alert">서버에서 읽지 못했습니다. 연결을 확인한 뒤 다시 열어 주세요.</p>}

          {result && (
            <div className="pp-result" role="status">
              <b>{result.undo ? '되돌린 결과' : '정리 결과'}</b>
              <span className="num">서버가 받은 {n(result.ok)}건{result.failed > 0 && ` · 거절 ${n(result.failed)}건('저장하지 못한 것' 목록에 남았습니다)`}</span>
              {result.left !== null
                ? <span className="num">서버에서 다시 읽어 확인: {result.left === 0 ? '모두 반영됐습니다' : `${n(result.left)}건이 아직 그대로입니다`}</span>
                : <span>서버에서 다시 읽지 못해 확인하지 못했습니다.</span>}
              {!result.undo && moved.length > 0 && (
                <button className="btn" disabled={phase !== 'ready'} onClick={() => { void undo(); }}>방금 바꾼 {n(moved.length)}건 되돌리기</button>
              )}
            </div>
          )}

          {(phase === 'ready' || phase === 'running') && (
            scan.convert.length === 0 && scan.pocketLinked.length === 0 ? (
              <p className="pp-state">옮길 거래가 없습니다.{scan.alreadyLoan > 0 && ` 이미 대출로 센 거래 ${n(scan.alreadyLoan)}건은 그대로입니다.`}</p>
            ) : (
              <>
                <div className="pp-sum" aria-label="고른 항목 요약">
                  <span className="num">고른 {n(picked.length)}건 · 실제 {n(actual.length)}건 {formatAmount(sum(actual))}원 · 예정 {n(picked.length - actual.length)}건</span>
                  <span className="pp-note">
                    목록에 넣지 않은 것: 이미 대출 {n(scan.alreadyLoan)}건 · 예전 유형(카드 · 이체 등) {n(scan.other.length)}건
                  </span>
                  <span className="pp-tools">
                    <button className="chip" disabled={phase !== 'ready'} onClick={() => setSelected(new Set(scan.convert.map((e) => e.id)))}>전체 선택</button>
                    <button className="chip" disabled={phase !== 'ready'} onClick={() => setSelected(new Set())}>모두 해제</button>
                  </span>
                </div>
                {scan.convert.length > 0 && (
                  <section className="pp-grp" aria-label="옮길 거래">
                    <h3 className="pp-gt">옮길 거래 <span className="num">{n(scan.convert.length)}건</span></h3>
                    <ul>{scan.convert.map((e) => row(e, true))}</ul>
                  </section>
                )}
                {scan.pocketLinked.length > 0 && (
                  <section className="pp-grp" aria-label="생활비에 걸린 거래">
                    <h3 className="pp-gt">생활비에 걸린 거래 <span className="num">{n(scan.pocketLinked.length)}건</span></h3>
                    <p className="pp-note">대출은 생활비에 걸지 않습니다. 옮기면 생활비 연결이 풀려 남은 생활비 · 한도가 바뀌므로 여기서는 옮기지 않습니다 — 거래를 열어 흐름에서 대출을 고르세요.</p>
                    <ul>{scan.pocketLinked.map((e) => row(e, false))}</ul>
                  </section>
                )}
                <footer className="pp-run">
                  <button className="btn" disabled={phase !== 'ready'} onClick={() => { void onBackup(); }}>
                    <Icon.Download size={14} /> 백업 내려받기 (선택)
                  </button>
                  <button className="btn primary" disabled={phase !== 'ready' || picked.length === 0} onClick={() => { void run(); }}>
                    {phase === 'running' ? '바꾸는 중 — 서버 확인을 기다립니다…' : `고른 ${n(picked.length)}건 대출로 바꾸기`}
                  </button>
                </footer>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
