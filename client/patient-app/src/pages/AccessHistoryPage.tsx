import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Eye, FlaskConical, PencilLine } from 'lucide-react';
import { getAccessLogs, useTranslation, formatTimestamp, SealStatusBadge } from '@medichain/shared';
import type { AccessLogEntry } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { authorityLabelKey, groupAccessSessions, sealStateOf } from './accessHistoryGrouping';
import type { AccessSession } from './accessHistoryGrouping';
import { EmergencyAccessHistory } from './EmergencyAccessHistory';

/** Rows fetched per request; the API caps page size at 100. */
const PAGE_SIZE = 100;

/**
 * "Who viewed my records" -- the patient's view of every access to their data.
 *
 * This is MediChain's core promise made visible: for every time someone other
 * than the patient opened their health information, the patient sees who (name
 * and role), where (facility or department), when, why (the declared reason)
 * and what (plain-language categories). Reads are grouped into sessions so one chart
 * visit is one line, not twenty.
 *
 * An empty list and a list that failed to load are shown differently: telling
 * a patient "nobody has viewed your record" when the read failed would be the
 * worst possible mistake on this page.
 */
export function AccessHistoryPage() {
  const patientId = usePatientAuthStore((state) => state.patient?.healthId ?? null);
  return patientId ? <PatientAccessHistory key={patientId} patientId={patientId} /> : null;
}

/** Load history owned by one authenticated patient; changing owner resets all state. */
function PatientAccessHistory({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AccessLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [pending, setPending] = useState(false);
  const [failedPage, setFailedPage] = useState(1);
  const busy = useRef(false);
  const generation = useRef(0);

  /**
   * Load one page of access-log rows and append it.
   *
   * @param nextPage - The 1-indexed page to fetch.
   */
  const loadPage = useCallback(
    async (nextPage: number) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      const requestGeneration = generation.current;
      try {
        const body = await getAccessLogs(patientId, { page: nextPage, limit: PAGE_SIZE });
        if (requestGeneration !== generation.current) return;
        if (body.patient_id !== patientId) throw new Error('Access history owner mismatch');
        setEntries((previous) => (nextPage === 1 ? body.access_logs : [...previous, ...body.access_logs]));
        setTotal(body.total_accesses);
        setPage(nextPage);
        setStatus('ready');
      } catch (error) {
        if (requestGeneration !== generation.current) return;
        console.error('Access history could not be loaded', error);
        setFailedPage(nextPage);
        setStatus('failed');
      } finally {
        if (requestGeneration === generation.current) {
          busy.current = false;
          setPending(false);
        }
      }
    },
    [patientId],
  );

  useEffect(() => {
    void loadPage(1);
    return () => {
      generation.current += 1;
      busy.current = false;
    };
  }, [loadPage]);

  const sessions = groupAccessSessions(entries);

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-content">{t('accessHistory.title')}</h1>
      <p className="text-sm text-content-muted mt-1 mb-4">{t('accessHistory.subtitle')}</p>
      {sessions.some((session) => sealStateOf(session) !== null) && (
        <p className="text-xs text-content-muted mb-4">{t('accessHistory.sealExplainer')}</p>
      )}
      {patientId && <EmergencyAccessHistory key={patientId} patientId={patientId} entries={entries} />}

      {status === 'loading' && <p className="text-sm text-content-muted">{t('accessHistory.loading')}</p>}

      {status === 'failed' && (
        <div role="alert" className="bg-surface border border-border rounded-xl p-4">
          <p className="text-sm text-content">{t('accessHistory.failed')}</p>
          <button
            type="button"
            onClick={() => void loadPage(failedPage)}
            disabled={pending}
            className="mt-3 px-3 py-2 rounded-lg border border-border text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t('accessHistory.retry')}
          </button>
        </div>
      )}

      {status === 'ready' && sessions.length === 0 && (
        <p className="text-sm text-content-muted">{t('accessHistory.empty')}</p>
      )}

      {sessions.length > 0 && (
        <ul className="space-y-3" data-testid="access-history-list">
          {sessions.map((session) => (
            <SessionCard key={session.key} session={session} />
          ))}
        </ul>
      )}

      {status === 'ready' && entries.length < total && (
        <button
          type="button"
          onClick={() => void loadPage(page + 1)}
          disabled={pending}
          aria-busy={pending}
          className="mt-4 w-full px-3 py-2 rounded-lg border border-border text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('accessHistory.loadOlder')}
        </button>
      )}
    </div>
  );
}

