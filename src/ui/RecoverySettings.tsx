/**
 * 회복 설정. 기존 설정 시트 안의 한 그룹으로 들어간다.
 *
 * 별도 화면을 세우지 않은 이유는 회복이 네 번째 축이 아니기 때문이다. 사용자가 여기에
 * 오는 일은 처음 한 번과 기준을 바꿀 때뿐이라, 화면을 하나 더 만들면 그 화면으로 가는
 * 길만 늘어난다. 옵션 관리도 접힌 줄로 같은 그룹 안에 둔다.
 */
import { useEffect, useState } from 'react';
import {
  addRecoveryOption, describeRecoveryRule, horizonLabel, moveRecoveryOption,
  RECOVERY_HORIZON_CHOICES, RECOVERY_INTERVAL_CHOICES, RECOVERY_WINDOWS,
  removeRecoveryOption, renameRecoveryOption, setRecoveryInterval, toggleDefaultOption,
} from '../domain/recovery';
import type { RecoveryRule, RecoveryWindowId } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  rule: RecoveryRule;
  onChange: (next: RecoveryRule) => void;
}

export function RecoverySettings({ rule, onChange }: Props) {
  const [manageOptions, setManageOptions] = useState(false);
  const [newOption, setNewOption] = useState('');
  const sorted = [...rule.options].sort((a, b) => a.order - b.order);

  /*
    글자 입력은 초안으로 들고 있다가 포커스가 빠질 때 한 번만 저장한다.
    onChange 를 그대로 물리면 한 글자에 쓰기가 한 번씩 나가는데, 이 앱은 접속마다
    전량을 실어 나르던 구조를 걷어내면서 읽기·쓰기 비용을 줄여 온 참이다.
  */
  const [memoDraft, setMemoDraft] = useState(rule.defaultMemo);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

  // 다른 기기에서 바뀐 값은 편집 중이 아닐 때만 따라간다.
  useEffect(() => { setMemoDraft(rule.defaultMemo); }, [rule.defaultMemo]);

  const commitMemo = () => {
    if (memoDraft === rule.defaultMemo) return;
    onChange({ ...rule, defaultMemo: memoDraft });
  };

  const commitLabel = (id: string, current: string) => {
    const draft = labelDrafts[id];
    setLabelDrafts((d) => { const { [id]: _drop, ...rest } = d; return rest; });
    if (draft === undefined || draft.trim() === current) return;
    onChange(renameRecoveryOption(rule, id, draft));
  };

  const addOption = () => {
    const text = newOption.trim();
    if (!text) return;
    onChange(addRecoveryOption(rule, text));
    setNewOption('');
  };

  return (
    <div className="set-grp">
      <h3 className="set-gt">회복</h3>

      <div className="set-row-inline">
        <span>
          Recovery 사용
          <span className="set-row-s rec-sum">{describeRecoveryRule(rule)}</span>
        </span>
        <div className="seg">
          {([true, false] as const).map((on) => (
            <button
              key={String(on)}
              className={'seg-btn' + (rule.enabled === on ? ' on' : '')}
              onClick={() => onChange({ ...rule, enabled: on })}
            >
              {on ? 'ON' : 'OFF'}
            </button>
          ))}
        </div>
      </div>

      {rule.enabled && (
        <>
          <div className="set-row-inline">
            <span>간격</span>
            <select
              className="mod-input rec-sel"
              value={rule.intervalDays}
              onChange={(e) => onChange(setRecoveryInterval(rule, Number(e.target.value)))}
              aria-label="회복 간격"
            >
              {RECOVERY_INTERVAL_CHOICES.map((d) => (
                <option key={d} value={d}>{d}일마다</option>
              ))}
            </select>
          </div>

          <div className="set-row-inline">
            <span>회복 단위</span>
            <select
              className="mod-input rec-sel"
              value={rule.window}
              onChange={(e) => onChange({ ...rule, window: e.target.value as RecoveryWindowId })}
              aria-label="회복 단위"
            >
              {RECOVERY_WINDOWS.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </select>
          </div>

          <div className="set-row-inline">
            <span>
              생성 시점
              <span className="set-row-s rec-sum">이때까지는 캘린더에 회복이 없습니다.</span>
            </span>
            <select
              className="mod-input rec-sel"
              value={rule.generationHorizonDays}
              onChange={(e) => onChange({ ...rule, generationHorizonDays: Number(e.target.value) })}
              aria-label="일정 생성 시점"
            >
              {RECOVERY_HORIZON_CHOICES.map((d) => (
                <option key={d} value={d}>{horizonLabel(d)}</option>
              ))}
            </select>
          </div>

          <div className="rec-field">
            <label className="set-gt" htmlFor="rec-default-memo">기본 메모</label>
            <textarea
              id="rec-default-memo"
              className="mod-input note"
              rows={2}
              value={memoDraft}
              placeholder="예: 오늘은 결과물을 만들지 않는다"
              onChange={(e) => setMemoDraft(e.target.value)}
              onBlur={commitMemo}
            />
          </div>

          <div className="rec-field">
            <span className="set-gt">이번 Recovery에서 끌 것</span>
            <div className="mod-chips">
              {sorted.map((o) => {
                const on = rule.defaultOptionIds.includes(o.id);
                return (
                  <button
                    key={o.id}
                    className={'chip' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => onChange(toggleDefaultOption(rule, o.id))}
                  >
                    {on && <Icon.Check size={11} />}
                    {o.label}
                  </button>
                );
              })}
              {sorted.length === 0 && <span className="rec-none">옵션이 없습니다. 아래에서 추가하세요.</span>}
            </div>
          </div>

          <button
            type="button"
            className="rec-manage-t"
            onClick={() => setManageOptions((x) => !x)}
            aria-expanded={manageOptions}
          >
            <Icon.Chevron size={12} dir={manageOptions ? 'down' : 'right'} />
            Recovery 옵션 관리
          </button>

          {manageOptions && (
            <div className="rec-manage">
              <ul className="rec-opts">
                {sorted.map((o, i) => (
                  <li key={o.id}>
                    <input
                      className="mod-input"
                      value={labelDrafts[o.id] ?? o.label}
                      onChange={(e) => setLabelDrafts((d) => ({ ...d, [o.id]: e.target.value }))}
                      onBlur={() => commitLabel(o.id, o.label)}
                      aria-label={`${o.label} 이름`}
                    />
                    <button
                      className="ico-btn sm" aria-label="위로" disabled={i === 0}
                      onClick={() => onChange(moveRecoveryOption(rule, o.id, -1))}
                    >
                      <Icon.Chevron size={13} dir="up" />
                    </button>
                    <button
                      className="ico-btn sm" aria-label="아래로" disabled={i === sorted.length - 1}
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
              </ul>
              <div className="rec-add">
                <input
                  className="mod-input"
                  value={newOption}
                  placeholder="새 옵션 — 예: 과외 준비"
                  onChange={(e) => setNewOption(e.target.value)}
                  onKeyDown={(e) => {
                    // 조합 중 Enter 가 두 번 발화하면 입력이 사라진다.
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') { e.preventDefault(); addOption(); }
                  }}
                />
                <button className="btn" onClick={addOption}><Icon.Plus size={13} /> 추가</button>
              </div>
              <p className="set-row-s">
                이름을 바꾸거나 지워도 지난 회복은 그대로 남습니다 — 각 회차가 그때의 이름을 함께 들고 있습니다.
              </p>
            </div>
          )}

          <p className="set-row-s rec-state">
            {rule.debtCount > 0
              ? `밀린 회복 ${rule.debtCount}회 — 다시 잡으면 하나씩 갚습니다.`
              : rule.nextDueAt
                ? `다음 예정 ${rule.nextDueAt}`
                : '다음 예정을 계산하는 중입니다.'}
            {rule.lastCompletedAt && ` · 마지막 완료 ${rule.lastCompletedAt}`}
          </p>
        </>
      )}
    </div>
  );
}
