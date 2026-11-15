/**
 * My health (mockup p2): the tab's own page. Four places a patient returns to
 * most, as tiles, then everything they track and check, as a list. Each row
 * opens a screen that already exists; this page only gathers them.
 */
import { useEffect, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, BookOpen, Bell, ChevronRight, ClipboardCheck, FileText, FlaskConical,
  Pill, Thermometer, TrendingUp, Watch,
} from 'lucide-react';
import {
  formatTimestamp, getPatientAdherence, getPatientLabSubmissions, getPatientReminders, getPatientVitals, useTranslation,
} from '@medichain/shared';
import { newestResult, remainingDoses } from '../components/HomeToday';
import type { PatientVitalReading } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

type Icon = ComponentType<{ className?: string }>;

/** The latest reading in words, or null when it measured nothing worth naming. */
export function describeReading(r: PatientVitalReading): string | null {
  if (r.systolic_bp !== null && r.diastolic_bp !== null) return `BP ${r.systolic_bp}/${r.diastolic_bp}`;
  if (r.heart_rate !== null) return `Pulse ${r.heart_rate}`;
  if (r.oxygen_saturation !== null) return `SpO₂ ${r.oxygen_saturation}%`;
  if (r.temperature_celsius !== null) return `${r.temperature_celsius} °C`;
  return null;
}

function Tile({ to, label, detail, icon: TileIcon }: { to: string; label: string; detail: string; icon: Icon }) {
  return (
    <Link to={to}
      className="flex min-h-[120px] flex-col gap-3 rounded-2xl border border-border bg-surface p-4 hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-subtle-fg" aria-hidden="true">
        <TileIcon className="h-5 w-5" />
      </span>
      <span>
        <span className="block font-semibold text-content">{label}</span>
        <span className="block text-sm text-content-muted">{detail}</span>
      </span>
    </Link>
  );
}

export function MyHealthPage() {
  const { t } = useTranslation();
  const patientId = usePatientAuthStore((s) => s.patient?.healthId);
  // undefined while loading; null when there is no reading to describe.
  const [latest, setLatest] = useState<string | null | undefined>(undefined);
  // The patient's own figures (p2). Undefined until read, and left undefined
  // when a read fails: the tile then just names the place, never a zero.
  const [dosesLeft, setDosesLeft] = useState<number | undefined>(undefined);
  const [newestLab, setNewestLab] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([getPatientReminders(patientId), getPatientAdherence(patientId)])
      .then(([reminders, adherence]) => { if (!cancelled) setDosesLeft(remainingDoses(reminders, adherence, today).length); })
      .catch(() => undefined);
    getPatientLabSubmissions(patientId)
      .then((items) => {
        if (cancelled) return;
        const newest = newestResult(items);
        setNewestLab(newest
          ? [newest.test_name, formatTimestamp(newest.reviewed_at ?? newest.submitted_at, { day: 'numeric', month: 'short' })].join(' · ')
          : null);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [patientId]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    getPatientVitals(patientId)
      .then((body) => {
        if (cancelled) return;
        const newest = [...body.readings].sort((a, b) => b.timestamp - a.timestamp)[0];
        const reading = newest ? describeReading(newest) : null;
        setLatest(newest && reading
          ? t('myHealth.vitalsLatest', { reading, when: formatTimestamp(newest.recorded_at, { day: 'numeric', month: 'short' }) })
          : null);
      })
      // A failed read says nothing about the readings; the tile just names the place.
      .catch(() => { if (!cancelled) setLatest(undefined); });
    return () => { cancelled = true; };
  }, [patientId, t]);

  const rows: Array<{ to: string; label: string; icon: Icon }> = [
    { to: '/medications', label: t('myHealth.reminders'), icon: Bell },
    { to: '/lab-results', label: t('myHealth.labTrends'), icon: TrendingUp },
    { to: '/symptoms', label: t('myHealth.symptomDiary'), icon: Thermometer },
    { to: '/symptoms?view=check', label: t('myHealth.checkSymptom'), icon: ClipboardCheck },
    { to: '/vitals?view=devices', label: t('myHealth.wearables'), icon: Watch },
    { to: '/medical-history', label: t('myHealth.history'), icon: BookOpen },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-8 md:p-5">
      <h1 className="text-2xl font-bold text-content">{t('myHealth.title')}</h1>

      <div className="grid grid-cols-2 gap-3">
        <Tile to="/records" label={t('myHealth.records')} detail={t('myHealth.recordsDetail')} icon={FileText} />
        <Tile to="/lab-results" label={t('myHealth.labResults')}
          detail={newestLab === undefined ? t('myHealth.labResultsDetail') : newestLab ?? t('myHealth.labResultsNone')} icon={FlaskConical} />
        <Tile to="/medications" label={t('myHealth.medications')}
          detail={dosesLeft === undefined ? t('myHealth.medicationsDetail')
            : dosesLeft === 0 ? t('myHealth.noDosesLeft') : t('myHealth.dosesLeft', { n: String(dosesLeft) })} icon={Pill} />
        <Tile to="/vitals" label={t('myHealth.vitals')}
          detail={latest === undefined ? '' : latest ?? t('myHealth.vitalsNone')} icon={Activity} />
      </div>

      <section aria-labelledby="my-health-track" className="space-y-1.5">
        <h2 id="my-health-track" className="px-1 text-sm font-semibold text-content-secondary">{t('myHealth.trackCheck')}</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {rows.map(({ to, label, icon: RowIcon }) => (
            <li key={to}>
              <Link to={to} className="flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
                <RowIcon className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                <span className="flex-1 font-medium text-content">{label}</span>
                <ChevronRight className="h-4 w-4 text-content-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default MyHealthPage;
