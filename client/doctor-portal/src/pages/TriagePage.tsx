import { MotionLink } from '@medichain/shared';
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import {
  createTriageAssessment,
  getPatients,
  getTriageQueue,
  useTranslation,
  formatTimestamp,
  submitForReply,
  useScoringCatalog,
  useSubmission,
  SubmitButton,
  vitalFlag,
} from '@medichain/shared';
import { Link } from 'react-router-dom';
import PatientSelect from '../components/PatientSelect';
import { usePatientWorkspace } from '../workspace/PatientWorkspaceContext';
import { useAmbulanceTriage, type Carried } from '../ems/useAmbulanceTriage';
import type { ScoringCatalog } from '@medichain/shared';
import {
  AlertTriangle,
  Activity,
  Heart,
  Thermometer,
  Wind,
  Droplet,
  Clock,
  User,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Loader2,
  Plus,
} from 'lucide-react';

interface VitalSigns {
  heart_rate: number | null;
  respiratory_rate: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  temperature_celsius: number | null;
  oxygen_saturation: number | null;
  pain_scale: number | null;
  gcs_score: number | null;
  blood_glucose: number | null;
  weight_kg: number | null;
}

interface TriageAssessment {
  assessment_id: string;
  patient_id: string;
  /** Resolved by the API; absent when the name cannot be decrypted. */
  patient_name?: string;
  esi_level: string | number | { level: number };
  chief_complaint: string;
  vital_signs: VitalSigns;
  pain_scale: number | null;
  notes: string | null;
  performed_by: string;
  performed_at: number;
}

interface Patient {
  patient_id: string;
  full_name: string;
  // The card's Health ID; null when none was issued.
  health_id?: string | null;
  date_of_birth: string;
}

/** Read numeric ESI levels from the server enum or older numeric queue responses. */
export function triageLevel(value: TriageAssessment['esi_level']): number | null {
  const enumLevels: Record<string, number> = {
    Level1Resuscitation: 1, Level2Emergent: 2, Level3Urgent: 3,
    Level4LessUrgent: 4, Level5NonUrgent: 5,
  };
  const level = typeof value === 'string' ? enumLevels[value]
    : typeof value === 'number' ? value : value?.level;
  return typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 5 ? level : null;
}

/** A field's border: critical by the server's catalogue (rule 8), never by a literal here. */
function flagClass(flag: ReturnType<typeof vitalFlag>): string {
  return flag === 'critical' ? 'border-critical bg-critical-subtle' : 'border-border-interactive';
}

/** "60–100", the catalogue's reference range for a field's placeholder; empty until it loads. */
function normalRange(key: string, catalog: ScoringCatalog | null): string {
  const band = catalog?.vital_signs?.find((b) => b.key === key);
  return band && band.normal_low !== null && band.normal_high !== null ? `${band.normal_low}–${band.normal_high}` : '';
}

/** Where a value came from: the crew's reading time, or "From ambulance". */
function CarriedTag({ from }: { from: Carried[keyof Carried] }) {
  const { t } = useTranslation();
  if (!from) return null;
  return (
    <span className="ml-1 rounded-full bg-notice-subtle px-2 text-xs font-semibold text-notice-subtle-fg">
      {from === true ? t('docTriage.fromAmbulance') : t('docTriage.ambulanceAt', { time: formatTimestamp(from, { timeStyle: 'short' }) })}
    </span>
  );
}

/** The crew's values: a tap to use them, and the reminder to check them once used. */
function AmbulanceValuesBar({ available, carried, onUse }: { available: boolean; carried: Carried; onUse: () => void }) {
  const { t } = useTranslation();
  const used = Object.keys(carried).length > 0;
  if (!available && !used) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-notice bg-notice-subtle p-3 text-sm text-notice-subtle-fg">
      <p className="min-w-0 flex-1">{used ? t('docTriage.ambulanceValuesHint') : t('docTriage.ambulanceValuesOffer')}</p>
      {available && (
        <button type="button" onClick={onUse}
          className="mc-press min-h-[44px] rounded-lg border border-current px-3 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {t('docTriage.useAmbulanceValues')}
        </button>
      )}
    </div>
  );
}

function TriagePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, isAuthenticated } = useAuthStore();

  const ESI_LEVELS = [
    {
      level: 1,
      name: t('docTriage.esi1_name'),
      color: 'bg-red-800',
      textColor: 'text-critical-subtle-fg',
      bgLight: 'bg-critical-subtle',
      borderColor: 'border-red-500',
      description: t('docTriage.esi1_description'),
      wait: t('docTriage.esi1_wait'),
      examples: t('docTriage.esi1_examples'),
    },
    {
      level: 2,
      name: t('docTriage.esi2_name'),
      color: 'bg-orange-700',
      textColor: 'text-content-secondary',
      bgLight: 'bg-surface-sunken',
      borderColor: 'border-orange-500',
      description: t('docTriage.esi2_description'),
      wait: t('docTriage.esi2_wait'),
      examples: t('docTriage.esi2_examples'),
    },
    {
      level: 3,
      name: t('docTriage.esi3_name'),
      color: 'bg-amber-700',
      textColor: 'text-caution-subtle-fg',
      bgLight: 'bg-caution-subtle',
      borderColor: 'border-yellow-500',
      description: t('docTriage.esi3_description'),
      wait: t('docTriage.esi3_wait'),
      examples: t('docTriage.esi3_examples'),
    },
    {
      level: 4,
      name: t('docTriage.esi4_name'),
      color: 'bg-green-800',
      textColor: 'text-ok-subtle-fg',
      bgLight: 'bg-ok-subtle',
      borderColor: 'border-green-500',
      description: t('docTriage.esi4_description'),
      wait: t('docTriage.esi4_wait'),
      examples: t('docTriage.esi4_examples'),
    },
    {
      level: 5,
      name: t('docTriage.esi5_name'),
      color: 'bg-sky-800',
      textColor: 'text-notice-subtle-fg',
      bgLight: 'bg-notice-subtle',
      borderColor: 'border-blue-500',
      description: t('docTriage.esi5_description'),
      wait: t('docTriage.esi5_wait'),
      examples: t('docTriage.esi5_examples'),
    },
  ];

  const [activeTab, setActiveTab] = useState<'new' | 'queue'>('new');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  
  // Triage form state
  const [selectedESI, setSelectedESI] = useState<number | null>(null);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [notes, setNotes] = useState('');
  const [vitalSigns, setVitalSigns] = useState<VitalSigns>({
    heart_rate: null,
    respiratory_rate: null,
    bp_systolic: null,
    bp_diastolic: null,
    temperature_celsius: null,
    oxygen_saturation: null,
    pain_scale: null,
    gcs_score: null,
    blood_glucose: null,
    weight_kg: null,
  });
  
  // Triage queue state
  const [triageQueue, setTriageQueue] = useState<TriageAssessment[]>([]);
  // "Could not load" and "nobody waiting" are opposite answers; an empty
  // array asserts the second.
  const [queueUnavailable, setQueueUnavailable] = useState(false);
  const [queueAttempt, setQueueAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submission = useSubmission('triage');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Fetch patients
  useEffect(() => {
    if (!user) return;
    
    const fetchPatients = async () => {
      try {
        setPatients(await getPatients());
        setApiConnected(true);
      } catch (err) {
        console.error('Failed to fetch patients:', err);
        setApiConnected(false);
      }
    };
    fetchPatients();
  }, [user]);

  // Fetch triage queue
  useEffect(() => {
    if (!user) return;
    if (activeTab !== 'queue') return;
    
    const fetchTriageQueue = async () => {
      setLoading(true);
      setQueueUnavailable(false);
      try {
        // The API returns `{ queue, total, success }`. This read
        // `data.assessments`, a key the server never sends, so the triage queue
        // rendered empty in production no matter how many patients were
        // waiting; `getTriageQueue` owns the shape now.
        setTriageQueue((await getTriageQueue()) as typeof triageQueue);
      } catch (err) {
        console.error('Failed to fetch triage queue:', err);
        setTriageQueue([]);
        setQueueUnavailable(true);
      } finally {
        setLoading(false);
      }
    };
    fetchTriageQueue();
  }, [activeTab, user?.userId, user, queueAttempt]);

  // Which readings are critical comes from the server's catalogue (rule 8):
  // the copy that used to live here disagreed with it on four of six limits,
  // so an SpO2 the server alerted on raised no warning on this screen.
  const { catalog: scoringCatalog } = useScoringCatalog();
  // Inside a patient's chart the patient is chosen already; the standalone
  // page still asks.
  const workspace = usePatientWorkspace();
  const location = useLocation();
  const patientId = workspace?.patientId ?? selectedPatientId;
  const ambulance = useAmbulanceTriage({
    patientId,
    vitals: vitalSigns,
    setVitals: setVitalSigns,
    complaint: chiefComplaint,
    setComplaint: setChiefComplaint,
    fromRun: (location.state as { fromRun?: string } | null)?.fromRun ?? null,
  });
  const hasCriticalVitals = (): boolean => {
    const readings: Array<[number | null, string]> = [
      [vitalSigns.heart_rate, 'heart_rate'],
      [vitalSigns.respiratory_rate, 'respiratory_rate'],
      [vitalSigns.bp_systolic, 'bp_systolic'],
      [vitalSigns.bp_diastolic, 'bp_diastolic'],
      [vitalSigns.temperature_celsius, 'temperature'],
      [vitalSigns.oxygen_saturation, 'oxygen_saturation'],
      [vitalSigns.gcs_score, 'gcs'],
      [vitalSigns.blood_glucose, 'blood_glucose'],
    ];
    return readings.some(([value, key]) => vitalFlag(value, key, scoringCatalog) === 'critical');
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!patientId) {
      setError(t('docTriage.errorSelectPatient'));
      return;
    }
    if (selectedESI === null) {
      setError(t('docTriage.errorSelectESI'));
      return;
    }
    if (!chiefComplaint.trim()) {
      setError(t('docTriage.errorChiefComplaint'));
      return;
    }
    
    if (!user) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const assessment = {
        patient_id: patientId,
        esi_level: selectedESI as number,
        chief_complaint: chiefComplaint,
        vital_signs: vitalSigns,
        pain_scale: vitalSigns.pain_scale,
        notes: notes || null,
      };
      const outcome = await submitForReply(submission, assessment, () => createTriageAssessment(assessment));
      if (outcome.kind === 'busy') return;
      // Only a fresh save carries the id and the wait; an earlier attempt that
      // already wrote this, or one held offline, has neither to show.
      setSuccess(outcome.kind === 'saved'
        ? t('docTriage.successMessage', { id: outcome.value.assessment_id, level: outcome.value.esi_level, wait: outcome.value.expected_wait })
        : t(outcome.kind === 'duplicate' ? 'forms.alreadySaved' : 'forms.queued'));
      // Reset form
      setSelectedPatientId('');
      ambulance.clear();
      setSelectedESI(null);
      setChiefComplaint('');
      setNotes('');
      setVitalSigns({
        heart_rate: null,
        respiratory_rate: null,
        bp_systolic: null,
        bp_diastolic: null,
        temperature_celsius: null,
        oxygen_saturation: null,
        pain_scale: null,
        gcs_score: null,
        blood_glucose: null,
        weight_kg: null,
      });
    } catch (err) {
      console.error('Triage submission failed', err);
      setError(t('docTriage.errorCreateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // Update vital sign helper
  const updateVitalSign = (field: keyof VitalSigns, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    setVitalSigns(prev => ({ ...prev, [field]: numValue }));
    ambulance.forget(field as keyof Carried);
  };

  return (
    <div className="p-8">
      {!workspace && (<>
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content flex items-center gap-2">
            <AlertTriangle className="text-caution" />
            {t('docTriage.title')}
          </h1>
          <p className="text-content-muted mt-1">
            {t('docTriage.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            apiConnected ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-critical-subtle text-critical-subtle-fg'
          }`}>
            <span className={`w-2 h-2 rounded-full ${apiConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            {apiConnected ? t('docTriage.apiConnected') : t('docTriage.apiDisconnected')}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-sunken p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('new')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'new'
              ? 'bg-surface text-content shadow-sm'
              : 'text-content-muted hover:text-content'
          }`}
        >
          <Plus size={16} className="inline mr-1" />
          {t('docTriage.tabNewAssessment')}
        </button>
        <button
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'queue'
              ? 'bg-surface text-content shadow-sm'
              : 'text-content-muted hover:text-content'
          }`}
        >
          <Clock size={16} className="inline mr-1" />
          {t('docTriage.tabTriageQueue')}
        </button>
      </div>
      </>)}

      {/* Alerts */}
      {error && (
        <div className="mb-6 p-4 bg-critical-subtle border border-critical rounded-lg flex items-center gap-2 text-critical-subtle-fg">
          <AlertCircle size={20} />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-ok-subtle border border-ok rounded-lg flex items-center gap-2 text-ok-subtle-fg">
          <CheckCircle size={20} />
          {success}
        </div>
      )}

      {activeTab === 'new' ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          <AmbulanceValuesBar available={ambulance.available} carried={ambulance.carried} onUse={ambulance.apply} />

          {/* Patient Selection: the chart has its patient already. */}
          {!workspace && (
          <div className="bg-surface rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
              <User size={20} />
              {t('docTriage.patientSelectionTitle')}
            </h2>
            {/* Searched on the server. Filtering the first page of
                `GET /api/patients` (50 rows) locally meant a nurse could not
                find any patient past the fiftieth. */}
            <PatientSelect
              id="triage-patient"
              label={t('docTriage.searchPatientPlaceholder')}
              value={selectedPatientId}
              onChange={(patientId) => setSelectedPatientId(patientId)}
              required
            />
            {selectedPatientId && (
              <p className="mt-2 text-sm text-ok-subtle-fg flex items-center gap-1 min-h-[24px] py-1">
                <CheckCircle size={16} />
                {t('docTriage.patientSelected', { id: selectedPatientId })}
              </p>
            )}
          </div>
          )}

          {/* ESI Level Selection */}
          <div className="bg-surface rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
              <AlertTriangle size={20} />
              {t('docTriage.esiLevelTitle')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {ESI_LEVELS.map((esi) => (
                <button
                  key={esi.level}
                  type="button"
                  onClick={() => setSelectedESI(esi.level)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    selectedESI === esi.level
                      ? `${esi.borderColor} ${esi.bgLight}`
                      : 'border-border hover:border-border-strong'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-8 h-8 shrink-0 rounded-full ${esi.color} text-white flex items-center justify-center font-bold`}>
                      {esi.level}
                    </span>
                    <span className={`font-semibold ${esi.textColor}`}>{esi.name}</span>
                  </div>
                  <p className="text-xs text-content-muted mb-1">{esi.description}</p>
                  <p className="text-xs text-content-muted flex items-center gap-1">
                    <Clock size={12} />
                    {esi.wait}
                  </p>
                </button>
              ))}
            </div>
            {selectedESI !== null && (
              <div className={`mt-4 p-3 rounded-lg ${ESI_LEVELS[selectedESI - 1].bgLight}`}>
                <p className="text-sm text-content-secondary">
                  <strong>{t('docTriage.examplesLabel')}</strong> {ESI_LEVELS[selectedESI - 1].examples}
                </p>
              </div>
            )}
          </div>

          {/* Chief Complaint */}
          <div className="bg-surface rounded-xl shadow p-6">
            {/* A heading is not a label: this required field had no
                accessible name at all, so a screen reader announced an unnamed
                text box — unlike every other field on this form, which uses
                `<label htmlFor>`. Kept as a heading visually, bound properly. */}
            <label
              htmlFor="triage-chief-complaint"
              className="block text-lg font-semibold text-content mb-4"
            >
              {t('docTriage.chiefComplaintTitle')}
              <CarriedTag from={ambulance.carried.chief_complaint} />
            </label>
            <textarea
              id="triage-chief-complaint"
              value={chiefComplaint}
              onChange={(e) => { setChiefComplaint(e.target.value); ambulance.forget('chief_complaint'); }}
              placeholder={t('docTriage.chiefComplaintPlaceholder')}
              rows={3}
              className="w-full px-4 py-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          {/* Vital Signs */}
          <div className="bg-surface rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
              <Activity size={20} />
              {t('docTriage.vitalSignsTitle')}
              {hasCriticalVitals() && (
                <span className="ml-2 px-2 py-1 bg-critical-subtle text-critical-subtle-fg text-xs font-medium rounded-full mc-rise">
                  {t('docTriage.criticalValuesDetected')}
                </span>
              )}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Heart Rate */}
              <div>
                <label htmlFor="triage-heart-rate" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Heart size={14} className="text-critical" />
                  {t('docTriage.heartRateLabel')}
                  <CarriedTag from={ambulance.carried.heart_rate} />
                </label>
                <input
                  id="triage-heart-rate"
                  type="number"
                  value={vitalSigns.heart_rate ?? ''}
                  onChange={(e) => updateVitalSign('heart_rate', e.target.value)}
                  placeholder={normalRange('heart_rate', scoringCatalog)}
                  className={`w-full px-3 py-2 border rounded-lg ${flagClass(vitalFlag(vitalSigns.heart_rate, 'heart_rate', scoringCatalog))}`}
                />
              </div>
              
              {/* Respiratory Rate */}
              <div>
                <label htmlFor="triage-respiratory-rate" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Wind size={14} className="text-notice-subtle-fg" />
                  {t('docTriage.respRateLabel')}
                  <CarriedTag from={ambulance.carried.respiratory_rate} />
                </label>
                <input
                  id="triage-respiratory-rate"
                  type="number"
                  value={vitalSigns.respiratory_rate ?? ''}
                  onChange={(e) => updateVitalSign('respiratory_rate', e.target.value)}
                  placeholder={normalRange('respiratory_rate', scoringCatalog)}
                  className={`w-full px-3 py-2 border rounded-lg ${flagClass(vitalFlag(vitalSigns.respiratory_rate, 'respiratory_rate', scoringCatalog))}`}
                />
              </div>
              
              {/* Blood Pressure */}
              <div>
                <label htmlFor="triage-bp-systolic" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Activity size={14} className="text-purple-500" />
                  {t('docTriage.bpSystolicLabel')}
                  <CarriedTag from={ambulance.carried.bp_systolic} />
                </label>
                <input
                  id="triage-bp-systolic"
                  type="number"
                  value={vitalSigns.bp_systolic ?? ''}
                  onChange={(e) => updateVitalSign('bp_systolic', e.target.value)}
                  placeholder={normalRange('bp_systolic', scoringCatalog)}
                  className={`w-full px-3 py-2 border rounded-lg ${flagClass(vitalFlag(vitalSigns.bp_systolic, 'bp_systolic', scoringCatalog))}`}
                />
              </div>
              
              <div>
                <label htmlFor="triage-bp-diastolic" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.bpDiastolicLabel')}
                  <CarriedTag from={ambulance.carried.bp_diastolic} />
                </label>
                <input
                  id="triage-bp-diastolic"
                  type="number"
                  value={vitalSigns.bp_diastolic ?? ''}
                  onChange={(e) => updateVitalSign('bp_diastolic', e.target.value)}
                  placeholder={normalRange('bp_diastolic', scoringCatalog)}
                  className={`w-full px-3 py-2 border rounded-lg ${flagClass(vitalFlag(vitalSigns.bp_diastolic, 'bp_diastolic', scoringCatalog))}`}
                />
              </div>
              
              {/* Temperature */}
              <div>
                <label htmlFor="triage-temperature" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Thermometer size={14} className="text-caution" />
                  {t('docTriage.temperatureLabel')}
                  <CarriedTag from={ambulance.carried.temperature_celsius} />
                </label>
                <input
                  id="triage-temperature"
                  type="number"
                  step="0.1"
                  value={vitalSigns.temperature_celsius ?? ''}
                  onChange={(e) => updateVitalSign('temperature_celsius', e.target.value)}
                  placeholder={normalRange('temperature', scoringCatalog)}
                  className={`w-full px-3 py-2 border rounded-lg ${flagClass(vitalFlag(vitalSigns.temperature_celsius, 'temperature', scoringCatalog))}`}
                />
              </div>
              
              {/* O2 Saturation */}
              <div>
                <label htmlFor="triage-oxygen-saturation" className="flex text-sm font-medium text-content-secondary mb-1 items-center gap-1">
                  <Droplet size={14} className="text-brand" />
                  {t('docTriage.o2SatLabel')}
                  <CarriedTag from={ambulance.carried.oxygen_saturation} />
                </label>
                <input
                  id="triage-oxygen-saturation"
                  type="number"
                  value={vitalSigns.oxygen_saturation ?? ''}
                  onChange={(e) => updateVitalSign('oxygen_saturation', e.target.value)}
                  placeholder={normalRange('oxygen_saturation', scoringCatalog)}
                  className={`w-full px-3 py-2 border rounded-lg ${flagClass(vitalFlag(vitalSigns.oxygen_saturation, 'oxygen_saturation', scoringCatalog))}`}
                />
              </div>
              
              {/* Pain Scale */}
              <div>
                <label htmlFor="triage-pain-scale" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.painScaleLabel')}
                </label>
                <input
                  id="triage-pain-scale"
                  type="number"
                  min="0"
                  max="10"
                  value={vitalSigns.pain_scale ?? ''}
                  onChange={(e) => updateVitalSign('pain_scale', e.target.value)}
                  placeholder="0-10"
                  className="w-full px-3 py-2 border border-border-interactive rounded-lg"
                />
              </div>
              
              {/* GCS */}
              <div>
                <label htmlFor="triage-gcs-score" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.gcsLabel')}
                  <CarriedTag from={ambulance.carried.gcs_score} />
                </label>
                <input
                  id="triage-gcs-score"
                  type="number"
                  min="3"
                  max="15"
                  value={vitalSigns.gcs_score ?? ''}
                  onChange={(e) => updateVitalSign('gcs_score', e.target.value)}
                  placeholder={t('docTriage.gcsPlaceholder')}
                  className={`w-full px-3 py-2 border rounded-lg ${flagClass(vitalFlag(vitalSigns.gcs_score, 'gcs', scoringCatalog))}`}
                />
              </div>
              
              {/* Blood Glucose */}
              <div>
                <label htmlFor="triage-blood-glucose" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.bloodGlucoseLabel')}
                  <CarriedTag from={ambulance.carried.blood_glucose} />
                </label>
                <input
                  id="triage-blood-glucose"
                  type="number"
                  value={vitalSigns.blood_glucose ?? ''}
                  onChange={(e) => updateVitalSign('blood_glucose', e.target.value)}
                  placeholder={normalRange('blood_glucose', scoringCatalog)}
                  step="0.1"
                  className={`w-full px-3 py-2 border rounded-lg ${flagClass(vitalFlag(vitalSigns.blood_glucose, 'blood_glucose', scoringCatalog))}`}
                />
              </div>
              
              {/* Weight */}
              <div>
                <label htmlFor="triage-weight" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docTriage.weightLabel')}
                </label>
                <input
                  id="triage-weight"
                  type="number"
                  step="0.1"
                  value={vitalSigns.weight_kg ?? ''}
                  onChange={(e) => updateVitalSign('weight_kg', e.target.value)}
                  placeholder={t('docTriage.weightPlaceholder')}
                  className="w-full px-3 py-2 border border-border-interactive rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-surface rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-content mb-4">{t('docTriage.notesTitle')}</h2>
            <textarea aria-label={t('docTriage.notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('docTriage.notesPlaceholder')}
              rows={3}
              className="w-full px-4 py-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-4">
            <Link
              to="/dashboard"
              className="px-6 py-3 border border-border rounded-lg hover:bg-surface-sunken transition-colors"
            >
              {t('docTriage.cancel')}
            </Link>
            {/* The shared button: its tick confirms the save (c10). */}
            <SubmitButton status={submitting ? 'saving' : submission.status} label={t('docTriage.completeTriageAssessment')} />
          </div>
        </form>
      ) : (
        /* Triage Queue Tab */
        <div className="bg-surface rounded-xl shadow">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-content">{t('docTriage.currentQueueTitle')}</h2>
            <p className="text-sm text-content-muted">{t('docTriage.queueSubtitle')}</p>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="mx-auto mb-3 text-brand animate-spin" size={48} />
              <p className="text-content-muted">{t('docTriage.loadingQueue')}</p>
            </div>
          ) : queueUnavailable ? (
            <div role="alert" className="p-12 text-center">
              <AlertCircle className="mx-auto mb-3 text-critical-subtle-fg" size={48} />
              <p className="text-content">{t('docTriage.queueUnavailable')}</p>
              <button
                type="button"
                onClick={() => setQueueAttempt((n) => n + 1)}
                className="mt-4 px-4 py-2 rounded-lg border border-border-interactive text-content hover:bg-surface-sunken"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : triageQueue.length > 0 ? (
            <div className="divide-y divide-border">
              {triageQueue
                .sort((a, b) => {
                  const levelA = triageLevel(a.esi_level) ?? 6;
                  const levelB = triageLevel(b.esi_level) ?? 6;
                  return levelA - levelB;
                })
                .map((assessment) => {
                  const level = triageLevel(assessment.esi_level);
                  const esiConfig = level === null ? undefined : ESI_LEVELS[level - 1];
                  const patient = patients.find(p => p.patient_id === assessment.patient_id);
                  
                  return (
                    <MotionLink opensPatient
                      key={assessment.assessment_id}
                      to={`/patients/${assessment.patient_id}`}
                      className="flex items-center justify-between p-4 hover:bg-surface-sunken transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <span className={`w-10 h-10 rounded-full ${esiConfig?.color || 'bg-gray-500'} text-white flex items-center justify-center font-bold`}>
                          {level ?? '—'}
                        </span>
                        <div>
                          <p className="font-medium text-content">
                            {assessment.patient_name || patient?.full_name || assessment.patient_id}
                          </p>
                          <p className="text-sm text-content-muted">{assessment.chief_complaint}</p>
                          <p className="text-xs text-content-muted mt-1">
                            {formatTimestamp(assessment.performed_at * 1000, { timeStyle: 'short' })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${esiConfig?.bgLight} ${esiConfig?.textColor}`}>
                            {level !== null && esiConfig ? t('docTriage.esiBadge', { level, name: esiConfig.name }) : '—'}
                          </span>
                          <p className="text-xs text-content-muted mt-1">{esiConfig?.wait}</p>
                        </div>
                        <ChevronRight className="text-content-muted" size={20} />
                      </div>
                    </MotionLink>
                  );
                })}
            </div>
          ) : (
            <div className="p-12 text-center">
              <Clock className="mx-auto mb-3 text-content-muted" size={48} />
              <p className="text-content-muted">{t('docTriage.noPatientsInQueue')}</p>
              <button
                onClick={() => setActiveTab('new')}
                className="mt-4 px-4 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand transition-colors"
              >
                {t('docTriage.startNewTriage')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TriagePage;
