import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OnboardingOutcome } from '../app/useOnboarding';
import tuto1 from '../../tuto1.png';
import tuto2 from '../../tuto2.png';
import tuto3 from '../../tuto3.png';
import tuto4 from '../../tuto4.png';
import tuto5 from '../../tuto5.png';
import '../styles/onboarding.css';

// Original uploaded artwork is clipped by a viewport. Its background and painted controls
// never appear in the dialog; real HTML controls below remain keyboard accessible.
const STEPS = [
  { label: '일정과 회복', title: '일정도, 회복도. 캘린더 안에서.', image: tuto1,
    body: 'Calendar X는 일정과 할 일뿐 아니라 회복할 시간까지 함께 관리하는 캘린더입니다.' },
  { label: '노트', title: '생각과 기록을, 다시 찾기 쉽게.', image: tuto2,
    body: '노트에서는 메모, 아이디어, 참고 기록을 남기고 날짜와 연결해 필요한 순간 다시 꺼내볼 수 있습니다.' },
  { label: '가계부', title: '잔고만이 아니라 가용 금액까지.', image: tuto3,
    body: '가계부에서는 현금흐름, 생활비, 세이브를 함께 보고 다음 입금일까지 얼마나 쓸 수 있는지 파악할 수 있습니다.' },
  { label: '리커버리', title: '일정도, 회복도. 캘린더 안에서.', image: tuto4,
    body: '일정과 할 일, 회복 시간을 함께 관리하세요. 일상과 회복의 균형을 캘린더 안에 담습니다.' },
  { label: 'Clear Week', title: '이번 주에 더 집중하는 방식, Clear Week.', image: tuto5,
    body: 'Calendar X의 일정 흐름을 바탕으로, 연결된 별도 서비스 Clear Week에서 이번 주의 핵심 일정과 할 일을 더 간결하게 확인할 수 있습니다.' },
] as const;

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
        <header className="ob-header">
          <span className="ob-brand"><b>Calendar X</b> 시작 가이드</span>
          <button className="ob-text-button" onClick={() => onFinish(neverAgain ? 'dismiss' : 'skip')}>건너뛰기</button>
          <nav aria-label="튜토리얼 단계"><ol className="ob-progress">
            {STEPS.map((item, index) => <li key={item.label}><button type="button" title={item.label} aria-current={step === index ? 'step' : undefined} aria-label={`${index + 1}단계 ${item.label}`} onClick={() => setStep(index)}><span /></button></li>)}
          </ol><span className="ob-count" aria-live="polite">{step + 1} / {STEPS.length}</span></nav>
        </header>
        <div className="ob-artwork">
          <h2 className="sr-only" id={titleId} ref={heading} tabIndex={-1}>{current.title}</h2>
          <p className="sr-only" id={bodyId}>{current.body}</p>
          <svg className="ob-cropped-art" viewBox={step === 4 ? '62 154 1180 905' : '225 164 998 740'} aria-hidden="true" focusable="false">
            <image href={current.image} x="0" y="0" width={step === 4 ? 1284 : 1448} height={step === 4 ? 1225 : 1086} />
          </svg>
        </div>
        <footer className="ob-footer">
          <div className="ob-preference"><label><input type="checkbox" checked={neverAgain} onChange={(event) => setNeverAgain(event.target.checked)} />다시 보지 않기</label><span>이 브라우저에 저장됩니다.</span></div>
          <div className="ob-actions"><button className="ob-button" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>이전</button><button className="ob-button ob-primary" onClick={() => step === STEPS.length - 1 ? onFinish('complete') : setStep((value) => value + 1)}>{step === STEPS.length - 1 ? '시작하기' : '다음'}</button></div>
        </footer>
      </div>
    </div>, document.body,
  );
}
