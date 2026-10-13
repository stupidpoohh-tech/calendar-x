/**
 * 가계부 달력의 날짜 요약 — 지난 날 · 오늘 셀에 개별 거래 대신 적는 것.
 *
 * 지난 날의 실제 거래를 막대로 하나씩 늘어놓으면 편의점 3,000원 같은 소액까지 셀을 채워,
 * 거래가 많은 날만 키가 자라고 정작 큰 흐름이 안 보였다. 셀에는 세 가지만 적는다.
 *
 *   총수입 · 총지출  **현금흐름** 기준 (`cashSignOf`). 카드 사용은 0 — 대금 내는 날 나간다.
 *                   대출 원금 · 이체도 현금이 나가므로 지출에 든다. 소비 통계(`ledgerStats`)와
 *                   다른 숫자이고, 섞지 않는다.
 *   주요 거래 1건    직접 고른 것(`money.highlight`) → 10만 원 이상 소비(카드 사용 포함) →
 *                   10만 원 이상 금융 거래(원금 · 이자 · 카드 대금) 순. 없으면 비운다.
 *   나머지 건수      실제 거래만 센다. 예정은 따로 센다(`unconfirmed`).
 *
 * 계산 규칙은 새로 만들지 않는다 — 실제 · 예정 구분(`isActual`), 현금 부호(`cashSignOf`),
 * 분류(`ledgerClassOf`), 확정 회차를 뺀 예정(`entriesOn`)을 그대로 쓴다.
 */
import { cashSignOf, isActual, isPlanned, ledgerClassOf, moneyFlowOf } from './ledger';
import { entriesOn } from './tide';
import type { DateISO, Entry } from './types';

/** 자동으로 주요 거래로 띄우는 기준 금액. */
export const MAJOR_THRESHOLD = 100_000;

export type MajorKind = 'pinned' | 'consumption' | 'finance';

export interface MajorTx {
  entry: Entry;
  amount: number;
  /** 셀에 적는 이름. 금융 거래는 소비와 헷갈리지 않게 성격을 이름으로 쓴다. */
  label: string;
  /** 이름 옆 작은 표식 — 카드 사용 · 수입처럼 금액 부호만으로 뜻이 갈리는 경우. */
  tag: string | null;
  sign: -1 | 0 | 1;
  why: MajorKind;
}

export interface DaySummary {
  date: DateISO;
  /** 그 날의 실제 거래 전부(현금 0인 것 포함). 금액 큰 순. */
  actuals: Entry[];
  /** 실제 현금 수입 합. */
  income: number;
  /** 실제 현금 지출 합(양수). */
  outflow: number;
  major: MajorTx | null;
  /** 주요 거래를 뺀 실제 거래 수. */
  rest: number;
  /** 그 날 아직 확정하지 않은 예정 회차 수 — 확정한 회차는 들지 않는다. */
  unconfirmed: number;
}

const amountOf = (e: Entry) => Math.abs(e.money?.amountMinor ?? 0);

const FINANCE_LABEL: Partial<Record<string, string>> = {
  principal: '대출상환',
  financeCost: '대출이자',
  cardPayment: '카드대금',
};

function majorOf(e: Entry, why: MajorKind): MajorTx {
  const cls = ledgerClassOf(e);
  const finance = cls ? FINANCE_LABEL[cls] : undefined;
  const sign = cashSignOf(e);
  return {
    entry: e,
    amount: amountOf(e),
    // 제목만 쓴다 — 금액은 셀이 따로 적는다. 제목이 비면 흐름 이름으로.
    label: finance ?? (e.title.trim() || (sign > 0 ? '수입' : '지출')),
    tag: finance ? null
      : moneyFlowOf(e.money) === 'cardSpend' ? '카드'
        : sign > 0 ? '수입'
          : cls === 'transfer' ? '이체' : null,
    sign,
    why,
  };
}

const biggest = (list: readonly Entry[]) =>
  list.reduce<Entry | null>((best, e) => (!best || amountOf(e) > amountOf(best) ? e : best), null);

/** 하루 최대 1건. 직접 고른 것이 자동보다 앞선다. */
export function pickMajor(actuals: readonly Entry[], threshold = MAJOR_THRESHOLD): MajorTx | null {
  const pinned = biggest(actuals.filter((e) => e.money?.highlight === true));
  if (pinned) return majorOf(pinned, 'pinned');
  const big = actuals.filter((e) => amountOf(e) >= threshold);
  const consumption = biggest(big.filter((e) => ledgerClassOf(e) === 'consumption'));
  if (consumption) return majorOf(consumption, 'consumption');
  const finance = biggest(big.filter((e) => {
    const c = ledgerClassOf(e);
    return c === 'principal' || c === 'financeCost' || c === 'cardPayment';
  }));
  return finance ? majorOf(finance, 'finance') : null;
}

/**
 * 하루 요약.
 *
 * `entries` 는 **저장된 원본**이다(반복을 펼치지 않은 목록). 확정하지 않은 예정 회차는
 * `entriesOn` 이 반복을 펼치고 확정한 회차를 빼서 세므로, 화면용으로 펼친 목록을 넘기면
 * `TideInputError` 로 거절된다.
 */
export function daySummary(entries: readonly Entry[], date: DateISO): DaySummary {
  const actuals = entries
    .filter((e) => isActual(e) && e.startDate === date)
    .sort((a, b) => amountOf(b) - amountOf(a) || a.createdAt.localeCompare(b.createdAt));
  let income = 0;
  let outflow = 0;
  for (const e of actuals) {
    const s = cashSignOf(e);
    if (s > 0) income += amountOf(e);
    else if (s < 0) outflow += amountOf(e);
  }
  const major = pickMajor(actuals);
  // 예정은 entriesOn 이 확정한 회차를 뺀 뒤의 것만 센다. 기간 예정(하루 몫으로 잘게 들어온다)은
  // "그 날의 거래" 가 아니므로 세지 않는다.
  const unconfirmed = new Set(
    entriesOn(entries, date)
      .filter((o) => isPlanned(o.entry) && !(o.entry.endDate && o.entry.endDate > o.entry.startDate))
      .map((o) => o.entry.id),
  ).size;
  return { date, actuals, income, outflow, major, rest: actuals.length - (major ? 1 : 0), unconfirmed };
}
