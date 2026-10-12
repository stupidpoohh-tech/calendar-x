/**
 * 실제 거래의 칸들 — 카테고리 · 결제수단 · 계좌 · 생활비 · 거래 유형.
 *
 * 새 거래 입력(`EntryModal`)과 예정 확정(`ConfirmSheet`)이 같은 조각을 쓴다. 두 자리가
 * 따로 그리면 한쪽에만 계좌 칸이 생기는 식으로 서서히 달라진다.
 *
 * ── 자주 쓰는 입력은 짧게 ─────────────────────────────────────
 *
 * 일반 소비는 금액 · 카테고리만 고르면 저장된다. 거래 유형(카드 · 대출 · 이체)과 대출
 * 연결은 "상세" 를 눌러야 펼쳐진다 — 점심 한 끼를 적을 때마다 유형을 고르게 하면 안
 * 적게 된다. 고른 값이 일반이 아니면 접혀 있어도 줄 하나로 보인다.
 */
import { useState } from 'react';
import { pickableCategories } from '../domain/category';
import { balanceInclusion } from '../domain/ledger';
import type { Account, Budget, Category, DateISO, Debt, MoneyFields } from '../domain/types';
import { FLOW_OPTIONS, flowsFor } from './ledgerFlows';

interface Props {
  /** 문서 id. 잔고 반영 판정(같은 날 고른 목록)에 쓴다. */
  entryId: string;
  type: 'income' | 'expense';
  date: DateISO;
  money: MoneyFields;
  onMoney: (patch: Partial<MoneyFields>) => void;
  categories: readonly Category[];
  /** 카테고리 구독을 받았는가. 못 받았으면 "없음" 을 확정할 수 없어 만들기를 권하지 않는다. */
  categoriesReady: boolean;
  onSeedCategories?: () => void;
  accounts: readonly Account[];
  /** 그 날짜를 품는 생활비 주머니. 부르는 쪽이 고른다. */
  pockets: readonly Budget[];
  debts: readonly Debt[];
  /** 전에 적은 결제수단. 자주 쓰는 것을 다시 치지 않게. */
  methods: readonly string[];
  /** 거래 유형을 반드시 고르게 할 때(legacy 확정). 펼친 채로 시작하고 '일반' 을 미리 고르지 않는다. */
  requireFlow?: boolean;
  /** 예정 항목에는 카테고리만 붙인다 — 확정할 때 기본값이 된다. */
  only?: 'category';
}

