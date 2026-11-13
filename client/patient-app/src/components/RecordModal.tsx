import { useEffect, useRef, type ReactNode } from 'react';

/** Open a native modal, contain keyboard focus and restore its opening control on close. */
export function RecordModal({ label, onClose, children, className = '', returnFocus }: {
  label: string; onClose: () => void; children: ReactNode; className?: string; returnFocus?: HTMLElement | null;
}) {
  const reference = useRef<HTMLDialogElement>(null);
  const initialReturnFocus = useRef(returnFocus);
  useEffect(() => {
    const openingControl = initialReturnFocus.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialog = reference.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (openingControl?.isConnected) openingControl.focus();
    };
  }, []);
  return <dialog ref={reference} aria-label={label}
    onCancel={event => { event.preventDefault(); onClose(); }}
    // ux-allow(overlay): a native <dialog> opened with showModal(); the browser traps focus and Escape fires onCancel.
    className={`fixed inset-0 m-0 w-full max-w-none h-full max-h-none border-0 bg-transparent text-inherit flex justify-center backdrop:bg-black/60 ${className}`}>
    {children}
  </dialog>;
}
