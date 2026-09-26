import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, PencilLine, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { getAccessLogs, useTranslation, formatTimestamp } from '@medichain/shared';
import type { AccessLogEntry } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { anchorStateOf, groupAccessSessions } from './accessHistoryGrouping';
import type { AccessSession } from './accessHistoryGrouping';

/** Rows fetched per request; the API caps page size at 100. */
const PAGE_SIZE = 100;

/**
 * "Who viewed my records" -- the patient's view of every access to their data.
 *
 * This is MediChain's core promise made visible: for every time someone other
 * than the patient opened their health information, the patient sees who (name
 * and role), where (facility or department), when, why (the declared reason)
 * and what (plain-language categories), plus whether that entry has been
 * anchored on the blockchain. Reads are grouped into sessions so one chart
 * visit is one line, not twenty.
 *
 * An empty list and a list that failed to load are shown differently: telling
 * a patient "nobody has viewed your record" when the read failed would be the
 * worst possible mistake on this page.
 */
export function AccessHistoryPage() {
  const { t } = useTranslation();
  const patientId = usePatientAuthStore((state) => state.patient?.healthId ?? null);
  const [entries, setEntries] = useState<AccessLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  /**
   * Load one page of access-log rows and append it.
   *
   * @param nextPage - The 1-indexed page to fetch.
   */
  const loadPage = useCallback(
    async (nextPage: number) => {
      if (!patientId) return;
      try {
        const body = await getAccessLogs(patientId, { page: nextPage, limit: PAGE_SIZE });
        setEntries((previous) => (nextPage === 1 ? body.access_logs : [...previous, ...body.access_logs]));
        setTotal(body.total_accesses);
        setPage(nextPage);
        setStatus('ready');
      } catch (error) {
        console.error('Access history could not be loaded', error);
        setStatus('failed');
      }
    },
    [patientId],
  );

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  const sessions = groupAccessSessions(entries);

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-content">{t('accessHistory.title')}</h1>
      <p className="text-sm text-content-muted mt-1 mb-4">{t('accessHistory.subtitle')}</p>

      {status === 'loading' && <p className="text-sm text-content-muted">{t('accessHistory.loading')}</p>}

      {status === 'failed' && (
        <div role="alert" className="bg-surface border border-border rounded-xl p-4">
          <p className="text-sm text-content">{t('accessHistory.failed')}</p>
          <button
            type="button"
            onClick={() => void loadPage(1)}
            className="mt-3 px-3 py-2 rounded-lg border border-border text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t('accessHistory.retry')}
          </button>
        </div>
      )}

      {status === 'ready' && sessions.length === 0 && (
        <p className="text-sm text-content-muted">{t('accessHistory.empty')}</p>
      )}

      {status === 'ready' && sessions.length > 0 && (
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
          className="mt-4 w-full px-3 py-2 rounded-lg border border-border text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('accessHistory.loadOlder')}
        </button>
      )}
    </div>
  );
}

/**
 * One access session: who, where, when, why, what, and anchor state.
 *
 * @param props.session - The grouped session to render.
 */
function SessionCard({ session }: { session: AccessSession }) {
  const { t } = useTranslation();
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
            {session.kind === 'viewed' ? t('accessHistory.viewed') : t('accessHistory.changed')}:{' '}
          </span>
          {session.resources.join(', ')}
        </span>
      </p>
      <AnchorBadge session={session} />
    </li>
  );
}

/**
 * Truthful blockchain state for a session. Never says "verified" for a row
 * without a finalized transaction.
 *
 * @param props.session - The grouped session.
 */
function AnchorBadge({ session }: { session: AccessSession }) {
  const { t } = useTranslation();
  const state = anchorStateOf(session);
  const anchored = state === 'anchored';
  const Icon = anchored ? ShieldCheck : ShieldQuestion;
  const label =
    state === 'anchored'
      ? t('accessHistory.anchored')
      : state === 'partial'
        ? t('accessHistory.partiallyAnchored')
        : t('accessHistory.anchorPending');
  return (
    <p
      className={`flex items-center gap-1 text-xs mt-3 ${anchored ? 'text-green-700 dark:text-green-400' : 'text-content-muted'}`}
      title={t('accessHistory.anchorExplainer')}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
      {label}
    </p>
  );
}
