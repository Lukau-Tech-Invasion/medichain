import { useState, useEffect } from 'react';
import { useAuthStore } from '../store';
import PatientSelect from '../components/PatientSelect';
import {
  apiUrl,
  createGCS,
  getApiClient,
  getApiErrorMessage,
  useScoringCatalog,
  useTranslation,
} from '@medichain/shared';
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
  notes?: string;
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

// Normal ranges for vitals
const VITAL_RANGES = {
  heart_rate: { min: 60, max: 100, unit: 'bpm', label: 'Heart Rate' },
  respiratory_rate: { min: 12, max: 20, unit: '/min', label: 'Resp Rate' },
  bp_systolic: { min: 90, max: 140, unit: 'mmHg', label: 'Systolic BP' },
  bp_diastolic: { min: 60, max: 90, unit: 'mmHg', label: 'Diastolic BP' },
  temperature: { min: 36.1, max: 37.8, unit: '°C', label: 'Temperature' },
  oxygen_saturation: { min: 95, max: 100, unit: '%', label: 'SpO2' },
  pain_scale: { min: 0, max: 3, unit: '/10', label: 'Pain' },
  gcs: { min: 15, max: 15, unit: '', label: 'GCS' },
  blood_glucose: { min: 70, max: 140, unit: 'mg/dL', label: 'Glucose' },
};

function isAbnormal(value: number | null, type: keyof typeof VITAL_RANGES): boolean {
  if (value === null) return false;
  const range = VITAL_RANGES[type];
  return value < range.min || value > range.max;
}

