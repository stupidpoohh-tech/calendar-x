/**
 * 실제 거래의 칸들 — 카테고리 · 계좌 · 잔고 반영 · 생활비 · 대출 연결.
 *
 * 새 거래 입력(`EntryModal`)과 예정 확정(`ConfirmSheet`)이 같은 조각을 쓴다. 두 자리가
 * 따로 그리면 한쪽에만 계좌 칸이 생기는 식으로 서서히 달라진다.
 *
 * ── 자주 쓰는 입력은 짧게 ─────────────────────────────────────
 *
 * 흐름(수입 · 지출 · 대출)은 부르는 쪽이 `FlowChips` 로 고른다. 일반 소비는 금액 · 카테고리만 고르면
 * 저장된다 — 결제수단은 '현금 · 계좌' 가 기본이다. 이미 저장된 예전 결제수단 · 유형은 지우지 않고
 * 그대로 둔다(`ledgerFlows.ts`).
 */
import { isLoanCategory, pickableCategories } from '../domain/category';
import { balanceInclusion, moneyFlowOf, reflectChoiceFor } from '../domain/ledger';
import { activeCards, cardState, cycleByKey, cycleOfUse, defaultPaymentCycle, fmtMonthDay } from '../domain/card';
import { formatAmount } from '../domain/money';
import type { Account, Budget, Card, Category, DateISO, Debt, Entry, MoneyFields, Reserve } from '../domain/types';

interface Props {
  /** 문서 id. 잔고 반영 판정(같은 날 고른 목록)에 쓴다. */
  entryId: string;
  compactCategory?: boolean;
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
  /**
   * 세이브 (P3). 주면 일반 지출에 '사용할 세이브' 칸이 붙는다. 보관한 세이브는 고르는 자리에 없고,
   * 이미 걸려 있으면 그대로 보여 준다.
   */
  reserves?: readonly Reserve[];
  /** 반복 예정인가. 반복은 세이브에 걸지 않는다 — 한 봉투에 몇 번 들어갈지가 애매해진다. */
  recurring?: boolean;
  /**
   * 신용카드(P4)와 카드에 걸린 거래 전량. 주면 지출에 '결제수단'(현금 · 계좌 / 카드) 줄이, 카드 대금에 '카드 · 회차'
   * 줄이 붙는다. 거래 전량은 대금 회차의 남은 금액을 적는 데 쓴다.
   */
  cards?: readonly Card[];
  cardEntries?: readonly Entry[];
  /**
   * 결제수단 줄의 '카드 등록'. 주면 지출을 적던 창에서 카드를 등록하고 돌아온다(`EntryModal`). 없으면
   * 등록한 카드가 없을 때 어디서 등록하는지만 적는다.
   */
  onRegisterCard?: () => void;
  /** 오늘. 회차가 마감됐는지 · 지났는지 적는다. */
  todayISO?: DateISO;
}

const NO_CARDS: readonly Card[] = [];
const NO_ENTRIES: readonly Entry[] = [];
const dayLabel = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

const NO_RESERVES: readonly Reserve[] = [];

