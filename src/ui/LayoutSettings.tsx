/**
 * 내 캘린더 구성 · 캘린더 표시. 설정 시트 맨 위의 두 그룹이다.
 *
 * 한 줄에 한 기능, 그 기능의 말로 고른다 — 보이는 것은 표시 / 숨김, 도는 것은 활성화 / 일시중지
 * (회복은 아래 회복 그룹). 일괄 켜기 · 끄기나 고를 때마다 확인창을 두지 않는다: 숨김은 자료를
 * 건드리지 않아 언제든 그대로 되돌아온다.
 *
 * 같이 보기는 둘로 갈린다. 공간 전환(👤 / 👥)을 보일지는 여기서 고르고, 연결 자체는 '공유 연결
 * 관리' 에서만 끊는다 — 숨기기를 공유 해제로 쓰지 않는다. 연결이 없으면 고를 것이 없으므로
 * 토글 대신 시작하는 길을 둔다.
 */
import { CALENDAR_AMOUNTS, type Layout } from '../domain/layout';

export interface LayoutSettingsProps {
  /** The settings hub places these groups on separate detail screens. */
  section?: 'features' | 'sharing' | 'calendar';
  layout: Layout;
  onLayout: (patch: Partial<Layout>) => void;
  shared: {
    /** 보드가 있는가. 구독이 아직 안 왔으면 `ready` 가 false 다. */
    connected: boolean;
    ready: boolean;
    onStart: () => void;
    onManage: () => void;
  };
}

function ShowHide({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="seg" role="group" aria-label={`${label} 표시`}>
      {([true, false] as const).map((v) => (
        <button
          key={String(v)}
          className={'seg-btn' + (on === v ? ' on' : '')}
          aria-pressed={on === v}
          onClick={() => { if (on !== v) onChange(v); }}
        >
          {v ? '표시' : '숨김'}
        </button>
      ))}
    </div>
  );
}

export function LayoutSettings({ layout, onLayout, shared, section }: LayoutSettingsProps) {
  return (
    <>
      {(!section || section === 'features') && <div className="set-grp">
        <h3 className="set-gt">내 캘린더 구성</h3>
        <p className="set-note">필요한 기능만 선택해서 사용하세요.</p>

        <div className="set-row-inline">
          <span>
            캘린더
            <span className="set-row-s rec-sum">대시보드 · 캘린더 화면</span>
          </span>
          <span className="set-fixed">항상 사용</span>
        </div>

        <div className="set-row-inline">
          <span>
            가계부
            <span className="set-row-s rec-sum">
              {layout.ledger
                ? '내역 · 현금흐름 · 예산 · 분석'
                : '숨김 — 거래 · 잔고 · 생활비와 계산은 그대로 남아 있습니다'}
            </span>
          </span>
          <ShowHide label="가계부" on={layout.ledger} onChange={(v) => onLayout({ ledger: v })} />
        </div>

        <div className="set-row-inline">
          <span>
            노트
            <span className="set-row-s rec-sum">
              {layout.notes
                ? '독립 노트 화면'
                : '숨김 — 아이디어는 전체 화면과 입력 창에 그대로 남습니다'}
            </span>
          </span>
          <ShowHide label="노트" on={layout.notes} onChange={(v) => onLayout({ notes: v })} />
        </div>

      </div>}

      {(!section || section === 'sharing') && <div className="set-grp">
        <h3 className="set-gt">같이 보기 연결</h3>
        <div className="set-row-inline">
          <span>
            같이보기 공간 전환
            <span className="set-row-s rec-sum">
              {!shared.ready
                ? '같이 보기 연결을 확인하는 중입니다'
                : !shared.connected
                  ? '연결된 같이 보기가 없습니다'
                  : layout.sharedSwitcher
                    ? '머리의 👤 / 👥'
                    : '숨김 — 공유 연결 · 자료 · 권한은 그대로입니다'}
            </span>
          </span>
          {shared.ready && shared.connected && (
            <ShowHide label="같이보기 공간 전환" on={layout.sharedSwitcher} onChange={(v) => onLayout({ sharedSwitcher: v })} />
          )}
          {shared.ready && !shared.connected && (
            <button className="btn" onClick={shared.onStart}>같이보기 시작하기</button>
          )}
        </div>

        {shared.ready && shared.connected && (
          <button className="set-row" onClick={shared.onManage}>
            <span className="set-row-b">
              <span className="set-row-t">공유 연결 관리</span>
              <span className="set-row-s">초대 링크 · 참여자 · 공유 그만두기. 연결은 여기서만 끊습니다.</span>
            </span>
          </button>
        )}
      </div>}

      {layout.ledger && (!section || section === 'calendar') && (
        <div className="set-grp">
          <h3 className="set-gt">캘린더 표시</h3>
          <p className="set-note">현금흐름 달력 칸에 적을 금액입니다. 계산은 그대로이고 보여 줄 숫자만 고릅니다.</p>
          <div className="set-choices" role="radiogroup" aria-label="달력 칸의 금액">
            {CALENDAR_AMOUNTS.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={layout.calendarAmount === a.id}
                className={'set-choice' + (layout.calendarAmount === a.id ? ' on' : '')}
                onClick={() => { if (layout.calendarAmount !== a.id) onLayout({ calendarAmount: a.id }); }}
              >
                <span className="set-choice-dot" aria-hidden="true" />
                <span className="set-row-b">
                  <span className="set-row-t">{a.label}</span>
                  <span className="set-row-s">{a.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
