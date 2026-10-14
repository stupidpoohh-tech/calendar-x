/**
 * 예정 회차를 실제 거래로 확정한다.
 *
 * 예정 금액과 날짜가 기본값이고, 실제로 다르면 고친다. 저장하면 실제 거래 **한 건**이
 * 생긴다 — 예정 원본과 반복 규칙은 그대로이고, 이 회차만 계산 · 화면에서 빠진다
 * (`domain/confirm.ts`). 같은 회차는 언제나 같은 문서라 두 번 확정해도 한 건이다.
 *
 * 편집 창 위에 겹쳐 띄우지 않는다 — 부르는 쪽이 편집 창을 닫고 이것을 연다.
 */
import { useEffect, useRef, useState } from 'react';
import { budgetCovers, pocketEligible } from '../domain/budget';
import { confirmOccurrence, needsTypeChoice, pocketChoiceFor, type ConfirmRefusal } from '../domain/confirm';
import { confirmedEntryId, moneyFlowOf } from '../domain/ledger';
import { fmtDayShort } from '../domain/date';
import { formatAmount, minorToInput, parseAmountToMinor } from '../domain/money';
import type { Account, Budget, Category, Debt, Entry, MoneyFields } from '../domain/types';
import { Icon } from './Icon';
import { FlowChips } from './FlowChips';
import { LedgerFields } from './LedgerFields';
import { flowLabel, flowPickPatch, type FlowPick } from './ledgerFlows';
import { PICKER } from './pickerField';
import { isComposingEnter } from './ime';

interface Props {
  plan: Entry;
  occurrenceDate: string;
  categories: readonly Category[];
  categoriesReady: boolean;
  onSeedCategories?: () => void;
  accounts: readonly Account[];
  budgets: readonly Budget[];
  debts: readonly Debt[];
  /** `reflected` — "이 잔고에 이미 반영됨" 을 고른 값. 손대지 않았으면 undefined. */
  onSave: (actual: Entry, opts?: { reflected?: boolean }) => void;
  onClose: () => void;
}

const REASONS: Record<ConfirmRefusal, string> = {
  'not-money': '가계부 항목이 아닙니다.',
  virtual: '반복 원본을 찾지 못했습니다. 다시 열어 주세요.',
  'already-actual': '이미 실제 거래입니다.',
  span: '기간형 예정은 확정하지 않습니다. 실제로 쓴 돈은 새 거래로 적어 주세요.',
  'legacy-unconfirmable': '예전 유형(생활비 · 세이브 · 가용)은 확정하지 않습니다. 실제로 쓴 돈은 새 거래로 적어 주세요.',
  'legacy-needs-choice': '예전 유형입니다. 수입 · 지출과 거래 유형을 골라 주세요.',
  'not-occurrence': '이 날짜는 이 예정의 회차가 아닙니다.',
  'invalid-flow': '들어온 돈에는 카드 · 대출 유형을 고를 수 없습니다.',
  'invalid-amount': '금액을 확인해 주세요.',
  'invalid-date': '날짜를 확인해 주세요.',
};

