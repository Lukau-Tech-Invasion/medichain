import { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { downloadClaimEob } from '../api/endpoints';
import type { EobDocument } from '../api/endpoints';
import { formatAttachmentSize, saveBlob } from './MessageAttachments';

/** One EOB as a download button, labelled when it was not virus-scanned. */
function EobItem({ document }: { document: EobDocument }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const { blob } = await downloadClaimEob(document.claim_id, document.id);
      saveBlob(blob, document.filename);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('insurance.eobDownloadFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="space-y-0.5">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-left text-xs text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
        <span className="font-medium">{document.filename}</span>
        <span className="text-content-muted">{formatAttachmentSize(document.size_bytes)}</span>
        <Download className="h-3 w-3" aria-hidden="true" />
      </button>
      {document.scan_status === 'not_scanned' && (
        <p className="text-xs text-caution-subtle-fg">{t('messages.attachmentNotScanned')}</p>
      )}
      {error && <p role="alert" className="text-xs text-critical-subtle-fg">{error}</p>}
    </li>
  );
}

/**
 * A claim's explanation-of-benefits documents, each downloadable, or an
 * honest "No EOB received yet" when the payer's EOB has not been filed.
 */
export function EobDocumentList({ documents }: { documents: EobDocument[] }) {
  const { t } = useTranslation();
  if (documents.length === 0) {
    return <p className="text-xs text-content-muted">{t('insurance.noEobYet')}</p>;
  }
  return (
    <ul className="space-y-1" aria-label={t('insurance.eobDocumentsLabel')}>
      {documents.map((document) => (
        <EobItem key={document.id} document={document} />
      ))}
    </ul>
  );
}
