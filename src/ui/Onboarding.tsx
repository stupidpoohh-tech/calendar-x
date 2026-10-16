import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OnboardingOutcome } from '../app/useOnboarding';
import { Icon } from './Icon';
import '../styles/onboarding.css';

const STEPS = [
  {
    label: '공간', title: '내 기록과 함께할 일을 구분합니다',
    body: '내 공간에서는 개인 일정과 노트, 가계부를 관리합니다. 같이 보기에서는 연결한 상대와 공유할 내용을 확인합니다.',
    tip: '로그인 후 상단의 사람 아이콘으로 전환합니다. 연결이 없다면 같이 보기 만들기부터 시작합니다.',
  },
  {
    label: '기록', title: '일정은 한눈에, 기록은 필요한 방식으로',
    body: '캘린더에서 날짜별 일정을 보고, 리스트 보기로 할 일을 차례로 확인하세요. 떠오른 생각은 노트에 남길 수 있습니다.',
    tip: '내 공간에는 캘린더·노트·가계부가, 같이 보기에는 캘린더·리스트·노트가 있습니다. 숨긴 기능은 설정에서 다시 표시할 수 있습니다.',
  },
  {
    label: '현금흐름', title: '앞으로 쓸 수 있는 금액을 확인합니다',
    body: '가계부의 현금흐름에서 잔고와 직접 기록한 입출금 일정을 함께 살펴보세요. 날짜별 흐름과 쓸 수 있는 한도를 확인할 수 있습니다.',
    tip: '금융사 거래를 자동으로 불러오지 않습니다. 표시 금액은 입력한 잔고와 거래, 생활비·세이브를 기준으로 계산합니다.',
  },
  {
    label: '세이브', title: '남겨 둘 돈에 목적을 정합니다',
    body: '세이브(Save)는 목적을 위해 따로 확보해 둘 금액입니다. 현금흐름에서 생활비와 세이브를 구분해 관리하세요.',
    tip: '확보한 금액은 쓸 수 있는 한도에서 구분됩니다. 설정의 튜토리얼 다시 보기에서 이 안내를 언제든 열 수 있습니다.',
  },
] as const;

/** Illustrative UI using the service's labels and icons, with no live user data. */
function Preview({ step }: { step: number }) {
  return (
    <div className="ob-preview" aria-hidden="true">
      <div className="ob-preview-head"><span>캘린더X</span><span>기능 안내 · 예시</span></div>
      {step === 0 ? (
        <div className="ob-spaces">
          <div className="ob-card"><Icon.User size={24} /><strong>내 공간</strong><span>나의 일정 · 노트 · 가계부</span><div className="ob-lines"><i /><i /><i /></div></div>
          <div className="ob-card"><Icon.Users size={24} /><strong>같이 보기</strong><span>함께 보는 일정과 기록</span><div className="ob-tags"><span>캘린더</span><span>리스트</span><span>노트</span></div></div>
        </div>
      ) : step === 1 ? (
        <div className="ob-records">
          <div className="ob-card"><Icon.Calendar size={22} /><strong>캘린더</strong><div className="ob-calendar">{Array.from({ length: 21 }, (_, i) => <i key={i} className={i === 9 || i === 17 ? 'marked' : ''}>{i + 1}</i>)}</div></div>
          <div className="ob-card"><Icon.List size={22} /><strong>리스트 · 노트</strong><span className="ob-task">○ 이번 주 일정 확인</span><span className="ob-task">○ 준비할 내용 정리</span><span className="ob-note">떠오른 아이디어를 기록하세요.</span></div>
        </div>
      ) : step === 2 ? (
        <div className="ob-flow"><div className="ob-tags"><span>가계부</span><span className="selected">현금흐름</span></div><div className="ob-flow-row"><span>현재 잔고</span><strong>입출금 일정</strong><span>앞날의 한도</span></div><div className="ob-chart"><i /><i /><i /><i /><i /><i /><i /></div><div className="ob-flow-caption"><span>오늘</span><span>날짜별 흐름 확인</span></div></div>
      ) : (
        <div className="ob-reserve"><div className="ob-card"><strong>생활비</strong><span>기간 동안 사용할 돈</span><div className="ob-meter"><i /></div></div><div className="ob-card ob-save"><strong>세이브 <small>Save</small></strong><span>목적을 위해 남겨 둘 돈</span><div className="ob-tags"><span>비상금</span><span>여행 준비</span></div></div></div>
      )}
    </div>
  );
}

export function Onboarding({ onFinish }: { onFinish: (outcome: OnboardingOutcome) => void }) {
  const [step, setStep] = useState(0);
  const [neverAgain, setNeverAgain] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const finishRef = useRef(onFinish);
  const neverRef = useRef(neverAgain);
  finishRef.current = onFinish;
  neverRef.current = neverAgain;
  const current = STEPS[step]!;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = dialog.current!;
    const portal = panel.parentElement!;
    const siblings = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== portal);
    const inertBefore = siblings.map((node) => node.inert);
    const overflow = document.body.style.overflow;
    siblings.forEach((node) => { node.inert = true; });
    document.body.style.overflow = 'hidden';
    const focusInside = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node)) heading.current?.focus();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finishRef.current(neverRef.current ? 'dismiss' : 'skip');
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener('focusin', focusInside);
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('focusin', focusInside);
      document.removeEventListener('keydown', keydown, true);
      siblings.forEach((node, index) => { node.inert = inertBefore[index] ?? false; });
      document.body.style.overflow = overflow;
      if (previous?.isConnected && previous !== document.body) previous.focus();
      else document.querySelector<HTMLElement>('button[aria-label="설정"], .landing-cta-sm')?.focus();
    };
  }, []);

  useEffect(() => { heading.current?.focus(); }, [step]);

  return createPortal(
    <div className="ob-backdrop">
      <div className="ob-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} ref={dialog}>
        <header className="ob-header"><span className="ob-brand">캘린더X 시작 안내</span><button className="ob-text-button" onClick={() => onFinish(neverAgain ? 'dismiss' : 'skip')}>건너뛰기 <Icon.X size={16} /></button></header>
        <ol className="ob-progress" aria-label="튜토리얼 진행">
          {STEPS.map((item, index) => <li key={item.label} aria-current={step === index ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span>{item.label}</li>)}
        </ol>
        <div className="ob-content">
          <Preview step={step} />
          <div className="ob-copy">
            <p className="ob-eyebrow">{step + 1} / 4 · {current.label}</p>
            <h2 id={titleId} ref={heading} tabIndex={-1}>{current.title}</h2>
            <p id={bodyId}>{current.body}</p>
            <p className="ob-tip">{current.tip}</p>
          </div>
        </div>
        <footer className="ob-footer">
          <div className="ob-preference"><label><input type="checkbox" checked={neverAgain} onChange={(event) => setNeverAgain(event.target.checked)} />다시 보지 않기</label><span>이 브라우저에 저장됩니다.</span></div>
          <div className="ob-actions"><button className="ob-button" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>이전</button><button className="ob-button ob-primary" onClick={() => step === 3 ? onFinish('complete') : setStep((value) => value + 1)}>{step === 3 ? '시작하기' : '다음'}<Icon.Chevron size={16} /></button></div>
        </footer>
      </div>
    </div>, document.body,
  );
}
