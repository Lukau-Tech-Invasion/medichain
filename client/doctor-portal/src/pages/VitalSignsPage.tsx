import { useState, useEffect } from 'react';
import { useAuthStore } from '../store';
import PatientSelect from '../components/PatientSelect';
import {
  createGCS,
  getApiErrorMessage,
  useScoringCatalog,
  useTranslation,
  vitalFlag,
  getVitalsFlowsheet,
  formatTimestamp,
  notifySuccess, submitOnce, useSubmission } from '@medichain/shared';
import type { GcsScale } from '@medichain/shared';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  Heart,
  Thermometer,
  Wind,
  Droplet,
  Plus,
  Search,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  CheckCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

import StaffName from '../components/StaffName';
import { VitalsEntryForm } from '../components/VitalsEntryForm';
import { usePatientWorkspace } from '../workspace/PatientWorkspaceContext';
interface VitalReading {
  reading_id: string;
  patient_id: string;
  recorded_at: string;
  recorded_by: string;
  heart_rate: number | null;
  respiratory_rate: number | null;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  temperature_celsius: number | null;
  oxygen_saturation: number | null;
  pain_scale: number | null;
  gcs_total: number | null;
  blood_glucose: number | null;
  weight_kg: number | null;
  notes?: string | null;
}

/** "Last recorded Nov 9, 9:41 AM · BP 128/82 · Pulse 88 · Temp 36.8 °C" -- only what was measured. */
export function lastRecordedLine(r: VitalReading, t: (key: string, vars?: Record<string, string>) => string): string {
  const parts = [
    r.blood_pressure_systolic != null && r.blood_pressure_diastolic != null
      ? t('docVitalSigns.lastBp', { bp: `${r.blood_pressure_systolic}/${r.blood_pressure_diastolic}` }) : null,
    r.heart_rate != null ? t('docVitalSigns.lastPulse', { n: String(r.heart_rate) }) : null,
    r.temperature_celsius != null ? t('docVitalSigns.lastTemp', { n: String(r.temperature_celsius) }) : null,
    r.oxygen_saturation != null ? t('docVitalSigns.lastSpo2', { n: String(r.oxygen_saturation) }) : null,
  ].filter(Boolean);
  return t('docVitalSigns.lastRecorded', { when: formatTimestamp(r.recorded_at), values: parts.join(' · ') || t('docVitalSigns.lastNothing') });
}

interface VitalFlowsheet {
  patient_id: string;
  patient_name: string;
  readings: VitalReading[];
}

/**
 * A flowsheet row as stored, which is not quite a `VitalReading`.
 *
 * Blood pressure and GCS each arrive under two names depending on which writer
 * produced the row, and the timestamp is either an ISO string or epoch seconds.
 * Naming the alternatives is the whole job of this function; `any` meant the
 * five field names below were unchecked spelling.
 */
type RawVitalReading = Partial<VitalReading> & {
  timestamp?: number;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  gcs_score?: number | null;
};

interface RawFlowsheet {
  patient_id: string;
  patient_name?: string;
  readings?: RawVitalReading[];
}

function normalizeFlowsheet(data: RawFlowsheet): VitalFlowsheet {
  return {
    patient_id: data.patient_id,
    patient_name: data.patient_name || '',
    readings: (data.readings || []).map((reading) => ({
      ...reading,
      recorded_at: reading.recorded_at || new Date((reading.timestamp || 0) * 1000).toISOString(),
      blood_pressure_systolic: reading.blood_pressure_systolic ?? reading.systolic_bp ?? null,
      blood_pressure_diastolic: reading.blood_pressure_diastolic ?? reading.diastolic_bp ?? null,
      gcs_total: reading.gcs_total ?? reading.gcs_score ?? null,
    })) as VitalReading[],
  };
}

function getTrend(current: number | null, previous: number | null): 'up' | 'down' | 'stable' | null {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 1) return 'stable';
  return diff > 0 ? 'up' : 'down';
}

