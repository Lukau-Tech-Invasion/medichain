import { useEffect, useRef, useState } from 'react';
import { ApiClientError, downloadRecordContent, getPatientRecords, getApiErrorMessage, formatTimestamp, getApiClient } from '@medichain/shared';
import type { MedicalRecordReference } from '@medichain/shared';
import { DocumentAccessRequest } from './DocumentAccessRequest';
import { MedicalDocumentUpload } from './MedicalDocumentUpload';
import { useCurrentProvider } from '../hooks/useCurrentProvider';

const ACCESS_REFUSED = 'Document access was refused. Check document-access permission before opening these records.';

/** Read a patient's document list and invalidate reads when its workspace changes. */
function useDocumentList(patientId: string) {
  const [records, setRecords] = useState<MedicalRecordReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const readGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    readGeneration.current += 1;
    setLoading(true);
    setError(null);
    setRecords([]);
    setListFailed(false);
    setAccessDenied(false);
    getPatientRecords(patientId).then(rows => { if (active) setRecords(rows); })
      .catch(err => {
        if (!active) return;
        const denied = err instanceof ApiClientError && err.status === 403;
        setAccessDenied(denied);
        setListFailed(true);
        setError(denied ? ACCESS_REFUSED
          : getApiErrorMessage(err, 'Documents could not be loaded.'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; readGeneration.current += 1; };
  }, [patientId, readAttempt]);

  const denyAccess = () => {
    setRecords([]); setAccessDenied(true); setListFailed(true); setError(ACCESS_REFUSED);
  };
  const reload = () => setReadAttempt(attempt => attempt + 1);
  return { records, loading, error, listFailed, accessDenied, readAttempt, readGeneration, setError, denyAccess, reload };
}

/** Keep document content bound to its patient, clinician and login session. */
function useDocumentOpening(patientId: string, documents: ReturnType<typeof useDocumentList>) {
  const [preview, setPreview] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => { setPreview(null); setOpening(false); }, [patientId, documents.readAttempt]);

  /** Preview text safely; download binary documents without injecting HTML. */
  async function openRecord(record: MedicalRecordReference) {
    const generation = documents.readGeneration.current;
    const client = getApiClient();
    const owner = client.getUserId();
    const session = client.getSessionRevision();
    const current = () => generation === documents.readGeneration.current
      && owner === client.getUserId() && session === client.getSessionRevision();
    setOpening(true);
    documents.setError(null);
    setPreview(null);
    try {
      const { blob, contentType } = await downloadRecordContent(record.content_hash, patientId);
      if (!current()) return;
      if (contentType.startsWith('text/') || contentType.includes('json')) {
        const text = await blob.text();
        if (current()) setPreview(text);
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'medical-document';
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      if (!current()) return;
      if (err instanceof ApiClientError && err.status === 403) {
        setPreview(null); documents.denyAccess();
      } else documents.setError(getApiErrorMessage(err, 'The document could not be opened.'));
    } finally { if (current()) setOpening(false); }
  }
  return { preview, setPreview, opening, openRecord };
}

/** Read and open the selected patient's encrypted documents through authorised APIs. */
export function PatientRecordDocuments({ patientId }: { patientId: string }) {
  const { can } = useCurrentProvider();
  const documents = useDocumentList(patientId);
  const { records, loading, error, listFailed, accessDenied, reload } = documents;
  const { preview, setPreview, opening, openRecord } = useDocumentOpening(patientId, documents);

  return <section aria-label="Patient documents">
    {can.editRecords && !accessDenied && <MedicalDocumentUpload key={patientId} patientId={patientId}
      disabled={loading || listFailed} onUploaded={reload} />}
    {error && <p role="alert" className="text-critical">{error}</p>}
    {accessDenied && <DocumentAccessRequest key={patientId} patientId={patientId}
      onCheckAccess={reload} />}
    {loading ? <p role="status">Loading documents...</p> : listFailed ?
      !accessDenied && <button type="button" className="underline" onClick={reload}>Retry loading documents</button> : records.length === 0 ?
      <p>No uploaded documents. Clinical notes and results are available in their respective workspaces.</p> :
      <ul className="divide-y divide-border">{records.map(record => <li key={record.content_hash} className="py-3 flex items-center justify-between gap-3">
        <span>{typeof record.record_type === 'string' ? record.record_type : 'Medical document'} · {formatTimestamp(record.uploaded_at * 1000)}</span>
        <button type="button" disabled={opening} onClick={() => void openRecord(record)} className="px-4 py-2 rounded-lg bg-brand text-brand-fg">Open document</button>
      </li>)}</ul>}
    {preview !== null && <div role="region" aria-label="Document preview" className="mt-4">
      <button type="button" onClick={() => setPreview(null)} className="px-4 py-2 border rounded-lg">Close preview</button>
      <pre className="whitespace-pre-wrap break-words mt-3 text-sm">{preview}</pre>
    </div>}
  </section>;
}
