/**
 * 공유 시작 · 초대 · 수락.
 *
 * ── 링크만으로는 아무것도 열리지 않는다 ─────────────────────────
 *
 * 초대 링크는 "이 보드에 들어와도 된다" 는 증거일 뿐이고, 들어오려면 **로그인**해야
 * 한다. 링크를 받은 사람이 보드 내용을 바로 읽는 구조가 아니다 — 수락해서 member 가
 * 된 뒤에야 보인다. 그리고 member 가 되어도 볼 수 있는 것은 `sharedBoards` 안의
 * 자료뿐이다. 내 아이디어 · 가계부 · 대출 · 잔고에는 접근 권한이 없다.
 *
 * ── 수락은 온라인이어야 한다 ────────────────────────────────────
 *
 * 초대장을 읽어야 하고(`getDoc`), 아직 member 가 아닌 상태에서 보드에 쓰는 것은 서버
 * 규칙만이 판정할 수 있다. 평소 편집과 조건이 다르므로 화면에서 미리 알린다.
 */
import { useState } from 'react';
import { inviteUrl, shortName } from '../domain/shared';
import type { SharedBoard, SharedInvite as Invite } from '../domain/types';
import { Icon } from './Icon';
import { isComposingEnter } from './ime';

/** 클립보드는 막혀 있을 수 있다. 링크는 늘 읽을 수 있는 칸에도 함께 보여 준다. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function linkFor(code: string): string {
  return inviteUrl(window.location.origin, window.location.pathname, code);
}

// ---------- 공유 시작 ----------

interface StartProps {
  defaultName: string;
  onCreate: (name: string) => void;
  onClose: () => void;
}

export function SharedStartSheet({ defaultName, onCreate, onClose }: StartProps) {
  const [name, setName] = useState(defaultName);

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="mod sh-mod" role="dialog" aria-modal="true" aria-label="같이 보기 만들기" onClick={(e) => e.stopPropagation()}>
        <header className="mod-head">
          <strong className="shi-head">같이 보기 만들기</strong>
          <button className="ico-btn sm" onClick={onClose} aria-label="닫기"><Icon.X size={14} /></button>
        </header>

        <div className="mod-body">
          <p className="mod-hint">
            내 캘린더를 상대와 함께 보는 자리를 만듭니다. 상대가 보는 것은 <b>이 공유 화면뿐</b>이고,
            아이디어 · 가계부 · 잔고에는 접근할 수 없습니다.
          </p>
          <p className="mod-hint">
            공유 화면에서 고친 값은 <b>내 캘린더에 반영되지 않습니다.</b> 고치지 않은 칸은 계속 원본을 따라갑니다.
          </p>

          <div className="mod-row">
            <label className="mod-lbl" htmlFor="sh-name">이름</label>
            <input
              id="sh-name" className="mod-input" value={name} autoFocus
              placeholder="같이 보기"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (isComposingEnter(e)) return;
                if (e.key === 'Enter') { e.preventDefault(); onCreate(name); }
              }}
            />
          </div>
        </div>

        <footer className="mod-foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={() => onCreate(name)}>만들기</button>
        </footer>
      </div>
    </div>
  );
}

// ---------- 보드 설정 · 초대 링크 ----------

interface SettingsProps {
  board: SharedBoard;
  myUid: string;
  /** 지금 살아 있는 초대장. 소유자만 목록 조회로 되찾을 수 있다. */
  invite: Invite | null;
  /** 초대장 조회가 끝났는가. 아직이면 "링크 없음" 을 확정하지 않는다. */
  invitesReady: boolean;
  /** 내가 속한 보드 수. 둘 이상이면 그 사실을 말해 준다. */
  boardCount: number;
  onMakeInvite: () => void;
  onDropInvite: (code: string) => void;
  onLeave: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function SharedSettingsSheet({
  board, myUid, invite, invitesReady, boardCount,
  onMakeInvite, onDropInvite, onLeave, onDelete, onClose,
}: SettingsProps) {
  const [copied, setCopied] = useState(false);
  const isOwner = board.ownerUid === myUid;
  const link = invite ? linkFor(invite.code) : '';

  return (
    <div className="mod-back" onClick={onClose}>
      <div className="mod sh-mod" role="dialog" aria-modal="true" aria-label="공유 설정" onClick={(e) => e.stopPropagation()}>
        <header className="mod-head">
          <strong className="shi-head">같이 보기 · {board.name}</strong>
          <button className="ico-btn sm" onClick={onClose} aria-label="닫기"><Icon.X size={14} /></button>
        </header>

        <div className="mod-body">
          {/*
            둘이 각자 '공유하기' 를 누른 뒤 링크를 주고받으면 두 보드에 속하게 된다.
            한 번에 하나만 열므로, 지금 무엇을 보고 있는지와 다른 보드로 가는 길을 적어 둔다.
          */}
          {boardCount > 1 && (
            <p className="mod-hint">
              참여 중인 보드가 {boardCount.toLocaleString('ko-KR')}개입니다. 지금 열려 있는 것은
              <b> {board.name}</b> 이고, 이 보드를 그만두거나 나가면 다른 보드가 열립니다.
            </p>
          )}

          <div className="mod-row">
            <span className="mod-lbl">함께 보는 사람</span>
            <ul className="sh-members">
              {board.memberUids.map((u) => (
                <li key={u}>
                  {shortName(board.memberNames[u] ?? '')}
                  {u === board.ownerUid && <span className="sh-tag">만든 사람</span>}
                  {u === myUid && <span className="sh-tag">나</span>}
                </li>
              ))}
            </ul>
          </div>

          {isOwner && (
            <>
              <div className="mod-row">
                <span className="mod-lbl">초대 링크</span>
                <div className="sh-invite">
                  {!invitesReady ? (
                    <span className="mod-hint">불러오는 중입니다.</span>
                  ) : invite ? (
                    <>
                      <input className="mod-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                      <div className="sh-invite-a">
                        <button
                          className="btn sm"
                          onClick={() => { void copy(link).then(setCopied); }}
                        >
                          <Icon.Link size={13} /> {copied ? '복사했습니다' : '링크 복사'}
                        </button>
                        <button className="btn sm danger ghost" onClick={() => onDropInvite(invite.code)}>
                          링크 끊기
                        </button>
                      </div>
                    </>
                  ) : (
                    <button className="btn sm" onClick={onMakeInvite}>
                      <Icon.Link size={13} /> 초대 링크 만들기
                    </button>
                  )}
                </div>
              </div>
              <p className="mod-hint">
                링크를 받은 사람이 <b>로그인해서 수락</b>해야 들어옵니다. 링크만으로는 아무것도 열리지 않습니다.
                링크를 끊으면 아직 수락하지 않은 사람은 들어올 수 없습니다.
              </p>
              <p className="mod-hint">
                살아 있는 링크는 하나입니다. 새로 만들면 앞 링크는 끊어집니다.
              </p>
            </>
          )}
        </div>

        <footer className="mod-foot">
          {isOwner ? (
            <button className="btn danger ghost" onClick={onDelete}>
              <Icon.Trash size={14} /> 공유 그만두기
            </button>
          ) : (
            <button className="btn danger ghost" onClick={onLeave}>나가기</button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>닫기</button>
        </footer>
      </div>
    </div>
  );
}

// ---------- 초대 수락 ----------

interface JoinProps {
  /** 초대장을 읽지 못했으면 null — 끊긴 링크이거나 아직 못 읽었다. */
  invite: Invite | null;
  state: 'loading' | 'ready' | 'not-found' | 'joining';
  onAccept: () => void;
  onClose: () => void;
}

export function SharedJoinSheet({ invite, state, onAccept, onClose }: JoinProps) {
  return (
    <div className="mod-back" onClick={onClose}>
      <div className="mod sh-mod" role="dialog" aria-modal="true" aria-label="초대 수락" onClick={(e) => e.stopPropagation()}>
        <header className="mod-head">
          <strong className="shi-head">같이 보기 초대</strong>
          <button className="ico-btn sm" onClick={onClose} aria-label="닫기"><Icon.X size={14} /></button>
        </header>

        <div className="mod-body">
          {state === 'loading' && <p className="mod-hint">초대를 확인하고 있습니다.</p>}

          {state === 'not-found' && (
            <>
              <p className="mod-hint">이 초대 링크는 더 이상 쓸 수 없습니다. 끊겼거나 주소가 잘못됐습니다.</p>
              <p className="mod-hint">보낸 사람에게 새 링크를 받아 주세요.</p>
            </>
          )}

          {(state === 'ready' || state === 'joining') && invite && (
            <>
              <p>
                <b>{invite.boardName}</b> 에 초대받았습니다. 수락하면 이 보드의 TODO · 고정메모 · D-Day 를
                함께 보고 고칠 수 있습니다.
              </p>
              <p className="mod-hint">
                <b>두 사람의 캘린더가 모두 여기로 옵니다</b> — 오늘 이후의 할 일만 올라가고,
                항목을 <b>나만 보기</b>로 표시하면 그 항목은 올라가지 않습니다.
              </p>
              <p className="mod-hint">
                수락해도 상대의 <b>아이디어 · 가계부 · 잔고 · 개인 고정 메모</b>에는 접근할 수 없습니다.
                공유 화면에서 고친 값은 상대의 원본에 반영되지 않습니다.
              </p>
              {!navigator.onLine && (
                <p className="dlg-warn">지금 오프라인으로 보입니다. 수락은 연결된 뒤에만 됩니다.</p>
              )}
            </>
          )}
        </div>

        <footer className="mod-foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>{state === 'not-found' ? '닫기' : '나중에'}</button>
          {state !== 'not-found' && (
            <button className="btn primary" disabled={state !== 'ready'} onClick={onAccept}>
              {state === 'joining' ? '수락하는 중' : '수락'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
