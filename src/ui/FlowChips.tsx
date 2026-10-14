/**
 * 흐름 칩 — 수입 · 지출 · 대출. 새 거래 입력(`EntryModal`)과 예정 확정(`ConfirmSheet`)이 같이 쓴다.
 * 예전 종류 · 예전 유형으로 저장된 값은 '(예전)' 칩으로 보여만 준다(`ledgerFlows.ts`).
 */
import { FLOW_PICKS, flowPickOf, type FlowPick } from './ledgerFlows';
import type { MoneyFields } from '../domain/types';

const COLOR: Record<FlowPick, string> = { income: '#22c55e', expense: '#ef4444', loan: '#f97316' };

export function FlowChips({ money, chosen = true, legacyLabel, onPick }: {
  money: Pick<MoneyFields, 'type' | 'flow'>;
  /** false 면 아무것도 고르지 않은 상태로 보인다(예전 종류의 확정 — 추정하지 않는다). */
  chosen?: boolean;
  /** 지금 값이 세 흐름 밖이면 그 이름. 고를 수는 없고 보여만 준다. */
  legacyLabel?: string | null;
  onPick: (pick: FlowPick) => void;
}) {
  const current = chosen ? flowPickOf(money) : null;
  return (
    <div className="mod-row">
      <span className="mod-lbl">흐름</span>
      <div className="mod-chips" role="radiogroup" aria-label="흐름">
        {FLOW_PICKS.map((f) => (
          <button
            key={f.id} type="button" role="radio"
            className={'chip mt' + (current === f.id ? ' on' : '')}
            style={{ ['--c' as string]: COLOR[f.id] }}
            aria-checked={current === f.id}
            onClick={() => onPick(f.id)}
          >
            <span className="chip-dot" />{f.label}
          </button>
        ))}
        {chosen && current === null && legacyLabel && (
          <span className="chip mt on legacy" title="예전 유형입니다. 흐름을 고르면 바뀝니다.">
            <span className="chip-dot" />{legacyLabel} (예전)
          </span>
        )}
      </div>
    </div>
  );
}
