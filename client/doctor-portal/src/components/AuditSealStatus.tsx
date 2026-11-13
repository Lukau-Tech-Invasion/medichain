import { formatTimestamp, useTranslation } from '@medichain/shared';
import type { AuditSealSummary } from '@medichain/shared';

/**
 * The sealed audit stream at a glance: how many entries are waiting to be
 * sealed, when the last batch was sealed and exported, whether checkpoints
 * leave the host, and whether batches are signed.
 *
 * Renders nothing when the server did not report `audit_seal`. A missing
 * signing key or checkpoint sink is shown as the weaker state it is, in the
 * caution colours, never as a healthy default.
 *
 * @param props.summary - The `audit_seal` object from the health read.
 */
export function AuditSealStatus({ summary }: { summary: AuditSealSummary | null | undefined }) {
  const { t } = useTranslation();
  if (!summary) return null;
  const sealed = formatTimestamp(summary.last_sealed_at);
  const exported = formatTimestamp(summary.last_exported_at);
  const unsigned = summary.signing === 'unsigned';
  const noSink = summary.sink === 'none';
  return (
    <div className="mt-3 pt-3 border-t border-border" data-testid="audit-seal-status">
      <p className="text-sm font-medium text-content-secondary mb-1">{t('docAdmin.auditSealHeading')}</p>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-content-secondary">
        <li>{t('docAdmin.auditSealWaiting', { count: summary.unsealed_events })}</li>
        <li>
          {summary.last_sealed_at
            ? t('docAdmin.auditSealLastSealed', { time: sealed })
            : t('docAdmin.auditSealNeverSealed')}
        </li>
        <li>
          {summary.last_exported_at
            ? t('docAdmin.auditSealLastExported', { time: exported })
            : t('docAdmin.auditSealNeverExported')}
        </li>
        <li className={noSink ? 'text-caution-subtle-fg font-medium' : undefined}>
          {noSink ? t('docAdmin.auditSealSinkNone') : t('docAdmin.auditSealSinkFilesystem')}
        </li>
        <li className={unsigned ? 'text-caution-subtle-fg font-medium' : undefined}>
          {unsigned ? t('docAdmin.auditSealUnsigned') : t('docAdmin.auditSealSigned')}
        </li>
      </ul>
    </div>
  );
}
