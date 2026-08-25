import { type ReactNode, useEffect, useRef } from 'react';

type Props = {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
};

/** 대화상자 껍데기. Esc·바깥 클릭으로 닫히고, 열려 있는 동안 뒤쪽 스크롤을 잠근다. */
export function Modal({ titleId, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  /*
   * onClose를 의존성에 넣으면 안 된다. 부르는 쪽은 대개 인라인 화살표라 부모가
   * 다시 그릴 때마다 새 함수가 되고, 그러면 이 효과가 통째로 다시 돌아 초점이
   * 첫 요소(닫기 ×)로 튄다. 팝업 안에서 뭔가 저장할 때마다 초점을 빼앗겼다.
   * 최신 onClose는 ref로 읽고, 효과는 열고 닫을 때 한 번씩만 돈다.
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button')
      ?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);

    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = bodyOverflow;
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      // 안에서 시작한 드래그가 바깥에서 끝나도 닫히지 않도록 mousedown 대상만 본다.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({
  badge,
  title,
  titleId,
  onClose,
}: {
  badge: string;
  title: string;
  titleId: string;
  onClose: () => void;
}) {
  return (
    <header className="modal__head">
      <h2 id={titleId} className="modal__title">
        <span className="modal__badge">{badge}</span>
        {title}
      </h2>
      <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}>
        ×
      </button>
    </header>
  );
}
