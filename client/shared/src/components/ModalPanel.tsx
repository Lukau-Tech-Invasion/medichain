/**
 * The modal mechanics every in-app dialog needs, once.
 *
 * A panel drawn over the page is a dialog whether or not it says so. Without
 * the semantics a screen reader keeps reading the page behind it, Tab walks
 * out of it into controls the user cannot see, Escape does nothing, and on
 * close a keyboard user is dropped at the top of the document. The consent
 * screen's grant details shipped in exactly that state.
 *
 * This follows the W3C APG modal dialog pattern: a named `dialog` (or
 * `alertdialog` for a destructive confirmation), `aria-modal`, focus moved in
 * on open, Tab contained, Escape closes, focus returned to the opener.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Keep Tab inside the dialog: behind it is a page the user cannot act on. */
export function trapTab(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface ModalPanelProps {
  /** Id of the visible heading that names the dialog. */
  labelledBy?: string;
  /** Accessible name when there is no visible heading. */
  label?: string;
  describedBy?: string;
  /** A destructive confirmation: announced as an alert. */
  alert?: boolean;
  onClose: () => void;
  /** Where focus goes on open; defaults to the first focusable control. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Classes for the overlay that positions the panel. */
  overlayClassName?: string;
  className?: string;
  children: ReactNode;
}

export function ModalPanel({
  labelledBy,
  label,
  describedBy,
  alert = false,
  onClose,
  initialFocus,
  overlayClassName = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50',
  className,
  children,
}: ModalPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus goes where the user is expected to act, and returns to whatever
  // opened the dialog when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const target = initialFocus?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
    target?.focus();
    return () => opener?.focus?.();
    // Mount-only: re-running would steal focus from wherever the user moved it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={overlayClassName}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          trapTab(event);
        }}
        className={className}
      >
        {children}
      </div>
    </div>
  );
}
