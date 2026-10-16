/**
 * 로그아웃 상태의 홈 화면에 얹어 주는 in-memory 데모 데이터.
 *
 * 처음 온 사람에게 앱 UI 를 실제로 만져 볼 수 있게 하되(탐색 가능),
 * 저장·편집·삭제를 시도하면 로그인 팝업이 뜬다. 데이터는 오늘 날짜에
 * 상대적이라 언제 열어도 "오늘 잡힌 일" 이 있어 보인다.
 */
import { newAnnualBudget } from '../domain/annualBudget';
import { useMemo } from 'react';
import { tideWindow } from '../data/repo';
import { defaultCategories, setDefaultBudget } from '../domain/category';
import { addDaysISO, todayISO } from '../domain/date';
import { newEntry, newMoney, setRecurrence } from '../domain/entry';
import { periodOf } from '../domain/period';
import type { Entry, MoneyFields } from '../domain/types';
import { FEED_DEMO, type StoreState } from './useStore';

/** 실제 거래 한 건. 데모는 메모리에만 있다 — 저장하려 하면 로그인을 묻는다. */
function actual(id: string, title: string, date: string, amount: number, m: Partial<MoneyFields> = {}): Entry {
  return newEntry('money', {
    id, title, startDate: date,
    money: newMoney({ status: 'actual', type: 'expense', amountMinor: amount, ...m }),
  });
}

