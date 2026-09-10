/**
 * "오늘" 을 살아 있는 값으로 들고 있는다.
 *
 * 예전에는 `useMemo(() => todayISO(), [])` 였다. 앱을 열어 둔 채 자정을 넘기거나,
 * 모바일에서 화면을 껐다가 다음 날 돌아오면 어제 날짜가 그대로 남는다. 그 값이
 * 오늘 카드·계산 창(`tideWindow`)·한도·정산 기준을 전부 정하므로, 하루가 밀리면
 * 화면 전체가 조용히 어제를 가리킨다.
 *
 * 세 갈래로 다시 잰다.
 *   1. 다음 자정에 맞춘 타이머 — 앱을 켜 둔 채로 날이 바뀌는 경우
 *   2. 화면이 다시 보일 때(visibilitychange) — 모바일에서 가장 흔한 경우
 *   3. 창이 포커스를 받을 때 — 데스크톱에서 탭을 오래 두었다가 돌아오는 경우
 *
 * 값이 실제로 달라졌을 때만 상태를 바꾼다. 타이머가 돌 때마다 리렌더가 나면
 * 구독이 다시 붙는다.
 */
import { useEffect, useState } from 'react';
import { todayISO } from '../domain/date';

/** 다음 자정까지 남은 밀리초. 시계가 이상해도 최소 1초는 기다린다. */
function msUntilMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
  return Math.max(1_000, next.getTime() - now.getTime());
}

export function useToday(): string {
  const [today, setToday] = useState(todayISO);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const check = () => {
      // 같은 날이면 상태를 건드리지 않는다. 불필요한 리렌더가 구독을 다시 붙인다.
      setToday((prev) => {
        const now = todayISO();
        return now === prev ? prev : now;
      });
    };

    const scheduleMidnight = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        check();
        scheduleMidnight();
      }, msUntilMidnight());
    };

    const onWake = () => {
      // 백그라운드에 있는 동안 타이머가 늦춰지거나 건너뛰었을 수 있다.
      check();
      scheduleMidnight();
    };

    scheduleMidnight();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, []);

  return today;
}
