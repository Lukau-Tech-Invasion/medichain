import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAccessLogs, getPatient, useTranslation, formatTimestamp } from '@medichain/shared';
import type { AccessLogEntry } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import { AlertTriangle, ChevronRight, Droplets, Eye, QrCode } from 'lucide-react';
import { HomeToday } from '../components/HomeToday';
import { groupAccessSessions, type AccessKind } from './accessHistoryGrouping';

interface PatientData {
  bloodType: string | null;
  allergies: string[];
}

/** Everything one person did in the record lately, as one line. */
export interface AccessGroup {
  key: string;
  who: string;
  /** The parts of the record, in plain words, most recent first. */
  what: string;
  kinds: AccessKind[];
  /** Separate visits (access-history sessions), not rows. */
  count: number;
  first: string;
  last: string;
}

const BLOOD_TYPES: Record<string, string> = {
  APositive: 'A+', ANegative: 'A-', BPositive: 'B+', BNegative: 'B-',
  ABPositive: 'AB+', ABNegative: 'AB-', OPositive: 'O+', ONegative: 'O-',
};

/** The blood group as a patient writes it, or null when it was never recorded. */
export function formatBloodType(bt: string | undefined | null): string | null {
  if (!bt || bt === 'Unknown') return null;
  return BLOOD_TYPES[bt] ?? bt;
}

/**
 * The server's internal names for parts of a record, as a patient would say
 * them. Anything not listed is still shown -- in words, never dropped: every
 * access stays visible to the person it is about (Security Engineering 3e,
 * ch. 10, p. 15, "Consent and notification", "Attribution").
 */
const PLAIN_RESOURCE: Record<string, string> = {
  ems_run: 'ambulance record',
  offline_summary: 'summary, saved for use without signal',
  emergency_info: 'emergency information',
  emergency_record: 'emergency record',
  patient_record: 'record',
  patient_chart: 'chart',
  medical_document: 'documents',
  handoff_draft: 'handover notes',
  triage: 'triage assessment',
  telehealth_session: 'video visit',
  gcs: 'coma scale assessment',
  research_export: 'research export',
};

/** A stored category in words: `medical_document` reads "documents". */
export function plainResource(resource: string): string {
  const known = PLAIN_RESOURCE[resource];
  if (known) return known;
  if (!resource.includes('_')) return resource.toLowerCase();
  return resource.replace(/_/g, ' ').toLowerCase();
}

