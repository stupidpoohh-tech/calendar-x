/**
 * 회복 상세.
 *
 * 회복 항목은 kind 가 `task` 라 EntryModal 로도 열 수 있지만, 거기서는 이 회차에 필요한
 * 세 가지 행동(완료 · 옮기기 · 건너뛰기)이 아니라 저장과 삭제가 기본이 된다. 삭제가
 * 기본 행동이 되는 순간 빚이 증발하므로, 회복은 이 화면으로 보낸다.
 *
 * 화면 골격은 기존 모달(.mod)과 같은 조각을 그대로 쓴다. 회복만 다른 세계처럼 보이면
 * 캘린더X 안에 기능이 하나 더 얹힌 것처럼 느껴진다.
 */
import { useEffect, useState } from 'react';
import { fmtDayFull } from '../domain/date';
import {
  addOptionFromEntry, describeRecoveryTime, recoveryOptionChoices,
  setEntryMemo, toggleEntryOption,
} from '../domain/recovery';
import type { Entry, RecoveryRule, TimeHM } from '../domain/types';
import { Icon } from './Icon';
import { RecoveryOptionAdd, RecoveryOptionManager } from './RecoveryOptionManager';

interface Props {
  entry: Entry;
  rule: RecoveryRule;
  todayISO: string;
  /** 메모 · OFF 항목 켜고 끄기. 이 회차에만 적용된다. */
  onSaveEntry: (e: Entry) => void;
  /** 항목 목록 자체를 고친다. 다음 회차부터 함께 바뀐다. */
  onChangeRule: (next: RecoveryRule) => void;
  onComplete: (e: Entry) => void;
  onMove: (e: Entry, toDate: string, toTime: TimeHM | null) => void;
  onSkip: (e: Entry) => void;
  onClose: () => void;
}

export function RecoverySheet({
  entry, rule, todayISO, onSaveEntry, onChangeRule, onComplete, onMove, onSkip, onClose,
}: Props) {
  const [memo, setMemo] = useState(entry.note);
  const [managing, setManaging] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState(entry.startDate);
  const [moveTime, setMoveTime] = useState(entry.startTime ?? '');

  // 다른 기기에서 이 회차가 바뀌면 메모 입력창도 따라가야 한다.
  useEffect(() => { setMemo(entry.note); }, [entry.note]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choices = recoveryOptionChoices(rule, entry);
  const repayment = entry.recovery?.repayment ?? false;
  const moved = entry.recovery?.movedCount ?? 0;

  const commitMemo = () => {
    if (memo === entry.note) return;
    onSaveEntry(setEntryMemo(entry, memo));
  };

  /*
    새 항목은 목록에 더하고 이 회차에서도 켠다. 문서가 둘이라 쓰기도 둘이지만,
    사용자에게는 한 동작이다 — 적으면 지금 켜지고 다음 회차부터 기본으로 붙는다.
  */
  const addOption = (label: string) => {
    const next = addOptionFromEntry(rule, entry, label);
    if (!next) return;
    onChangeRule(next.rule);
    if (next.entry !== entry) onSaveEntry(next.entry);
  };

  return (
    <div className="mod-back" onClick={onClose}>
      <div
        className="mod rec-mod"
        role="dialog"
        aria-modal="true"
        aria-label="회복"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-h">
          <div>
            <div className="sheet-eyebrow">{repayment ? '밀린 회복 갚기' : '회복'}</div>
            <h2 className="sheet-t">{entry.title}</h2>
            <div className="rec-when">
              {fmtDayFull(entry.startDate)} · {describeRecoveryTime(entry)}
              {moved > 0 && <span className="rec-moved">{moved}번 옮김</span>}
            </div>
          </div>
          <button className="ico-btn" onClick={onClose} aria-label="닫기"><Icon.X size={18} /></button>
        </header>

        <div className="mod-body">
          <div className="mod-row">
            <span className="mod-lbl">OFF</span>
            <div className="mod-chips">
              {choices.map((c) => (
                <button
                  key={c.id}
                  className={'chip' + (c.on ? ' on' : '') + (c.gone ? ' gone' : '')}
                  aria-pressed={c.on}
                  onClick={() => onSaveEntry(toggleEntryOption(rule, entry, c.id))}
                  title={c.gone ? '목록에서 지운 항목입니다. 이 회차에는 남아 있습니다.' : undefined}
                >
                  {c.on && <Icon.Check size={11} />}
                  {c.label}
                </button>
              ))}
              <button
                type="button"
                className={'chip ghost' + (managing ? ' on' : '')}
                aria-expanded={managing}
                aria-label={managing ? '항목 편집 닫기' : '항목 편집'}
                onClick={() => setManaging((x) => !x)}
              >
                <Icon.Settings size={11} /> 편집
              </button>
            </div>
          </div>

          {/*
            목록 자체를 여기서 고친다. 사용자가 자기 기준을 쌓아 가는 목록이라,
            새 항목을 적으려고 설정 화면까지 가야 하면 결국 적지 않게 된다.
          */}
          {managing && (
            <div className="mod-row">
              <span className="mod-lbl" />
              <div className="rec-manage">
                <RecoveryOptionAdd placeholder="새 항목 — 예: 사우나" onAdd={addOption} />
                <RecoveryOptionManager rule={rule} onChange={onChangeRule} />
                <p className="set-row-s">
                  여기서 고친 목록은 다음 회복에도 그대로 쓰입니다. 지난 회복은 그때의 이름을 그대로 둡니다.
                </p>
              </div>
            </div>
          )}

          <div className="mod-row">
            <label className="mod-lbl" htmlFor="rec-memo">메모</label>
            <textarea
              id="rec-memo"
              className="mod-input note"
              rows={2}
              value={memo}
              placeholder="선택 — 이 회차에만 적용됩니다"
              onChange={(e) => setMemo(e.target.value)}
              onBlur={commitMemo}
            />
          </div>

          {moving && (
            <div className="rec-move">
              <div className="mod-row">
                <label className="mod-lbl" htmlFor="rec-date">옮길 날</label>
                <div className="mod-dt">
                  <input
                    id="rec-date" type="date" className="mod-input"
                    value={moveDate} min={todayISO}
                    onChange={(e) => setMoveDate(e.target.value || entry.startDate)}
                  />
                  <input
                    type="time" className="mod-input time" value={moveTime}
                    onChange={(e) => setMoveTime(e.target.value)}
                    aria-label="옮길 시각"
                  />
                </div>
              </div>
              <p className="mod-hint">옮겨도 밀린 것으로 세지 않습니다. 회복은 그대로 잡혀 있습니다.</p>
              <div className="rec-move-do">
                <button className="btn" onClick={() => setMoving(false)}>그만두기</button>
                <button
                  className="btn primary"
                  onClick={() => { commitMemo(); onMove(entry, moveDate, moveTime || null); }}
                >
                  여기로 옮기기
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="mod-foot rec-foot">
          <button className="btn danger ghost" onClick={() => onSkip(entry)}>건너뛰기</button>
          <div className="spacer" />
          {!moving && <button className="btn" onClick={() => setMoving(true)}>옮기기</button>}
          <button className="btn primary" onClick={() => { commitMemo(); onComplete(entry); }}>
            <Icon.Check size={14} /> 완료
          </button>
        </footer>
      </div>
    </div>
  );
}
