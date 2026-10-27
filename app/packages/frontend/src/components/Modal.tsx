import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ children, labelId, className, onClose, preventClose = false }: {
  children: ReactNode;
  labelId: string;
  className: string;
  onClose: () => void;
  preventClose?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={dialog} className={className} aria-labelledby={labelId}
    onKeyDown={(event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!preventClose) onClose();
    }}
    onCancel={(event) => { event.preventDefault(); if (!preventClose) onClose(); }}>
    {children}
  </dialog>;
}
