/**
 * One pop-up shape for the whole product: a bottom sheet on a phone, a
 * centred panel on a wider screen, never taller than 85% of the screen, with
 * its title pinned at the top and its actions pinned at the bottom so the
 * button is never scrolled away (docs/UX_SIMPLIFICATION_PLAN.md Phase 2).
 *
 * Built on `ModalPanel`, so focus is trapped, Escape closes and focus returns
 * to the opener (W3C APG modal dialog). Never stack two: Apple's HIG — "let
 * people dismiss a modal view before presenting another one".
 */
import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ModalPanel } from './ModalPanel';
import { useTranslation } from '../i18n/react';

export interface SheetProps {
  title: string;
  /** Optional line under the title. */
  description?: string;
  onClose: () => void;
  /** Pinned under the content: the sheet's buttons. */
  actions?: ReactNode;
  children: ReactNode;
}

export function Sheet({ title, description, onClose, actions, children }: SheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalPanel
      labelledBy={titleId}
      describedBy={description ? descriptionId : undefined}
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      className="mc-sheet flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-3xl bg-surface-raised text-content shadow-xl outline-none sm:rounded-2xl"
    >
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 pb-3 pt-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          {description && <p id={descriptionId} className="text-sm text-content-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      {actions && (
        <div className="border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{actions}</div>
      )}
    </ModalPanel>
  );
}
