import { useEffect, useState } from 'react';
import { downloadRecordContent, getPatientRecords, getApiErrorMessage, formatTimestamp } from '@medichain/shared';
import type { MedicalRecordReference } from '@medichain/shared';

/** Read and open the selected patient's encrypted documents through authorised APIs. */
export function PatientRecordDocuments({ patientId }: { patientId: string }) {
  const [records, setRecords] = useState<MedicalRecordReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPreview(null);
    getPatientRecords(patientId).then(rows => { if (active) setRecords(rows); })
      .catch(err => { if (active) setError(getApiErrorMessage(err, 'Documents could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patientId]);

  /** Preview text safely; download binary documents without injecting HTML. */
  async function openRecord(record: MedicalRecordReference) {
    setOpening(true);
    setError(null);
    try {
      const { blob, contentType } = await downloadRecordContent(record.content_hash, patientId);
      if (contentType.startsWith('text/') || contentType.includes('json')) {
        setPreview(await blob.text());
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'medical-document';
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'The document could not be opened.'));
    } finally { setOpening(false); }
  }

  return <section aria-label="Patient documents">
    {error && <p role="alert" className="text-critical">{error}</p>}
    {loading ? <p role="status">Loading documents...</p> : records.length === 0 ?
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