export function LedgerFields({
  entryId, compactCategory = false, type, date, money, onMoney, categories, categoriesReady, onSeedCategories,
  accounts, pockets, debts, only, reflected, onReflected, reserves = NO_RESERVES, recurring = false,
  cards = NO_CARDS, cardEntries = NO_ENTRIES, todayISO = date, onRegisterCard,
}: Props) {
  const flow = moneyFlowOf(money);
  const isLoan = flow === 'loanPrincipal' || flow === 'loanInterest';
  const pickable = pickableCategories(categories, type);
  const picked = money.categoryId ? categories.find((c) => c.id === money.categoryId) ?? null : null;
  /** 이미 걸려 있지만 지금 고르는 자리에는 없는 카테고리(보관 · 흐름으로 옮긴 '대출'). */
  const pickedHidden = picked !== null && !pickable.some((c) => c.id === picked.id);
  const isOutflow = type === 'expense';
  // 주머니는 일반 지출 · 등록 카드의 카드 사용에 건다(`pocketEligible`). 대출 · 이체 · 카드 대금은 아니다.
  const canPocket = isOutflow && (flow === 'normal' || (flow === 'cardSpend' && !!money.cardId))
    && !money.debtId && pockets.length > 0;
  const use = money.budgetId ? 'linked' : money.outsidePocket ? 'outside' : 'undecided';
  const ambiguous = accounts.length > 1
    && balanceInclusion({ id: entryId, startDate: date, money }, accounts) === 'ambiguous';
  const reflect = onReflected
    ? reflectChoiceFor({ id: entryId, kind: 'money', startDate: date, money }, accounts)
    : { kind: 'none' as const };
  // 세이브는 일반 지출 · 등록 카드의 카드 사용에 건다(`reserveLinkable`).
  const canReserve = isOutflow && (flow === 'normal' || (flow === 'cardSpend' && !!money.cardId)) && !money.debtId && !recurring;
  // 결제수단(P4) — 현금 · 계좌로 낸 지출인가, 어느 카드로 쓴 지출인가.
  const pickableCards = activeCards(cards);
  const linkedCard = money.cardId ? cards.find((c) => c.id === money.cardId) ?? null : null;
  // 일반 지출 · 카드 사용에는 카드 등록 여부와 무관하게 늘 보인다 — 카드가 없으면 '현금 · 계좌' 와 등록 길만.
  // 카드 대금 · 대출 · 이체는 소비의 결제수단을 묻지 않는다.
  const showMethod = isOutflow && (flow === 'normal' || flow === 'cardSpend') && !money.debtId;
  const cardUse = flow === 'cardSpend' && linkedCard ? cycleOfUse(linkedCard, date) : null;
  const isCardPay = isOutflow && flow === 'cardPayment';
  const payState = isCardPay && linkedCard ? cardState(linkedCard, cardEntries, todayISO) : null;
  const payCycle = isCardPay && linkedCard && money.cardCycle && !recurring ? cycleByKey(linkedCard, money.cardCycle) : null;
  const pickableReserves = reserves.filter((r) => !r.archivedAt);
  const linkedReserve = money.reserveId ? reserves.find((r) => r.id === money.reserveId) ?? null : null;
  const showReserve = canReserve && (pickableReserves.length > 0 || !!money.reserveId);
  const planned = money.status !== 'actual';
  const day = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

  return (
    <>
      {/* 대출은 카테고리가 아니라 흐름이다. 대출에는 카테고리 칸이 없다 — 이미 붙은 값은 그대로 둔다. */}
      {/*
        결제수단 (P4). 카드로 쓴 돈은 오늘 소비로 세고(현금 0) 결제일에 대금으로 나간다. 등록한 카드의 카드 사용은
        생활비 · 세이브에 걸 수 있다(P1-D). 기본은 현금 · 계좌이고, 카드가 없으면 그 자리에서 등록하러 간다.
      */}
      {!isLoan && !isCardPay && compactCategory && <div className="mod-row">
        <label className="mod-lbl" htmlFor={'category-' + entryId}>카테고리</label>
        <div className="category-select">
          <select id={'category-' + entryId} className="mod-input" value={money.categoryId ?? ''} onChange={e => onMoney({ categoryId: e.target.value || null })} disabled={!categoriesReady}>
            <option value="">{categoriesReady ? '카테고리 선택 (선택 사항)' : '불러오는 중…'}</option>
            {pickedHidden && picked && <option value={picked.id}>{picked.name}{picked.archived ? ' (보관)' : ''}</option>}
            {!picked && money.categoryId && <option value={money.categoryId}>알 수 없는 카테고리</option>}
            {pickable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {categoriesReady && !pickable.length && onSeedCategories && <button type="button" className="btn" onClick={onSeedCategories}>기본 카테고리 만들기</button>}
        </div>
      </div>}
      {showMethod && (
        <div className="mod-row">
          <span className="mod-lbl">결제수단</span>
          <div className="mod-chips" role="radiogroup" aria-label="결제수단">
            <button
              type="button" role="radio"
              className={'chip' + (flow === 'normal' ? ' on' : '')}
              aria-checked={flow === 'normal'}
              onClick={() => onMoney({ flow: 'normal', cardId: null, cardCycle: null })}
            >
              현금 · 계좌
            </button>
            {pickableCards.map((c) => (
              <button
                key={c.id} type="button" role="radio"
                className={'chip' + (flow === 'cardSpend' && money.cardId === c.id ? ' on' : '')}
                aria-checked={flow === 'cardSpend' && money.cardId === c.id}
                onClick={() => onMoney({ flow: 'cardSpend', cardId: c.id, cardCycle: null, debtId: null })}
              >
                {c.name}
              </button>
            ))}
            {money.cardId && (!linkedCard || linkedCard.archivedAt) && (
              <span className="chip on" title={linkedCard ? '보관한 카드입니다' : '지금은 없는 카드입니다'}>
                {linkedCard ? `${linkedCard.name} (보관)` : '지워진 카드'}
              </span>
            )}
            {flow === 'cardSpend' && !money.cardId && (
              <span className="chip on legacy" title="카드를 정하지 않은 예전 카드 사용입니다. 미결제로 세지 않습니다.">카드 (정하지 않음)</span>
            )}
            {onRegisterCard && (
              <button type="button" className="chip ghost" onClick={onRegisterCard}>
                {pickableCards.length > 0 ? '+ 카드 등록' : '신용카드 · 카드 등록'}
              </button>
            )}
          </div>
        </div>
      )}
      {/* 등록 길이 없는 자리(확정 창)에서는 어디서 등록하는지 적는다. 거래 창은 칩이 그 길이다. */}
      {showMethod && pickableCards.length === 0 && !onRegisterCard && (
        <p className="mod-hint">등록한 카드가 없습니다. 카드는 현금흐름 &gt; 카드대금에서 등록합니다.</p>
      )}
      {cardUse && (
        <p className="mod-hint">
          {money.status === 'actual'
            ? `오늘 소비로 세고, 현금은 ${fmtMonthDay(cardUse.payDate)} 결제일에 대금으로 나갑니다. 그때까지 미결제로 가용 한도에서 빠집니다.`
            : `예정 카드 사용은 확정해야 미결제가 됩니다. 확정하면 ${fmtMonthDay(cardUse.payDate)} 결제분에 들어갑니다.`}
        </p>
      )}
      {flow === 'cardSpend' && !money.cardId && pickableCards.length > 0 && (
        <p className="mod-hint">카드를 고르면 그 카드의 미결제로 세고, 결제일 예상 잔고에 대금이 잡힙니다.</p>
      )}

      {/*
        카드 대금 (P4). 어느 카드의 어느 회차를 갚는가. 일부 납부 · 여러 번 납부는 같은 회차를 가리키는 대금 여러 건이다.
        반복 예정은 회차마다 그 달을 갚는다.
      */}
      {isCardPay && (
        <div className="mod-row">
          <label className="mod-lbl" htmlFor={`card-${entryId}`}>카드</label>
          <select
            id={`card-${entryId}`} className="mod-input"
            value={money.cardId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              const c = id ? cards.find((x) => x.id === id) : null;
              onMoney({ cardId: id, cardCycle: c && !recurring ? defaultPaymentCycle(cardState(c, cardEntries, todayISO), date) : null });
            }}
          >
            <option value="">정하지 않음</option>
            {pickableCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {linkedCard?.archivedAt && <option value={linkedCard.id}>{linkedCard.name} (보관)</option>}
            {money.cardId && !linkedCard && <option value={money.cardId}>지워진 카드</option>}
          </select>
        </div>
      )}
      {isCardPay && linkedCard && !recurring && payState && (
        <div className="mod-row">
          <label className="mod-lbl" htmlFor={`cycle-${entryId}`}>청구 회차</label>
          <select
            id={`cycle-${entryId}`} className="mod-input"
            value={money.cardCycle ?? ''}
            onChange={(e) => onMoney({ cardCycle: e.target.value || null })}
          >
            {!money.cardCycle && <option value="">날짜의 달 ({date.slice(0, 7)})</option>}
            {[...new Set([...payState.cycles.map((c) => c.key), ...(money.cardCycle ? [money.cardCycle] : [])])].sort().map((key) => {
              const c = payState.cycles.find((x) => x.key === key);
              const cy = cycleByKey(linkedCard, key);
              return (
                <option key={key} value={key}>
                  {dayLabel(cy.payDate)} 결제 ({dayLabel(cy.start)}~{dayLabel(cy.close)}){c ? ` · 남음 ${formatAmount(c.remainingMinor)}` : ''}
                </option>
              );
            })}
          </select>
        </div>
      )}
      {isCardPay && payCycle && (
        <p className="mod-hint">
          {dayLabel(payCycle.start)}~{dayLabel(payCycle.close)} 이용분을 갚습니다. 소비는 쓴 날 이미 셌으므로 대금은 소비에 더하지 않습니다.
        </p>
      )}
      {isCardPay && !money.cardId && pickableCards.length > 0 && (
        <p className="mod-hint">
          카드를 정하면 그 카드의 미결제를 줄입니다.{money.status !== 'actual' ? ' 예정이면 그 회차의 예상 대금을 이 예정이 대신합니다 — 같은 돈을 두 번 빼지 않습니다.' : ''}
        </p>
      )}

      {!compactCategory && !isLoan && !isCardPay && <div className="mod-row">
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
      {!isLoan && !isCardPay && picked && isLoanCategory(picked) && (
        <p className="mod-hint">
          예전에 '대출' 카테고리로 적은 거래입니다. 지금은 지출로 셉니다 — 빚을 갚은 돈이면 흐름에서 대출을 고르세요. 여러 건은 설정 &gt; 데이터 &gt; '예전 대출 카테고리 정리' 로 한꺼번에 옮깁니다.
        </p>
      )}


      {/*
        사용할 세이브 (P3). 세이브는 가상 봉투다 — 고르면 이 지출이 그 봉투에서 쓴 돈으로 세어져 남은 금액이 준다.
        잔고 · 예상 잔고는 그대로이고, 세이브의 확보액도 바뀌지 않는다. 생활비와 같이 걸지 않는다(사용처는 하나).
      */}
      {showReserve && (
        <div className="mod-row">
          <span className="mod-lbl">세이브</span>
          <div className="mod-chips" role="radiogroup" aria-label="사용할 세이브">
            <button
              type="button" role="radio"
              className={'chip' + (!money.reserveId ? ' on' : '')}
              aria-checked={!money.reserveId}
              onClick={() => onMoney({ reserveId: null })}
            >
              사용 안 함
            </button>
            {pickableReserves.map((r) => (
              <button
                key={r.id} type="button" role="radio"
                className={'chip' + (money.reserveId === r.id ? ' on' : '')}
                aria-checked={money.reserveId === r.id}
                onClick={() => onMoney({ reserveId: r.id, budgetId: null, outsidePocket: true, debtId: null })}
              >
                {r.name}
              </button>
            ))}
            {/* 보관했거나 지워진 세이브를 가리키는 연결도 보여 준다. 안 보이면 무엇에 걸려 있는지 모른다. */}
            {money.reserveId && (!linkedReserve || linkedReserve.archivedAt) && (
              <span className="chip on" title={linkedReserve ? '보관한 세이브입니다' : '지금은 없는 세이브입니다'}>
                {linkedReserve ? `${linkedReserve.name} (보관)` : '지워진 세이브'}
              </span>
            )}
          </div>
        </div>
      )}
      {showReserve && money.reserveId && (
        <p className="mod-hint">
          {planned
            ? '예정은 아직 쓴 돈이 아닙니다. 확정해 실제 거래가 되면 그때 이 세이브의 사용으로 셉니다.'
            : linkedReserve && !linkedReserve.archivedAt
              ? '이 세이브의 남은 금액에서 빠집니다. 잔고 · 예상 잔고는 바뀌지 않습니다.'
              : '연결된 세이브가 보관됐거나 없어 가용 한도에는 영향이 없습니다. 다른 세이브를 고르거나 사용 안 함으로 둘 수 있습니다.'}
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
                onClick={() => onMoney({ budgetId: b.id, outsidePocket: false, debtId: null, reserveId: null })}
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
      {/* 카드를 정하지 않은 카드 사용은 생활비에 걸지 않는다 — 미결제로 지켜지지 않아, 걸면 대금이 나갈 때
          같은 돈이 두 번 빠진다. 고를 자리를 감추는 것에서 그치지 않고 이유를 적는다. */}
      {isOutflow && flow === 'cardSpend' && !money.cardId && pockets.length > 0 && (
        <p className="mod-hint">카드를 정하지 않은 카드 사용은 생활비에 연결하지 않습니다 — 카드를 고르면 연결할 수 있습니다.</p>
      )}
      {canPocket && flow === 'cardSpend' && money.budgetId && (
        <p className="mod-hint">생활비 사용으로는 오늘 세고, 현금은 결제일에 대금으로 나갑니다. 같은 돈을 생활비와 카드 미결제가 두 번 빼지 않습니다.</p>
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
            onChange={(e) => onMoney(e.target.value ? { debtId: e.target.value, budgetId: null, reserveId: null } : { debtId: null })}
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

