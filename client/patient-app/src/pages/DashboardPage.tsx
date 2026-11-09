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

/** Repeated visits by the same person to the same records, as one line. */
export interface AccessGroup {
  key: string;
  who: string;
  what: string;
  kind: AccessKind;
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

/** A stored category in words: `medical_document` reads "Medical document". */
function readable(resource: string): string {
  if (!resource.includes('_')) return resource;
  const words = resource.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Who has looked at the record lately, as at most `limit` lines. Rows are the
 * access history's own sessions (`groupAccessSessions`), so Home and the full
 * history agree on what one visit is; consecutive sessions by the same person
 * over the same records then fold into one line with a count, so five visits
 * to one assessment read "· 5 times" (UX plan F14). The patient's own reads
 * are not news to them and are left out.
 */
export function groupAccess(logs: AccessLogEntry[], selfId: string | undefined, limit: number): AccessGroup[] {
  const groups: AccessGroup[] = [];
  for (const s of groupAccessSessions(logs)) {
    if (s.accessorId === selfId) continue;
    const what = s.resources.map(readable).join(', ');
    const key = `${s.accessorId}|${s.kind}|${what}`;
    const prev = groups[groups.length - 1];
    if (prev && prev.key === key) {
      prev.count += 1;
      prev.first = s.startedAt;
      continue;
    }
    if (groups.length === limit) break;
    groups.push({ key, who: s.accessorName, what, kind: s.kind, count: 1, first: s.startedAt, last: s.endedAt });
  }
  return groups;
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
    const verb = g.kind === 'viewed' ? t('accessHistory.viewed') : t('home.changed');
    const what = `${verb} ${g.what.toLowerCase()}`;
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
            <li key={`${g.key}-${g.last}`}>
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
