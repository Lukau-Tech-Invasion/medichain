import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, Search, Users } from 'lucide-react';
import { getApiClient, useTranslation } from '@medichain/shared';
import { useAuthStore } from '../store';

/** The directory deliberately carries no medical or national-ID fields. */
interface DirectoryPatient {
  patient_id: string;
  full_name?: string;
  date_of_birth?: string;
  facility?: string | null;
  content_available: boolean;
}

interface DirectoryPage {
  data: DirectoryPatient[];
  total: number;
  next_cursor?: string | null;
  unreadable_count: number;
}

/** Search the encrypted-name index on the server with a bounded page. */
async function fetchDirectory(query: string, cursor?: string): Promise<DirectoryPage> {
  const params = new URLSearchParams({ limit: '50' });
  if (query.trim()) params.set('q', query.trim());
  if (cursor) params.set('cursor', cursor);
  return getApiClient().get<DirectoryPage>(`/api/patients?${params}`, { keepEnvelope: true });
}

/** Minimal clinical directory; opening a chart is the patient-specific read. */
function PatientSearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<DirectoryPatient[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadable, setUnreadable] = useState(0);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) navigate('/login');
  }, [isAuthenticated, navigate]);

  const load = useCallback(async (term: string, next?: string) => {
    setLoading(true);
    setError(false);
    try {
      const page = await fetchDirectory(term, next);
      setPatients((current) => next ? [...current, ...page.data] : page.data);
      setTotal(page.total);
      setUnreadable(page.unreadable_count);
      setCursor(page.next_cursor ?? undefined);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load('');
  }, [user, load]);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold text-content">{t('docPatientSearch.title')}</h1>
      <p className="mt-1 text-content-muted">{t('docPatientSearch.subtitle')}</p>
      <form className="mt-6 flex gap-3" onSubmit={(event) => {
        event.preventDefault();
        setQuery(input.trim());
        void load(input.trim());
      }}>
        <label htmlFor="directory-query" className="sr-only">{t('docPatientSearch.search')}</label>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" size={18} aria-hidden="true" />
          <input id="directory-query" value={input} onChange={(event) => setInput(event.target.value)}
            placeholder={t('docPatientSearch.searchPlaceholder')}
            className="w-full rounded-lg border border-border-interactive bg-surface py-3 pl-10 pr-3 text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" />
        </div>
        <button type="submit" disabled={loading}
          className="rounded-lg bg-brand px-5 py-3 text-brand-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50">
          {t('docPatientSearch.search')}
        </button>
      </form>
      <section aria-live="polite" className="mt-6 rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border p-4">
          <span className="flex items-center gap-2 font-medium text-content-secondary">
            <Users size={18} aria-hidden="true" />
            {t('docPatientSearch.totalInSystem', { count: total })}
          </span>
          {unreadable > 0 && <span className="text-sm text-caution-subtle-fg">
            {t('docPatientSearch.unreadableSummary', { count: unreadable })}
          </span>}
        </div>
        {patients.map((patient) => <DirectoryRow key={patient.patient_id} patient={patient} />)}
        {loading && <p className="flex items-center gap-2 p-6 text-content-muted">
          <Loader2 className="animate-spin" size={18} aria-hidden="true" />{t('docPatientSearch.loading')}
        </p>}
        {error && <div role="alert" className="p-6 text-critical">
          {t('docPatientSearch.failFetch')}
          <button type="button" onClick={() => void load(query)} className="ml-3 underline focus-visible:ring-2 focus-visible:ring-primary-500">
            {t('common.retry')}
          </button>
        </div>}
        {!loading && !error && patients.length === 0 && <p className="p-6 text-content-muted">{t('docPatientSearch.noneFound')}</p>}
      </section>
      {cursor && !loading && <button type="button" onClick={() => void load(query, cursor)}
        className="mt-4 rounded-lg border border-border px-4 py-2 text-content focus-visible:ring-2 focus-visible:ring-primary-500">
        {t('common.loadMore')}
      </button>}
    </main>
  );
}

/** Render only fields authorised for discovery. */
function DirectoryRow({ patient }: { patient: DirectoryPatient }) {
  const { t } = useTranslation();
  const contents = <>
    <strong className="text-content">{patient.full_name || t('docPatientSearch.recordUnreadable')}</strong>
    <span className="block text-sm text-content-muted">{patient.patient_id}</span>
    {patient.date_of_birth && <span className="block text-sm text-content-muted">
      {t('docPatientSearch.dobLabel', { dob: patient.date_of_birth })}
    </span>}
    {patient.facility && <span className="block text-sm text-content-muted">{patient.facility}</span>}
    {!patient.content_available && <span className="flex items-center gap-1 text-sm text-caution-subtle-fg">
      <AlertCircle size={14} aria-hidden="true" />{t('docPatientSearch.phiUnavailable')}
    </span>}
  </>;
  return patient.content_available
    ? <Link to={`/patients/${encodeURIComponent(patient.patient_id)}`} className="block border-b border-border p-4 hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-primary-500">{contents}</Link>
    : <div className="border-b border-border p-4">{contents}</div>;
}

export default PatientSearchPage;
