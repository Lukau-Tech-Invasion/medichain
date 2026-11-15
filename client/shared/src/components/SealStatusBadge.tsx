import { useTranslation } from '../i18n/react';
import { Badge } from './Badge';
import { sealLabelKey, type CombinedSealStatus } from '../utils/sealStatus';

export interface SealStatusBadgeProps {
  /** The entry's `seal_status`, or a combined state. Null/absent renders nothing. */
  status: CombinedSealStatus | null | undefined;
  className?: string;
}

/**
 * Where an audit entry, record or capsule version stands in the sealed audit
 * stream: "Sealing pending", "Sealed" or "Sealed and exported".
 *
 * Renders nothing when the server did not report a state -- an absent badge is
 * honest, a guessed one is not. Anything short of sealed uses the caution
 * colours so a pending entry never looks finished.
 */
export function SealStatusBadge({ status, className }: SealStatusBadgeProps) {
  const { t } = useTranslation();
  if (status === null || status === undefined) return null;
  const finished = status === 'sealed' || status === 'exported';
  return (
    <Badge
      variant={finished ? 'success' : 'warning'}
      className={className}
      data-testid="seal-badge"
      data-seal-status={status}
    >
      {t(sealLabelKey(status))}
    </Badge>
  );
}
