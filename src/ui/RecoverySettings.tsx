/**
 * 회복 설정. 기존 설정 시트 안의 한 그룹으로 들어간다.
 *
 * 별도 화면을 세우지 않은 이유는 회복이 네 번째 축이 아니기 때문이다. 사용자가 여기에
 * 오는 일은 처음 한 번과 기준을 바꿀 때뿐이라, 화면을 하나 더 만들면 그 화면으로 가는
 * 길만 늘어난다. 옵션 관리도 접힌 줄로 같은 그룹 안에 둔다.
 */
import { useEffect, useState } from 'react';
import {
  addRecoveryOption, describeRecoveryRule, horizonLabel, isFirstActivation,
  RECOVERY_HORIZON_CHOICES, RECOVERY_INTERVAL_CHOICES, RECOVERY_WINDOWS,
  setRecoveryInterval, toggleDefaultOption, recoveryOptionKind,
} from '../domain/recovery';
import type { RecoveryRule, RecoveryWindowId } from '../domain/types';
import { Icon } from './Icon';
import { RecoveryOptionAdd, RecoveryOptionManager } from './RecoveryOptionManager';

interface Props {
  rule: RecoveryRule;
  onChange: (next: RecoveryRule) => void;
  /**
   * 활성화 · 일시중지. 규칙을 통째로 쓰는 `onChange` 와 다른 길이다 — 일시중지는 앞날 회차를
   * 빚 없이 풀고, 다시 활성화는 오늘 + 간격으로 예정을 다시 잡는다(`pauseRecovery` · `resumeRecovery`).
   * 확인창은 부르는 쪽이 띄운다.
   */
  onPause: () => void;
  onResume: () => void;
}

export function RecoverySettings({ rule, onChange, onPause, onResume }: Props) {
  const first = isFirstActivation(rule);
  const [manageOptions, setManageOptions] = useState(false);
  const sorted = [...rule.options].sort((a, b) => a.order - b.order);

  /*
    글자 입력은 초안으로 들고 있다가 포커스가 빠질 때 한 번만 저장한다.
    onChange 를 그대로 물리면 한 글자에 쓰기가 한 번씩 나가는데, 이 앱은 접속마다
    전량을 실어 나르던 구조를 걷어내면서 읽기·쓰기 비용을 줄여 온 참이다.
  */
  const [memoDraft, setMemoDraft] = useState(rule.defaultMemo);

  // 다른 기기에서 바뀐 값은 편집 중이 아닐 때만 따라간다.
  useEffect(() => { setMemoDraft(rule.defaultMemo); }, [rule.defaultMemo]);

  const commitMemo = () => {
    if (memoDraft === rule.defaultMemo) return;
    onChange({ ...rule, defaultMemo: memoDraft });
  };

  return (
    <div className="set-grp">
      <h3 className="set-gt">회복</h3>

      <div className="set-row-inline">
        <span>
          Recovery
          <span className="set-row-s rec-sum">
            {rule.enabled
              ? describeRecoveryRule(rule)
              : first
                ? '켜면 간격마다 회복 일정 한 건을 잡습니다.'
                : '일시중지 중 — 규칙 · 메모 · 회복 항목 · 지난 기록 · 밀린 회복은 그대로 있습니다.'}
          </span>
        </span>
        <div className="seg" role="group" aria-label="Recovery 활성화">
          <button
            className={'seg-btn' + (rule.enabled ? ' on' : '')}
            aria-pressed={rule.enabled}
            onClick={() => { if (!rule.enabled) onResume(); }}
          >
            {first || rule.enabled ? '활성화' : '다시 활성화'}
          </button>
          <button
            className={'seg-btn' + (!rule.enabled ? ' on' : '')}
            aria-pressed={!rule.enabled}
            onClick={() => { if (rule.enabled) onPause(); }}
          >
            일시중지
          </button>
        </div>
      </div>

      {(rule.enabled || !first) && (
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

          <p className="set-row-s">다음 회복에 기본으로 포함할 항목을 선택하세요. 이미 잡힌 회차는 해당 일정을 열어 바꿀 수 있습니다.</p>
          {(['off', 'do'] as const).map((kind) => <div className="rec-field rec-option-group" data-kind={kind} key={kind} role="group" aria-label={kind === 'off' ? '끌 것' : '할 것'}>
            <span className="set-gt">{kind === 'off' ? '끌 것' : '할 것'}</span>
            <p className="rec-group-desc">{kind === 'off' ? '잠시 내려놓을 일과 생각' : '나를 회복시키는 활동'}</p>
            <div className="mod-chips">
              {sorted.filter((o) => recoveryOptionKind(o) === kind).map((o) => {
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
              {!sorted.some((o) => recoveryOptionKind(o) === kind) && <span className="rec-none">{kind === 'off' ? '예: 일, 고민' : '예: 사우나, 명상'} · 아래 옵션 관리에서 추가하세요.</span>}
            </div>
          </div>)}

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
              <RecoveryOptionAdd
                placeholder="예: 일, 고민"
                onAdd={(label, kind) => onChange(addRecoveryOption(rule, label, kind))}
              />
              <RecoveryOptionManager rule={rule} onChange={onChange} />
              <p className="set-row-s">
                이름과 구분을 바꾸거나 지워도 지난 회복에는 당시 이름과 구분이 남습니다.
              </p>
            </div>
          )}

          <p className="set-row-s rec-state">
            {rule.debtCount > 0
              ? `밀린 회복 ${rule.debtCount}회 — ${rule.enabled ? '다시 잡으면 하나씩 갚습니다.' : '일시중지 중에도 그대로 남고, 다시 활성화하면 다시 잡기로 갚습니다.'}`
              : !rule.enabled
                ? `다시 활성화하면 그날부터 ${rule.intervalDays}일 뒤로 잡습니다. 멈춘 기간은 밀린 회복으로 세지 않습니다.`
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
