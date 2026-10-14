/**
 * 짧은 사용률 바 — 예산 줄의 맨 오른쪽. 막대 하나가 100% 까지이고, 넘으면 단계를 바꾼다.
 *
 *   ~100%     가계부 색으로 채운다
 *   100~200%  막대 전체를 옅은 빨강으로, 넘은 몫(예: 150% 면 절반)을 진한 빨강으로 겹친다
 *   200% 초과 막대 전체를 진한 빨강 + 빗금으로, 숫자도 굵게 — "두 배를 넘었다" 가 한눈에 보인다
 *
 * 색만으로 가르지 않도록 숫자(%)를 늘 함께 적는다.
 */
export function UsageBar({ used, budget, label, showPct = true }: {
  used: number; budget: number; label?: string;
  /** 숫자를 곁에 따로 적는 자리(예산 요약)에서는 끈다. */
  showPct?: boolean;
}) {
  const ratio = budget > 0 ? used / budget : 0;
  const level = ratio > 2 ? 'over2' : ratio > 1 ? 'over' : 'ok';
  const pct = Math.round(ratio * 100);
  return (
    <span className={`ub ub-${level}`} role="img" aria-label={`${label ? `${label} ` : ''}사용률 ${pct}%${level === 'over2' ? ' (두 배 초과)' : level === 'over' ? ' (초과)' : ''}`}>
      {showPct && <span className="ub-p num">{pct}%</span>}
      <span className="ub-t">
        <span className="ub-f" style={{ width: `${Math.round(Math.min(1, ratio) * 100)}%` }} />
        {level === 'over' && <span className="ub-x" style={{ width: `${Math.round((ratio - 1) * 100)}%` }} />}
      </span>
    </span>
  );
}
