/**
 * 실제 거래의 칸들 — 카테고리 · 계좌 · 잔고 반영 · 생활비 · 대출 연결.
 *
 * 새 거래 입력(`EntryModal`)과 예정 확정(`ConfirmSheet`)이 같은 조각을 쓴다. 두 자리가
 * 따로 그리면 한쪽에만 계좌 칸이 생기는 식으로 서서히 달라진다.
 *
 * ── 자주 쓰는 입력은 짧게 ─────────────────────────────────────
 *
 * 흐름(수입 · 지출 · 대출)은 부르는 쪽이 `FlowChips` 로 고른다. 여기에는 결제수단 칸도 거래
 * 유형 칸도 없다 — 일반 소비는 금액 · 카테고리만 고르면 저장된다. 이미 저장된 결제수단 · 유형은
 * 지우지 않고 그대로 둔다(`ledgerFlows.ts`).
 */
import { isLoanCategory, pickableCategories } from '../domain/category';
import { balanceInclusion, moneyFlowOf, reflectChoiceFor } from '../domain/ledger';
import type { Account, Budget, Category, DateISO, Debt, MoneyFields } from '../domain/types';

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
  /** 예정 항목에는 카테고리만 붙인다 — 확정할 때 기본값이 된다. */
  only?: 'category';
  /**
   * "이 잔고에 이미 반영됨" 을 고른 값. undefined 면 아직 손대지 않았다 — 지금 목록 상태를
   * 보여 주고, 저장할 때 목록을 건드리지 않는다.
   */
  reflected?: boolean;
  onReflected?: (b: boolean) => void;
}