export function ConfirmSheet({
  plan, occurrenceDate, categories, categoriesReady, onSeedCategories,
  accounts, budgets, debts, onSave, onClose,
}: Props) {
  const legacy = needsTypeChoice(plan);
  const planMoney = plan.money!;
  const [amountText, setAmountText] = useState(() => minorToInput(planMoney.amountMinor, planMoney.currency));
  const [date, setDate] = useState(occurrenceDate);
  const [pocketTouched, setPocketTouched] = useState(!!planMoney.budgetId);
  // 새로 만드는 거래라 기본은 미선택이다. 손대지 않아도 false 로 보낸다 — 같은 회차를 확정
  // 취소했다 다시 확정하면 같은 id 라, 옛 반영 목록에 남은 값이 저절로 살아나면 안 된다.
  const [reflected, setReflected] = useState(false);
  const [money, setMoney] = useState<MoneyFields>(() => {
    const type = legacy ? undefined : planMoney.type === 'income' ? 'income' : 'expense';
    const base: MoneyFields = {
      ...planMoney,
      type: (type ?? 'expense'),
      // legacy 는 고르기 전까지 유형이 비어 있다. 일반으로 미리 채우면 추정이 된다.
      flow: legacy ? undefined : planMoney.flow ?? 'normal',
      status: 'actual',
    };
    // 일반 지출만, 그리고 예정에서 이미 고른 사용처(주머니 · 생활비 외)는 덮지 않는다.
    if (base.budgetId || base.outsidePocket || !pocketEligible({ money: base, recurrence: null })) return base;
    return { ...base, budgetId: pocketChoiceFor(occurrenceDate, budgets).selected?.id ?? null };
  });
  const [typeChosen, setTypeChosen] = useState(!legacy);
  const [error, setError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => amountRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const type: 'income' | 'expense' = money.type === 'income' ? 'income' : 'expense';
  const pockets = budgets.filter((b) => budgetCovers(b, date));

  const patch = (p: Partial<MoneyFields>) => {
    if ('budgetId' in p || 'outsidePocket' in p) setPocketTouched(true);
    setMoney((m) => ({ ...m, ...p }));
  };

  /** 흐름 — 수입 · 지출 · 대출. 예전 종류는 여기서 고르기 전에는 확정하지 않는다. */
  const pickFlow = (pick: FlowPick) => {
    setTypeChosen(true);
    const p = flowPickPatch(pick);
    setMoney((m) => {
      const keepCat = pick !== 'loan' && categories.find((c) => c.id === m.categoryId)?.kind === p.type;
      return { ...m, ...p, categoryId: keepCat ? m.categoryId : null };
    });
  };

  const changeDate = (d: string) => {
    setDate(d);
    if (pocketTouched || money.outsidePocket || !pocketEligible({ money, recurrence: null })) return;
    setMoney((m) => ({ ...m, budgetId: pocketChoiceFor(d, budgets).selected?.id ?? null }));
  };

  const save = () => {
    setError('');
    const minor = parseAmountToMinor(amountText, planMoney.currency);
    if (minor === null || minor === 0) { setError('금액을 입력해 주세요.'); amountRef.current?.focus(); return; }
    if (legacy && (!typeChosen || !money.flow)) { setError(REASONS['legacy-needs-choice']); return; }
    const r = confirmOccurrence(plan, occurrenceDate, {
      date,
      amountMinor: Math.abs(minor),
      ...(typeChosen ? { type } : {}),
      ...(money.flow ? { flow: money.flow } : {}),
      categoryId: money.categoryId ?? null,
      method: money.method ?? null,
      accountId: money.accountId ?? null,
      budgetId: money.budgetId ?? null,
      debtId: money.debtId ?? null,
    });
    if (!r.ok) { setError(REASONS[r.reason]); return; }
    onSave(r.entry, { reflected });
  };

  const label = plan.title.trim() || (planMoney.type === 'income' ? '입금 예정' : '지출 예정');

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="mod" role="dialog" aria-modal="true" aria-label="실제 거래로 확정" onClick={(e) => e.stopPropagation()}>
        <header className="mod-head">
          <h2 className="mod-h">실제 거래로 확정</h2>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>
        <div className="mod-body">
          <p className="mod-status-l">
            예정 <b>{label}</b> · {fmtDayShort(occurrenceDate)} · {formatAmount(planMoney.amountMinor)}원
            {plan.recurrence && ' · 이 회차만 확정합니다'}
          </p>

          <div className="mod-row">
            <label className="mod-lbl" htmlFor="cf-amount">실제 금액</label>
            <div className="mod-amt">
              <input
                id="cf-amount" ref={amountRef} className="mod-input amt" type="text" inputMode="numeric"
                value={amountText} onChange={(e) => setAmountText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e)) save(); }}
              />
              <span className="mod-cur">원</span>
            </div>
          </div>

          <div className="mod-row">
            <label className="mod-lbl" htmlFor="cf-date">실제 날짜</label>
            <input
              id="cf-date" type="date" className="mod-input" {...PICKER}
              value={date} onChange={(e) => changeDate(e.target.value || occurrenceDate)}
            />
          </div>
          {date !== occurrenceDate && (
            <p className="mod-hint">
              {fmtDayShort(occurrenceDate)} 회차를 {fmtDayShort(date)}에 실제로 낸 것으로 적습니다. 회차와 연결은 그대로 남습니다.
            </p>
          )}

          {legacy && (
            <p className="mod-hint warn" role="note">
              예전 유형({planMoney.type === 'repay' ? '갚을 거' : '우선 상환'})으로 적힌 예정입니다.
              실제로 어떤 거래였는지 골라 주세요 — 추정하지 않습니다.
            </p>
          )}
          <FlowChips
            money={money} chosen={typeChosen}
            legacyLabel={flowLabel(moneyFlowOf(money))}
            onPick={pickFlow}
          />

          <LedgerFields
            entryId={confirmedEntryId(plan.id, occurrenceDate)}
            type={type}
            date={date}
            money={money}
            onMoney={patch}
            categories={categories}
            categoriesReady={categoriesReady}
            onSeedCategories={onSeedCategories}
            accounts={accounts}
            pockets={pockets}
            debts={debts}
            reflected={reflected}
            onReflected={setReflected}
          />

          {error && <p className="mod-err" role="alert">{error}</p>}
        </div>
        <footer className="mod-foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={save}>확정</button>
        </footer>
      </div>
    </div>
  );
}