function VitalSignsPage() {
  const [searchParams] = useSearchParams();
  const patientIdFromUrl = searchParams.get('patientId');
  const navigate = useNavigate();
  const { t } = useTranslation();
  const workspace = usePatientWorkspace();
  const gcsSubmission = useSubmission('gcs');

  const { user, isAuthenticated } = useAuthStore();
  
  const [selectedPatientId, setSelectedPatientId] = useState(patientIdFromUrl || '');

  // --- Glasgow Coma Scale ----------------------------------------------------
  //
  // `POST /api/clinical/gcs` and `GET /api/clinical/patient/{id}/gcs` have
  // existed as long as the feature, with `createGCS`/`getPatientGCS` sitting in
  // the shared client unused: **no screen wrote a GCS assessment and none read
  // one**. What this page had instead was a free-typed `gcs_total` on the
  // vitals form -- a number with no eye, verbal or motor components behind it,
  // which cannot be checked, trended, or defended.
  //
  // This records the components. The total, the interpretation, and whether the
  // airway is at risk all come back from the server (rule 8); nothing here
  // adds three numbers together.
  // The catalog is fetched once and shared: `useScoringCatalog` already caches
  // it across pages, so this adds no request of its own.
  const { catalog: scoringCatalog } = useScoringCatalog();
  // Flagged against the server's catalog bands (rule 8) -- the limits
  // `POST /api/clinical/vitals` raises its critical alerts on. The page used to
  // carry its own copy, whose critical systolic limit was 70 where the server
  // alerted below 90. Until the catalog loads nothing is flagged.
  const isCritical = (value: number | null, key: string) =>
    vitalFlag(value, key, scoringCatalog) === 'critical';
  const isAbnormal = (value: number | null, key: string) => {
    const flag = vitalFlag(value, key, scoringCatalog);
    return flag === 'critical' || flag === 'abnormal';
  };
  // The flag in words. The tiles used to say "critical" only with a red border
  // and a red icon, which a nurse with a colour-vision deficiency, or anyone
  // using a screen reader, never receives (WCAG 1.4.1).
  const flagText = (value: number | null, key: string): string | null => {
    const flag = vitalFlag(value, key, scoringCatalog);
    if (flag === 'critical') return t('docVitalSigns.flagCritical');
    if (flag === 'abnormal') return t('docVitalSigns.flagAbnormal');
    return null;
  };
  const flagBadge = (value: number | null, key: string) => {
    const text = flagText(value, key);
    return text ? <span className="ml-auto text-xs font-semibold uppercase text-critical-subtle-fg">{text}</span> : null;
  };
  // The flowsheet's compact form of the same flag: a mark a colour-blind reader
  // sees, and a word a screen reader says.
  const cellFlag = (value: number | null, key: string) => {
    const text = flagText(value, key);
    if (!text) return null;
    const critical = vitalFlag(value, key, scoringCatalog) === 'critical';
    return (
      <span className="ml-1 text-xs font-bold" title={text}>
        <span aria-hidden="true">{critical ? '!!' : '!'}</span>
        <span className="sr-only">{text}</span>
      </span>
    );
  };
  const gcsScale: GcsScale | null = scoringCatalog?.glasgow_coma_scale ?? null;
  const [gcsEye, setGcsEye] = useState('');
  const [gcsVerbal, setGcsVerbal] = useState('');
  const [gcsMotor, setGcsMotor] = useState('');
  const [gcsNotes, setGcsNotes] = useState('');
  const [gcsSubmitting, setGcsSubmitting] = useState(false);
  const [gcsError, setGcsError] = useState<string | null>(null);
  const [gcsResult, setGcsResult] = useState<{
    total_score: number;
    interpretation: string;
    is_comatose: boolean;
    needs_airway: boolean;
  } | null>(null);

  const handleSubmitGcs = async () => {
    if (gcsSubmitting) return;
    setGcsError(null);
    setGcsResult(null);
    if (!selectedPatientId) {
      setGcsError(t('docVitalSigns.gcsErrorPatient'));
      return;
    }
    // All three components or none. A GCS reported without one of its parts is
    // not a lower score, it is an incomplete assessment -- and the total the
    // server computes would silently be wrong.
    if (!gcsEye || !gcsVerbal || !gcsMotor) {
      setGcsError(t('docVitalSigns.gcsErrorComponents'));
      return;
    }

    try {
      setGcsSubmitting(true);
      const gcs = {
        patient_id: selectedPatientId,
        eye_response: Number(gcsEye),
        verbal_response: Number(gcsVerbal),
        motor_response: Number(gcsMotor),
        notes: gcsNotes.trim() || undefined,
      };
      let result: Awaited<ReturnType<typeof createGCS>> | undefined;
      const outcome = await submitOnce(gcsSubmission, gcs, async () => { result = await createGCS(gcs); });
      if (outcome === 'busy') return;
      if (!result) {
        // Kept on this device, or already saved: the server's score is not here
        // to show, and this page does not compute one (rule 8).
        setGcsEye('');
        setGcsVerbal('');
        setGcsMotor('');
        setGcsNotes('');
        notifySuccess(outcome === 'queued'
          ? `${t('forms.queued')} ${t('clinicianOffline.scoreOffline')}`
          : t('forms.alreadySaved'));
        return;
      }
      // Show what the server scored, not what this page thinks the total is.
      setGcsResult({
        total_score: result.total_score,
        interpretation: result.interpretation,
        is_comatose: result.is_comatose,
        needs_airway: result.needs_airway,
      });
      setGcsEye('');
      setGcsVerbal('');
      setGcsMotor('');
      setGcsNotes('');
      notifySuccess('Glasgow Coma Scale saved.');
    } catch (err) {
      setGcsError(getApiErrorMessage(err, t('docVitalSigns.gcsErrorFailed')));
    } finally {
      setGcsSubmitting(false);
    }
  };

  const [flowsheet, setFlowsheet] = useState<VitalFlowsheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Opened for a patient -- from their chart, or with ?patientId= -- the form
  // is the task, so it is open; chosen here, it waits for "Record vitals".
  const [showForm, setShowForm] = useState(Boolean(patientIdFromUrl || workspace));
  const [showHistory, setShowHistory] = useState(true);
  
  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Fetch flowsheet when patient is selected
  useEffect(() => {
    if (!selectedPatientId || !user) {
      setFlowsheet(null);
      return;
    }

    const fetchFlowsheet = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = (await getVitalsFlowsheet(selectedPatientId)) as RawFlowsheet;
        setFlowsheet(normalizeFlowsheet(data));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('docVitalSigns.errorLoadFlowsheetGeneric'));
      } finally {
        setLoading(false);
      }
    };

    fetchFlowsheet();
  }, [selectedPatientId, user, t]);

  const refreshAfterSave = async (queued: boolean) => {
    setError(null);
    setSuccess(queued ? t('forms.queued') : t('docVitalSigns.recordSuccess'));
    setShowForm(false);
    // A reading still on this device is not on the flowsheet yet.
    if (queued) return;
    try {
      setFlowsheet(normalizeFlowsheet((await getVitalsFlowsheet(selectedPatientId)) as RawFlowsheet));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('docVitalSigns.errorLoadFlowsheetGeneric'));
    }
  };

  const lastReading = flowsheet?.readings?.[0];
  const previousReading = flowsheet?.readings?.[1];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-content flex items-center gap-3">
            <Activity className="text-brand" size={28} />
            {t('docVitalSigns.title')}
          </h1>
          <p className="text-content-muted mt-1">{t('docVitalSigns.subtitle')}</p>
        </div>
        {/* Inside a chart, "Close patient" is the way out (c3/c5). */}
        {!workspace && (
          <Link
            to="/dashboard"
            className="text-content-muted hover:text-content flex items-center gap-2"
          >
            {t('docVitalSigns.backToDashboard')}
          </Link>
        )}
      </div>

      {/* Inside a chart the banner already names the patient (c3): no picker,
          only the way back into the form after a save or cancel. */}
      {workspace && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mb-6 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand px-6 py-3 text-brand-fg hover:bg-brand"
        >
          <Plus size={20} />
          {t('docVitalSigns.recordVitalsButton')}
        </button>
      )}

      {/* Patient Selection */}
      <div className={`bg-surface rounded-xl shadow-sm border border-border p-6 mb-6 ${workspace ? 'hidden' : ''}`}>
        <label htmlFor="vitals-patient-select" className="block text-sm font-medium text-content-secondary mb-2">
          {t('docVitalSigns.selectPatientLabel')}
        </label>
        <div className="flex gap-4">
          <PatientSelect
            id="vitals-patient-select"
            value={selectedPatientId}
            onChange={setSelectedPatientId}
            placeholder={t('docVitalSigns.selectPatientPlaceholder')}
            className="flex-1"
          />
          {selectedPatientId && !showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="px-6 py-3 bg-brand text-brand-fg rounded-lg hover:bg-brand flex items-center gap-2"
            >
              <Plus size={20} />
              {t('docVitalSigns.recordVitalsButton')}
            </button>
          )}
        </div>
      </div>

      {/* The vitals form first (mockup c3): the task the page is opened for. */}
      {showForm && selectedPatientId && (
        <VitalsEntryForm
          key={selectedPatientId}
          patientId={selectedPatientId}
          lastRecorded={lastReading ? lastRecordedLine(lastReading, t) : null}
          onCancel={() => setShowForm(false)}
          onSaved={(queued) => void refreshAfterSave(queued)}
        />
      )}

      {/* Glasgow Coma Scale.
          Its own card, not a field on the vitals form: the vitals row carries a
          free-typed `gcs_total`, and a total with no eye/verbal/motor behind it
          cannot be checked or trended. */}
      {selectedPatientId && gcsScale && (
        <form
          onSubmit={(e) => { e.preventDefault(); void handleSubmitGcs(); }}
          className="mb-6 bg-surface rounded-xl shadow p-6"
        >
          <h2 className="text-lg font-semibold text-content mb-1">
            {t('docVitalSigns.gcsHeading')}
          </h2>
          <p className="text-sm text-content-muted mb-4">{t('docVitalSigns.gcsSubtitle')}</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {([
              ['gcs-eye', t('docVitalSigns.gcsEye'), gcsScale.eye, gcsEye, setGcsEye],
              ['gcs-verbal', t('docVitalSigns.gcsVerbal'), gcsScale.verbal, gcsVerbal, setGcsVerbal],
              ['gcs-motor', t('docVitalSigns.gcsMotor'), gcsScale.motor, gcsMotor, setGcsMotor],
            ] as const).map(([id, label, options, value, setValue]) => (
              <div key={id}>
                <label htmlFor={id} className="block text-sm font-medium mb-1">
                  {label}
                </label>
                <select
                  id={id}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                >
                  <option value="">{t('docVitalSigns.gcsSelect')}</option>
                  {/* Wording and scores are the server's, not this page's. */}
                  {options.map((option) => (
                    <option key={option.score} value={String(option.score)}>
                      {option.score} — {option.description}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <label htmlFor="gcs-notes" className="block text-sm font-medium mb-1">
              {t('docVitalSigns.gcsNotes')}
            </label>
            <textarea
              id="gcs-notes"
              value={gcsNotes}
              onChange={(e) => setGcsNotes(e.target.value)}
              rows={2}
              className="w-full border border-border-interactive rounded-lg px-3 py-2"
            />
          </div>

          {gcsError && (
            <div role="alert" className="mb-4 bg-critical-subtle border border-critical rounded-lg p-3">
              <p className="text-sm text-critical-subtle-fg">{gcsError}</p>
            </div>
          )}

          {/* What the SERVER scored. This page adds nothing up. */}
          {gcsResult && (
            <div
              role="status"
              className={`mb-4 rounded-lg p-4 border ${
                gcsResult.needs_airway || gcsResult.is_comatose
                  ? 'bg-critical-subtle border-critical'
                  : 'bg-ok-subtle border-ok'
              }`}
            >
              <p
                className={`text-lg font-semibold ${
                  gcsResult.needs_airway || gcsResult.is_comatose
                    ? 'text-critical-subtle-fg'
                    : 'text-ok-subtle-fg'
                }`}
              >
                {t('docVitalSigns.gcsTotal', { score: gcsResult.total_score })}
              </p>
              <p
                className={`text-sm ${
                  gcsResult.needs_airway || gcsResult.is_comatose
                    ? 'text-critical-subtle-fg'
                    : 'text-ok-subtle-fg'
                }`}
              >
                {gcsResult.interpretation}
              </p>
              {gcsResult.needs_airway && (
                <p className="text-sm font-semibold text-critical-subtle-fg mt-1">
                  {t('docVitalSigns.gcsNeedsAirway')}
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            aria-disabled={gcsSubmitting || undefined}
            className="px-6 py-3 bg-brand text-brand-fg rounded-lg font-medium aria-disabled:cursor-wait min-h-[44px]"
          >
            {gcsSubmitting ? t('docVitalSigns.gcsSaving') : t('docVitalSigns.gcsSave')}
          </button>
        </form>
      )}

      {/* Success/Error Messages */}
      {success && (
        <div className="mb-6 p-4 bg-ok-subtle border border-ok rounded-lg flex items-center gap-3">
          <CheckCircle className="text-ok-subtle-fg" size={20} />
          <span className="text-ok-subtle-fg">{success}</span>
        </div>
      )}
      {error && (
        <div className="mb-6 p-4 bg-critical-subtle border border-critical rounded-lg flex items-center gap-3">
          <AlertTriangle className="text-critical-subtle-fg" size={20} />
          <span className="text-critical-subtle-fg">{error}</span>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-surface rounded-xl shadow-sm p-12 text-center">
          <Loader2 className="mx-auto mb-3 text-brand animate-spin" size={48} />
          <p className="text-content-muted">{t('docVitalSigns.loadingVitals')}</p>
        </div>
      )}

      {/* Current Vitals Summary */}
      {!loading && flowsheet && lastReading && (
        <div className="bg-surface rounded-xl shadow-sm border border-border p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-content">{t('docVitalSigns.latestVitalSignsTitle')}</h2>
            <span className="text-sm text-content-muted flex items-center gap-1 min-h-[24px] py-1">
              <Clock size={14} />
              {formatTimestamp(lastReading.recorded_at)}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* Heart Rate */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.heart_rate, 'heart_rate') ? 'bg-critical-subtle border-2 border-critical' : isAbnormal(lastReading.heart_rate, 'heart_rate') ? 'bg-caution-subtle' : 'bg-surface-sunken'}`}>
              <div className="flex items-center gap-2 text-content-muted mb-1">
                <Heart size={16} className={isCritical(lastReading.heart_rate, 'heart_rate') ? 'text-critical' : 'text-content-muted'} />
                <span className="text-sm">{t('docVitalSigns.heartRateShort')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.heart_rate ?? '—'}</span>
                <span className="text-sm text-content-muted">bpm</span>
                {flagBadge(lastReading.heart_rate, 'heart_rate')}
                {getTrend(lastReading.heart_rate, previousReading?.heart_rate ?? null) === 'up' && <TrendingUp size={16} className="text-critical" />}
                {getTrend(lastReading.heart_rate, previousReading?.heart_rate ?? null) === 'down' && <TrendingDown size={16} className="text-ok" />}
                {getTrend(lastReading.heart_rate, previousReading?.heart_rate ?? null) === 'stable' && <Minus size={16} className="text-content-muted" />}
              </div>
            </div>

            {/* Blood Pressure */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.blood_pressure_systolic, 'bp_systolic') ? 'bg-critical-subtle border-2 border-critical' : isAbnormal(lastReading.blood_pressure_systolic, 'bp_systolic') ? 'bg-caution-subtle' : 'bg-surface-sunken'}`}>
              <div className="flex items-center gap-2 text-content-muted mb-1">
                <Activity size={16} className="text-content-muted" />
                <span className="text-sm">{t('docVitalSigns.bloodPressureShort')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">
                  {lastReading.blood_pressure_systolic ?? '—'}/{lastReading.blood_pressure_diastolic ?? '—'}
                </span>
                <span className="text-sm text-content-muted">mmHg</span>
                {flagBadge(lastReading.blood_pressure_systolic, 'bp_systolic')}
              </div>
            </div>

            {/* SpO2 */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.oxygen_saturation, 'oxygen_saturation') ? 'bg-critical-subtle border-2 border-critical' : isAbnormal(lastReading.oxygen_saturation, 'oxygen_saturation') ? 'bg-caution-subtle' : 'bg-surface-sunken'}`}>
              <div className="flex items-center gap-2 text-content-muted mb-1">
                <Droplet size={16} className={isCritical(lastReading.oxygen_saturation, 'oxygen_saturation') ? 'text-critical' : 'text-content-muted'} />
                <span className="text-sm">{t('docVitalSigns.spo2Short')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.oxygen_saturation ?? '—'}</span>
                <span className="text-sm text-content-muted">%</span>
                {flagBadge(lastReading.oxygen_saturation, 'oxygen_saturation')}
              </div>
            </div>

            {/* Temperature */}
            <div className={`p-4 rounded-lg ${isAbnormal(lastReading.temperature_celsius, 'temperature') ? 'bg-caution-subtle' : 'bg-surface-sunken'}`}>
              <div className="flex items-center gap-2 text-content-muted mb-1">
                <Thermometer size={16} className="text-content-muted" />
                <span className="text-sm">{t('docVitalSigns.temperatureShort')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.temperature_celsius?.toFixed(1) ?? '—'}</span>
                <span className="text-sm text-content-muted">°C</span>
                {flagBadge(lastReading.temperature_celsius, 'temperature')}
              </div>
            </div>

            {/* Resp Rate */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.respiratory_rate, 'respiratory_rate') ? 'bg-critical-subtle border-2 border-critical' : isAbnormal(lastReading.respiratory_rate, 'respiratory_rate') ? 'bg-caution-subtle' : 'bg-surface-sunken'}`}>
              <div className="flex items-center gap-2 text-content-muted mb-1">
                <Wind size={16} className="text-content-muted" />
                <span className="text-sm">{t('docVitalSigns.respRateShort')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.respiratory_rate ?? '—'}</span>
                <span className="text-sm text-content-muted">/min</span>
                {flagBadge(lastReading.respiratory_rate, 'respiratory_rate')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flowsheet History */}
      {/* `readings` is optional-guarded, not just `flowsheet`: a response that
          omits the array (or sends null) used to crash the whole page on
          `.length` — a blank screen instead of a vitals chart. */}
      {!loading && flowsheet && (flowsheet.readings?.length ?? 0) > 0 && (
        <div className="bg-surface rounded-xl shadow-sm border border-border">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full p-4 flex items-center justify-between hover:bg-surface-sunken"
          >
            <h2 className="text-lg font-semibold text-content">
              {t('docVitalSigns.vitalSignsHistoryTitle', { count: flowsheet?.readings?.length ?? 0 })}
            </h2>
            {showHistory ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
          {showHistory && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunken border-y">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-content-muted">{t('docVitalSigns.timeColumn')}</th>
                    <th className="px-4 py-3 text-center font-medium text-content-muted">{t('docVitalSigns.hrColumn')}</th>
                    <th className="px-4 py-3 text-center font-medium text-content-muted">{t('docVitalSigns.bpColumn')}</th>
                    <th className="px-4 py-3 text-center font-medium text-content-muted">{t('docVitalSigns.spo2Column')}</th>
                    <th className="px-4 py-3 text-center font-medium text-content-muted">{t('docVitalSigns.tempColumn')}</th>
                    <th className="px-4 py-3 text-center font-medium text-content-muted">{t('docVitalSigns.rrColumn')}</th>
                    <th className="px-4 py-3 text-center font-medium text-content-muted">{t('docVitalSigns.painColumn')}</th>
                    <th className="px-4 py-3 text-center font-medium text-content-muted">{t('docVitalSigns.gcsColumn')}</th>
                    <th className="px-4 py-3 text-center font-medium text-content-muted">{t('docVitalSigns.glucoseColumn')}</th>
                    <th className="px-4 py-3 text-center font-medium text-content-muted">{t('docVitalSigns.weightLabel')}</th>
                    <th className="px-4 py-3 text-left font-medium text-content-muted">{t('docVitalSigns.notesLabel')}</th>
                    <th className="px-4 py-3 text-left font-medium text-content-muted">{t('docVitalSigns.recordedByColumn')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {flowsheet.readings.map((reading) => (
                    <tr key={reading.reading_id} className="hover:bg-surface-sunken">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatTimestamp(reading.recorded_at)}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${isCritical(reading.heart_rate, 'heart_rate') ? 'text-critical-subtle-fg bg-critical-subtle' : isAbnormal(reading.heart_rate, 'heart_rate') ? 'text-caution-subtle-fg' : ''}`}>
                        {reading.heart_rate ?? '—'}{cellFlag(reading.heart_rate, 'heart_rate')}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${isCritical(reading.blood_pressure_systolic, 'bp_systolic') ? 'text-critical-subtle-fg bg-critical-subtle' : ''}`}>
                        {reading.blood_pressure_systolic ?? '—'}/{reading.blood_pressure_diastolic ?? '—'}{cellFlag(reading.blood_pressure_systolic, 'bp_systolic')}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${isCritical(reading.oxygen_saturation, 'oxygen_saturation') ? 'text-critical-subtle-fg bg-critical-subtle' : isAbnormal(reading.oxygen_saturation, 'oxygen_saturation') ? 'text-caution-subtle-fg' : ''}`}>
                        {reading.oxygen_saturation ?? '—'}%{cellFlag(reading.oxygen_saturation, 'oxygen_saturation')}
                      </td>
                      <td className={`px-4 py-3 text-center ${isAbnormal(reading.temperature_celsius, 'temperature') ? 'text-caution-subtle-fg' : ''}`}>
                        {reading.temperature_celsius?.toFixed(1) ?? '—'}°C{cellFlag(reading.temperature_celsius, 'temperature')}
                      </td>
                      <td className={`px-4 py-3 text-center ${isCritical(reading.respiratory_rate, 'respiratory_rate') ? 'text-critical-subtle-fg bg-critical-subtle' : ''}`}>
                        {reading.respiratory_rate ?? '—'}{cellFlag(reading.respiratory_rate, 'respiratory_rate')}
                      </td>
                      <td className={`px-4 py-3 text-center ${reading.pain_scale && reading.pain_scale > 6 ? 'text-critical-subtle-fg' : ''}`}>
                        {reading.pain_scale ?? '—'}/10
                      </td>
                      <td className={`px-4 py-3 text-center ${isCritical(reading.gcs_total, 'gcs') ? 'text-critical-subtle-fg bg-critical-subtle' : ''}`}>
                        {reading.gcs_total ?? '—'}{cellFlag(reading.gcs_total, 'gcs')}
                      </td>
                      {/* Recorded and returned all along, and shown nowhere. */}
                      <td className={`px-4 py-3 text-center ${isCritical(reading.blood_glucose, 'blood_glucose') ? 'text-critical-subtle-fg bg-critical-subtle' : ''}`}>
                        {reading.blood_glucose ?? '—'}{cellFlag(reading.blood_glucose, 'blood_glucose')}
                      </td>
                      <td className="px-4 py-3 text-center">{reading.weight_kg ?? '—'}</td>
                      <td className="px-4 py-3 min-w-48 whitespace-pre-wrap">{reading.notes || t('docNursing.notRecorded')}</td>
                      <td className="px-4 py-3 text-content-muted"><StaffName id={reading.recorded_by} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* No Data State */}
      {!loading && selectedPatientId && (!flowsheet || (flowsheet.readings?.length ?? 0) === 0) && (
        <div className="bg-surface rounded-xl shadow-sm p-12 text-center">
          <Activity className="mx-auto mb-3 text-content-muted" size={48} />
          <p className="text-content-muted">{t('docVitalSigns.noVitalsRecorded')}</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 px-6 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand"
          >
            {t('docVitalSigns.recordFirstVitalsButton')}
          </button>
        </div>
      )}

      {/* No Patient Selected */}
      {!selectedPatientId && (
        <div className="bg-surface rounded-xl shadow-sm p-12 text-center">
          <Search className="mx-auto mb-3 text-content-muted" size={48} />
          <p className="text-content-muted">{t('docVitalSigns.noPatientSelected')}</p>
        </div>
      )}
    </div>
  );
}

export default VitalSignsPage;