export function LedgerFields({
  entryId, type, date, money, onMoney, categories, categoriesReady, onSeedCategories,
  accounts, pockets, debts, methods, requireFlow = false, only,
}: Props) {
  const flow = money.flow ?? 'normal';
  const [advanced, setAdvanced] = useState(requireFlow || flow !== 'normal' || !!money.debtId);
  const pickable = pickableCategories(categories, type);
  const picked = money.categoryId ? categories.find((c) => c.id === money.categoryId) ?? null : null;
  const isOutflow = type === 'expense';
  // 카드 사용은 주머니에 걸지 않는다 — 대금이 나갈 때 일반 지출로 한 번 더 빠진다.
  const canPocket = isOutflow && flow !== 'cardSpend' && pockets.length > 0;
  const ambiguous = accounts.length > 1
    && balanceInclusion({ id: entryId, startDate: date, money }, accounts) === 'ambiguous';

  return (
    <>
      <div className="mod-row">
        <span className="mod-lbl">카테고리</span>
        <div className="mod-chips">
          {pickable.map((c) => (
            <button
              key={c.id} type="button"
              className={'chip' + (money.categoryId === c.id ? ' on' : '')}
              aria-pressed={money.categoryId === c.id}
              onClick={() => onMoney({ categoryId: money.categoryId === c.id ? null : c.id })}
            >
              {c.name}
            </button>
          ))}
          {/* 보관한 카테고리도 이미 걸려 있으면 보여 준다. 안 보이면 무엇으로 집계되는지 모른다. */}
          {picked && picked.archived && (
            <span className="chip on" title="보관한 카테고리입니다">{picked.name} (보관)</span>
          )}
          {picked === null && money.categoryId && (
            <span className="chip on" title="목록에 없는 카테고리입니다">알 수 없는 카테고리</span>
          )}
          {pickable.length === 0 && categoriesReady && onSeedCategories && (
            <button type="button" className="chip ghost" onClick={onSeedCategories}>
              기본 카테고리 만들기
            </button>
          )}
          {pickable.length === 0 && !categoriesReady && (
            <span className="mod-hint">카테고리를 불러오는 중입니다.</span>
          )}
        </div>
      </div>

      {only !== 'category' && <>
      <div className="mod-row">
        <label className="mod-lbl" htmlFor={`method-${entryId}`}>결제수단</label>
        <input
          id={`method-${entryId}`} className="mod-input" placeholder="선택 (예: 신한카드 · 현금)"
          list={`methods-${entryId}`} maxLength={100}
          value={money.method ?? ''}
          onChange={(e) => onMoney({ method: e.target.value.trim() ? e.target.value : null })}
        />
        <datalist id={`methods-${entryId}`}>
          {methods.map((m) => <option key={m} value={m} />)}
        </datalist>
      </div>

      {accounts.length > 1 && (
        <div className="mod-row">
          <label className="mod-lbl" htmlFor={`acc-${entryId}`}>계좌</label>
          <select
            id={`acc-${entryId}`} className="mod-input"
            value={money.accountId ?? ''}
            onChange={(e) => onMoney({ accountId: e.target.value || null })}
          >
            <option value="">정하지 않음</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}
      {ambiguous && (
        <p className="mod-hint warn" role="note">
          계좌마다 잔고를 적은 날이 달라, 이 거래가 잔고에 이미 들어 있는지 가를 수 없습니다.
          계좌를 정해 주세요 — 정하지 않으면 한도를 계산하지 않습니다.
        </p>
      )}

      {canPocket && (
        <div className="mod-row">
          <span className="mod-lbl">생활비</span>
          <div className="mod-chips">
            <button
              type="button"
              className={'chip' + (!money.budgetId ? ' on' : '')}
              aria-pressed={!money.budgetId}
              onClick={() => onMoney({ budgetId: null })}
            >
              연결 안 함
            </button>
            {pockets.map((b) => (
              <button
                key={b.id} type="button"
                className={'chip' + (money.budgetId === b.id ? ' on' : '')}
                aria-pressed={money.budgetId === b.id}
                onClick={() => onMoney({ budgetId: b.id, debtId: null })}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {canPocket && pockets.length > 1 && !money.budgetId && (
        <p className="mod-hint">이 날짜를 품는 생활비가 여럿입니다. 어느 주머니에서 나간 돈인지 골라 주세요.</p>
      )}

      {!advanced && flow === 'normal' && !money.debtId && (
        <button type="button" className="mod-more" onClick={() => setAdvanced(true)}>
          상세 — 거래 유형 · 대출
        </button>
      )}
      {(advanced || flow !== 'normal' || money.debtId) && (
        <>
          <div className="mod-row">
            <span className="mod-lbl">유형</span>
            <div className="mod-chips" role="radiogroup" aria-label="거래 유형">
              {flowsFor(type).map((f) => (
                <button
                  key={f.id} type="button" role="radio"
                  className={'chip' + (money.flow === f.id ? ' on' : '')}
                  aria-checked={money.flow === f.id}
                  title={f.hint}
                  onClick={() => onMoney(f.id === 'cardSpend' ? { flow: f.id, budgetId: null } : { flow: f.id })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {money.flow && <p className="mod-hint">{FLOW_OPTIONS.find((f) => f.id === money.flow)?.hint}</p>}
          {isOutflow && debts.length > 0 && (
            <div className="mod-row">
              <label className="mod-lbl" htmlFor={`debt-${entryId}`}>대출</label>
              <select
                id={`debt-${entryId}`} className="mod-input"
                value={money.debtId ?? ''}
                onChange={(e) => onMoney(e.target.value ? { debtId: e.target.value, budgetId: null } : { debtId: null })}
              >
                <option value="">연결 안 함</option>
                {debts.map((d) => <option key={d.id} value={d.id}>{d.name || '(이름 없음)'}</option>)}
              </select>
            </div>
          )}
        </>
      )}
      </>}
    </>
  );
}
