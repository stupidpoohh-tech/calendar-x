import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COLORS, DEFAULT_CURRENCY, KIND_LABEL, MONEY_TYPE_BY_ID,
  REPEAT_OPTIONS, STATUSES,
} from '../domain/constants';
import { todayISO as computeToday } from '../domain/date';
import { convertKind, newEntry, newMoney, withDerived } from '../domain/entry';
import { normalizeTag } from '../domain/filters';
import { minorToInput, parseAmountToMinor } from '../domain/money';
import { describeRecurrence } from '../domain/recurrence';
import { confirmBlockOf } from '../domain/confirm';
import { fmtDayShort } from '../domain/date';
import { budgetCovers } from '../domain/budget';
import { pocketChoiceFor } from '../domain/confirm';
import { pocketEligible } from '../domain/budget';
import type {
  Account, Budget, Category, Debt, Entry, EntryKind, MoneyFields, NewMoneyType, RepeatFreq, TaskStatus,
} from '../domain/types';
import { Icon } from './Icon';
import { FlowChips } from './FlowChips';
import { LedgerFields } from './LedgerFields';
import { flowLabel, flowPickOf, flowPickPatch, type FlowPick } from './ledgerFlows';
import { moneyFlowOf } from '../domain/ledger';
import { PICKER } from './pickerField';
import { isComposingEnter } from './ime';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initial: Entry | null;
  allTags: readonly string[];
  linkableTasks: readonly Entry[];
  /** 지출을 걸 수 있는 생활비 예산. 없으면 '생활비에서 사용' 자리가 뜨지 않는다. */
  budgets: readonly Budget[];
  /** 상환을 걸 수 있는 대출. */
  debts: readonly Debt[];
  /** 같이 보기 보드가 있는가. 없으면 비공개 토글을 띄울 이유가 없다. */
  sharedActive?: boolean;
  /** 거래 카테고리 · 계좌. 실제 거래 칸에 쓴다. */
  categories?: readonly Category[];
  categoriesReady?: boolean;
  onSeedCategories?: () => void;
  accounts?: readonly Account[];
  /**
   * 편집 중인 예정의 **누른 회차** 날짜. 반복 발생분을 눌렀으면 그 날, 아니면 시작일.
   * '실제로 확정' 이 이 회차를 확정한다.
   */
  occurrenceDate?: string | null;
  /** 예정 회차를 실제 거래로 확정한다. 저장된 예정(편집 전 값)을 넘긴다. */
  onConfirm?: (plan: Entry, occurrenceDate: string) => void;
  /** 확정을 취소한다 — 실제 거래를 지우고 예정 회차를 되살린다. */
  onUnconfirm?: (actual: Entry) => void;
  /**
   * 저장. `reflected` 는 "이 잔고에 이미 반영됨" 을 이 창에서 고른 값이다 — 손대지 않았으면
   * undefined 이고, 그때 부르는 쪽은 계좌의 반영 목록을 건드리지 않는다.
   */
  onSave: (e: Entry, opts?: SaveOptions) => void;
  onDelete: (e: Entry) => void;
  onClose: () => void;
}

export interface SaveOptions {
  reflected?: boolean;
}

/**
 * 나갈 돈이 어디로 가는가. 종류(`MoneyType`)가 아니라 **연결**로 적는다.
 *
 * 예전에는 이 셋이 전부 종류였다 (`expense` · `living` · `repay`). 그러면
 * "생활비에서 나간 대출 상환" 같은 것을 적을 자리가 없고, 생활비는 종류가 기간형이라
 * 예산이 아니라 기간형 지출로 계산됐다. 지금은 흐름은 둘뿐이고 나머지는 연결이다.
 */
type MoneyUse = 'plain' | 'budget' | 'debt';

function moneyUseOf(money: Entry['money']): MoneyUse {
  if (money?.budgetId) return 'budget';
  if (money?.debtId) return 'debt';
  return 'plain';
}

const NO_CATEGORIES: readonly Category[] = [];
const NO_ACCOUNTS: readonly Account[] = [];

/**
 * 새 실제 지출의 생활비 주머니 기본값.
 *
 * 그 날을 품는 주머니가 **하나**면 그것을 고르고, 여럿이면 고르지 않는다 — 넘겨짚으면
 * 다른 주머니의 남은 금액이 틀린다. 무엇이 골라졌는지는 칩으로 저장 전에 보인다.
 * 일반 지출만 고른다(`pocketEligible` — 수입 · 대출 · 이체 · 카드 대금 · 카드 사용은 아니다).
 * 사용자가 "생활비 외" 로 명시했으면 덮지 않는다.
 */
