/**
 * The one way a screen says why it is not showing data.
 *
 * Pages rendered an empty list for six different reasons — still loading, truly
 * nothing, the request failed, part of it failed, the caller may not see it, no
 * signal — and most showed the same blank table for all of them. A clinician
 * reading "no allergies" off a list that failed to load reads a finding that
 * does not exist. Each state here says which it is, and the failure states say
 * what to do next.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, Lock, WifiOff, XCircle } from 'lucide-react';
import { useTranslation } from '../i18n/react';

export type StatusKind = 'loading' | 'empty' | 'error' | 'partial' | 'denied' | 'offline';

const LOOK: Record<StatusKind, { icon: typeof Inbox; tone: string; role: 'status' | 'alert' }> = {
  loading: { icon: Loader2, tone: 'text-content-muted', role: 'status' },
  empty: { icon: Inbox, tone: 'text-content-muted', role: 'status' },
  error: { icon: XCircle, tone: 'bg-critical-subtle text-critical-subtle-fg', role: 'alert' },
  partial: { icon: AlertTriangle, tone: 'bg-caution-subtle text-caution-subtle-fg', role: 'alert' },
  denied: { icon: Lock, tone: 'bg-surface-sunken text-content-secondary', role: 'status' },
  offline: { icon: WifiOff, tone: 'bg-caution-subtle text-caution-subtle-fg', role: 'status' },
};

export function StatusBanner({ kind, message, action, onRetry }: {
  kind: StatusKind;
  /** What specifically is missing ("No lab orders for this patient"); a generic sentence otherwise. */
  message?: string;
  /** A next step, e.g. a link to create the first record. */
  action?: ReactNode;
  /** Offered on error and partial. */
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const look = LOOK[kind];
  const Icon = look.icon;
  const retryable = onRetry && (kind === 'error' || kind === 'partial' || kind === 'offline');
  return (
    <div role={look.role} className={`flex flex-wrap items-center gap-3 rounded-xl p-4 ${look.tone}`}>
      <Icon className={`h-5 w-5 shrink-0 ${kind === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-base">{message ?? t(`kit.status.${kind}`)}</p>
      {retryable && (
        <button type="button" onClick={onRetry}
          className="mc-press min-h-[44px] rounded-lg border border-current px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {t('kit.retry')}
        </button>
      )}
      {action}
    </div>
  );
}
