import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import {
  Baby,
  Search,
  TrendingUp,
  Ruler,
  Scale,
  Activity,
  AlertTriangle,
  CheckCircle,
  Heart,
  FileSignature
} from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import PediatricGrowthChart from '../components/PediatricGrowthChart';
import {
  createPeds,
  listPedsForPatient,
  getPaediatricCaseload,
  useTranslation,
  clickable,
  Input,
  useValidatedForm,
  pediatricAssessmentSchema,
  ApiClientError,
  CARE_RELATIONSHIP_REQUIRED,
} from '@medichain/shared';

/**
 * PediatricsPage
 * 
 * Page for pediatric assessment and documentation.
 * Implements pediatric assessment form, growth chart, and risk screening.
 */

type AgeGroup = 'newborn' | 'infant' | 'toddler' | 'preschool' | 'school-age' | 'adolescent';
type DevelopmentStatus = 'unknown' | 'on-track' | 'monitor' | 'concern';

interface GrowthData {
  date: Date | null;
  ageMonths: number | null;
  weight: number | null;
  height: number | null;
  headCircumference?: number;
  bmi?: number;
  weightPercentile: number | null;
  heightPercentile: number | null;
}

interface PediatricPatient {
  id: string;
  name: string;
  mrn: string;
  dob: Date;
  ageMonths: number;
  ageGroup: AgeGroup;
  gender: string;
  growthData: GrowthData[];
  vaccinesUpToDate: boolean | null;
  developmentStatus: DevelopmentStatus;
  alerts: string[];
}

/**
 * The child's most recent growth point, or `undefined` when none is recorded.
 *
 * Returning `undefined` rather than indexing blindly is the point: a newly
 * registered child has no assessment yet, and every caller here renders a dash
 * instead of crashing the page.
 */
const latestGrowthOf = (patient: PediatricPatient): GrowthData | undefined =>
  patient.growthData.length > 0 ? patient.growthData[patient.growthData.length - 1] : undefined;

/** Parse recorded numeric values without coercing missing, blank or boolean values to zero. */
function recordedNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Read canonical and legacy measurement names while preserving absent dates and percentiles. */
function recordedGrowth(item: unknown): GrowthData | null {
  const wrapper = item as Record<string, unknown>;
  const record = (wrapper.data ?? wrapper) as Record<string, unknown>;
  const weight = recordedNumber(record.weight_kg ?? wrapper.weight_kg);
  const height = recordedNumber(record.length_cm ?? record.height_cm ?? wrapper.length_cm);
  if (weight === null && height === null) return null;
  const rawDate = wrapper.assessment_datetime ?? record.assessment_datetime ?? wrapper.created_at;
  const date = typeof rawDate === 'string' ? new Date(rawDate) : null;
  const recordedAge = recordedNumber(wrapper.age_months ?? record.age_months);
  return { weight, height, ageMonths: recordedAge !== null && recordedAge >= 0 ? recordedAge : null,
    date: date && Number.isFinite(date.getTime()) ? date : null,
    headCircumference: recordedNumber(record.head_circumference_cm) ?? undefined,
    weightPercentile: recordedNumber(record.weight_percentile),
    heightPercentile: recordedNumber(record.height_percentile) };
}

/** Apply authoritative history to one patient; an empty history clears cached observations. */
function withRecordedHistory(patient: PediatricPatient, rows: unknown[]): PediatricPatient {
  const growthData = rows.map(recordedGrowth)
    .filter((point): point is GrowthData => point !== null)
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  const latest = rows[0] as Record<string, unknown> | undefined;
  const recorded = (latest?.data ?? latest) as Record<string, unknown> | undefined;
  const development = recorded?.developmental_status;
  const vaccine = latest?.immunizations_up_to_date ?? recorded?.immunizations_up_to_date;
  return { ...patient, growthData,
    developmentStatus: ['on-track', 'monitor', 'concern'].includes(String(development))
      ? development as DevelopmentStatus : 'unknown',
    vaccinesUpToDate: typeof vaccine === 'boolean' ? vaccine : null };
}

