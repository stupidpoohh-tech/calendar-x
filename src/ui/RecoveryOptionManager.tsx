/**
 * OFF 항목 목록 관리 — 이름 변경 · 순서 · 삭제.
 *
 * 설정과 회복 상세가 같은 조각을 쓴다. 사용자가 자기 기준을 손으로 쌓아 가는 목록이라,
 * "여기서는 추가만 되고 이름은 설정에서" 같은 갈래가 생기면 그 자체가 관리 비용이 된다.
 */
import { useState } from 'react';
import {
  moveRecoveryOption, removeRecoveryOption, renameRecoveryOption, recoveryOptionKind, setRecoveryOptionKind,
} from '../domain/recovery';
import type { RecoveryRule, RecoveryOptionKind } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  rule: RecoveryRule;
  onChange: (next: RecoveryRule) => void;
}

export function RecoveryOptionManager({ rule, onChange }: Props) {
  const sorted = [...rule.options].sort((a, b) => a.order - b.order);

  /*
    이름 입력은 초안으로 들고 있다가 포커스가 빠질 때 한 번만 저장한다.
    onChange 를 그대로 물리면 한 글자에 쓰기가 한 번씩 나간다.
  */
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const commit = (id: string, current: string) => {
    const draft = drafts[id];
    setDrafts((d) => { const { [id]: _drop, ...rest } = d; return rest; });
    if (draft === undefined || draft.trim() === current) return;
    onChange(renameRecoveryOption(rule, id, draft));
  };

  if (sorted.length === 0) {
    return <p className="rec-none">항목이 없습니다. 위에서 추가하세요.</p>;
  }

  return (
    <><p className="rec-manage-hint">이름과 구분을 바꿀 수 있습니다. 선택한 항목은 다음 회복에 적용됩니다.</p>{error && <p role="alert">{error}</p>}<ul className="rec-opts">
      {sorted.map((o, i) => (
        <li key={o.id}>
          <select className="mod-input rec-kind" aria-label={`${o.label} 구분`} value={recoveryOptionKind(o)} onChange={(e) => {
            const next = setRecoveryOptionKind(rule, o.id, e.target.value as RecoveryOptionKind);
            setError(next === rule ? '해당 구분에 같은 이름이 있습니다. 이름을 먼저 바꿔 주세요.' : '');
            if (next !== rule) onChange(next);
          }}><option value="off">끌 것</option><option value="do">할 것</option></select>
          <input
            className="mod-input"
            value={drafts[o.id] ?? o.label}
            onChange={(e) => setDrafts((d) => ({ ...d, [o.id]: e.target.value }))}
            onBlur={() => commit(o.id, o.label)}
            onKeyDown={(e) => {
              // 조합 중 Enter 가 두 번 발화하면 입력이 사라진다.
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            aria-label={`${o.label} 이름`}
          />
          <button
            className="ico-btn sm" aria-label={`${o.label} 위로`} disabled={i === 0}
            onClick={() => onChange(moveRecoveryOption(rule, o.id, -1))}
          >
            <Icon.Chevron size={13} dir="up" />
          </button>
          <button
            className="ico-btn sm" aria-label={`${o.label} 아래로`} disabled={i === sorted.length - 1}
            onClick={() => onChange(moveRecoveryOption(rule, o.id, 1))}
          >
            <Icon.Chevron size={13} dir="down" />
          </button>
          <button
            className="ico-btn sm" aria-label={`${o.label} 삭제`}
            onClick={() => onChange(removeRecoveryOption(rule, o.id))}
          >
            <Icon.Trash size={13} />
          </button>
        </li>
      ))}
    </ul></>
  );
}

/**
 * 새 항목 입력 한 줄.
 *
 * 칩 줄 끝에 놓든 관리 목록 아래에 놓든 같은 조각이다. 태그 입력(EntryModal)과 같은
 * 규칙으로 움직인다 — Enter 로 넣고, 조합 중 Enter 는 무시한다.
 */
export function RecoveryOptionAdd({
  placeholder, onAdd,
}: { placeholder: string; onAdd: (label: string, kind: RecoveryOptionKind) => void }) {
  const [kind, setKind] = useState<RecoveryOptionKind>('off');
  const [text, setText] = useState('');

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onAdd(value, kind);
    setText('');
  };

  return (
    <div className="rec-add">
      <select className="mod-input rec-kind" aria-label="새 항목 구분" value={kind} onChange={(e) => setKind(e.target.value as RecoveryOptionKind)}><option value="off">끌 것</option><option value="do">할 것</option></select>
      <input
        className="mod-input"
        value={text}
        aria-label="새 회복 항목"
        placeholder={kind === 'do' ? '예: 사우나, 명상' : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        }}
      />
      <button className="btn" onClick={submit} disabled={!text.trim()}>
        <Icon.Plus size={13} /> 추가
      </button>
    </div>
  );
}
