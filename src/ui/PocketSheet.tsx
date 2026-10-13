/**
 * 생활비 · 세이브 창 — 현금흐름 보기에서 연다.
 *
 * 들어오는 길이 셋이다: 카드의 확보 줄(생활비 · 세이브 하나), 달력의 생활비 막대, '+ 생활비' ·
 * '+ 세이브'. 어느 길로 오든 같은 `BudgetPanel` 을 연다 — 같은 자료를 고치는 화면을 둘 만들지
 * 않는다. 저장 · 삭제 · 기간 변경 확인 · 연결은 전부 `BudgetPanel` 이 받은 콜백 그대로다.
 *
 * 캘린더 위에 큰 패널을 하나 더 세우지 않으려고 창으로 띄운다.
 */
import { useEffect, type ComponentProps } from 'react';
import { BudgetPanel, type PocketFocus } from './BudgetPanel';
import { Icon } from './Icon';

type PanelProps = Omit<ComponentProps<typeof BudgetPanel>, 'collapsed' | 'onToggleCollapsed' | 'bare' | 'focus'>;

export function PocketSheet({ focus, onClose, ...panel }: PanelProps & {
  focus: PocketFocus;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="생활비 · 세이브" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-h">
          <div>
            <div className="sheet-eyebrow">한도에서 미리 빼 두는 돈</div>
            <h2 className="sheet-t">생활비 · 세이브</h2>
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>
        <div className="sheet-b">
          <BudgetPanel
            {...panel}
            focus={focus}
            collapsed={false}
            onToggleCollapsed={() => undefined}
            bare
          />
        </div>
      </div>
    </div>
  );
}
