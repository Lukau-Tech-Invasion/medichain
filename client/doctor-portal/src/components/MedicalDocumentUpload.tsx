import { useEffect, useRef, useState } from 'react';
import { getApiErrorMessage, uploadMedicalRecord } from '@medichain/shared';
import type { RecordType } from '@medichain/shared';
import { MedicalDocumentFileError, prepareMedicalDocument } from './medicalDocumentFile';

interface UploadProps {
  patientId: string; disabled: boolean; onUploaded: () => void;
}

/** Keep a patient-specific upload's pending state and unchanged retry key together. */
function useMedicalDocumentUpload({ patientId, disabled, onUploaded }: UploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [recordType, setRecordType] = useState<RecordType>('other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inputVersion, setInputVersion] = useState(0);
  const operation = useRef<string | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  /** Validate and save; a failed list refresh never becomes a failed upload or an automatic retry. */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || disabled || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = await prepareMedicalDocument(file, patientId, recordType);
      if (!active.current) return;
      operation.current ??= crypto.randomUUID();
      const result = await uploadMedicalRecord(payload, operation.current);
      if (!result.success) throw new Error('UPLOAD_NOT_CONFIRMED');
      if (!active.current) return;
      operation.current = null;
      setFile(null); setInputVersion(value => value + 1);
      setNotice('Document uploaded. The document list is being refreshed.');
      onUploaded();
    } catch (err) {
      console.error('Medical document upload failed', err);
      if (active.current) setError(err instanceof MedicalDocumentFileError ? err.message
        : getApiErrorMessage(err, 'Upload could not be confirmed. Check the document list before retrying.'));
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }

  return { file, setFile, recordType, setRecordType, busy, error, notice, inputVersion, operation, setError, setNotice, submit };
}

/** Upload a bounded PDF or raster image to the displayed patient through the protected API. */
export function MedicalDocumentUpload(props: UploadProps) {
  const { patientId, disabled } = props;
  const { file, setFile, recordType, setRecordType, busy, error, notice, inputVersion, operation, setError, setNotice, submit } = useMedicalDocumentUpload(props);

  return <form aria-label="Upload medical document" onSubmit={event => void submit(event)} className="mb-4 space-y-3 border-b border-border pb-4">
    <h4 className="font-semibold">Upload medical document</h4>
    <p>Patient ID: <strong className="break-all">{patientId}</strong></p>
    <p id="medical-document-help">PDF, PNG or JPEG, up to 1 MiB. Saved as an encrypted patient document.</p>
    <fieldset disabled={disabled || busy} className="space-y-3">
      <label className="block" htmlFor="medical-document-file">Document file</label>
      <input key={inputVersion} id="medical-document-file" type="file" accept="application/pdf,image/png,image/jpeg"
        aria-describedby="medical-document-help" onChange={event => { setFile(event.target.files?.[0] ?? null); operation.current = null; setError(''); setNotice(''); }} />
      <label className="block" htmlFor="medical-document-type">Document category</label>
      <select id="medical-document-type" value={recordType} className="rounded border border-border bg-surface text-content p-2"
        onChange={event => { setRecordType(event.target.value as RecordType); operation.current = null; }}>
        <option value="other">Other</option><option value="imaging">Imaging</option>
        <option value="lab_result">Lab result</option><option value="discharge_summary">Discharge summary</option>
      </select>
      <button type="submit" disabled={!file} className="block rounded border border-border px-4 py-2">{busy ? 'Uploading document...' : 'Upload document'}</button>
    </fieldset>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="text-critical">{error}</p>}
  </form>;
}