export function useDemoStore(): StoreState {
  return useMemo(() => {
    const today = todayISO();
    const tomorrow = addDaysISO(today, 1);
    const soon = addDaysISO(today, 3);

    // 다음 입금이 5일 뒤 정도가 자연스러운 headline 을 만든다.
    const salary = addDaysISO(today, 5);
    // 생활비는 이 달의 대략 앞 · 뒤 반쪽. 오늘 기준 상대 계산이라 언제 열어도 걸친다.
    const spanStart = addDaysISO(today, -8);
    const spanEnd = addDaysISO(today, 20);

    const entries = [
      newEntry('task', {
        id: 'demo-task-1', title: '치과 예약',
        startDate: today, startTime: '14:30',
        task: { status: 'planned', important: true, urgent: false, order: 0 },
        color: 'red', location: '강남',
      }),
      newEntry('task', {
        id: 'demo-task-2', title: '분기 보고서 마감',
        startDate: today,
        task: { status: 'in-progress', important: true, urgent: false, order: 1 },
        color: 'blue',
      }),
      newEntry('task', {
        id: 'demo-task-3', title: '스크럼',
        startDate: today,
        task: { status: 'planned', important: false, urgent: false, order: 2 },
        color: 'cyan',
      }),
      setRecurrence(
        newEntry('task', {
          id: 'demo-task-4', title: '주간 회의',
          startDate: today,
          task: { status: 'planned', important: false, urgent: false, order: 3 },
          color: 'violet',
        }),
        { freq: 'weekly', interval: 1, until: null, count: null },
      ),

      newEntry('idea', {
        id: 'demo-idea-1', title: '뉴스레터 다시 시작',
        startDate: today, color: 'violet',
      }),
      newEntry('idea', {
        id: 'demo-idea-2', title: '월 리뷰 템플릿 정리',
        startDate: tomorrow, color: 'violet',
      }),

      newEntry('money', {
        id: 'demo-money-1', title: '급여',
        startDate: salary,
        money: newMoney({ type: 'income', amountMinor: 3_000_000, categoryId: 'default-salary' }),
      }),
      newEntry('money', {
        id: 'demo-money-2', title: '전기요금',
        startDate: soon,
        money: newMoney({ type: 'expense', amountMinor: 65_000, categoryId: 'default-housing' }),
      }),
      // 오늘 생활비에서 쓴 점심. 잔고를 오늘 적었고 반영 목록에 없으니 아직 잔고 밖이다 —
      // 그래도 주머니 안이라 한도는 더 깎이지 않는다(주머니가 이미 잡아 뒀다).
      actual('demo-money-3', '점심', today, 12_000, { categoryId: 'default-food', budgetId: 'demo-budget-1' }),

      /*
        지난 실제 거래 — 내역 · 예산 · 통계를 만져 볼 수 있게. 모두 잔고 기준일(오늘) 앞이라
        이미 잔고 안이고 한도를 움직이지 않는다. 생활비에 걸린 셋은 주머니에서 "반영된 몫" 으로
        빠진다. 카드 사용은 현금이 안 움직이고(대금에서 나간다), 대출 이자는 금융비용이다.
      */
      actual('demo-act-1', '점심', addDaysISO(today, -1), 9_000, { categoryId: 'default-food', budgetId: 'demo-budget-1' }),
      actual('demo-act-2', '커피', addDaysISO(today, -2), 4_500, { categoryId: 'default-cafe', budgetId: 'demo-budget-1', method: '체크카드' }),
      actual('demo-act-3', '장보기', addDaysISO(today, -3), 54_000, { categoryId: 'default-food', budgetId: 'demo-budget-1' }),
      actual('demo-act-4', '카드 대금', addDaysISO(today, -4), 120_000, { flow: 'cardPayment', method: '신한카드' }),
      actual('demo-act-5', '교통카드 충전', addDaysISO(today, -5), 30_000, { categoryId: 'default-transport' }),
      actual('demo-act-6', '온라인 쇼핑', addDaysISO(today, -6), 39_000, { categoryId: 'default-shopping', flow: 'cardSpend', method: '신한카드' }),
      actual('demo-act-7', '대출 이자', addDaysISO(today, -7), 45_000, { categoryId: 'default-finance', flow: 'loanInterest' }),
      actual('demo-act-7b', '대출 원금', addDaysISO(today, -7), 200_000, { flow: 'loanPrincipal' }),
      actual('demo-act-8', '관리비', addDaysISO(today, -20), 150_000, { categoryId: 'default-housing' }),
      actual('demo-act-9', '지난달 급여', addDaysISO(today, -25), 3_000_000, { type: 'income', categoryId: 'default-salary' }),
      actual('demo-act-10', '장보기', addDaysISO(today, -35), 61_000, { categoryId: 'default-food' }),
      actual('demo-act-11', '외식', addDaysISO(today, -40), 28_000, { categoryId: 'default-food' }),
    ];

    return {
      entries,
      // 데모는 전부 메모리에 있어 화면용·계산용 원본이 같은 목록이다.
      // 계산 쪽에는 반복을 펼치지 않은 이 목록이 그대로 들어가야 한다.
      tideEntries: entries,
      tideMonths: tideWindow(today),
      accounts: [{
        id: 'demo-account', name: '주계좌',
        balanceMinor: 850_000, currency: 'KRW',
        asOf: today, checkedAt: `${today}T09:00:00.000Z`,
        order: 0, createdAt: '', updatedAt: '',
      }],
      debts: [],
      budgets: [{
        id: 'demo-budget-1', name: '이번 달 생활비',
        startDate: spanStart, endDate: spanEnd,
        amountMinor: 620_000, currency: 'KRW',
        createdAt: '', updatedAt: '',
      }],
      reserves: [{
        id: 'demo-reserve-1', name: '비상금',
        amountMinor: 100_000, currency: 'KRW',
        createdAt: '', updatedAt: '',
      }],
      pins: [{
        id: 'demo-pin-1', lens: 'task',
        text: '이번 분기 목표: 상용화',
        order: 0, createdAt: '', updatedAt: '',
      }],
      // 미리보기에는 기본 카테고리를 보여 준다. 저장하는 순간 로그인을 묻는다.
      categories: defaultCategories(''),
      // 식비 · 카페는 이번 기간부터 기본 예산. 결산용이라 한도에서 빼지 않는다.
      categoryBudgets: [
        setDefaultBudget('default-food', periodOf(today, 1).key, 400_000, ''),
        setDefaultBudget('default-cafe', periodOf(today, 1).key, 50_000, ''),
      ],
      // 데모 세이브에 건 지출은 없다 — 사용액 0, 남은 금액 = 확보액.
      reserveLinked: [],
      reserveUsage: new Map(),
      // 데모에는 등록한 카드가 없다 — 카드 사용 · 대금 거래는 예전처럼 카드가 정해지지 않은 거래다.
      cards: [],
      cardLinked: [],
      // 경조사 · 선물은 올해 연간 예산 — 설 · 추석 달에 몰아 쓰는 지출이다. 계획이라 한도에서 빼지 않는다.
      annualBudgets: [
        newAnnualBudget('default-social', Number(today.slice(0, 4)), 600_000, { '02': 300_000, '09': 200_000 }, ''),
      ],
      ledger: { settleDay: 1 },
      ledgerMeta: FEED_DEMO,
      // 지난 기간의 돌아보기 한 장. 분석 보기 아래에 어떻게 보이는지 미리 보여 준다.
      ledgerNotes: [{
        id: periodOf(addDaysISO(periodOf(today, 1).start, -1), 1).key,
        period: periodOf(addDaysISO(periodOf(today, 1).start, -1), 1).key,
        text: '배달이 예산을 넘었다. 이번 달은 장 보기로 돌린다.', createdAt: '', updatedAt: '',
      }],
      ledgerNotesFeed: FEED_DEMO,
      // 메모리에서 만든 값이라 기다릴 것이 없다. 두 갈래 모두 받아 둔 상태다.
      display: FEED_DEMO, calc: FEED_DEMO,
      loading: false, error: null, rulesBlocked: false,
    };
  }, []);
}
