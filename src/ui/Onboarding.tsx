import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OnboardingOutcome } from '../app/useOnboarding';
import { Icon } from './Icon';
import { OnboardingIllustration } from './OnboardingIllustration';
import '../styles/onboarding.css';
import '../styles/onboarding-infographic.css';

const STEPS = [
  { label: '대시보드', title: '일정도, 생각도, 돈도. 오늘을 한눈에.',
    body: '대시보드에서 오늘 남은 할 일과 앞으로 7일의 일정을 확인하세요. 이번 달 노트와 생활비 외 가용 금액도 한곳에서 살펴볼 수 있습니다.',
    tip: '날짜를 누르면 그날 일정으로, 카드의 바로가기를 누르면 캘린더·노트·현금흐름으로 이동합니다.' },
  { label: '기록', title: '일정은 한눈에, 기록은 필요한 방식으로',
    body: '캘린더는 언제 할 일인지, 리스트는 무엇을 해야 하는지 보여 줍니다. 날짜에 남길 메모와 아이디어는 노트로 정리하세요.',
    tip: '내 공간의 캘린더에서 월간·리스트 보기를 바꿀 수 있습니다. 같이 보기에는 캘린더·리스트·노트 탭이 있습니다. 숨긴 기능은 설정에서 다시 표시합니다.' },
  { label: '현금흐름', title: '잔고 너머, 앞으로 쓸 수 있는 돈까지',
    body: '가계부 → 현금흐름에서 잔고와 직접 기록한 입출금 일정을 확인하세요. 생활비·세이브·카드 미결제를 반영한 생활비 외 가용 한도를 보여 줍니다.',
    tip: '다음 예정 입금 전날까지를 기준으로 계산합니다. 예정 입금이 없으면 앞으로 30일을 봅니다. 금융사 거래를 자동으로 가져오지 않습니다.' },
  { label: '세이브', title: '남겨 둘 돈에 목적을 정합니다',
    body: '생활비는 기간 동안 사용할 예산, 세이브(Save)는 목적을 위해 따로 확보할 돈입니다. 현금흐름에서 두 금액을 구분해 관리하세요.',
    tip: '세이브는 별도 계좌로 돈을 옮기는 기능이 아닙니다. 실제 지출을 연결하면 사용한 금액과 남은 몫을 확인할 수 있습니다.' },
  { label: '리커버리', title: '해야 할 일 사이에, 쉴 시간도 남겨 두세요',
    body: '설정 → 회복에서 간격과 시간대를 정하고, 끌 것(일·고민)과 할 것(사우나·명상)을 나눠 선택하세요. 예정일이 가까워지면 캘린더에 회복 일정 한 건이 만들어집니다.',
    tip: '실제로 쉰 뒤 완료하면 그날부터 다음 간격을 잡습니다. 놓친 회복은 다시 잡기로 옮길 수 있고, 일시중지해도 지난 기록과 설정은 남습니다.' },
  { label: '같이 보기', title: '내 기록과 함께할 일을 구분합니다',
    body: '내 공간에서는 나의 일정·노트·가계부를 관리합니다. 같이 보기에서는 연결한 상대와 공유할 일정·리스트·노트를 함께 확인합니다.',
    tip: '로그인 후 로고 오른쪽의 내 공간·같이 보기로 전환합니다. 연결이 없다면 같이 보기 만들기부터 시작합니다. 개인 가계부는 공유 화면에 합쳐지지 않습니다.' },
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
        <header className="ob-header"><span className="ob-brand">캘린더X 시작 안내</span><button className="ob-text-button" onClick={() => onFinish(neverAgain ? 'dismiss' : 'skip')}>건너뛰기 <Icon.X size={16} /></button></header>
        <nav aria-label="튜토리얼 단계"><ol className="ob-progress">
          {STEPS.map((item, index) => <li key={item.label}><button type="button" aria-current={step === index ? 'step' : undefined} aria-label={`${index + 1}단계 ${item.label}`} onClick={() => setStep(index)}><span>{String(index + 1).padStart(2, '0')}</span>{item.label}</button></li>)}
        </ol></nav>
        <div className="ob-content">
          <div className="ob-copy">
            <p className="ob-eyebrow">{step + 1} / {STEPS.length} · {current.label}</p>
            <h2 id={titleId} ref={heading} tabIndex={-1}>{current.title}</h2>
            <p id={bodyId}>{current.body}</p>
            <p className="ob-tip">{current.tip}</p>
          </div>
          <OnboardingIllustration step={step} />
        </div>
        <footer className="ob-footer">
          <div className="ob-preference"><label><input type="checkbox" checked={neverAgain} onChange={(event) => setNeverAgain(event.target.checked)} />다시 보지 않기</label><span>이 브라우저에 저장됩니다.</span></div>
          <div className="ob-actions"><button className="ob-button" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>이전</button><button className="ob-button ob-primary" onClick={() => step === STEPS.length - 1 ? onFinish('complete') : setStep((value) => value + 1)}>{step === STEPS.length - 1 ? '시작하기' : '다음'}<Icon.Chevron size={16} /></button></div>
        </footer>
      </div>
    </div>, document.body,
  );
}