function isCritical(value: number | null, type: keyof typeof VITAL_RANGES): boolean {
  if (value === null) return false;
  const criticalRanges: Record<string, { min: number; max: number }> = {
    heart_rate: { min: 40, max: 150 },
    respiratory_rate: { min: 8, max: 30 },
    bp_systolic: { min: 70, max: 180 },
    oxygen_saturation: { min: 88, max: 100 },
    gcs: { min: 9, max: 15 },
    blood_glucose: { min: 50, max: 400 },
  };
  const range = criticalRanges[type];
  if (!range) return false;
  return value < range.min || value > range.max;
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
      const result = await createGCS({
        patient_id: selectedPatientId,
        eye_response: Number(gcsEye),
        verbal_response: Number(gcsVerbal),
        motor_response: Number(gcsMotor),
        notes: gcsNotes.trim() || undefined,
      });
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
    } catch (err) {
      setGcsError(getApiErrorMessage(err, t('docVitalSigns.gcsErrorFailed')));
    } finally {
      setGcsSubmitting(false);
    }
  };

  const [flowsheet, setFlowsheet] = useState<VitalFlowsheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  
  // New vital signs form
  const [newVitals, setNewVitals] = useState({
    heart_rate: '',
    respiratory_rate: '',
    bp_systolic: '',
    bp_diastolic: '',
    temperature: '',
    oxygen_saturation: '',
    pain_scale: '',
    gcs_total: '',
    blood_glucose: '',
    weight_kg: '',
    notes: '',
  });

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
        const data = await getApiClient().get<RawFlowsheet>(
        `/api/clinical/vitals/flowsheet/${selectedPatientId}`
      );
        setFlowsheet(normalizeFlowsheet(data));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('docVitalSigns.errorLoadFlowsheetGeneric'));
      } finally {
        setLoading(false);
      }
    };

    fetchFlowsheet();
  }, [selectedPatientId, user, t]);

  const handleSubmitVitals = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !user) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        patient_id: selectedPatientId,
        heart_rate: newVitals.heart_rate ? Number(newVitals.heart_rate) : null,
        respiratory_rate: newVitals.respiratory_rate ? Number(newVitals.respiratory_rate) : null,
        systolic_bp: newVitals.bp_systolic ? Number(newVitals.bp_systolic) : null,
        diastolic_bp: newVitals.bp_diastolic ? Number(newVitals.bp_diastolic) : null,
        temperature_celsius: newVitals.temperature ? Number(newVitals.temperature) : null,
        oxygen_saturation: newVitals.oxygen_saturation ? Number(newVitals.oxygen_saturation) : null,
        pain_scale: newVitals.pain_scale ? Number(newVitals.pain_scale) : null,
        gcs_total: newVitals.gcs_total ? Number(newVitals.gcs_total) : null,
        blood_glucose: newVitals.blood_glucose ? Number(newVitals.blood_glucose) : null,
        weight_kg: newVitals.weight_kg ? Number(newVitals.weight_kg) : null,
        notes: newVitals.notes || null,
      };

      const response = await fetch(apiUrl('/api/clinical/vitals'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getApiClient().getSessionHeaders(user.walletAddress),
          'Idempotency-Key': getApiClient().getMutationHeaders()['Idempotency-Key'],
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(getApiErrorMessage(errData, t('docVitalSigns.errorRecordVitals')));
      }

      setSuccess(t('docVitalSigns.recordSuccess'));
      setShowForm(false);
      setNewVitals({
        heart_rate: '',
        respiratory_rate: '',
        bp_systolic: '',
        bp_diastolic: '',
        temperature: '',
        oxygen_saturation: '',
        pain_scale: '',
        gcs_total: '',
        blood_glucose: '',
        weight_kg: '',
        notes: '',
      });

      // Refresh flowsheet
      const refreshResponse = await fetch(
        apiUrl(`/api/clinical/vitals/flowsheet/${selectedPatientId}`),
        { 
          headers: { 
            ...getApiClient().getSessionHeaders(user.walletAddress),
            'X-Provider-Role': user.role,
          } 
        }
      );
      if (refreshResponse.ok) {
        setFlowsheet(normalizeFlowsheet(await refreshResponse.json()));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('docVitalSigns.errorRecordVitalsGeneric'));
    } finally {
      setSubmitting(false);
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
        <Link
          to="/dashboard"
          className="text-content-muted hover:text-content flex items-center gap-2"
        >
          {t('docVitalSigns.backToDashboard')}
        </Link>
      </div>

      {/* Patient Selection */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6 mb-6">
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
          {selectedPatientId && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-6 py-3 bg-brand text-brand-fg rounded-lg hover:bg-brand flex items-center gap-2"
            >
              <Plus size={20} />
              {t('docVitalSigns.recordVitalsButton')}
            </button>
          )}
        </div>
      </div>

      {/* Glasgow Coma Scale.
          Its own card, not a field on the vitals form: the vitals row carries a
          free-typed `gcs_total`, and a total with no eye/verbal/motor behind it
          cannot be checked or trended. */}
      {selectedPatientId && gcsScale && (
        <div className="mb-6 bg-surface rounded-xl shadow p-6">
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
            type="button"
            onClick={handleSubmitGcs}
            disabled={gcsSubmitting}
            className="px-6 py-3 bg-brand text-brand-fg rounded-lg font-medium disabled:opacity-60 disabled:cursor-not-allowed min-h-[24px]"
          >
            {gcsSubmitting ? t('docVitalSigns.gcsSaving') : t('docVitalSigns.gcsSave')}
          </button>
        </div>
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

      {/* New Vitals Form */}
      {showForm && selectedPatientId && (
        <div className="bg-surface rounded-xl shadow-sm border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold text-content mb-4">{t('docVitalSigns.recordNewVitalsTitle')}</h2>
          <form onSubmit={handleSubmitVitals}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label htmlFor="vitals-heart-rate" className="block text-sm font-medium text-content-secondary mb-1">
                  <Heart className="inline mr-1" size={14} />
                  {t('docVitalSigns.heartRateLabel')}
                </label>
                <input
                  id="vitals-heart-rate"
                  type="number"
                  value={newVitals.heart_rate}
                  onChange={(e) => setNewVitals({ ...newVitals, heart_rate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="60-100"
                />
              </div>
              <div>
                <label htmlFor="vitals-respiratory-rate" className="block text-sm font-medium text-content-secondary mb-1">
                  <Wind className="inline mr-1" size={14} />
                  {t('docVitalSigns.respRateLabel')}
                </label>
                <input
                  id="vitals-respiratory-rate"
                  type="number"
                  value={newVitals.respiratory_rate}
                  onChange={(e) => setNewVitals({ ...newVitals, respiratory_rate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="12-20"
                />
              </div>
              <div>
                <label htmlFor="vitals-bp-systolic" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docVitalSigns.bpSystolicLabel')}
                </label>
                <input
                  id="vitals-bp-systolic"
                  type="number"
                  value={newVitals.bp_systolic}
                  onChange={(e) => setNewVitals({ ...newVitals, bp_systolic: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="90-140"
                />
              </div>
              <div>
                <label htmlFor="vitals-bp-diastolic" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docVitalSigns.bpDiastolicLabel')}
                </label>
                <input
                  id="vitals-bp-diastolic"
                  type="number"
                  value={newVitals.bp_diastolic}
                  onChange={(e) => setNewVitals({ ...newVitals, bp_diastolic: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="60-90"
                />
              </div>
              <div>
                <label htmlFor="vitals-temperature" className="block text-sm font-medium text-content-secondary mb-1">
                  <Thermometer className="inline mr-1" size={14} />
                  {t('docVitalSigns.temperatureLabel')}
                </label>
                <input
                  id="vitals-temperature"
                  type="number"
                  step="0.1"
                  value={newVitals.temperature}
                  onChange={(e) => setNewVitals({ ...newVitals, temperature: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="36.1-37.8"
                />
              </div>
              <div>
                <label htmlFor="vitals-oxygen-saturation" className="block text-sm font-medium text-content-secondary mb-1">
                  <Droplet className="inline mr-1" size={14} />
                  {t('docVitalSigns.spo2Label')}
                </label>
                <input
                  id="vitals-oxygen-saturation"
                  type="number"
                  value={newVitals.oxygen_saturation}
                  onChange={(e) => setNewVitals({ ...newVitals, oxygen_saturation: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="95-100"
                />
              </div>
              <div>
                <label htmlFor="vitals-pain-scale" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docVitalSigns.painScaleLabel')}
                </label>
                <input
                  id="vitals-pain-scale"
                  type="number"
                  min="0"
                  max="10"
                  value={newVitals.pain_scale}
                  onChange={(e) => setNewVitals({ ...newVitals, pain_scale: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="0-10"
                />
              </div>
              <div>
                <label htmlFor="vitals-gcs-total" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docVitalSigns.gcsScoreLabel')}
                </label>
                <input
                  id="vitals-gcs-total"
                  type="number"
                  min="3"
                  max="15"
                  value={newVitals.gcs_total}
                  onChange={(e) => setNewVitals({ ...newVitals, gcs_total: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="15"
                />
              </div>
              <div>
                <label htmlFor="vitals-blood-glucose" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docVitalSigns.bloodGlucoseLabel')}
                </label>
                <input
                  id="vitals-blood-glucose"
                  type="number"
                  value={newVitals.blood_glucose}
                  onChange={(e) => setNewVitals({ ...newVitals, blood_glucose: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="70-140"
                />
              </div>
              <div>
                <label htmlFor="vitals-weight" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docVitalSigns.weightLabel')}
                </label>
                <input
                  id="vitals-weight"
                  type="number"
                  step="0.1"
                  value={newVitals.weight_kg}
                  onChange={(e) => setNewVitals({ ...newVitals, weight_kg: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder={t('docVitalSigns.weightPlaceholder')}
                />
              </div>
            </div>
            <div className="mb-4">
              <label htmlFor="vitals-notes" className="block text-sm font-medium text-content-secondary mb-1">{t('docVitalSigns.notesLabel')}</label>
              <textarea
                id="vitals-notes"
                value={newVitals.notes}
                onChange={(e) => setNewVitals({ ...newVitals, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder={t('docVitalSigns.notesPlaceholder')}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}
                {t('docVitalSigns.saveVitalsButton')}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 py-2 border border-border-strong rounded-lg hover:bg-surface-sunken"
              >
                {t('docVitalSigns.cancelButton')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-surface rounded-xl shadow-sm p-12 text-center">
          <Loader2 className="mx-auto mb-3 text-primary-500 animate-spin" size={48} />
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
              {new Date(lastReading.recorded_at).toLocaleString()}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* Heart Rate */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.heart_rate, 'heart_rate') ? 'bg-critical-subtle border-2 border-critical' : isAbnormal(lastReading.heart_rate, 'heart_rate') ? 'bg-caution-subtle' : 'bg-surface-sunken'}`}>
              <div className="flex items-center gap-2 text-content-muted mb-1">
                <Heart size={16} className={isCritical(lastReading.heart_rate, 'heart_rate') ? 'text-red-500' : 'text-content-muted'} />
                <span className="text-sm">{t('docVitalSigns.heartRateShort')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.heart_rate ?? '—'}</span>
                <span className="text-sm text-content-muted">bpm</span>
                {getTrend(lastReading.heart_rate, previousReading?.heart_rate ?? null) === 'up' && <TrendingUp size={16} className="text-red-500" />}
                {getTrend(lastReading.heart_rate, previousReading?.heart_rate ?? null) === 'down' && <TrendingDown size={16} className="text-green-500" />}
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
              </div>
            </div>

            {/* SpO2 */}
            <div className={`p-4 rounded-lg ${isCritical(lastReading.oxygen_saturation, 'oxygen_saturation') ? 'bg-critical-subtle border-2 border-critical' : isAbnormal(lastReading.oxygen_saturation, 'oxygen_saturation') ? 'bg-caution-subtle' : 'bg-surface-sunken'}`}>
              <div className="flex items-center gap-2 text-content-muted mb-1">
                <Droplet size={16} className={isCritical(lastReading.oxygen_saturation, 'oxygen_saturation') ? 'text-red-500' : 'text-content-muted'} />
                <span className="text-sm">{t('docVitalSigns.spo2Short')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{lastReading.oxygen_saturation ?? '—'}</span>
                <span className="text-sm text-content-muted">%</span>
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
                    <th className="px-4 py-3 text-left font-medium text-content-muted">{t('docVitalSigns.recordedByColumn')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {flowsheet.readings.map((reading) => (
                    <tr key={reading.reading_id} className="hover:bg-surface-sunken">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {new Date(reading.recorded_at).toLocaleString()}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${isCritical(reading.heart_rate, 'heart_rate') ? 'text-critical-subtle-fg bg-critical-subtle' : isAbnormal(reading.heart_rate, 'heart_rate') ? 'text-caution-subtle-fg' : ''}`}>
                        {reading.heart_rate ?? '—'}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${isCritical(reading.blood_pressure_systolic, 'bp_systolic') ? 'text-critical-subtle-fg bg-critical-subtle' : ''}`}>
                        {reading.blood_pressure_systolic ?? '—'}/{reading.blood_pressure_diastolic ?? '—'}
                      </td>
                      <td className={`px-4 py-3 text-center font-medium ${isCritical(reading.oxygen_saturation, 'oxygen_saturation') ? 'text-critical-subtle-fg bg-critical-subtle' : isAbnormal(reading.oxygen_saturation, 'oxygen_saturation') ? 'text-caution-subtle-fg' : ''}`}>
                        {reading.oxygen_saturation ?? '—'}%
                      </td>
                      <td className={`px-4 py-3 text-center ${isAbnormal(reading.temperature_celsius, 'temperature') ? 'text-caution-subtle-fg' : ''}`}>
                        {reading.temperature_celsius?.toFixed(1) ?? '—'}°C
                      </td>
                      <td className={`px-4 py-3 text-center ${isCritical(reading.respiratory_rate, 'respiratory_rate') ? 'text-critical-subtle-fg bg-critical-subtle' : ''}`}>
                        {reading.respiratory_rate ?? '—'}
                      </td>
                      <td className={`px-4 py-3 text-center ${reading.pain_scale && reading.pain_scale > 6 ? 'text-critical-subtle-fg' : ''}`}>
                        {reading.pain_scale ?? '—'}/10
                      </td>
                      <td className={`px-4 py-3 text-center ${isCritical(reading.gcs_total, 'gcs') ? 'text-critical-subtle-fg bg-critical-subtle' : ''}`}>
                        {reading.gcs_total ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-content-muted">{reading.recorded_by}</td>
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
          <Activity className="mx-auto mb-3 text-gray-300" size={48} />
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
          <Search className="mx-auto mb-3 text-gray-300" size={48} />
          <p className="text-content-muted">{t('docVitalSigns.noPatientSelected')}</p>
        </div>
      )}
    </div>
  );
}

export default VitalSignsPage;
