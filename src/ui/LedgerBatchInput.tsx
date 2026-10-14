/**
 * 입력 리스트 — 가계부 내역에서 여러 건을 줄로 쭉 적고 한 번에 저장한다.
 *
 * `+` 는 한 건씩 창을 열고 닫는다. 영수증 · 통장 내역을 옮겨 적을 때는 그 왕복이 일이 되어, 줄마다
 * 날짜 · 흐름 · 금액 · 내역 · 카테고리만 두고 Enter 로 다음 줄로 넘어간다(한글 조합 중 Enter 는 넘기지
 * 않는다 — `ime.ts`).
 *
 * 저장하는 것은 거래 창과 같은 모양이다 — 오늘까지는 실제 거래, 앞날은 예정. 흐름은 수입 · 지출 · 대출
 * (`ledgerFlows.ts`). 생활비 연결 · 잔고 반영은 여기서 고르지 않는다(미결정 · 미반영으로 남는다) — 줄마다
 * 고르게 하면 다시 창 하나와 같아진다. 저장 뒤 생활비 창 · 각 거래에서 고른다.
 *
 * 쓰기는 기존 쓰기 큐의 묶음(`ledgerBatch`)이다. 거절된 묶음은 '저장하지 못한 것' 목록에 남는다.
 * 한 줄이라도 금액이 잘못됐으면 아무것도 저장하지 않고 그 줄을 짚는다.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { pickableCategories } from '../domain/category';
import { formatAmount } from '../domain/money';
import type { Category, Entry } from '../domain/types';
import { amountOf, blankRow, filled, problemOf, rowsToEntries, type BatchRow } from './batchRows';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';
import { FLOW_PICKS, type FlowPick } from './ledgerFlows';
import { PICKER } from './pickerField';

export function LedgerBatchInput({ rows, onRows, todayISO, defaultDate, categories, categoriesReady, onSave }: {
  rows: readonly BatchRow[];
  onRows: (rows: BatchRow[]) => void;
  todayISO: string;
  /** 새 줄의 날짜. 보고 있는 기간에 오늘이 있으면 오늘, 아니면 그 기간의 마지막 날. */
  defaultDate: string;
  categories: readonly Category[];
  categoriesReady: boolean;
  onSave: (entries: Entry[], label: string) => Promise<{ ok: number; failed: number }>;
}) {
  const [notice, setNotice] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const refs = useRef(new Map<string, HTMLInputElement>());

  const patch = (key: string, p: Partial<BatchRow>) => onRows(rows.map((r) => {
    if (r.key !== key) return r;
    const next = { ...r, ...p };
    // 카테고리는 흐름마다 따로다. 지출 카테고리를 단 채 수입으로 바꾸면 결산이 엉뚱한 쪽에 선다.
    if (p.pick && p.pick !== r.pick) next.categoryId = null;
    return next;
  }));
  const addRow = (after?: BatchRow) => {
    const last = after ?? rows[rows.length - 1];
    const row = blankRow(last?.date ?? defaultDate, last?.pick ?? 'expense');
    onRows([...rows, row]);
    return row;
  };
  /*
    다음 칸으로 옮기는 포커스. 칸이 이미 있으면 그 자리에서 바로 옮긴다 — 한 박자 늦게 옮기면 빠르게
    이어 치는 글자가 앞 칸에 들어간다(브라우저에서 재현됨). 방금 더한 줄은 그려진 뒤에 옮긴다.
  */
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingFocus) return;
    refs.current.get(pendingFocus)?.focus();
    setPendingFocus(null);
  }, [pendingFocus, rows]);
  const focus = (key: string, field: 'amount' | 'title') => {
    const el = refs.current.get(`${key}:${field}`);
    if (el) el.focus(); else setPendingFocus(`${key}:${field}`);
  };
  /** Enter — 금액 → 내역 → 다음 줄 금액. 마지막 줄이면 줄을 하나 더한다. */
  const onEnter = (r: BatchRow, field: 'amount' | 'title') => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || isComposingEnter(e)) return;
    e.preventDefault();
    if (field === 'amount') { focus(r.key, 'title'); return; }
    const i = rows.findIndex((x) => x.key === r.key);
    const next = rows[i + 1] ?? addRow(r);
    focus(next.key, 'amount');
  };

  const used = rows.filter(filled);
  const problems = rows.filter((r) => problemOf(r) !== null);
  const sum = (pick: FlowPick) => used.filter((r) => r.pick === pick).reduce((t, r) => t + (amountOf(r) ?? 0), 0);
  const planned = used.filter((r) => r.date > todayISO).length;

  const save = () => {
    setNotice('');
    if (used.length === 0) return;
    if (problems.length > 0) { setShowErrors(true); return; }
    const entries = rowsToEntries(rows, todayISO);
    const n = entries.length;
    // 화면은 로컬 반영으로 바로 바뀐다. 서버 확정은 기다리지 않는다 — 오프라인이면 영원히 기다린다.
    onRows([blankRow(rows[rows.length - 1]?.date ?? defaultDate)]);
    setShowErrors(false);
    setNotice(`${n.toLocaleString('ko-KR')}건을 적었습니다.`);
    void onSave(entries, '입력 리스트').then((r) => {
      if (r.failed > 0) setNotice(`${r.failed.toLocaleString('ko-KR')}건을 저장하지 못했습니다 — 위 '저장하지 못한 것' 목록에 남았습니다.`);
    });
  };

  return (
    <div className="bi" role="region" aria-label="입력 리스트">
      <p className="led-note">
        줄마다 적고 한 번에 저장합니다. Enter 로 다음 칸 · 다음 줄로 갑니다. 오늘까지는 실제 거래, 앞날은 예정으로
        저장하고, 생활비 연결 · 잔고 반영은 저장한 뒤 각 거래에서 고릅니다.
      </p>
      <ol className="bi-rows">
        {rows.map((r, i) => {
          const kind = r.pick === 'income' ? 'income' : 'expense';
          const cats = pickableCategories(categories, kind);
          const bad = showErrors ? problemOf(r) : null;
          return (
            <li key={r.key} className={'bi-row' + (bad ? ' bad' : '')}>
              <input
                type="date" className="mod-input bi-date" {...PICKER} aria-label={`${i + 1}번째 줄 날짜`}
                value={r.date} onChange={(e) => patch(r.key, { date: e.target.value })}
              />
              <select
                className="mod-input bi-flow" aria-label={`${i + 1}번째 줄 흐름`}
                value={r.pick} onChange={(e) => patch(r.key, { pick: e.target.value as FlowPick })}
              >
                {FLOW_PICKS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <input
                ref={(el) => { if (el) refs.current.set(`${r.key}:amount`, el); else refs.current.delete(`${r.key}:amount`); }}
                className={'mod-input bi-amt num ' + (r.pick === 'income' ? 'plus' : 'minus')} inputMode="numeric" placeholder="금액"
                aria-label={`${i + 1}번째 줄 금액`} aria-invalid={bad === '금액'}
                value={r.amount} onChange={(e) => patch(r.key, { amount: e.target.value })} onKeyDown={onEnter(r, 'amount')}
              />
              <input
                ref={(el) => { if (el) refs.current.set(`${r.key}:title`, el); else refs.current.delete(`${r.key}:title`); }}
                className="mod-input bi-title" placeholder="내역" maxLength={200}
                aria-label={`${i + 1}번째 줄 내역`}
                value={r.title} onChange={(e) => patch(r.key, { title: e.target.value })} onKeyDown={onEnter(r, 'title')}
              />
              <select
                className="mod-input bi-cat" aria-label={`${i + 1}번째 줄 카테고리`}
                value={r.categoryId ?? ''} disabled={r.pick === 'loan'}
                onChange={(e) => patch(r.key, { categoryId: e.target.value || null })}
              >
                <option value="">{r.pick === 'loan' ? '—' : categoriesReady ? '카테고리' : '불러오는 중'}</option>
                {r.pick !== 'loan' && cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                className="ico-btn sm bi-x" aria-label={`${i + 1}번째 줄 지우기`}
                onClick={() => onRows(rows.length > 1 ? rows.filter((x) => x.key !== r.key) : [blankRow(defaultDate)])}
              >
                <Icon.X size={14} />
              </button>
              {bad && <span className="bi-err" role="alert">{bad === '금액' ? '금액을 0보다 크게 적어 주세요.' : '날짜를 골라 주세요.'}</span>}
            </li>
          );
        })}
      </ol>
      <button className="btn bi-add" onClick={() => { const row = addRow(); focus(row.key, 'amount'); }}>
        <Icon.Plus size={14} /> 줄 추가
      </button>
      <div className="bi-foot">
        <span className="num" aria-label="입력 리스트 합계">
          {used.length.toLocaleString('ko-KR')}건
          {sum('income') > 0 && <> · 수입 <b className="plus">+{formatAmount(sum('income'))}</b></>}
          {sum('expense') > 0 && <> · 지출 <b className="minus">−{formatAmount(sum('expense'))}</b></>}
          {sum('loan') > 0 && <> · 대출 <b className="minus">−{formatAmount(sum('loan'))}</b></>}
          {planned > 0 && ` · 그중 예정 ${planned}건`}
        </span>
        <button className="btn primary" disabled={used.length === 0} onClick={save}>
          {used.length > 0 ? `${used.length.toLocaleString('ko-KR')}건 저장` : '저장'}
        </button>
      </div>
      {showErrors && problems.length > 0 && (
        <p className="mod-err" role="alert">{problems.length}줄을 고쳐야 저장합니다. 아무것도 저장하지 않았습니다.</p>
      )}
      {notice && <p className="led-note" role="status">{notice}</p>}
    </div>
  );
}
