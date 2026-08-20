import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  COLORS, DEFAULT_CURRENCY, KIND_LABEL, MONEY_TYPES, MONEY_TYPE_BY_ID,
  REPEAT_OPTIONS, STATUSES,
} from '../domain/constants';
import { todayISO as computeToday } from '../domain/date';
import { convertKind, newEntry, withDerived } from '../domain/entry';
import { normalizeTag } from '../domain/filters';
import { minorToInput, parseAmountToMinor } from '../domain/money';
import { describeRecurrence } from '../domain/recurrence';
import type { Entry, EntryKind, MoneyType, RepeatFreq, TaskStatus } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initial: Entry | null;
  allTags: readonly string[];
  linkableTasks: readonly Entry[];
  onSave: (e: Entry) => void;
  onDelete: (e: Entry) => void;
  onClose: () => void;
}

/**
 * 한글 IME 안전 Enter.
 * isComposing 체크가 없으면 조합 중 Enter 가 두 번 발화해 입력이 사라진다.
 */
function isComposingEnter(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.key === 'Process' || e.keyCode === 229;
}

export function EntryModal({
  open, mode, initial, allTags, linkableTasks, onSave, onDelete, onClose,
}: Props) {
  const [form, setForm] = useState<Entry>(() => initial ?? newEntry('task'));
  const [amountText, setAmountText] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState('');
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const base = initial ?? newEntry('task');
    setForm(base);
    setAmountText(base.money ? (base.money.amountMinor ? minorToInput(base.money.amountMinor, base.money.currency) : '') : '');
    setTagInput('');
    setError('');
    const t = setTimeout(() => firstFieldRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const tagSuggestions = useMemo(
    () => allTags.filter((t) => !form.tags.includes(t) && (!tagInput || t.includes(tagInput))).slice(0, 8),
    [allTags, form.tags, tagInput],
  );

  if (!open) return null;

  const isTask = form.kind === 'task';
  const isMoney = form.kind === 'money';
  const moneyDef = form.money ? MONEY_TYPE_BY_ID[form.money.type] : null;

  const patch = (p: Partial<Entry>) => setForm((f) => ({ ...f, ...p }));

  const switchKind = (kind: EntryKind) => {
    setForm((f) => {
      const next = convertKind(f, kind);
      if (kind === 'money' && next.money) setAmountText(next.money.amountMinor ? minorToInput(next.money.amountMinor) : '');
      return next;
    });
  };

  const setMoney = (p: Partial<NonNullable<Entry['money']>>) => {
    setForm((f) => {
      const money = { ...(f.money ?? { type: 'expense' as MoneyType, amountMinor: 0, currency: DEFAULT_CURRENCY, linkedEntryId: null }), ...p };
      // 유형을 바꾸면 기본 색상도 따라간다. 사용자가 색을 직접 고쳤다면 건드리지 않는다.
      const typeChanged = p.type && p.type !== f.money?.type;
      return {
        ...f,
        money,
        color: typeChanged ? MONEY_TYPE_BY_ID[money.type].defaultColor : f.color,
        // 기간형이 아닌 유형으로 바꾸면 종료일을 접는다.
        endDate: typeChanged && !MONEY_TYPE_BY_ID[money.type].ranged ? null : f.endDate,
      };
    });
  };

  const setTask = (p: Partial<NonNullable<Entry['task']>>) => {
    setForm((f) => f.task ? { ...f, task: { ...f.task, ...p } } : f);
  };

  const setRepeat = (freq: RepeatFreq | 'none') => {
    patch({
      recurrence: freq === 'none' ? null : { freq, interval: 1, until: null, count: null },
    });
  };

  const addTag = (raw?: string) => {
    const tag = normalizeTag(raw ?? tagInput);
    if (!tag) return;
    if (!form.tags.includes(tag)) patch({ tags: [...form.tags, tag] });
    setTagInput('');
  };

  const save = () => {
    setError('');

    if (isMoney) {
      const minor = parseAmountToMinor(amountText, form.money?.currency ?? DEFAULT_CURRENCY);
      if (minor === null || minor === 0) {
        setError('금액을 입력해 주세요.');
        firstFieldRef.current?.focus();
        return;
      }
      const next = withDerived({
        ...form,
        money: { ...(form.money ?? { type: 'expense', currency: DEFAULT_CURRENCY, linkedEntryId: null }), amountMinor: Math.abs(minor), type: form.money?.type ?? 'expense', currency: form.money?.currency ?? DEFAULT_CURRENCY, linkedEntryId: form.money?.linkedEntryId ?? null },
      });
      onSave(next);
      return;
    }

    if (!form.title.trim()) {
      setError('제목을 입력해 주세요.');
      firstFieldRef.current?.focus();
      return;
    }
    onSave(withDerived({ ...form, title: form.title.trim() }));
  };

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="mod" role="dialog" aria-modal="true" aria-label={mode === 'edit' ? '항목 편집' : '새 항목'} onClick={(e) => e.stopPropagation()}>
        <header className="mod-head">
          <div className="mod-kinds" role="tablist" aria-label="항목 종류">
            {(['task', 'idea', 'money'] as EntryKind[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={form.kind === k}
                className={'mod-kind' + (form.kind === k ? ' on' : '')}
                data-kind={k}
                onClick={() => switchKind(k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>

        {mode === 'edit' && form.kind !== 'task' && (
          <div className="mod-convert">
            <Icon.ArrowUpRight size={13} />
            <span>종류를 바꾸면 이 항목이 그대로 다른 축으로 옮겨갑니다.</span>
          </div>
        )}

        <div className="mod-body">
          {isMoney ? (
            <>
              <div className="mod-row">
                <label className="mod-lbl" htmlFor="amount">금액</label>
                <div className="mod-amt">
                  <input
                    id="amount" ref={firstFieldRef} className="mod-input amt" type="text" inputMode="numeric"
                    placeholder="0" value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e)) save(); }}
                  />
                  <span className="mod-cur">원</span>
                </div>
              </div>

              <div className="mod-row">
                <span className="mod-lbl">유형</span>
                <div className="mod-chips">
                  {MONEY_TYPES.map((t) => (
                    <button
                      key={t.id}
                      className={'chip mt' + (form.money?.type === t.id ? ' on' : '')}
                      style={{ ['--c' as string]: t.color }}
                      onClick={() => setMoney({ type: t.id })}
                      title={t.hint}
                    >
                      <span className="chip-dot" />{t.label}
                    </button>
                  ))}
                </div>
              </div>
              {moneyDef && <p className="mod-hint">{moneyDef.hint}</p>}

              <div className="mod-row">
                <label className="mod-lbl" htmlFor="mtitle">라벨</label>
                <input
                  id="mtitle" className="mod-input" placeholder="예: 전기요금 (없어도 됩니다)"
                  value={form.title} onChange={(e) => patch({ title: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEnter(e)) save(); }}
                />
              </div>

              {linkableTasks.length > 0 && (
                <div className="mod-row">
                  <label className="mod-lbl" htmlFor="link">연결</label>
                  <select
                    id="link" className="mod-input"
                    value={form.money?.linkedEntryId ?? ''}
                    onChange={(e) => setMoney({ linkedEntryId: e.target.value || null })}
                  >
                    <option value="">연결한 할 일 없음</option>
                    {linkableTasks.map((t) => (
                      <option key={t.id} value={t.id}>{t.title || '(제목 없음)'}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          ) : (
            <>
              <input
                ref={firstFieldRef}
                className="mod-title"
                placeholder={form.kind === 'idea' ? '떠오른 것을 그대로' : '제목'}
                value={form.title}
                onChange={(e) => patch({ title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isComposingEnter(e) && (e.metaKey || e.ctrlKey)) save();
                }}
              />

              <div className="mod-row">
                <span className="mod-lbl">색상</span>
                <div className="mod-colors">
                  {COLORS.map((c) => (
                    <button
                      key={c.id}
                      className={'mod-color' + (form.color === c.id ? ' on' : '')}
                      style={{ background: c.hex }}
                      onClick={() => patch({ color: c.id })}
                      aria-label={c.label}
                      aria-pressed={form.color === c.id}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 날짜 */}
          <div className="mod-row">
            <label className="mod-lbl" htmlFor="start">
              {isMoney && moneyDef?.ranged ? '시작일' : '날짜'}
            </label>
            <div className="mod-dt">
              <input
                id="start" type="date" className="mod-input"
                value={form.startDate}
                onChange={(e) => patch({ startDate: e.target.value || computeToday() })}
              />
              {!isMoney && (
                <input
                  type="time" className="mod-input time" value={form.startTime ?? ''}
                  onChange={(e) => patch({ startTime: e.target.value || null })}
                  aria-label="시작 시각"
                />
              )}
            </div>
          </div>

          {(isTask || (isMoney && moneyDef?.ranged)) && (
            <div className="mod-row">
              <label className="mod-lbl" htmlFor="end">종료일</label>
              <div className="mod-dt">
                <input
                  id="end" type="date" className="mod-input"
                  value={form.endDate ?? ''} min={form.startDate}
                  onChange={(e) => patch({ endDate: e.target.value || null })}
                />
                {isTask && (
                  <input
                    type="time" className="mod-input time" value={form.endTime ?? ''}
                    onChange={(e) => patch({ endTime: e.target.value || null })}
                    aria-label="종료 시각"
                  />
                )}
              </div>
            </div>
          )}

          {/* 반복 — 할 일과 가계부 모두 */}
          {form.kind !== 'idea' && (
            <div className="mod-row">
              <label className="mod-lbl" htmlFor="repeat">반복</label>
              <div className="mod-dt">
                <select
                  id="repeat" className="mod-input"
                  value={form.recurrence?.freq ?? 'none'}
                  onChange={(e) => setRepeat(e.target.value as RepeatFreq | 'none')}
                >
                  {REPEAT_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                {form.recurrence && (
                  <input
                    type="date" className="mod-input" value={form.recurrence.until ?? ''}
                    min={form.startDate}
                    onChange={(e) => patch({
                      recurrence: form.recurrence ? { ...form.recurrence, until: e.target.value || null } : null,
                    })}
                    aria-label="반복 종료일"
                  />
                )}
              </div>
            </div>
          )}
          {form.recurrence && <p className="mod-hint"><Icon.Repeat size={11} /> {describeRecurrence(form.recurrence)}</p>}

          {/* 할 일 속성 */}
          {isTask && form.task && (
            <>
              <div className="mod-row">
                <span className="mod-lbl">상태</span>
                <div className="mod-chips">
                  {STATUSES.map((s) => (
                    <button
                      key={s.id}
                      className={'chip' + (form.task?.status === s.id ? ' on' : '')}
                      onClick={() => setTask({ status: s.id as TaskStatus })}
                    >
                      <span className="chip-dot" style={{ background: s.dot }} />{s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mod-row">
                <span className="mod-lbl">속성</span>
                <div className="mod-chips">
                  <button className={'chip' + (form.task.important ? ' on' : '')} onClick={() => setTask({ important: !form.task?.important })}>
                    <Icon.Star size={12} filled={form.task.important} fillColor="#f59e0b" stroke="#f59e0b" /> 중요
                  </button>
                  <button className={'chip' + (form.task.urgent ? ' on' : '')} onClick={() => setTask({ urgent: !form.task?.urgent })}>
                    <Icon.Flame size={12} filled={form.task.urgent} fillColor="#ef4444" stroke="#ef4444" /> 긴급
                  </button>
                </div>
              </div>
              <div className="mod-row">
                <label className="mod-lbl" htmlFor="loc">장소</label>
                <input id="loc" className="mod-input" value={form.location} placeholder="선택"
                  onChange={(e) => patch({ location: e.target.value })} />
              </div>
            </>
          )}

          {/* 태그 */}
          <div className="mod-row">
            <label className="mod-lbl" htmlFor="tag">태그</label>
            <div className="mod-tags">
              {form.tags.map((t) => (
                <span key={t} className="tag-pill">
                  #{t}
                  <button onClick={() => patch({ tags: form.tags.filter((x) => x !== t) })} aria-label={`${t} 태그 빼기`}>
                    <Icon.X size={10} />
                  </button>
                </span>
              ))}
              <input
                id="tag" className="tag-in" placeholder="태그 추가" value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (isComposingEnter(e)) return;
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
                  if (e.key === 'Backspace' && !tagInput && form.tags.length > 0) {
                    patch({ tags: form.tags.slice(0, -1) });
                  }
                }}
              />
            </div>
          </div>
          {tagSuggestions.length > 0 && (
            <div className="mod-row">
              <span className="mod-lbl" />
              <div className="mod-chips">
                {tagSuggestions.map((t) => (
                  <button key={t} className="chip ghost" onClick={() => addTag(t)}>#{t}</button>
                ))}
              </div>
            </div>
          )}

          {/* 메모 */}
          <div className="mod-row">
            <label className="mod-lbl" htmlFor="note">메모</label>
            <textarea
              id="note" className="mod-input note" rows={3} value={form.note}
              onChange={(e) => patch({ note: e.target.value })}
              placeholder="선택"
            />
          </div>

          {error && <p className="mod-err" role="alert">{error}</p>}
        </div>

        <footer className="mod-foot">
          {mode === 'edit' && (
            <button className="btn danger ghost" onClick={() => onDelete(form)}>
              <Icon.Trash size={14} /> 삭제
            </button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={save}>저장</button>
        </footer>
      </div>
    </div>
  );
}
