/**
 * 같이 보기 항목 편집.
 *
 * ── 이 화면은 원본을 쓰지 않는다 ────────────────────────────────
 *
 * 받는 것도 돌려주는 것도 `SharedTodoItem` 뿐이다. `Entry` 를 import 하지 않으므로
 * 여기서 개인 TODO 로 역반영이 일어날 수 있는 자리 자체가 없다. 저장은
 * `applyOverrides` 를 거치고, 그 함수는 `overrides` 만 바꾼다.
 *
 * ── 고치지 않은 칸은 원본을 따라간다 ────────────────────────────
 *
 * 입력칸은 표시값(`source ⊕ overrides`)으로 채워지고, 저장할 때 **원본과 같은 값은
 * override 에서 빠진다.** 그래서 제목만 고친 항목의 날짜는 계속 원본을 따라간다.
 * 어느 칸이 지금 공유 화면 값인지 칸마다 '수정됨' 으로 적어 둔다.
 */
import { useState } from 'react';
import { STATUSES } from '../domain/constants';
import {
  applyOverrides, canRevert, revertToSource, sharedView,
} from '../domain/shared';
import type { SharedOverridableField, SharedOverrides, SharedTodoItem } from '../domain/types';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';

interface Props {
  item: SharedTodoItem;
  mode: 'create' | 'edit';
  onSave: (item: SharedTodoItem) => void;
  /** 공유 화면에서만 감춘다. **원본은 지우지 않는다.** */
  onHide: (item: SharedTodoItem) => void;
  /** 공유 화면에서만 만든 항목을 지운다. 원본이 있는 항목에는 주지 않는다. */
  onDelete: (item: SharedTodoItem) => void;
  onClose: () => void;
}

interface Form {
  title: string;
  note: string;
  startDate: string;
  startTime: string;
  status: string;
  important: boolean;
  urgent: boolean;
}

export function SharedItemSheet({ item, mode, onSave, onHide, onDelete, onClose }: Props) {
  const view = sharedView(item);
  /*
    입력칸은 표시값으로 한 번만 채운다.

    열려 있는 동안 상대의 수정이 들어와도 지금 적고 있는 칸을 덮지 않는다. 다른 항목을
    열면 부르는 쪽이 `key` 로 이 조각을 새로 만들므로(`SharedScreen`), 여기서 항목이
    바뀌었는지 살피는 effect 를 두지 않는다.
  */
  const [form, setForm] = useState<Form>(() => toForm(item));
  const [error, setError] = useState('');

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const overridden = new Set<SharedOverridableField>(view.overridden);
  const mark = (k: SharedOverridableField) =>
    (overridden.has(k) ? <span className="shi-mark">수정됨</span> : null);

  const save = () => {
    const title = form.title.trim();
    if (!title) { setError('제목을 입력해 주세요.'); return; }
    const patchFields: SharedOverrides = {
      title,
      note: form.note,
      startDate: form.startDate,
      startTime: form.startTime || null,
      status: asStatus(form.status),
      important: form.important,
      urgent: form.urgent,
    };
    onSave(applyOverrides(item, patchFields));
  };

  return (
    <div className="mod-back" onClick={onClose}>
      <div
        className="mod sh-mod" role="dialog" aria-modal="true"
        aria-label={mode === 'create' ? '같이 보기 새 항목' : '같이 보기 항목'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mod-head">
          <strong className="shi-head">
            {mode === 'create' ? '같이 보기에만 만들 항목' : '같이 보기 항목'}
          </strong>
          <button className="ico-btn sm" onClick={onClose} aria-label="닫기"><Icon.X size={14} /></button>
        </header>

        <div className="mod-body">
          {item.localOnly && mode === 'edit' && (
            <p className="mod-hint">이 항목은 같이 보기에만 있습니다. 내 TODO 에는 만들어지지 않습니다.</p>
          )}
          {!item.localOnly && (
            <p className="mod-hint">
              내 TODO 의 항목입니다. 여기서 고친 값은 <b>내 TODO 에 반영되지 않고</b>,
              고치지 않은 칸은 계속 원본을 따라갑니다.
            </p>
          )}

          <input
            className="mod-title"
            placeholder="제목"
            value={form.title}
            autoFocus
            onChange={(e) => patch({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isComposingEnter(e) && (e.metaKey || e.ctrlKey)) save();
            }}
          />

          <div className="mod-row">
            <label className="mod-lbl" htmlFor="sh-date">날짜{mark('startDate')}</label>
            <div className="mod-dt">
              <input
                id="sh-date" type="date" className="mod-input"
                value={form.startDate}
                onChange={(e) => patch({ startDate: e.target.value })}
              />
              <input
                type="time" className="mod-input time" value={form.startTime}
                onChange={(e) => patch({ startTime: e.target.value })}
                aria-label="시각"
              />
            </div>
          </div>

          <div className="mod-row">
            <span className="mod-lbl">상태{mark('status')}</span>
            <div className="mod-chips">
              {STATUSES.map((s) => (
                <button
                  key={s.id}
                  className={'chip' + (form.status === s.id ? ' on' : '')}
                  onClick={() => patch({ status: s.id })}
                  aria-pressed={form.status === s.id}
                >
                  <span className="chip-dot" style={{ ['--c' as string]: s.dot }} />{s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mod-row">
            <span className="mod-lbl">속성{mark('important') ?? mark('urgent')}</span>
            <div className="mod-chips">
              <button
                className={'chip' + (form.important ? ' on' : '')}
                onClick={() => patch({ important: !form.important })}
                aria-pressed={form.important}
              >
                <Icon.Star size={12} />중요
              </button>
              <button
                className={'chip' + (form.urgent ? ' on' : '')}
                onClick={() => patch({ urgent: !form.urgent })}
                aria-pressed={form.urgent}
              >
                <Icon.Flame size={12} />긴급
              </button>
            </div>
          </div>

          <div className="mod-row">
            <label className="mod-lbl" htmlFor="sh-note">메모{mark('note')}</label>
            <textarea
              id="sh-note" className="mod-input note" rows={3} value={form.note}
              onChange={(e) => patch({ note: e.target.value })}
              placeholder="선택"
            />
          </div>

          {canRevert(item) && (
            <div className="mod-row">
              <span className="mod-lbl" />
              <button
                className="btn sm"
                onClick={() => onSave(revertToSource(item))}
              >
                <Icon.Undo size={13} /> 원본대로 되돌리기
              </button>
            </div>
          )}

          {error && <p className="mod-err" role="alert">{error}</p>}
        </div>

        <footer className="mod-foot">
          {mode === 'edit' && (
            item.localOnly ? (
              <button className="btn danger ghost" onClick={() => onDelete(item)}>
                <Icon.Trash size={14} /> 삭제
              </button>
            ) : (
              <button className="btn ghost" onClick={() => onHide(item)}>
                <Icon.EyeOff size={14} /> {item.hidden ? '다시 보이기' : '같이 보기에서 감추기'}
              </button>
            )
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={save}>저장</button>
        </footer>
      </div>
    </div>
  );
}

function toForm(item: SharedTodoItem): Form {
  const v = sharedView(item);
  return {
    title: v.title,
    note: v.note,
    startDate: v.startDate,
    startTime: v.startTime ?? '',
    status: v.status,
    important: v.important,
    urgent: v.urgent,
  };
}

function asStatus(v: string): 'planned' | 'in-progress' | 'done' {
  return v === 'in-progress' || v === 'done' ? v : 'planned';
}