/** "a, b and 2 more" -- the list stays one line on a phone. */
function shortList(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, 2).join(', ')} and ${items.length - 2} more`;
}

/**
 * Who has looked at the record lately: one line per person, at most `limit`
 * people, newest first. Sessions are the access history's own
 * (`groupAccessSessions`), so Home and the full history agree on what one visit
 * is. A nurse who opened the ambulance record, the emergency information and the
 * handover notes is one line, not three -- and each of those visits is still
 * listed, separately, behind the line in the full history. The patient's own
 * reads are not news to them and are left out.
 */
export function groupAccess(logs: AccessLogEntry[], selfId: string | undefined, limit: number): AccessGroup[] {
  const byPerson = new Map<string, AccessGroup & { parts: string[] }>();
  for (const s of groupAccessSessions(logs)) {
    if (s.accessorId === selfId) continue;
    let g = byPerson.get(s.accessorId);
    if (!g) {
      if (byPerson.size === limit) continue;
      g = { key: s.accessorId, who: s.accessorName, what: '', kinds: [], parts: [], count: 0, first: s.startedAt, last: s.endedAt };
      byPerson.set(s.accessorId, g);
    }
    g.count += 1;
    g.first = s.startedAt;
    if (!g.kinds.includes(s.kind)) g.kinds.push(s.kind);
    for (const r of s.resources.map(plainResource)) if (!g.parts.includes(r)) g.parts.push(r);
  }
  return [...byPerson.values()].map(({ parts, ...g }) => ({ ...g, what: shortList(parts) }));
}

/**
 * Home (mockup p1): the emergency card first, then what is due today, then
 * who has recently looked at the record.
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [patientData, setPatientData] = useState<PatientData | null>(null);
  const [profileFailed, setProfileFailed] = useState(false);
  const [access, setAccess] = useState<AccessGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || !patient) navigate('/login');
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (!patient) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const patientId = patient.healthId;
    getPatient(patientId)
      .then((data) => {
        if (cancelled) return;
        const info = data.emergency_info || {};
        setPatientData({
          bloodType: formatBloodType(info.blood_type) ?? formatBloodType(patient.bloodType),
          allergies: (info.allergies || []).map((a: string | { name: string }) => (typeof a === 'string' ? a : a.name)),
        });
        setProfileFailed(false);
      })
      // An unavailable profile is said to be unavailable; no plausible card is drawn.
      .catch(() => { if (!cancelled) setProfileFailed(true); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    getAccessLogs(patientId)
      .then((logs) => { if (!cancelled) setAccess(groupAccess(logs.access_logs || [], patient.userId, 3)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [patient]);

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-36 bg-surface-sunken rounded-2xl" />
        <div className="h-40 bg-surface-sunken rounded-2xl" />
      </div>
    );
  }

  const firstName = patient?.firstName || patient?.fullName?.split(' ')[0] || '';
  const accessLine = (g: AccessGroup) => {
    const day = (at: string) => formatTimestamp(at, { day: 'numeric', month: 'short' });
    const viewed = g.kinds.includes('viewed');
    const changed = g.kinds.includes('changed');
    const verb = viewed && changed ? t('home.viewedAndChanged') : changed ? t('home.changed') : t('accessHistory.viewed');
    const what = t('home.accessWhat', { verb, what: g.what });
    let when = formatTimestamp(g.last, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    if (g.count > 1) {
      when = day(g.first) === day(g.last)
        ? t('home.timesOn', { n: String(g.count), day: day(g.last) })
        : t('home.timesBetween', { n: String(g.count), from: day(g.first), to: day(g.last) });
    }
    return `${what} · ${when}`;
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-8 md:p-5">
      <div>
        <h1 className="text-3xl font-bold text-content">{t('dashboard.greeting', { name: firstName })}</h1>
        <p className="text-content-muted">{formatTimestamp(new Date().toISOString(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* The emergency card first (mockup p1): the screen a patient may need to
          show a stranger in a hurry, with the two facts a paramedic asks first. */}
      <Link to="/emergency-card"
        className="block rounded-2xl border-2 border-critical bg-critical-subtle p-4 text-critical-subtle-fg hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <span className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-black/20" aria-hidden="true">
            <QrCode className="h-7 w-7" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold">{t('dashboard.emergencyCard')}</span>
            <span className="block text-sm">{t('home.showParamedic')}</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
        </span>
        {patientData && (patientData.bloodType || patientData.allergies.length > 0) && (
          <span className="mt-3 flex flex-wrap gap-2">
            {patientData.bloodType && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1 text-sm font-semibold">
                <Droplets className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('dashboard.bloodType')}: </span>{patientData.bloodType}
              </span>
            )}
            {patientData.allergies.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('dashboard.allergies')}: </span>{patientData.allergies.join(', ')}
              </span>
            )}
          </span>
        )}
      </Link>
      {profileFailed && (
        <p role="status" className="rounded-xl bg-caution-subtle p-3 text-sm text-caution-subtle-fg">{t('dashboard.dataUnavailable')}</p>
      )}

      {patient && <HomeToday patientId={patient.healthId} />}

      <section aria-labelledby="home-privacy" className="space-y-1.5">
        <h2 id="home-privacy" className="px-1 text-sm font-semibold text-content-secondary">{t('home.privacy')}</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {access.length === 0 && <li className="px-4 py-3 text-sm text-content-muted">{t('dashboard.noRecentActivity')}</li>}
          {access.map((g) => (
            <li key={g.key}>
              <Link to="/privacy?view=viewed"
                className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-brand" aria-hidden="true">
                  <Eye className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-content">{g.who}</span>
                  <span className="block text-sm text-content-muted">{accessLine(g)}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-content-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
