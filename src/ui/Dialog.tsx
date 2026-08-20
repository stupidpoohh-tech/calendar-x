/**
 * 앱 내 확인창과 알림. (F-10)
 *
 * 이전에는 confirm() / alert() 를 그대로 썼다. 브라우저 기본 대화상자는 모바일에서
 * 도메인명이 먼저 뜨고, 문구를 다듬을 수 없으며, 다크 모드를 따르지 않는다.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ChoiceOption<T extends string> {
  id: T;
  label: string;
  hint?: string;
  danger?: boolean;
}

interface DialogApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  choose: <T extends string>(title: string, options: ChoiceOption<T>[], body?: ReactNode) => Promise<T | null>;
  toast: (message: string, tone?: 'ok' | 'bad') => void;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog 는 <DialogHost> 안에서만 쓸 수 있습니다.');
  return ctx;
}

type Pending =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'choose'; title: string; body?: ReactNode; options: ChoiceOption<string>[]; resolve: (v: string | null) => void };

interface ToastItem { id: number; message: string; tone: 'ok' | 'bad' }

export function DialogHost({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextToastId = useRef(1);
  const panelRef = useRef<HTMLDivElement>(null);

  const api = useMemo<DialogApi>(() => ({
    confirm: (options) => new Promise<boolean>((resolve) => {
      setPending({ kind: 'confirm', options, resolve });
    }),
    choose: <T extends string>(title: string, options: ChoiceOption<T>[], body?: ReactNode) =>
      new Promise<T | null>((resolve) => {
        setPending({
          kind: 'choose', title, body,
          options: options as ChoiceOption<string>[],
          resolve: resolve as (v: string | null) => void,
        });
      }),
    toast: (message, tone = 'ok') => {
      const id = nextToastId.current++;
      setToasts((t) => [...t, { id, message, tone }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
    },
  }), []);

  const close = useCallback((value: boolean | string | null) => {
    setPending((p) => {
      if (!p) return null;
      if (p.kind === 'confirm') p.resolve(value === true);
      else p.resolve(typeof value === 'string' ? value : null);
      return null;
    });
  }, []);

  // 열려 있는 동안 Escape 로 닫고, 포커스를 대화상자 안으로 가져온다.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(pending.kind === 'confirm' ? false : null); }
    };
    window.addEventListener('keydown', onKey, true);
    const timer = setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('button[data-autofocus]')?.focus();
    }, 30);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(timer); };
  }, [pending, close]);

  return (
    <DialogContext.Provider value={api}>
      {children}

      {pending && (
        <div className="mod-back" onClick={() => close(pending.kind === 'confirm' ? false : null)}>
          <div
            className="dlg"
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.kind === 'confirm' ? pending.options.title : pending.title}
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
          >
            {pending.kind === 'confirm' ? (
              <>
                <h2 className="dlg-t">{pending.options.title}</h2>
                {pending.options.body && <div className="dlg-b">{pending.options.body}</div>}
                <div className="dlg-actions">
                  <button className="btn" onClick={() => close(false)}>
                    {pending.options.cancelLabel ?? '취소'}
                  </button>
                  <button
                    className={'btn ' + (pending.options.danger ? 'danger' : 'primary')}
                    data-autofocus
                    onClick={() => close(true)}
                  >
                    {pending.options.confirmLabel ?? '확인'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="dlg-t">{pending.title}</h2>
                {pending.body && <div className="dlg-b">{pending.body}</div>}
                <div className="dlg-choices">
                  {pending.options.map((o, i) => (
                    <button
                      key={o.id}
                      className={'dlg-choice' + (o.danger ? ' danger' : '')}
                      {...(i === 0 ? { 'data-autofocus': true } : {})}
                      onClick={() => close(o.id)}
                    >
                      <span className="dlg-choice-l">{o.label}</span>
                      {o.hint && <span className="dlg-choice-h">{o.hint}</span>}
                    </button>
                  ))}
                </div>
                <div className="dlg-actions">
                  <button className="btn" onClick={() => close(null)}>취소</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.tone}>
            {t.tone === 'bad' ? <Icon.Alert size={14} /> : <Icon.Check size={14} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </DialogContext.Provider>
  );
}
