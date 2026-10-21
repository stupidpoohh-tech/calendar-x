/**
 * 가계부 내려받기 — 내역 목록을 엑셀 표로.
 *
 * **받는 모양과 같은 열이다** (`ledgerImport.ts` 의 `일자 · 구분 · 금액` + 선택 열). 내려받은 파일을
 * 다른 계정에 가져와도 같은 거래가 된다. 그래서 몇 가지를 그 약속에 맞춘다.
 *
 * - **실제 거래만 싣는다.** 가져오기는 모든 행을 실제 거래로 만든다 — 예정을 실으면 다시 가져올 때
 *   일어나지 않은 돈이 일어난 돈이 된다. 화면 목록에 예정이 섞여 있어도 파일에는 넣지 않고 건수를 따로 센다.
 * - 구분은 '수입' · '지출' 둘이다. 대출 원금은 지출이고 카테고리 칸에 '대출' 을 적는다 — 가져오기가
 *   카테고리 '대출' 을 대출 원금으로 센다(사용자 결정). 카테고리가 따로 붙어 있으면 그것을 적는다.
 * - '유형' 열(카드 사용 · 카드 대금 · 대출 원금 · 대출 이자 · 이체)은 보기 위한 열이다. 가져오기는 이 열을
 *   모르는 열로 알리고 읽지 않는다 — 카드 연결은 다시 가져오면 일반 지출이 된다.
 * - 금액은 부호 없는 숫자 셀(원 단위 그대로), 일자는 `YYYY-MM-DD` 글자다.
 *
 * 저장소 · 화면에 닿지 않는다. 표를 만드는 것만 한다.
 */
import { moneyFlowOf } from './ledger';
import type { HistoryItem } from './ledgerStats';
import type { Card, Category, MoneyFlow } from './types';

export const EXPORT_COLUMNS = ['일자', '구분', '금액', '카테고리', '설명', '수단', '유형', '메모'] as const;
/** 엑셀 열 너비(글자 수 기준). 열 순서와 같다. */
export const EXPORT_WIDTHS = [12, 6, 12, 14, 28, 14, 10, 30] as const;

const FLOW_NAME: Record<MoneyFlow, string> = {
  normal: '',
  cardSpend: '카드 사용',
  cardPayment: '카드 대금',
  loanPrincipal: '대출 원금',
  loanInterest: '대출 이자',
  transfer: '이체',
};

export interface LedgerExport {
  rows: (string | number | null)[][];
  /** 싣은 실제 거래 건수(머리줄 제외). */
  count: number;
  /** 목록에 있었지만 예정이라 싣지 않은 건수. */
  skippedPlanned: number;
}

export function ledgerExportRows(
  items: readonly HistoryItem[], categories: readonly Category[], cards: readonly Card[] = [],
): LedgerExport {
  const actual = items.filter((i) => !i.planned && i.entry.money);
  const sorted = [...actual].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const rows: (string | number | null)[][] = [[...EXPORT_COLUMNS]];
  for (const it of sorted) {
    const m = it.entry.money!;
    const flow = moneyFlowOf(m);
    const income = m.type === 'income';
    const cat = m.categoryId ? categories.find((c) => c.id === m.categoryId)?.name ?? '' : '';
    const card = m.cardId ? cards.find((c) => c.id === m.cardId)?.name ?? '' : '';
    rows.push([
      it.date,
      income ? '수입' : '지출',
      Math.abs(m.amountMinor),
      cat || (flow === 'loanPrincipal' ? '대출' : ''),
      it.entry.title.trim(),
      card || (m.method ?? ''),
      FLOW_NAME[flow] ?? '',
      it.entry.note.trim(),
    ]);
  }
  return { rows, count: sorted.length, skippedPlanned: items.filter((i) => i.planned).length };
}