export function LedgerFields({
  entryId, type, date, money, onMoney, categories, categoriesReady, onSeedCategories,
  accounts, pockets, debts, only, reflected, onReflected,
}: Props) {
  const flow = moneyFlowOf(money);
  const isLoan = flow === 'loanPrincipal' || flow === 'loanInterest';
  const pickable = pickableCategories(categories, type);
  const picked = money.categoryId ? categories.find((c) => c.id === money.categoryId) ?? null : null;
  /** 이미 걸려 있지만 지금 고르는 자리에는 없는 카테고리(보관 · 흐름으로 옮긴 '대출'). */
  const pickedHidden = picked !== null && !pickable.some((c) => c.id === picked.id);
  const isOutflow = type === 'expense';
  // 주머니는 일반 지출에만 건다(`pocketEligible`). 대출 · 이체 · 카드 대금 · 카드 사용은 아니다.
  const canPocket = isOutflow && flow === 'normal' && !money.debtId && pockets.length > 0;
  const use = money.budgetId ? 'linked' : money.outsidePocket ? 'outside' : 'undecided';
  const ambiguous = accounts.length > 1
    && balanceInclusion({ id: entryId, startDate: date, money }, accounts) === 'ambiguous';
  const reflect = onReflected
    ? reflectChoiceFor({ id: entryId, kind: 'money', startDate: date, money }, accounts)
    : { kind: 'none' as const };
  const day = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

  return (
    <>
      {/* 대출은 카테고리가 아니라 흐름이다. 대출에는 카테고리 칸이 없다 — 이미 붙은 값은 그대로 둔다. */}
      {!isLoan && <div className="mod-row">
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
          {/* 보관한 카테고리 · 흐름으로 옮긴 '대출' 도 이미 걸려 있으면 보여 준다. 안 보이면 무엇으로 집계되는지 모른다. */}
          {picked && pickedHidden && (
            <span className="chip on" title={picked.archived ? '보관한 카테고리입니다' : '지금은 고르는 자리에 없는 카테고리입니다'}>
              {picked.name}{picked.archived ? ' (보관)' : ''}
            </span>
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
      </div>}
      {!isLoan && picked && isLoanCategory(picked) && (
        <p className="mod-hint">
          예전에 '대출' 카테고리로 적은 거래입니다. 지금은 지출로 셉니다 — 빚을 갚은 돈이면 흐름에서 대출을 고르세요.
        </p>
      )}

      {only !== 'category' && <>

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
      {reflect.kind === 'ok' && onReflected && (
        <div className="mod-row">
          <span className="mod-lbl">잔고</span>
          <label className="mod-check">
            <input
              type="checkbox" checked={reflected ?? reflect.checked}
              onChange={(e) => onReflected(e.target.checked)}
            />
            <span>
              {accounts.length > 1 ? `'${reflect.account.name}' ` : ''}{day(reflect.account.asOf)} 잔고에 이미 반영됨
              <span className="mod-hint">잔고를 적기 전에 나간 돈이면 켜세요. 켜면 한도에서 다시 빼지 않습니다.</span>
            </span>
          </label>
        </div>
      )}
      {reflect.kind === 'needs-account' && onReflected && (
        <p className="mod-hint" role="note">
          잔고를 적은 날의 거래입니다. 계좌를 고르면 그 잔고에 이미 반영됐는지 고를 수 있습니다.
        </p>
      )}
      {ambiguous && (
        <p className="mod-hint warn" role="note">
          계좌마다 잔고를 적은 날이 달라, 이 거래가 잔고에 이미 들어 있는지 가를 수 없습니다.
          계좌를 정해 주세요 — 정하지 않으면 한도를 계산하지 않습니다.
        </p>
      )}

      {/*
        사용처 — 생활비 주머니 · 생활비 외 지출. 고르지 않으면 '미결정' 으로 남고 생활비
        상세에서 다시 고른다. "생활비 외" 는 명시한 선택이라 자동 선택이 덮지 않는다.
      */}
      {canPocket && (
        <div className="mod-row">
          <span className="mod-lbl">사용처</span>
          <div className="mod-chips" role="radiogroup" aria-label="사용처">
            {pockets.map((b) => (
              <button
                key={b.id} type="button" role="radio"
                className={'chip' + (money.budgetId === b.id ? ' on' : '')}
                aria-checked={money.budgetId === b.id}
                onClick={() => onMoney({ budgetId: b.id, outsidePocket: false, debtId: null })}
              >
                {/* 이름에 이미 '생활비' 가 있으면 앞말을 겹쳐 적지 않는다. */}
                {b.name.includes('생활비') ? b.name : `생활비 · ${b.name}`}
              </button>
            ))}
            <button
              type="button" role="radio"
              className={'chip' + (use === 'outside' ? ' on' : '')}
              aria-checked={use === 'outside'}
              onClick={() => onMoney({ budgetId: null, outsidePocket: true })}
            >
              생활비 외 지출
            </button>
          </div>
        </div>
      )}
      {/* 카드 사용은 생활비에 걸지 않는다. 카드 대금과 이어 줄 연결 정보가 없어서, 걸면 주머니와
          대금에서 같은 돈이 두 번 빠진다. 고를 자리를 감추는 것에서 그치지 않고 이유를 적는다. */}
      {isOutflow && flow === 'cardSpend' && pockets.length > 0 && (
        <p className="mod-hint">카드 사용은 생활비에 연결하지 않습니다 — 현금은 카드 대금을 내는 날 나가고, 그때 일반 지출로 셉니다.</p>
      )}
      {canPocket && use === 'undecided' && (
        <p className="mod-hint">
          {pockets.length > 1
            ? '이 날짜를 품는 생활비가 여럿입니다. 어느 주머니에서 나간 돈인지 고르거나, 생활비 외로 두세요.'
            : '사용처를 고르지 않으면 미결정으로 남고, 생활비 상세에서 다시 고를 수 있습니다.'}
        </p>
      )}

      {/* 대출 연결 — 흐름이 대출일 때(또는 이미 연결돼 있을 때)만. 연결하지 않아도 대출로 센다. */}
      {isOutflow && debts.length > 0 && (isLoan || money.debtId) && (
        <div className="mod-row">
          <label className="mod-lbl" htmlFor={`debt-${entryId}`}>대출 연결</label>
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
      </>}
    </>
  );
}
