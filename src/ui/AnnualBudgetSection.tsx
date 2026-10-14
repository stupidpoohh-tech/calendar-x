/**
 * 연간 카테고리 예산 (Financial Core P2) — 예산 보기 안의 한 묶음.
 *
 * 별도 대시보드를 세우지 않는다. 예산 보기의 월간 카테고리 줄과 **같은 모양의 줄**(카테고리 · 예산 · 사용 ·
 * 남음 · 사용률)로 그 해의 연간 예산을 견주고, 줄을 누르면 그 아래에 배분 · 달별 사용 · 그 해 거래가 펼쳐진다.
 *
 * 연간 예산 · 월별 배분은 **계획**이다. 저장해도 잔고 · 예상 잔고 · 가용 한도는 그대로다(`annualBudget.ts`).
 * 미래에 실제로 나갈 돈은 예정 거래로 따로 적는다 — 그 말을 화면이 적는다.
 */
import { useEffect, useState } from 'react';
import {
  allocatedTotal, annualBudgetProblem, MONTH_NOS, newAnnualBudget, type AnnualRow,
} from '../domain/annualBudget';
import { formatAmount, parseAmountToMinor } from '../domain/money';
import type { AnnualBudget, Entry, MonthNo } from '../domain/types';
import { isComposingEnter } from './ime';
import { TxCard } from './TxCard';
import { UsageBar } from './UsageBar';

const monthLabel = (m: MonthNo) => `${Number(m)}월`;

/** 금액 칸의 글자 → 최소 단위. 비우면 null, 못 읽으면 NaN(저장을 막는다). */
function readAmount(text: string): number | null {
  if (text.trim() === '') return null;
  const v = parseAmountToMinor(text);
  return v === null || v < 0 ? Number.NaN : v;
}

const toText = (v: number | null | undefined) => (v == null ? '' : String(v));

/**
 * 연간 예산 입력 — 연간 금액 하나가 기본이고, 월별 배분은 눌러서 펼친다(선택).
 * 배분 합 · 미배분을 그 자리에서 보이고, 합이 연간 예산을 넘으면 저장을 막는다.
 */
export function AnnualBudgetForm({
  categoryId, categoryName, year, initial, onSave, onCancel,
}: {
  categoryId: string;
  categoryName: string;
  year: number;
  initial: AnnualBudget | null;
  onSave: (b: AnnualBudget) => void;
  onCancel: () => void;
}) {
  const [amountText, setAmountText] = useState(toText(initial?.amountMinor));
  const [months, setMonths] = useState<Partial<Record<MonthNo, string>>>(() => {
    const out: Partial<Record<MonthNo, string>> = {};
    for (const m of MONTH_NOS) {
      const v = initial?.monthAllocations[m];
      if (v) out[m] = String(v);
    }
    return out;
  });
  const [showMonths, setShowMonths] = useState(false);

  const amount = readAmount(amountText);
  const parsedMonths: Partial<Record<MonthNo, number>> = {};
  let monthsBad = false;
  for (const m of MONTH_NOS) {
    const v = readAmount(months[m] ?? '');
    if (v === null) continue;
    if (Number.isNaN(v)) { monthsBad = true; continue; }
    if (v > 0) parsedMonths[m] = v;
  }
  const allocated = allocatedTotal({ monthAllocations: parsedMonths });
  const amountOk = amount !== null && !Number.isNaN(amount);
  const draft = amountOk
    ? newAnnualBudget(categoryId, year, amount, parsedMonths, initial?.createdAt)
    : null;
  const problem = draft ? annualBudgetProblem(draft) : 'amount';
  const ok = !monthsBad && problem === null;
  const over = amountOk ? allocated - amount : 0;

  const save = () => {
    if (!ok || !draft) return;
    const now = new Date().toISOString();
    onSave({ ...draft, createdAt: initial?.createdAt || now, updatedAt: now });
  };

  return (
    <div className="led-bl-edit ab-form" role="group" aria-label={`${categoryName} 연간 예산`}>
      <p className="led-note">대상 연도 <b>{year}년</b> · 1월 1일 ~ 12월 31일</p>
      <input
        className="mod-input num" inputMode="numeric" placeholder="연간 예산" autoFocus
        aria-label={`${categoryName} ${year}년 연간 예산`} value={amountText}
        onChange={(e) => setAmountText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e)) save(); }}
      />
      <button
        type="button" className="ab-toggle" aria-expanded={showMonths} onClick={() => setShowMonths((v) => !v)}
      >
        월별 배분 설정 (선택){allocated > 0 && !showMonths ? ` · 배분 ${formatAmount(allocated)}` : ''}
      </button>
      {showMonths && (
        <div className="ab-months" role="group" aria-label="월별 배분">
          {MONTH_NOS.map((m) => (
            <label key={m}>
              {monthLabel(m)}
              <input
                className="mod-input num" inputMode="numeric" placeholder="—"
                aria-label={`${monthLabel(m)} 배분`} value={months[m] ?? ''}
                onChange={(e) => setMonths((p) => ({ ...p, [m]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e)) save(); }}
              />
            </label>
          ))}
        </div>
      )}
      {amountOk && (
        <p className={'led-note num' + (over > 0 ? ' ab-bad' : '')} aria-live="polite">
          월별 배분 {formatAmount(allocated)} · {over > 0
            ? `연간 예산보다 ${formatAmount(over)} 많습니다 — 저장할 수 없습니다`
            : `미배분 ${formatAmount(amount - allocated)}`}
        </p>
      )}
      {monthsBad && <p className="led-note ab-bad">월별 배분 금액을 읽을 수 없는 달이 있습니다.</p>}
      <div className="led-bl-a">
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" disabled={!ok} onClick={save}>연간 예산 저장</button>
      </div>
      <p className="led-note">
        연간 예산과 월별 배분은 계획입니다. 잔고 · 가용 한도에서 빠지지 않고, 거래도 만들지 않습니다.
        날짜가 정해진 지출은 예정 거래로 따로 적어 주세요.
      </p>
    </div>
  );
}

