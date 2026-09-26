import { useCallback, useEffect, useId, useState } from 'react';
import { FileText, Loader2, Upload } from 'lucide-react';
import {
  attachmentProblem,
  EobDocumentList,
  getPatientInsuranceClaims,
  MESSAGE_ATTACHMENT_TYPES,
  uploadClaimEob,
  useTranslation,
} from '@medichain/shared';
import type { EobDocument } from '@medichain/shared';
import PatientSelect from '../components/PatientSelect';

/** The fields of a claim this page shows. */
interface ClaimRow {
  claimId: string;
  serviceDate: string;
  status: string;
  payerName: string;
  documents: EobDocument[];
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Read a claim from the API's JSON without trusting its shape. */
function toClaimRow(raw: Record<string, unknown>): ClaimRow {
  const insurance = (raw.insurance as Record<string, unknown> | undefined) ?? {};
  return {
    claimId: String(raw.claim_id ?? ''),
    serviceDate: String(raw.service_date ?? ''),
    status: String(raw.status ?? ''),
    payerName: String(insurance.payer_name ?? ''),
    documents: Array.isArray(raw.eob_documents) ? (raw.eob_documents as EobDocument[]) : [],
  };
}

/**
 * Administrators file the payer's explanation of benefits (EOB) against a
 * patient's insurance claim. The patient then sees and downloads it in the
 * patient app; until one is filed the claim says "No EOB received yet".
 */
export default function ClaimsEobPage() {
  const { t } = useTranslation();
  const [patientId, setPatientId] = useState('');
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [state, setState] = useState<LoadState>('idle');

  const load = useCallback(async (id: string) => {
    setState('loading');
    try {
      const body = await getPatientInsuranceClaims(id, { limit: 100 });
      setClaims((body.claims ?? []).map(toClaimRow));
      setState('ready');
    } catch (err) {
      console.error('Claims could not be loaded:', err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (patientId) void load(patientId);
  }, [patientId, load]);

  const added = (claimId: string, document: EobDocument) =>
    setClaims((prev) =>
      prev.map((claim) => (claim.claimId === claimId ? { ...claim, documents: [document, ...claim.documents] } : claim)),
    );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-content flex items-center">
        <FileText className="h-8 w-8 mr-3" aria-hidden="true" />
        {t('docClaims.title')}
      </h1>
      <p className="mt-2 mb-6 text-content-muted">{t('docClaims.subtitle')}</p>
      <div className="mb-6 bg-surface shadow rounded-lg p-6">
        <PatientSelect id="claims-patient" value={patientId} onChange={setPatientId} label={t('docClaims.patient')} />
      </div>
      <ClaimList state={state} claims={claims} onAdded={added} />
    </div>
  );
}

/** Idle, loading, error, empty and list states, each distinguishable. */
function ClaimList({ state, claims, onAdded }: { state: LoadState; claims: ClaimRow[]; onAdded: (claimId: string, doc: EobDocument) => void }) {
  const { t } = useTranslation();
  if (state === 'idle') return <p className="text-sm text-content-muted">{t('docClaims.choosePatient')}</p>;
  if (state === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-content-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('docClaims.loading')}
      </p>
    );
  }
  if (state === 'error') return <p role="alert" className="text-sm text-critical-subtle-fg">{t('docClaims.loadFailed')}</p>;
  if (claims.length === 0) return <p className="text-sm text-content-muted">{t('docClaims.none')}</p>;
  return (
    <ul className="space-y-4">
      {claims.map((claim) => (
        <li key={claim.claimId} className="bg-surface shadow rounded-lg p-4 space-y-3">
          <div>
            <p className="font-medium text-content">{claim.payerName || claim.claimId}</p>
            <p className="text-xs text-content-muted">
              {t('docClaims.claimLine', { id: claim.claimId, date: claim.serviceDate, status: claim.status })}
            </p>
          </div>
          <EobDocumentList documents={claim.documents} />
          <EobUpload claimId={claim.claimId} onAdded={(doc) => onAdded(claim.claimId, doc)} />
        </li>
      ))}
    </ul>
  );
}

/** Choose one file and file it as this claim's EOB. */
function EobUpload({ claimId, onAdded }: { claimId: string; onAdded: (doc: EobDocument) => void }) {
  const { t } = useTranslation();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = (chosen: File | undefined) => {
    setError('');
    if (!chosen) return setFile(null);
    const problem = attachmentProblem(chosen);
    if (problem) {
      setFile(null);
      return setError(t(problem, { name: chosen.name }));
    }
    setFile(chosen);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const body = await uploadClaimEob(claimId, file);
      onAdded(body.document);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('docClaims.uploadFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
      <div>
        <label htmlFor={inputId} className="block text-xs font-medium text-content-secondary mb-1">
          {t('docClaims.eobFile')}
        </label>
        <input
          id={inputId}
          type="file"
          accept={MESSAGE_ATTACHMENT_TYPES.join(',')}
          onChange={(e) => choose(e.target.files?.[0])}
          className="text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </div>
      <button
        type="submit"
        disabled={!file || busy}
        className="flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
        {t('docClaims.fileEob')}
      </button>
      {error && <p role="alert" className="w-full text-sm text-critical-subtle-fg">{error}</p>}
    </form>
  );
}