const PediatricsPage: React.FC = () => {
  // Toasts, not `alert()`. A native alert is a blocking modal: it freezes the
  // tab until dismissed, ignores the app's styling and focus handling, and
  // interrupts a clinician mid-form. `Toast.tsx` says in its own header that it
  // exists "to replace browser alert() calls"; these three pages were missed.
  const { showSuccess, showError } = useToastActions();
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const savePending = useRef(false);
  const saveConfirmed = useRef(false);
  const saveOperation = useRef<{ signature: string; key: string;
    payload: { patient_id: string; [key: string]: unknown } } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [summaryError, setSummaryError] = useState<{ patientId: string; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'patients' | 'assessment' | 'growth'>('patients');
  const [patients, setPatients] = useState<PediatricPatient[]>([]);
  const [caseloadNotice, setCaseloadNotice] = useState<'unavailable' | 'truncated' | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<PediatricPatient | null>(null);
  const selectedPatientId = selectedPatient?.id;
  const [historyPage, setHistoryPage] = useState(1);
  const [hasOlderHistory, setHasOlderHistory] = useState(false);
  const historyRows = useRef<unknown[]>([]);
  /** Start a fresh read when opening a child's accumulated growth history. */
  const openGrowth = (patient: PediatricPatient): void => {
    setHistoryPage(1);
    historyRows.current = [];
    setSelectedPatient(patient);
  };
  const growthDialog = useRef<HTMLDialogElement>(null);
  /** Native modal behavior contains focus; restore the opening control when details close. */
  useEffect(() => {
    if (!selectedPatientId) return;
    const openingControl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    growthDialog.current?.showModal();
    return () => openingControl?.focus();
  }, [selectedPatientId]);
  const [growthLoading, setGrowthLoading] = useState(false);
  const [growthError, setGrowthError] = useState('');
  const [growthAccessDenied, setGrowthAccessDenied] = useState(false);
  const [growthRetry, setGrowthRetry] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [assessmentForm, setAssessmentForm] = useState({
    patientId: '',
    weightKg: '',
    heightCm: '',
    heartRate: '',
    respiratoryRate: '',
    temperature: '',
    patAppearance: '',
    patWorkOfBreathing: '',
    patCirculation: '',
    developmentalStatus: '',
    notes: ''
  });

  /**
   * Load the paediatric caseload from the patient register.
   *
   * This effect used to `setPatients([...])` with two invented children and
   * four hand-written growth points each. The page therefore charted the same
   * fictional growth curves in every deployment, and no real child ever
   * appeared on it.
   *
   * Patients now come from the register and are filtered to under-18s by date
   * of birth; each child's growth series is loaded from their own pediatric
   * assessments on selection, so nothing is charted that was not recorded.
   */
  useEffect(() => {
    const ageGroupFor = (months: number): AgeGroup => {
      if (months < 1) return 'newborn';
      if (months < 12) return 'infant';
      if (months < 36) return 'toddler';
      if (months < 60) return 'preschool';
      if (months < 144) return 'school-age';
      return 'adolescent';
    };

    // The caseload is every child the directory holds, filtered and aged on the
    // server: this used to filter the first 50 patients by date of birth here.
    const loadPatients = async () => {
      try {
        const caseload = await getPaediatricCaseload();
        setCaseloadNotice(caseload.truncated ? 'truncated' : null);
        const children = caseload.children
          .map((entry) => {
            const raw = entry as unknown as Record<string, unknown>;
            const dob = new Date(entry.date_of_birth);
            const ageMonths = entry.age_months;
            return {
              id: String(raw.patient_id ?? ''),
              name: String(raw.full_name ?? ''),
              mrn: String(raw.mrn ?? raw.health_id ?? raw.patient_id ?? ''),
              dob,
              ageMonths,
              ageGroup: ageGroupFor(ageMonths),
              gender: String(raw.gender ?? '').trim() || 'Gender not recorded',
              // Filled in from the child's own assessments on selection.
              growthData: [],
              vaccinesUpToDate: typeof raw.vaccines_up_to_date === 'boolean' ? raw.vaccines_up_to_date : null,
              developmentStatus: ['on-track', 'monitor', 'concern'].includes(String(raw.developmental_status))
                ? raw.developmental_status as DevelopmentStatus : 'unknown',
              alerts: [],
            } as PediatricPatient;
          })
          .filter((entry): entry is PediatricPatient => entry !== null);
        setPatients(children);
      } catch (err) {
        // "Could not load" is not "no children": an empty caseload asserts the second.
        console.error('Failed to load pediatric patients:', err);
        setPatients([]);
        setCaseloadNotice('unavailable');
      }
    };
    loadPatients();
  }, []);

  /** Load the selected child's recorded growth points. */
  useEffect(() => {
    if (!selectedPatientId) return;
    let cancelled = false;
    setGrowthLoading(true);
    setGrowthError('');
    setGrowthAccessDenied(false);
    const loadGrowth = async () => {
      try {
        const pageRows = await listPedsForPatient(selectedPatientId, historyPage);
        if (cancelled) return;
        historyRows.current = historyPage === 1 ? pageRows : [...historyRows.current, ...pageRows];
        const rows = historyRows.current;
        setHasOlderHistory(pageRows.length === 100);
        setSummaryError(current => current?.patientId === selectedPatientId ? null : current);
        const update = (patient: PediatricPatient): PediatricPatient => patient.id !== selectedPatientId
          ? patient : withRecordedHistory(patient, rows);
        setSelectedPatient(current => current ? update(current) : current);
        setPatients(current => current.map(update));
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load growth history:', err);
        const careRequired = err instanceof ApiClientError && err.code === CARE_RELATIONSHIP_REQUIRED;
        setGrowthAccessDenied(careRequired);
        setGrowthError(careRequired
          ? 'A care relationship is required to view this history. Use the normal care-assignment workflow before opening it.'
          : 'Growth history could not be loaded. Recorded measurements are unavailable until you retry.');
      } finally {
        if (!cancelled) setGrowthLoading(false);
      }
    };
    loadGrowth();
    return () => {
      cancelled = true;
    };
  }, [selectedPatientId, growthRetry, historyPage]);

  /** Refresh a committed patient's summary without treating a failed read as a failed save. */
  const refreshSavedSummary = async (patientId: string): Promise<void> => {
    setSelectedPatient(null);
    const update = (rows: unknown[]) => setPatients(current => current.map(patient =>
      patient.id === patientId ? withRecordedHistory(patient, rows) : patient));
    update([]);
    try {
      update(await listPedsForPatient(patientId));
      setSummaryError(current => current?.patientId === patientId ? null : current);
    } catch (error) {
      console.error('Saved pediatric summary could not be refreshed:', error);
      setSummaryError({ patientId,
        message: 'Assessment saved. Growth summary could not be refreshed. Open the patient\'s growth details to retry.' });
    }
  };

  const getAgeDisplay = (months: number): string => {
    if (months < 1) return 'Newborn';
    if (months < 12) return `${months} months`;
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return remainingMonths > 0 ? `${years} yr ${remainingMonths} mo` : `${years} years`;
  };

  const getAgeGroupColor = (group: AgeGroup): string => {
    const colors: Record<AgeGroup, string> = {
      'newborn': 'bg-surface-sunken text-content-secondary',
      'infant': 'bg-surface-sunken text-content-secondary',
      'toddler': 'bg-notice-subtle text-notice-subtle-fg',
      'preschool': 'bg-ok-subtle text-ok-subtle-fg',
      'school-age': 'bg-surface-sunken text-content-secondary',
      'adolescent': 'bg-surface-sunken text-content-secondary'
    };
    return colors[group];
  };

  const getDevelopmentBadge = (status: DevelopmentStatus) => {
    const styles: Record<DevelopmentStatus, { bg: string; text: string; icon: React.ReactNode }> = {
      'unknown': { bg: 'bg-surface-sunken', text: 'text-content-muted', icon: null },
      'on-track': { bg: 'bg-ok-subtle', text: 'text-ok-subtle-fg', icon: <CheckCircle className="w-3 h-3" /> },
      'monitor': { bg: 'bg-caution-subtle', text: 'text-caution-subtle-fg', icon: <Activity className="w-3 h-3" /> },
      'concern': { bg: 'bg-critical-subtle', text: 'text-critical-subtle-fg', icon: <AlertTriangle className="w-3 h-3" /> }
    };
    const s = styles[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {s.icon} {status === 'unknown' ? 'Development not recorded' : t(`docPediatrics.devStatus_${status}`)}
      </span>
    );
  };

  const filteredPatients = patients.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.mrn.includes(searchQuery)
  );


  const { errors, validate, validateField, clearField } = useValidatedForm(pediatricAssessmentSchema);
  const handleSubmitAssessment = async () => {
    if (savePending.current || saveConfirmed.current) return;
    // Weight is bounded as well as required: paediatric dosing is per
    // kilogram, so a weight in pounds entered as kilograms roughly doubles
    // every dose calculated from it, and 250 kg is not a child.
    if (!validate(assessmentForm)) {
      return;
    }

    savePending.current = true;
    setSaving(true);
    setSaveError('');
    try {
      // Only what the form collects, under the names the handler reads.
      //
      // Two things were wrong here. The field names did not match — the page
      // sent `age: {years, months}`, `weight_method` and `immunizations`
      // against a handler reading `age_months`, `weight_estimated` and
      // `immunizations_up_to_date` — so a paediatric assessment stored age
      // 0 months and no immunisation status while returning success.
      //
      // And six clinical findings were asserted that nobody entered:
      //
      //   hr_interpretation / rr_interpretation / temp_interpretation: 'Normal'
      //     — every paediatric vital sign filed as normal, including a
      //       tachycardic infant's.
      //   pain: { score: 0 }              — no pain, on a child nobody asked.
      //   immunizations: 'Up to date'     — a complete schedule for every child.
      //   abuse_screening: { concerns: false }
      //     — the worst of them: a record stating a child-protection screen
      //       found no concerns, when no screen was performed.
      //   guardian_present: true          — a guardian who may not have been there.
      //   weight_method: 'Measured'       — measured, not estimated.
      //
      // A temperature nobody entered also became 37.0 and a weight nobody
      // entered became 0. Absent is what these are, and absent is what they
      // send now.
      const assessmentPatient = patients.find(patient => patient.id === assessmentForm.patientId);
      const assessmentData = {
        patient_id: assessmentForm.patientId,
        age_months: assessmentPatient?.ageMonths,
        weight_kg: assessmentForm.weightKg ? parseFloat(assessmentForm.weightKg) : null,
        length_cm: assessmentForm.heightCm ? parseFloat(assessmentForm.heightCm) : null,
        // The Paediatric Assessment Triangle, which the form does collect.
        appearance_score: assessmentForm.patAppearance ? assessmentForm.patAppearance === 'normal' ? 'Normal' : 'Abnormal' : null,
        work_of_breathing: assessmentForm.patWorkOfBreathing ? assessmentForm.patWorkOfBreathing === 'normal' ? 'Normal' : 'Abnormal' : null,
        circulation_to_skin: assessmentForm.patCirculation ? assessmentForm.patCirculation === 'normal' ? 'Normal' : 'Abnormal' : null,
        developmental_status: assessmentForm.developmentalStatus || null,
        developmental_concerns:
          assessmentForm.developmentalStatus === 'on-track'
            ? null
            : assessmentForm.developmentalStatus || null,
        // Vital signs as recorded. No interpretation: the form has no control
        // for one, and a vital sign labelled "Normal" by the page rather than
        // by a clinician is a finding nobody made.
        pediatric_triangle: {
          heart_rate: assessmentForm.heartRate ? parseInt(assessmentForm.heartRate) : null,
          respiratory_rate: assessmentForm.respiratoryRate
            ? parseInt(assessmentForm.respiratoryRate)
            : null,
          temperature_celsius: assessmentForm.temperature
            ? parseFloat(assessmentForm.temperature)
            : null,
          appearance: assessmentForm.patAppearance || null,
          work_of_breathing: assessmentForm.patWorkOfBreathing || null,
          circulation: assessmentForm.patCirculation || null,
        },
        notes: assessmentForm.notes,
      };

      // Derived metadata must not change the retried payload when the entered draft is unchanged.
      const signature = JSON.stringify(assessmentForm);
      if (saveOperation.current?.signature !== signature) {
        saveOperation.current = { signature, key: crypto.randomUUID(), payload: assessmentData };
      }
      const operation = saveOperation.current;
      try {
        const result = await createPeds(operation.payload, operation.key);
        if (!result.success) throw new Error('Unconfirmed pediatric submission');
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.code !== 'IDEMPOTENCY_DUPLICATE') throw error;
        const rows = await listPedsForPatient(operation.payload.patient_id);
        const recovered = rows.some(raw => {
          const record = raw as { assessed_by?: string; data?: { client_operation_id?: string } };
          return Boolean(user?.userId) && record.assessed_by === user?.userId
            && record.data?.client_operation_id === operation.key;
        });
        if (!recovered) throw error;
      }
      saveConfirmed.current = true;
      await refreshSavedSummary(operation.payload.patient_id);
      showSuccess(t('docPediatrics.submittedSuccess'));
      setActiveTab('patients');
      // Reset form
      setAssessmentForm({
        patientId: '', weightKg: '', heightCm: '', heartRate: '', respiratoryRate: '', temperature: '',
        patAppearance: '', patWorkOfBreathing: '', patCirculation: '',
        developmentalStatus: '', notes: ''
      });
    } catch (error) {
      console.error('Failed to submit pediatric assessment:', error);
      const message = 'Save could not be confirmed. Your draft is retained. Retry without changing it to recover the original save.';
      setSaveError(message);
      showError(message);
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  const developmentalMilestones: Record<AgeGroup, string[]> = {
    'newborn': ['Startles to loud sounds', 'Focuses on faces', 'Moves arms and legs equally'],
    'infant': ['Sits without support', 'Responds to name', 'Babbles', 'Transfers objects hand to hand'],
    'toddler': ['Walks independently', 'Says 2-word phrases', 'Follows simple instructions', 'Points to show interest'],
    'preschool': ['Hops on one foot', 'Speaks in sentences', 'Plays with other children', 'Can tell stories'],
    'school-age': ['Rides bicycle', 'Reads independently', 'Understands time concepts', 'Shows empathy'],
    'adolescent': ['Abstract thinking', 'Identity formation', 'Peer relationships', 'Future planning']
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-sky-700 to-blue-800 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Baby className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docPediatrics.title')}</h1>
        </div>
        <p className="text-white">{t('docPediatrics.subtitle')}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 p-4 -mt-4">
        <div className="bg-surface rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-content-secondary">{patients.length}</p>
          <p className="text-xs text-content-muted">{t('docPediatrics.statPatients')}</p>
        </div>
        <div className="bg-surface rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-caution-subtle-fg">{patients.filter(p => p.alerts.length > 0).length}</p>
          <p className="text-xs text-content-muted">{t('docPediatrics.statNeedsAttention')}</p>
        </div>
        <div className="bg-surface rounded-lg shadow p-4 text-center">
          <p className="text-2xl font-bold text-ok-subtle-fg">{patients.filter(p => p.vaccinesUpToDate).length}</p>
          <p className="text-xs text-content-muted">{t('docPediatrics.statVaccinesCurrent')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {(['patients', 'assessment', 'growth'] as const).map(tab => (
            <button
              key={tab}
              disabled={saving}
              onClick={() => {
                if (tab === 'assessment' && saveConfirmed.current) {
                  saveConfirmed.current = false;
                  saveOperation.current = null;
                  setSaveError('');
                }
                setActiveTab(tab);
              }}
              className={`flex-1 py-4 text-sm font-medium capitalize ${
                activeTab === tab ? 'text-notice-subtle-fg border-b-2 border-sky-700' : 'text-content-muted'
              }`}
            >
              {tab === 'patients' ? t('docPediatrics.tabAllPatients') : tab === 'assessment' ? t('docPediatrics.tabAssessment') : t('docPediatrics.tabGrowthCharts')}
            </button>
          ))}
        </div>
      </div>

      {saveError && <p role="alert" className="m-4 bg-critical-subtle text-critical-subtle-fg p-3 rounded">{saveError}</p>}
      {summaryError && <p role="alert" className="m-4 bg-critical-subtle text-critical-subtle-fg p-3 rounded">{summaryError.message}</p>}
      {/* Patients Tab */}
      {activeTab === 'patients' && (
        <div className="p-4">
          {caseloadNotice && (
            <p role="alert" className="mb-4 p-3 rounded-lg bg-caution-subtle text-caution-subtle-fg text-sm">
              {caseloadNotice === 'unavailable'
                ? t('docPediatrics.caseloadUnavailable')
                : t('docPediatrics.caseloadTruncated')}
            </p>
          )}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('docPediatrics.searchPh')}
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>

          <div className="space-y-3">
            {filteredPatients.map(patient => {
              const latestGrowth = latestGrowthOf(patient);
              return (
                <div
                  key={patient.id}
                  {...clickable(() => openGrowth(patient))}
                  className={`bg-surface rounded-lg shadow border p-4 cursor-pointer hover:shadow-md ${
                    patient.alerts.length > 0 ? 'border-l-4 border-l-yellow-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{patient.name}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs ${getAgeGroupColor(patient.ageGroup)}`}>
                          {t(`docPediatrics.ageGroup_${patient.ageGroup}`)}
                        </span>
                      </div>
                      <p className="text-sm text-content-muted">
                        {t('docPediatrics.ageMrnLine', { age: getAgeDisplay(patient.ageMonths), mrn: patient.mrn })}
                      </p>
                    </div>
                    {getDevelopmentBadge(patient.developmentStatus)}
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-surface-sunken rounded p-2 text-center">
                      <Scale className="w-4 h-4 mx-auto text-content-muted mb-1" />
                      <p className="text-sm font-semibold">{latestGrowth?.weight ?? '-'} kg</p>
                      <p className="text-xs text-content-muted">{latestGrowth?.weightPercentile ?? '-'}%ile</p>
                    </div>
                    <div className="bg-surface-sunken rounded p-2 text-center">
                      <Ruler className="w-4 h-4 mx-auto text-content-muted mb-1" />
                      <p className="text-sm font-semibold">{latestGrowth?.height ?? '-'} cm</p>
                      <p className="text-xs text-content-muted">{latestGrowth?.heightPercentile ?? '-'}%ile</p>
                    </div>
                    <div className="bg-surface-sunken rounded p-2 text-center">
                      <Heart className="w-4 h-4 mx-auto text-content-muted mb-1" />
                      <p className="text-sm font-semibold">{patient.vaccinesUpToDate === null ? 'Not recorded' : patient.vaccinesUpToDate ? '✓' : '!'}</p>
                      <p className="text-xs text-content-muted">{t('docPediatrics.vaccinesLabel')}</p>
                    </div>
                  </div>

                  {patient.alerts.length > 0 && (
                    <div className="bg-caution-subtle border border-caution rounded p-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-caution-subtle-fg flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-caution-subtle-fg">
                          {patient.alerts.map((alert, idx) => (
                            <p key={idx}>{alert}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Assessment Tab */}
      {activeTab === 'assessment' && (
        <div className="p-4">
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docPediatrics.newAssessmentHeading')}</h2>

            <fieldset disabled={saving} className="space-y-4">
              <div>
                <PatientSelect
                  id="peds-patient"
                  label={t('docPediatrics.patientRequired')}
                  required
                  value={assessmentForm.patientId}
                  onChange={(selectedPatientId) => { clearField('patientId'); setAssessmentForm({ ...assessmentForm, patientId: selectedPatientId }); }}
                  error={errors.patientId}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="peds-weight" className="block text-sm font-medium mb-1">{t('docPediatrics.weightKgRequired')} *</label>
                  <Input
                    id="peds-weight"
                    type="number"
                    step="0.1"
                    value={assessmentForm.weightKg}
                    onChange={(e) => { clearField('weightKg'); setAssessmentForm({ ...assessmentForm, weightKg: e.target.value }); }}
                    onBlur={() => validateField('weightKg', assessmentForm)}
                    error={errors.weightKg}
                    placeholder="0.0"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="peds-height" className="block text-sm font-medium mb-1">{t('docPediatrics.heightCmRequired')}</label>
                  <input
                    id="peds-height"
                    type="number"
                    step="0.1"
                    value={assessmentForm.heightCm}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, heightCm: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="0.0"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="peds-hr" className="block text-sm font-medium mb-1">{t('docPediatrics.heartRateRequired')} *</label>
                  <Input
                    id="peds-hr"
                    type="number"
                    value={assessmentForm.heartRate}
                    onChange={(e) => { clearField('heartRate'); setAssessmentForm({ ...assessmentForm, heartRate: e.target.value }); }}
                    onBlur={() => validateField('heartRate', assessmentForm)}
                    error={errors.heartRate}
                    placeholder={t('docPediatrics.heartRatePh')}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="peds-rr" className="block text-sm font-medium mb-1">{t('docPediatrics.respRateLabel')}</label>
                  <input
                    id="peds-rr"
                    type="number"
                    value={assessmentForm.respiratoryRate}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, respiratoryRate: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder={t('docPediatrics.respRatePh')}
                  />
                </div>
                <div>
                  <label htmlFor="peds-temperature" className="block text-sm font-medium mb-1">{t('docPediatrics.temperatureLabel')}</label>
                  <input
                    id="peds-temperature"
                    type="number"
                    step="0.1"
                    value={assessmentForm.temperature}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, temperature: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="36.5"
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-3">{t('docPediatrics.patHeading')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-content-muted mb-1">{t('docPediatrics.appearanceLabel')}</label>
                    <select
                      aria-label={t('docPediatrics.appearanceLabel')}
                      value={assessmentForm.patAppearance}
                      onChange={(e) => setAssessmentForm({ ...assessmentForm, patAppearance: e.target.value })}
                      className="w-full border rounded-lg px-2 py-1 text-sm"
                    >
                      <option value="">Not assessed</option>
                      <option value="normal">{t('docPediatrics.normalOption')}</option>
                      <option value="abnormal">{t('docPediatrics.abnormalOption')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-content-muted mb-1">{t('docPediatrics.workOfBreathingLabel')}</label>
                    <select
                      aria-label={t('docPediatrics.workOfBreathingLabel')}
                      value={assessmentForm.patWorkOfBreathing}
                      onChange={(e) => setAssessmentForm({ ...assessmentForm, patWorkOfBreathing: e.target.value })}
                      className="w-full border rounded-lg px-2 py-1 text-sm"
                    >
                      <option value="">Not assessed</option>
                      <option value="normal">{t('docPediatrics.normalOption')}</option>
                      <option value="abnormal">{t('docPediatrics.abnormalOption')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-content-muted mb-1">{t('docPediatrics.circulationLabel')}</label>
                    <select
                      aria-label={t('docPediatrics.circulationLabel')}
                      value={assessmentForm.patCirculation}
                      onChange={(e) => setAssessmentForm({ ...assessmentForm, patCirculation: e.target.value })}
                      className="w-full border rounded-lg px-2 py-1 text-sm"
                    >
                      <option value="">Not assessed</option>
                      <option value="normal">{t('docPediatrics.normalOption')}</option>
                      <option value="abnormal">{t('docPediatrics.abnormalOption')}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t('docPediatrics.developmentalStatusLabel')}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="dev-status" checked={assessmentForm.developmentalStatus === ''}
                      onChange={() => setAssessmentForm({ ...assessmentForm, developmentalStatus: '' })} />
                    <span>Not assessed</span>
                  </label>
                  {(['on-track', 'monitor', 'concern'] as const).map(status => (
                    <label key={status} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="dev-status"
                        checked={assessmentForm.developmentalStatus === status}
                        onChange={() => setAssessmentForm({ ...assessmentForm, developmentalStatus: status })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{t(`docPediatrics.devStatus_${status}`)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="peds-notes" className="block text-sm font-medium mb-1">{t('docPediatrics.notesLabel')}</label>
                <textarea
                  id="peds-notes"
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  value={assessmentForm.notes}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, notes: e.target.value })}
                  placeholder={t('docPediatrics.notesPh')}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setActiveTab('patients')}
                  className="flex-1 py-3 border border-border-strong rounded-lg font-medium"
                >
                  {t('docPediatrics.cancelButton')}
                </button>
                <button
                  onClick={handleSubmitAssessment}
                  disabled={saving}
                  aria-busy={saving}
                  className="flex-[2] py-3 bg-slate-800 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-slate-900"
                >
                  <FileSignature className="w-5 h-5" /> {t('docPediatrics.signSubmitButton')}
                </button>
              </div>
            </fieldset>
          </div>
        </div>
      )}

      {/* Growth Charts Tab */}
      {activeTab === 'growth' && (
        <div className="p-4">
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('docPediatrics.growthChartTrackingHeading')}</h2>
            <div className="space-y-4">
              {patients.map(patient => (
                <div key={patient.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">{patient.name}</h3>
                      <p className="text-sm text-content-muted">{getAgeDisplay(patient.ageMonths)}</p>
                    </div>
                    <TrendingUp className="w-5 h-5 text-ok" />
                  </div>
                  <button className="underline focus-visible:outline focus-visible:outline-2"
                    onClick={() => openGrowth(patient)}>View growth history for {patient.name}</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Patient Detail Modal */}
      {selectedPatient && (
        <dialog ref={growthDialog} aria-labelledby="pediatric-growth-title"
          onCancel={event => { event.preventDefault(); setSelectedPatient(null); }}
          className="fixed inset-0 m-0 w-full max-w-none h-full max-h-none border-0 bg-transparent text-inherit flex items-center justify-center p-4 backdrop:bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b p-4 flex items-center justify-between">
              <div>
                <h2 id="pediatric-growth-title" className="text-xl font-semibold">{selectedPatient.name}</h2>
                <p className="text-sm text-content-muted">{getAgeDisplay(selectedPatient.ageMonths)} • {selectedPatient.gender}</p>
              </div>
              <button aria-label="Close growth details" onClick={() => setSelectedPatient(null)} className="text-content-muted hover:text-content-muted text-2xl">×</button>
            </div>

            <div className="p-6 space-y-4">
              {growthLoading ? <p role="status">Loading recorded growth history…</p> : growthError ? (
                <div role="alert" className="bg-critical-subtle text-critical-subtle-fg p-3 rounded">
                  <p>{growthError}</p>
                  {!growthAccessDenied && <button className="mt-2 underline" onClick={() => setGrowthRetry(previous => previous + 1)}>
                    Retry loading growth history
                  </button>}
                </div>
              ) : <>
              <PediatricGrowthChart points={selectedPatient.growthData} />
              {hasOlderHistory && <button className="underline" onClick={() => setHistoryPage(page => page + 1)}>
                Load older measurements
              </button>}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-notice-subtle rounded-lg p-4 text-center">
                  <Scale className="w-6 h-6 mx-auto text-notice-subtle-fg mb-1" />
                  <p className="text-xl font-bold">{latestGrowthOf(selectedPatient)?.weight ?? '-'} kg</p>
                  <p className="text-sm text-notice-subtle-fg">{latestGrowthOf(selectedPatient)?.weightPercentile == null ? 'Percentile not recorded' : t('docPediatrics.percentileLine', { pct: latestGrowthOf(selectedPatient)?.weightPercentile ?? '-' })}</p>
                </div>
                <div className="bg-surface-sunken rounded-lg p-4 text-center">
                  <Ruler className="w-6 h-6 mx-auto text-content-secondary mb-1" />
                  <p className="text-xl font-bold">{latestGrowthOf(selectedPatient)?.height ?? '-'} cm</p>
                  <p className="text-sm text-content-secondary">{latestGrowthOf(selectedPatient)?.heightPercentile == null ? 'Percentile not recorded' : t('docPediatrics.percentileLine', { pct: latestGrowthOf(selectedPatient)?.heightPercentile ?? '-' })}</p>
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">{t('docPediatrics.growthHistoryHeading')}</h3>
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[360px] text-sm">
                    <thead className="bg-surface-sunken">
                      <tr>
                        <th className="p-2 text-left">{t('docPediatrics.tableDate')}</th>
                        <th className="p-2 text-right">Age (months)</th>
                        <th className="p-2 text-right">{t('docPediatrics.tableWeight')}</th>
                        <th className="p-2 text-right">{t('docPediatrics.tableHeight')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPatient.growthData.length === 0 && <tr><td colSpan={4} className="p-3">
                        No growth measurements recorded
                      </td></tr>}
                      {selectedPatient.growthData.slice().reverse().map((g, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{g.date?.toLocaleDateString() ?? 'Date not recorded'}</td>
                          <td className="p-2 text-right">{g.ageMonths ?? 'Not recorded'}</td>
                          <td className="p-2 text-right">{g.weight ?? '-'} kg</td>
                          <td className="p-2 text-right">{g.height ?? '-'} cm</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2">
                <span className={`flex-1 text-center py-2 rounded-lg text-sm ${selectedPatient.vaccinesUpToDate === null ? 'bg-surface-sunken text-content-muted' : selectedPatient.vaccinesUpToDate ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-critical-subtle text-critical-subtle-fg'}`}>
                  {t('docPediatrics.vaccinesStatusLine', { status: selectedPatient.vaccinesUpToDate === null ? 'Not recorded' : selectedPatient.vaccinesUpToDate ? t('docPediatrics.upToDate') : t('docPediatrics.overdue') })}
                </span>
                {getDevelopmentBadge(selectedPatient.developmentStatus)}
              </div>

              {/* `developmentalMilestones` was built and never rendered. The badge
                  above says "delayed" or "on track" without saying against what;
                  these are the milestones that judgement is made against. */}
              <div>
                <h3 className="font-medium mb-2">{t('docPediatrics.milestonesHeading')}</h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-content-secondary">
                  {developmentalMilestones[selectedPatient.ageGroup].map((milestone) => (
                    <li key={milestone}>{milestone}</li>
                  ))}
                </ul>
              </div>
              </>}
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
};

export default PediatricsPage;