/** 예산 보기 안의 '연간 예산 · N년' 묶음. 그 해 연간 예산이 하나도 없으면 그리지 않는다. */
export function AnnualBudgetSection({
  year, rows, canChange, yearEntries, onEntryClick, onSave, onDelete,
}: {
  year: number;
  rows: readonly AnnualRow[];
  /** 올해 · 앞날이면 월간으로 되돌릴 수 있다. */
  canChange: boolean;
  /** 그 해(1/1 ~ 12/31)의 실제 소비 — 펼친 줄의 거래 카드. */
  yearEntries: (categoryId: string) => readonly Entry[];
  onEntryClick?: (e: Entry) => void;
  onSave: (b: AnnualBudget) => void;
  onDelete: (b: AnnualBudget) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setOpen(null); }, [year]);
  if (rows.length === 0) return null;
  const budgeted = rows.reduce((t, r) => t + r.budget.amountMinor, 0);
  const actual = rows.reduce((t, r) => t + r.actual, 0);
  const left = budgeted - actual;

  return (
    <section className="ab" aria-label={`연간 예산 ${year}년`}>
      <h3 className="led-sec-h">연간 예산 · {year}년</h3>
      <div className="led-bsum" role="group" aria-label="연간 예산 요약">
        <div className="led-bsum-n">
          <div><span>연간 예산</span><b className="num">{formatAmount(budgeted)}</b></div>
          <div><span>실제 사용</span><b className="num">{formatAmount(actual)}</b></div>
          <div>
            <span>{left < 0 ? '초과' : '남은 예산'}</span>
            <b className={'num ' + (left < 0 ? 'minus' : 'plus')}>{formatAmount(Math.abs(left))}</b>
          </div>
        </div>
        <p className="led-note">
          {year}년 1월 1일 ~ 12월 31일의 실제 사용(소비 + 대출 이자)과 견줍니다 — 정산 기간과 경계가 다를 수 있습니다.
          예산은 계획이라 잔고 · 가용 한도에 들어가지 않습니다.
        </p>
      </div>
      <div className="led-bl-cols" aria-hidden="true">
        <span>카테고리</span><span>연간 예산</span><span>사용</span><span>남음</span><span>사용률</span>
      </div>
      <ul className="led-budgets" aria-label={`${year}년 연간 예산`}>
        {rows.map((r) => (
          <AnnualLine
            key={r.categoryId} row={r} year={year} canChange={canChange}
            open={open === r.categoryId}
            onToggle={() => setOpen(open === r.categoryId ? null : r.categoryId)}
            entries={open === r.categoryId ? yearEntries(r.categoryId) : []}
            onEntryClick={onEntryClick} onSave={onSave} onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  );
}

function AnnualLine({
  row, year, canChange, open, onToggle, entries, onEntryClick, onSave, onDelete,
}: {
  row: AnnualRow; year: number; canChange: boolean; open: boolean; onToggle: () => void;
  entries: readonly Entry[];
  onEntryClick?: (e: Entry) => void;
  onSave: (b: AnnualBudget) => void;
  onDelete: (b: AnnualBudget) => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'toMonthly'>('view');
  useEffect(() => { if (!open) setMode('view'); }, [open]);
  const budget = row.budget.amountMinor;
  const shown = row.months.filter((m) => m.allocation !== null || m.actual > 0 || m.planned > 0);

  return (
    <li className={'led-bl' + (open ? ' open' : '')}>
      <button className="led-bl-main cols" onClick={onToggle} aria-expanded={open}>
        <span className="led-bl-n">
          {row.name}{row.archived && ' (보관)'}
          <span className="led-badge muted">연간</span>
        </span>
        <span className="led-bl-c num" aria-label={`연간 예산 ${formatAmount(budget)}`}>{formatAmount(budget)}</span>
        <span className="led-bl-c num" aria-label={`사용 ${formatAmount(row.actual)}`}>{formatAmount(row.actual)}</span>
        <span
          className={'led-bl-c num' + (row.over ? ' minus' : '')}
          aria-label={row.over ? `초과 ${formatAmount(-row.remaining)}` : `남음 ${formatAmount(row.remaining)}`}
        >
          {row.over
            ? <><span className="led-bl-ovw">초과 </span><span className="led-bl-ovs">−</span>{formatAmount(-row.remaining)}</>
            : formatAmount(row.remaining)}
        </span>
        {budget > 0
          ? <UsageBar used={row.actual} budget={budget} />
          : <span className="led-bl-c led-bl-none" aria-label="사용률 없음">—</span>}
      </button>
      {open && mode !== 'edit' && (
        <div className="ab-detail">
          <p className="led-note num">
            {row.allocated > 0
              ? <>월별 배분 {formatAmount(row.allocated)} · 미배분 {formatAmount(row.unallocated)}</>
              : '월별 배분 없음 — 연간 예산 전체가 미배분입니다'}
            {row.planned > 0 && <> · 남은 예정 {formatAmount(row.planned)} (실제 사용에 넣지 않음)</>}
          </p>
          {shown.length > 0 && (
            <ul className="ab-mlist" aria-label={`${row.name} 달별 계획과 사용`}>
              {shown.map((m) => {
                const left = m.allocation !== null ? m.allocation - m.actual : null;
                return (
                  <li key={m.month} className="num">
                    <span className="ab-m">{monthLabel(m.month)}</span>
                    <span>
                      {m.allocation !== null ? `계획 ${formatAmount(m.allocation)} · ` : '배분 없음 · '}
                      사용 {formatAmount(m.actual)}
                      {left !== null && (left < 0
                        ? <b className="minus"> · 초과 {formatAmount(-left)}</b>
                        : ` · 남음 ${formatAmount(left)}`)}
                      {m.planned > 0 && ` · 예정 ${formatAmount(m.planned)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {open && mode !== 'edit' && (
        <TxCard
          label={`${row.name} ${year}년 거래`} scope={`${year}년`} entries={entries}
          fallbackTitle={row.name} onEntryClick={onEntryClick}
        >
          {mode === 'view' && (
            <div className="led-bl-a">
              <button className="btn led-bl-editbtn" onClick={() => setMode('edit')}>연간 예산 고치기</button>
              {canChange && (
                <button className="btn led-bl-editbtn" onClick={() => setMode('toMonthly')}>월간으로 바꾸기</button>
              )}
            </div>
          )}
        </TxCard>
      )}
      {open && mode === 'toMonthly' && (
        <div className="led-bl-edit" role="group" aria-label="월간으로 바꾸기">
          <p className="led-note">
            {year}년 {row.name} 연간 예산과 월별 배분을 지우고 월간 예산으로 돌아갑니다. 실제 거래와 월간 예산 기록은
            그대로이고, 이 해에 정해 둔 월간 예산이 있으면 다시 보입니다.
          </p>
          <div className="led-bl-a">
            <button className="btn" onClick={() => setMode('view')}>취소</button>
            <button className="btn primary" onClick={() => { setMode('view'); onDelete(row.budget); }}>
              연간 예산 지우고 월간으로
            </button>
          </div>
        </div>
      )}
      {open && mode === 'edit' && (
        <AnnualBudgetForm
          categoryId={row.categoryId} categoryName={row.name} year={year} initial={row.budget}
          onCancel={() => setMode('view')}
          onSave={(b) => { setMode('view'); onSave(b); }}
        />
      )}
    </li>
  );
}
