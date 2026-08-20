import { useState } from 'react';
import { uid } from '../domain/entry';
import type { EntryKind, LensId, Pin } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  lens: LensId;
  pins: readonly Pin[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSave: (p: Pin) => void;
  onDelete: (p: Pin) => void;
}

const LENS_TITLE: Record<string, string> = {
  all: '고정 메모',
  task: '고정 메모 · 할 일',
  idea: '고정 메모 · 아이디어',
  money: '고정 메모 · 가계부',
};

/** 날짜를 갖지 않는 상시 참조용 메모. 장기 과제나 기준값을 적어 둔다. */
export function PinnedSection({ lens, pins, collapsed, onToggleCollapsed, onSave, onDelete }: Props) {
  const [input, setInput] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // 'all' 렌즈에서는 세 축의 고정 메모를 함께 본다.
  const visible = lens === 'all' ? pins : pins.filter((p) => p.lens === lens);
  const targetLens: EntryKind = lens === 'all' ? 'task' : lens;

  const add = () => {
    const text = input.trim();
    if (!text) return;
    const now = new Date().toISOString();
    onSave({
      id: uid(), lens: targetLens, text,
      order: visible.length, createdAt: now, updatedAt: now,
    });
    setInput('');
  };

  const commitEdit = () => {
    const id = editId;
    const text = editText.trim();
    setEditId(null);
    if (!id) return;
    const pin = pins.find((p) => p.id === id);
    if (!pin) return;
    if (!text) onDelete(pin);
    else if (text !== pin.text) onSave({ ...pin, text, updatedAt: new Date().toISOString() });
  };

  return (
    <div className="pin">
      <button className="pin-h" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
        <Icon.Chevron size={13} dir={collapsed ? 'right' : 'down'} />
        <span className="pin-h-t">{LENS_TITLE[lens] ?? '고정 메모'}</span>
        {visible.length > 0 && <span className="pin-h-n">{visible.length}</span>}
      </button>

      {!collapsed && (
        <div className="pin-b">
          {visible.map((p) => (
            editId === p.id ? (
              <textarea
                key={p.id} className="pin-edit" value={editText} autoFocus rows={2}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                  if (e.key === 'Escape') setEditId(null);
                }}
              />
            ) : (
              <div key={p.id} className="pin-i" data-lens={p.lens}>
                <button className="pin-i-t" onClick={() => { setEditId(p.id); setEditText(p.text); }}>
                  {p.text}
                </button>
                <button className="pin-x" onClick={() => onDelete(p)} aria-label="고정 메모 삭제">
                  <Icon.X size={11} />
                </button>
              </div>
            )
          ))}

          <input
            className="pin-in" value={input} placeholder="고정해 둘 메모"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') { e.preventDefault(); add(); }
            }}
          />
        </div>
      )}
    </div>
  );
}