function withDefaultPocket(e: Entry, budgets: readonly Budget[]): Entry {
  const m = e.money;
  if (!m || m.status !== 'actual' || !pocketEligible(e) || m.outsidePocket) return e;
  const pick = pocketChoiceFor(e.startDate, budgets).selected;
  return { ...e, money: { ...m, budgetId: pick?.id ?? null } };
}

export function EntryModal({
  open, mode, initial, allTags, linkableTasks, budgets, debts, sharedActive = false,
  categories = NO_CATEGORIES, categoriesReady = true, onSeedCategories,
  accounts = NO_ACCOUNTS, occurrenceDate = null, onConfirm, onUnconfirm,
  onSave, onDelete, onClose,
}: Props) {
  const [form, setForm] = useState<Entry>(() => initial ?? newEntry('task'));
  const [amountText, setAmountText] = useState('');
  const [reflected, setReflected] = useState<boolean | undefined>(undefined);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState('');
  /** 사용자가 생활비 칸을 직접 건드렸는가. 건드렸으면 날짜를 바꿔도 기본값으로 되돌리지 않는다. */
  const [pocketTouched, setPocketTouched] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const base = initial ?? newEntry('task');
    setPocketTouched(mode === 'edit');
    setForm(mode === 'create' ? withDefaultPocket(base, budgets) : base);
    setAmountText(base.money ? (base.money.amountMinor ? minorToInput(base.money.amountMinor, base.money.currency) : '') : '');
    setTagInput('');
    setError('');
    const t = setTimeout(() => firstFieldRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // 열 때 한 번만 채운다. 생활비 목록이 바뀔 때마다 다시 채우면 적던 내용이 날아간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const tagSuggestions = useMemo(
    () => allTags.filter((t) => !form.tags.includes(t) && (!tagInput || t.includes(tagInput))).slice(0, 8),
    [allTags, form.tags, tagInput],
  );

  if (!open) return null;

  const isTask = form.kind === 'task';
  const isMoney = form.kind === 'money';
  const isActual = isMoney && form.money?.status === 'actual';
  const confirmedFrom = isActual ? form.money?.plannedRef ?? null : null;
  const pockets = budgets.filter((b) => budgetCovers(b, form.startDate));
  /** 저장된 예정이 확정 대상인가. 편집 중인 값이 아니라 저장된 값으로 본다. */
  const canConfirm = mode === 'edit' && !!initial && !!onConfirm
    && initial.kind === 'money' && confirmBlockOf(initial) === null;
  const moneyDef = form.money ? MONEY_TYPE_BY_ID[form.money.type] : null;
  const legacyDef = moneyDef?.legacy ? moneyDef : null;
  /** 나가는 돈에만 사용처가 있다. 들어올 돈은 예산에서도 대출에서도 나가지 않는다. */
  const isOutflow = isMoney && (moneyDef?.sign ?? 0) < 0;
  const moneyUse = moneyUseOf(form.money);
  const flowPick = flowPickOf(form.money);
  const pickedBudget = budgets.find((b) => b.id === form.money?.budgetId) ?? null;
  const outsideBudget = pickedBudget !== null
    && (form.startDate < pickedBudget.startDate || form.startDate > pickedBudget.endDate);

  const patch = (p: Partial<Entry>) => setForm((f) => ({ ...f, ...p }));

  const switchKind = (kind: EntryKind) => {
    setForm((f) => {
      const next = convertKind(f, kind);
      if (kind === 'money' && next.money) setAmountText(next.money.amountMinor ? minorToInput(next.money.amountMinor) : '');
      return next;
    });
  };

  const setMoney = (p: Partial<NonNullable<Entry['money']>>) => {
    setForm((f) => {
      const money = { ...(f.money ?? newMoney()), ...p };
      // 유형을 바꾸면 기본 색상도 따라간다. 사용자가 색을 직접 고쳤다면 건드리지 않는다.
      const typeChanged = p.type && p.type !== f.money?.type;
      return {
        ...f,
        money,
        color: typeChanged ? MONEY_TYPE_BY_ID[money.type].defaultColor : f.color,
        // 기간형이 아닌 유형으로 바꾸면 종료일을 접는다.
        endDate: typeChanged && !MONEY_TYPE_BY_ID[money.type].ranged ? null : f.endDate,
      };
    });
  };

  /**
   * 흐름 고르기 — 수입 · 지출 · 대출(`ledgerFlows.ts`). 옛 종류 · 옛 유형에서 옮기는 자리이기도 하다.
   *
   * 들어올 돈으로 바꾸면 사용처를 지운다 — 입금은 예산에서도 대출에서도 나가지 않는다.
   * 남겨 두면 예산이 그 입금을 지출로 세어 남은 금액이 늘어난다. 대출은 생활비에 걸지 않는다.
   */
  const setFlow = (pick: FlowPick) => {
    const p = flowPickPatch(pick);
    const type = p.type as NewMoneyType;
    // 카테고리는 흐름마다 따로다. 지출 카테고리를 단 채 입금으로 바꾸면 결산이 엉뚱한 쪽에 선다.
    const keep = pick !== 'loan' && categories.find((c) => c.id === form.money?.categoryId)?.kind === type;
    setMoney({ ...p, categoryId: keep ? form.money?.categoryId ?? null : null });
    if (isActual && pick === 'expense' && !pocketTouched) {
      setForm((f) => withDefaultPocket(f, budgets));
    }
  };

  /** 사용처. 한 번에 하나만 걸린다 — 같이 걸면 어느 쪽에서 나간 돈인지가 두 개가 된다. */
  const setUse = (use: Exclude<MoneyUse, 'debt'>) => {
    if (use === 'plain') { setMoney({ budgetId: null, debtId: null }); return; }
    setMoney({ budgetId: form.money?.budgetId ?? budgets[0]?.id ?? null, debtId: null });
  };

  /** 실제 거래 칸에서 온 변경. 생활비를 건드렸으면 그 뒤로는 기본값을 다시 고르지 않는다. */
  const setLedger = (p: Partial<MoneyFields>) => {
    if ('budgetId' in p || 'outsidePocket' in p) setPocketTouched(true);
    setMoney(p);
  };

  /**
   * 실제 거래 / 예정. 새로 적을 때만 바꾼다 — 저장된 실제 거래를 예정으로 돌리는 길은
   * '확정 취소' 하나다(연결이 끊긴 채 예정으로 남는 거래를 만들지 않는다).
   *
   * 실제 거래는 반복도 기간도 갖지 않고, 종류는 입금 · 출금뿐이다.
   */
  const setStatus = (status: 'planned' | 'actual') => {
    setForm((f) => {
      if (!f.money) return f;
      const type = status === 'actual' && f.money.type !== 'income' ? 'expense' : f.money.type;
      const next: Entry = {
        ...f,
        recurrence: status === 'actual' ? null : f.recurrence,
        endDate: status === 'actual' ? null : f.endDate,
        money: { ...f.money, status, type, plannedRef: null },
      };
      return pocketTouched ? next : withDefaultPocket(next, budgets);
    });
  };

  /** 날짜를 바꾸면 생활비 기본값도 그 날 기준으로 다시 고른다 — 사용자가 건드리지 않았다면. */
  const setDate = (startDate: string) => {
    setForm((f) => {
      const next = { ...f, startDate };
      return pocketTouched || mode === 'edit' ? next : withDefaultPocket(next, budgets);
    });
  };

  const setTask = (p: Partial<NonNullable<Entry['task']>>) => {
    setForm((f) => f.task ? { ...f, task: { ...f.task, ...p } } : f);
  };

  const setRepeat = (freq: RepeatFreq | 'none') => {
    patch({
      recurrence: freq === 'none' ? null : { freq, interval: 1, until: null, count: null },
    });
  };

  const addTag = (raw?: string) => {
    const tag = normalizeTag(raw ?? tagInput);
    if (!tag) return;
    if (!form.tags.includes(tag)) patch({ tags: [...form.tags, tag] });
    setTagInput('');
  };

  const save = () => {
    setError('');

    if (isMoney) {
      const minor = parseAmountToMinor(amountText, form.money?.currency ?? DEFAULT_CURRENCY);
      if (minor === null || minor === 0) {
        setError('금액을 입력해 주세요.');
        firstFieldRef.current?.focus();
        return;
      }
      const next = withDerived({
        ...form,
        money: newMoney({ ...form.money, amountMinor: Math.abs(minor) }),
      });
      onSave(next, { reflected });
      return;
    }

    if (!form.title.trim()) {
      setError('제목을 입력해 주세요.');
      firstFieldRef.current?.focus();
      return;
    }
    onSave(withDerived({ ...form, title: form.title.trim() }));
  };

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="mod" role="dialog" aria-modal="true" aria-label={mode === 'edit' ? '항목 편집' : '새 항목'} onClick={(e) => e.stopPropagation()}>
        <header className="mod-head">
          <div className="mod-kinds" role="tablist" aria-label="항목 종류">
            {(['task', 'idea', 'money'] as EntryKind[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={form.kind === k}
                className={'mod-kind' + (form.kind === k ? ' on' : '')}
                data-kind={k}
                onClick={() => switchKind(k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>

        {mode === 'edit' && form.kind !== 'task' && (
          <div className="mod-convert">
            <Icon.ArrowUpRight size={13} />
            <span>종류를 바꾸면 이 항목이 그대로 다른 축으로 옮겨갑니다.</span>
          </div>
        )}

        <div className="mod-body">
          {isMoney ? (
            <>
              {/*
                실제 거래 / 예정. 새로 적을 때만 고른다. 이미 지난 날짜는 실제 거래로,
                앞날은 예정으로 시작한다 (`App` 의 openCreate). 고른 쪽은 늘 보인다.
              */}
              {mode === 'create' ? (
                <div className="seg mod-status" role="radiogroup" aria-label="거래 상태">
                  {(['actual', 'planned'] as const).map((st) => (
                    <button
                      key={st} type="button" role="radio"
                      className={'seg-btn' + (form.money?.status === st || (st === 'planned' && !form.money?.status) ? ' on' : '')}
                      aria-checked={form.money?.status === st || (st === 'planned' && !form.money?.status)}
                      onClick={() => setStatus(st)}
                    >
                      {st === 'actual' ? '실제 거래' : '예정'}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mod-status-l">
                  {isActual ? '실제 거래' : '예정'}
                  {confirmedFrom && (
                    <> · 예정 회차 <b>{fmtDayShort(confirmedFrom.date)}</b> 을(를) 확정한 거래입니다</>
                  )}
                </p>
              )}

              <div className="mod-row">
                <label className="mod-lbl" htmlFor="amount">금액</label>
                <div className="mod-amt">
                  <input
                    id="amount" ref={firstFieldRef} className="mod-input amt" type="text" inputMode="numeric"
                    placeholder="0" value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e)) save(); }}
                  />
                  <span className="mod-cur">원</span>
                </div>
              </div>

              {form.money && (
                /*
                  옛 종류 · 옛 유형으로 저장된 항목은 고를 수는 없지만 **보여는 준다** — 안 보여 주면
                  이 항목이 지금 무엇으로 계산되고 있는지 알 수 없고, 다른 칸을 고치려다 종류가
                  조용히 바뀐다. 세 흐름 가운데 하나를 누르면 그때 비로소 옮긴다.
                */
                <FlowChips
                  money={form.money}
                  legacyLabel={legacyDef ? legacyDef.label : flowLabel(moneyFlowOf(form.money))}
                  onPick={setFlow}
                />
              )}

              {moneyDef && !isActual && <p className="mod-hint">{moneyDef.hint}</p>}

              {isActual && form.money && (
                <>
                  <div className="mod-row">
                    <label className="mod-lbl" htmlFor="mtitle">내역</label>
                    <input
                      id="mtitle" className="mod-input" placeholder="예: 점심 (없어도 됩니다)"
                      value={form.title} onChange={(e) => patch({ title: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e)) save(); }}
                    />
                  </div>
                  <LedgerFields
                    entryId={form.id}
                    type={form.money.type === 'income' ? 'income' : 'expense'}
                    date={form.startDate}
                    money={form.money}
                    onMoney={setLedger}
                    categories={categories}
                    categoriesReady={categoriesReady}
                    onSeedCategories={onSeedCategories}
                    accounts={accounts}
                    pockets={pockets}
                    debts={debts}
                    reflected={reflected}
                    onReflected={setReflected}
                  />
                </>
              )}

              {/* 대출은 흐름이다 — 사용처(생활비)를 묻지 않고 대출 연결만 묻는다. */}
              {!isActual && isOutflow && flowPick !== 'loan' && (
                <div className="mod-row">
                  <span className="mod-lbl">사용처</span>
                  <div className="mod-chips">
                    <button
                      className={'chip' + (moneyUse === 'plain' ? ' on' : '')}
                      onClick={() => setUse('plain')}
                    >
                      별도 지출
                    </button>
                    <button
                      className={'chip' + (moneyUse === 'budget' ? ' on' : '')}
                      onClick={() => setUse('budget')}
                      disabled={budgets.length === 0}
                      title={budgets.length === 0 ? '만들어 둔 생활비가 없습니다.' : undefined}
                    >
                      생활비에서 사용
                    </button>
                    {/* 예전에 '대출 상환' 사용처로 적은 예정. 지금은 흐름의 대출이 그 자리다. */}
                    {moneyUse === 'debt' && (
                      <span className="chip on" title="예전 방식의 대출 상환입니다. 흐름에서 대출을 고르면 옮겨집니다.">대출 상환 (예전)</span>
                    )}
                  </div>
                </div>
              )}

              {!isActual && isOutflow && moneyUse === 'budget' && (
                <div className="mod-row">
                  <label className="mod-lbl" htmlFor="budget">생활비</label>
                  <select
                    id="budget" className="mod-input"
                    value={form.money?.budgetId ?? ''}
                    onChange={(e) => setMoney({ budgetId: e.target.value || null })}
                  >
                    {budgets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.startDate} ~ {b.endDate})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!isActual && isOutflow && moneyUse === 'budget' && outsideBudget && (
                <p className="mod-hint">
                  이 날짜는 생활비 기간 밖입니다. 이대로 저장하면 별도 지출로 계산됩니다.
                </p>
              )}
              {!isActual && isOutflow && moneyUse === 'budget' && form.recurrence && (
                <p className="mod-hint">
                  반복 항목은 생활비에 넣지 않습니다. 이대로 저장하면 별도 지출로 계산됩니다.
                </p>
              )}

              {!isActual && isOutflow && debts.length > 0 && (flowPick === 'loan' || moneyUse === 'debt') && (
                <div className="mod-row">
                  <label className="mod-lbl" htmlFor="debt">대출 연결</label>
                  <select
                    id="debt" className="mod-input"
                    value={form.money?.debtId ?? ''}
                    onChange={(e) => setMoney({ debtId: e.target.value || null })}
                  >
                    <option value="">연결 안 함</option>
                    {debts.map((d) => (
                      <option key={d.id} value={d.id}>{d.name || '(이름 없음)'}</option>
                    ))}
                  </select>
                </div>
              )}

              {!isActual && isOutflow && (
                <div className="mod-row">
                  <span className="mod-lbl">속성</span>
                  <div className="mod-chips">
                    <button
                      className={'chip' + (form.money?.priority ? ' on' : '')}
                      onClick={() => setMoney({ priority: !form.money?.priority })}
                    >
                      <Icon.Star size={12} filled={form.money?.priority === true} fillColor="#8b5cf6" stroke="#8b5cf6" />
                      {' '}먼저 낼 것
                    </button>
                  </div>
                </div>
              )}


              {!isActual && (
                <div className="mod-row">
                  <label className="mod-lbl" htmlFor="mtitle">라벨</label>
                  <input
                    id="mtitle" className="mod-input" placeholder="예: 전기요금 (없어도 됩니다)"
                    value={form.title} onChange={(e) => patch({ title: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e)) save(); }}
                  />
                </div>
              )}
              {/* 예정에도 카테고리를 붙여 둘 수 있다 — 확정할 때 그대로 따라간다. */}
              {!isActual && form.money && !legacyDef && (
                <LedgerFields
                  only="category"
                  entryId={form.id}
                  type={form.money.type === 'income' ? 'income' : 'expense'}
                  date={form.startDate}
                  money={form.money}
                  onMoney={setLedger}
                  categories={categories}
                  categoriesReady={categoriesReady}
                  onSeedCategories={onSeedCategories}
                  accounts={accounts}
                  pockets={pockets}
                  debts={debts}
                />
              )}

              {linkableTasks.length > 0 && (
                <div className="mod-row">
                  <label className="mod-lbl" htmlFor="link">연결</label>
                  <select
                    id="link" className="mod-input"
                    value={form.money?.linkedEntryId ?? ''}
                    onChange={(e) => setMoney({ linkedEntryId: e.target.value || null })}
                  >
                    <option value="">연결한 할 일 없음</option>
                    {linkableTasks.map((t) => (
                      <option key={t.id} value={t.id}>{t.title || '(제목 없음)'}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          ) : (
            <>
              <input
                ref={firstFieldRef}
                className="mod-title"
                placeholder={form.kind === 'idea' ? '떠오른 것을 그대로' : '제목'}
                value={form.title}
                onChange={(e) => patch({ title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isComposingEnter(e) && (e.metaKey || e.ctrlKey)) save();
                }}
              />

              <div className="mod-row">
                <span className="mod-lbl">색상</span>
                <div className="mod-colors">
                  {COLORS.map((c) => (
                    <button
                      key={c.id}
                      className={'mod-color' + (form.color === c.id ? ' on' : '')}
                      style={{ background: c.hex }}
                      onClick={() => patch({ color: c.id })}
                      aria-label={c.label}
                      aria-pressed={form.color === c.id}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 날짜 */}
          <div className="mod-row">
            <label className="mod-lbl" htmlFor="start">
              {isMoney && moneyDef?.ranged ? '시작일' : '날짜'}
            </label>
            <div className="mod-dt">
              <input
                id="start" type="date" className="mod-input" {...PICKER}
                value={form.startDate}
                onChange={(e) => setDate(e.target.value || computeToday())}
              />
              {!isMoney && (
                <input
                  type="time" className="mod-input time" {...PICKER} value={form.startTime ?? ''}
                  onChange={(e) => patch({ startTime: e.target.value || null })}
                  aria-label="시작 시각"
                />
              )}
            </div>
          </div>

          {(isTask || (isMoney && moneyDef?.ranged)) && (
            <div className="mod-row">
              <label className="mod-lbl" htmlFor="end">종료일</label>
              <div className="mod-dt">
                <input
                  id="end" type="date" className="mod-input" {...PICKER}
                  value={form.endDate ?? ''} min={form.startDate}
                  onChange={(e) => patch({ endDate: e.target.value || null })}
                />
                {isTask && (
                  <input
                    type="time" className="mod-input time" {...PICKER} value={form.endTime ?? ''}
                    onChange={(e) => patch({ endTime: e.target.value || null })}
                    aria-label="종료 시각"
                  />
                )}
              </div>
            </div>
          )}

          {/* 반복 — 할 일과 가계부 모두 */}
          {/* 실제 거래는 한 날짜의 사실이라 반복하지 않는다. */}
          {form.kind !== 'idea' && !isActual && (
            <div className="mod-row">
              <label className="mod-lbl" htmlFor="repeat">반복</label>
              <div className="mod-dt">
                <select
                  id="repeat" className="mod-input"
                  value={form.recurrence?.freq ?? 'none'}
                  onChange={(e) => setRepeat(e.target.value as RepeatFreq | 'none')}
                >
                  {REPEAT_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                {form.recurrence && (
                  <input
                    type="date" className="mod-input" {...PICKER} value={form.recurrence.until ?? ''}
                    min={form.startDate}
                    onChange={(e) => patch({
                      recurrence: form.recurrence ? { ...form.recurrence, until: e.target.value || null } : null,
                    })}
                    aria-label="반복 종료일"
                  />
                )}
              </div>
            </div>
          )}
          {form.recurrence && <p className="mod-hint"><Icon.Repeat size={11} /> {describeRecurrence(form.recurrence)}</p>}

          {/* 할 일 속성 */}
          {isTask && form.task && (
            <>
              <div className="mod-row">
                <span className="mod-lbl">상태</span>
                <div className="mod-chips">
                  {STATUSES.map((s) => (
                    <button
                      key={s.id}
                      className={'chip' + (form.task?.status === s.id ? ' on' : '')}
                      onClick={() => setTask({ status: s.id as TaskStatus })}
                    >
                      <span className="chip-dot" style={{ background: s.dot }} />{s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mod-row">
                <span className="mod-lbl">속성</span>
                <div className="mod-chips">
                  <button className={'chip' + (form.task.important ? ' on' : '')} onClick={() => setTask({ important: !form.task?.important })}>
                    <Icon.Star size={12} filled={form.task.important} fillColor="#f59e0b" stroke="#f59e0b" /> 중요
                  </button>
                  <button className={'chip' + (form.task.urgent ? ' on' : '')} onClick={() => setTask({ urgent: !form.task?.urgent })}>
                    <Icon.Flame size={12} filled={form.task.urgent} fillColor="#ef4444" stroke="#ef4444" /> 긴급
                  </button>
                </div>
              </div>
              <div className="mod-row">
                <label className="mod-lbl" htmlFor="loc">장소</label>
                <input id="loc" className="mod-input" value={form.location} placeholder="선택"
                  onChange={(e) => patch({ location: e.target.value })} />
              </div>
            </>
          )}

          {/* 태그 */}
          <div className="mod-row">
            <label className="mod-lbl" htmlFor="tag">태그</label>
            <div className="mod-tags">
              {form.tags.map((t) => (
                <span key={t} className="tag-pill">
                  #{t}
                  <button onClick={() => patch({ tags: form.tags.filter((x) => x !== t) })} aria-label={`${t} 태그 빼기`}>
                    <Icon.X size={10} />
                  </button>
                </span>
              ))}
              <input
                id="tag" className="tag-in" placeholder="태그 추가" value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (isComposingEnter(e)) return;
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
                  if (e.key === 'Backspace' && !tagInput && form.tags.length > 0) {
                    patch({ tags: form.tags.slice(0, -1) });
                  }
                }}
              />
            </div>
          </div>
          {tagSuggestions.length > 0 && (
            <div className="mod-row">
              <span className="mod-lbl" />
              <div className="mod-chips">
                {tagSuggestions.map((t) => (
                  <button key={t} className="chip ghost" onClick={() => addTag(t)}>#{t}</button>
                ))}
              </div>
            </div>
          )}

          {/*
            같이 보기에 올릴 것인가.

            기본은 공유다 — 빼는 길이 없으면 선물 준비 · 면접 · 병원처럼 보이면 안 되는
            할 일까지 자동으로 올라간다. 보드가 없으면 이 줄은 뜻이 없으므로 띄우지 않는다.
          */}
          {isTask && sharedActive && (
            <div className="mod-row">
              <span className="mod-lbl">같이 보기</span>
              <div className="mod-chips">
                <button
                  className={'chip' + (form.keepPrivate ? ' on' : '')}
                  onClick={() => patch({ keepPrivate: !form.keepPrivate })}
                  aria-pressed={form.keepPrivate === true}
                >
                  <Icon.Lock size={12} />나만 보기
                </button>
              </div>
            </div>
          )}
          {isTask && sharedActive && (
            <p className="mod-hint">
              {form.keepPrivate
                ? '같이 보기에 올리지 않습니다. 이미 올라가 있으면 곧 내려갑니다.'
                : '오늘 이후의 할 일은 같이 보기에 올라갑니다.'}
            </p>
          )}

          {/* 메모 */}
          <div className="mod-row">
            <label className="mod-lbl" htmlFor="note">메모</label>
            <textarea
              id="note" className="mod-input note" rows={3} value={form.note}
              onChange={(e) => patch({ note: e.target.value })}
              placeholder="선택"
            />
          </div>

          {error && <p className="mod-err" role="alert">{error}</p>}
        </div>

        {canConfirm && initial && (
          <div className="mod-confirm">
            <button className="btn" onClick={() => onConfirm?.(initial, occurrenceDate ?? initial.startDate)}>
              <Icon.Check size={14} />
              {' '}{fmtDayShort(occurrenceDate ?? initial.startDate)} {initial.money?.type === 'income' ? '실제 수입' : '실제 지출'}로 확정
            </button>
            <span className="mod-hint">예정은 그대로 두고, 이 회차만 실제 거래로 기록합니다.</span>
          </div>
        )}
        {mode === 'edit' && confirmedFrom && initial && onUnconfirm && (
          <div className="mod-confirm">
            <button className="btn" onClick={() => onUnconfirm(initial)}>확정 취소</button>
            <span className="mod-hint">이 실제 거래를 지우고 예정 회차를 되살립니다.</span>
          </div>
        )}

        <footer className="mod-foot">
          {mode === 'edit' && (
            <button className="btn danger ghost" onClick={() => onDelete(form)}>
              <Icon.Trash size={14} /> 삭제
            </button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={save}>저장</button>
        </footer>
      </div>
    </div>
  );
}