/**
 * A de-identified research export that included this patient. Says what
 * happened in plain words rather than presenting it as someone reading the
 * record.
 *
 * @param props.session - The grouped research-export session.
 */
function ResearchInclusionCard({ session }: { session: AccessSession }) {
  const { t } = useTranslation();
  return (
    <li className="bg-surface rounded-xl border border-border p-4" data-testid="access-session">
      <p className="flex items-center gap-1 font-semibold text-content">
        <FlaskConical className="w-4 h-4" aria-hidden="true" />
        {t('accessHistory.researchIncluded', { date: formatTimestamp(session.startedAt) })}
      </p>
      <p className="text-sm text-content-muted mt-1">{t('accessHistory.researchExplainer')}</p>
    </li>
  );
}

/**
 * One access session: who, where, when, why, what, and seal state.
 *
 * @param props.session - The grouped session to render.
 */
function SessionCard({ session }: { session: AccessSession }) {
  const { t } = useTranslation();
  if (session.kind === 'research') return <ResearchInclusionCard session={session} />;
  const sameMoment = session.startedAt === session.endedAt;
  const when = sameMoment
    ? formatTimestamp(session.startedAt)
    : `${formatTimestamp(session.startedAt)} – ${formatTimestamp(session.endedAt)}`;
  const KindIcon = session.kind === 'viewed' ? Eye : PencilLine;

  return (
    <li
      className={`bg-surface rounded-xl border p-4 ${session.emergency ? 'border-red-500' : 'border-border'}`}
      data-testid="access-session"
    >
      {session.emergency && (
        <p className="flex items-center gap-1 text-sm font-semibold text-red-700 dark:text-red-400 mb-2">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          {t('accessHistory.emergencyAccess')}
        </p>
      )}
      <p className="font-semibold text-content break-words">{session.accessorName}</p>
      <p className="text-sm text-content-muted">
        {session.role}
        {session.place ? ` · ${session.place}` : ''}
      </p>
      <p className="text-sm text-content mt-2">{when}</p>
      <p className="text-sm text-content">
        <span className="text-content-muted">{t('accessHistory.reason')}: </span>
        {session.reason}
      </p>
      <p className="flex items-start gap-1 text-sm text-content mt-2">
        <KindIcon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="text-content-muted">
            {session.kind === 'requested' ? t('accessHistory.receiptRequested') : session.kind === 'viewed' ? t('accessHistory.viewed') : t('accessHistory.changed')}:{' '}
          </span>
          {session.resources.map(resource => resource === 'shift_handoff' ? t('accessHistory.shiftHandoff') : resource).join(', ')}
        </span>
      </p>
      <AuthorityLine session={session} />
      <SealStatusBadge status={sealStateOf(session)} className="mt-2" />
    </li>
  );
}

/**
 * How the access was authorised (WP9): a care relationship, a grant, or --
 * highlighted -- break-glass emergency access by someone with no relationship.
 *
 * @param props.session - The grouped session.
 */
function AuthorityLine({ session }: { session: AccessSession }) {
  const { t } = useTranslation();
  const key = authorityLabelKey(session);
  if (!key) return null;
  if (session.authorityType === 'break_glass') {
    return (
      <p className="mt-2 rounded-md bg-critical-subtle p-2 text-sm font-semibold text-critical-subtle-fg" data-testid="break-glass-entry">
        {t(key)}
      </p>
    );
  }
  return <p className="mt-2 text-xs text-content-muted">{t(key)}</p>;
}
