/**
 * 로그아웃 상태의 홈 화면에 얹어 주는 in-memory 데모 데이터.
 *
 * 처음 온 사람에게 앱 UI 를 실제로 만져 볼 수 있게 하되(탐색 가능),
 * 저장·편집·삭제를 시도하면 로그인 팝업이 뜬다. 데이터는 오늘 날짜에
 * 상대적이라 언제 열어도 "오늘 잡힌 일" 이 있어 보인다.
 */
import { useMemo } from 'react';
import { tideWindow } from '../data/repo';
import { addDaysISO, todayISO } from '../domain/date';
import { newEntry, setRecurrence } from '../domain/entry';
import type { StoreState } from './useStore';

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
        money: { type: 'income', amountMinor: 3_000_000, currency: 'KRW', linkedEntryId: null },
      }),
      newEntry('money', {
        id: 'demo-money-2', title: '전기요금',
        startDate: soon,
        money: { type: 'expense', amountMinor: 65_000, currency: 'KRW', linkedEntryId: null },
      }),
      newEntry('money', {
        id: 'demo-money-3', title: '생활비',
        startDate: spanStart, endDate: spanEnd,
        money: { type: 'living', amountMinor: 620_000, currency: 'KRW', linkedEntryId: null },
      }),
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
      pins: [{
        id: 'demo-pin-1', lens: 'task',
        text: '이번 분기 목표: 상용화',
        order: 0, createdAt: '', updatedAt: '',
      }],
      loading: false, error: null, rulesBlocked: false,
    };
  }, []);
}
