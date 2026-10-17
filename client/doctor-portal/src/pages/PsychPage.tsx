import { useState, useEffect, useCallback, useRef } from 'react';
import { Brain, AlertTriangle, Shield, User, Plus, Phone } from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { getPatients, createPsych, getPsychForPatient, useTranslation, formatTimestamp, ApiClientError } from '@medichain/shared';
import type { PatientDirectoryEntry } from '@medichain/shared';

type RiskLevel = 'unknown' | 'none' | 'low' | 'moderate' | 'high' | 'imminent';
type LegalStatus = '' | 'voluntary' | 'involuntary' | '5150' | '5250' | 'conservatorship';
type SubstanceEntry = { substance: string; frequency: string; lastUse: string };
const MAX_SUBSTANCE_ROWS = 100;

interface SuicideRisk {
  ideation: boolean | null;
  plan: boolean | null;
  intent: boolean | null;
  means: boolean | null;
  priorAttempts: number | null;
  recentAttempt: boolean | null;
  riskLevel: RiskLevel;
}

interface HomicideRisk {
  ideation: boolean | null;
  plan: boolean | null;
  target: boolean | null;
  means: boolean | null;
  riskLevel: RiskLevel;
}

interface MentalStatusExam {
  appearance: string;
  behavior: string;
  speech: string;
  mood: string;
  affect: string;
  thoughtProcess: string;
  thoughtContent: string[];
  perceptions: string[];
  cognition: string;
  insight: string;
  judgment: string;
}

interface PsychAssessment {
  id: string;
  patientId: string;
  patientName: string;
  assessedBy: string;
  assessedAt: string;
  chiefComplaint: string;
  historyOfPresentIllness: string;
  substanceUse: SubstanceEntry[];
  medications: string[];
  mentalStatusExam: MentalStatusExam;
  suicideRisk: SuicideRisk;
  homicideRisk: HomicideRisk;
  legalStatus: LegalStatus;
  diagnoses: string[];
  disposition: string;
  safetyPlan: string[];
  notes: string;
}

const riskLevelColors: Record<RiskLevel, string> = {
  unknown: 'bg-surface-sunken text-content-secondary',
  none: 'bg-surface-sunken text-content-secondary',
  low: 'bg-ok-subtle text-ok-subtle-fg',
  moderate: 'bg-caution-subtle text-caution-subtle-fg',
  high: 'bg-surface-sunken text-content-secondary',
  imminent: 'bg-critical-subtle text-critical-subtle-fg'
};

/** Coerce a stored risk level onto the union the badge colours are keyed by. */
function toRiskLevel(value: unknown): RiskLevel {
  const level = String(value ?? '').toLowerCase();
  return (['unknown', 'none', 'low', 'moderate', 'high', 'imminent'] as const).includes(level as RiskLevel)
    ? (level as RiskLevel)
    : 'unknown';
}

/** Preserve a recorded yes/no observation; absent and malformed values stay unknown. */
function toObservation(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Return a draft validation message, or null when count and substance entries can be submitted. */
function validatePsychDraft(attemptCount: number | null, substances: SubstanceEntry[]): string | null {
  if (attemptCount !== null && (!Number.isSafeInteger(attemptCount) || attemptCount < 0)) {
    return 'Enter a valid non-negative whole number for prior attempts, or leave it blank.';
  }
  if (substances.length > MAX_SUBSTANCE_ROWS) return 'An assessment can contain at most 100 substance rows.';
  if (substances.some(row => !row.substance.trim())) {
    return 'Enter a substance name for each added row, or remove the unused row.';
  }
  return null;
}

/** Render a documented observation without using unchecked boxes to imply a negative finding. */
function ObservationSelect({ label, value, onChange }: {
  label: string; value: boolean | null; onChange: (value: boolean | null) => void;
}) {
  const { t } = useTranslation();
  return <label className="flex items-center justify-between gap-2">
    {label}
    <select aria-label={label} className="border rounded p-1" value={value === null ? '' : String(value)}
      onChange={event => onChange(event.target.value === '' ? null : event.target.value === 'true')}>
      <option value="">{t('docPsych.notAssessed')}</option>
      <option value="true">{t('docPsych.observationYes')}</option>
      <option value="false">{t('docPsych.observationNo')}</option>
    </select>
  </label>;
}

/**
 * Map one stored assessment onto the shape the History tab renders.
 *
 * The endpoint returns the record exactly as it was submitted — nested and
 * snake_case (`suicide_risk`, `homicidal_risk`, …). The previous mapper spread
 * the raw item and renamed four scalars, so `suicideRisk` stayed `undefined`
 * and the very first row threw on `a.suicideRisk.riskLevel`. React unmounts on
 * a render throw, so the tab showed nothing at all — indistinguishable from
 * "this patient has no assessments", for a patient who did.
 *
 * The stored `risk_level` is also capitalised on the way out ("Low"), so it is
 * normalised here rather than being used as a key directly.
 */
function toStoredAssessment(patients: Array<{ patient_id: string; full_name: string }>) {
  return (raw: unknown): PsychAssessment => {
    // The stored assessment nests several sub-objects; each is read with `??`
    // fallbacks below, so the shape is optional all the way down.
    const item = raw as {
      history_of_present_illness?: string;
      psych_medications?: unknown;
      diagnoses?: unknown;
      safety_plan?: unknown;
      notes?: string;
      assessment_id?: string;
      patient_id?: string;
      chief_complaint?: string;
      assessed_by?: string;
      assessed_at?: number;
      disposition?: string;
      // Each sub-object is read field-by-field with a `?? ''` fallback, so its
      // values are strings-or-absent. `Record<string, unknown>` would make
      // every one of those reads `{}` rather than `string`.
      suicide_risk?: Partial<Record<string, unknown>>;
      homicidal_risk?: Partial<Record<string, unknown>>;
      mental_status?: Partial<Record<string, string>>;
      legal_status?: { admission_type?: string };
      psych_history?: { diagnoses?: unknown };
      substance_use?: {
        substances?: { substance?: string; frequency?: string; last_use?: string; lastUse?: string }[];
      };
      [key: string]: unknown;
    };
    const suicide = item.suicide_risk ?? {};
    const homicide = item.homicidal_risk ?? {};
    const mse = (item.mental_status_exam ?? item.mental_status ?? {}) as Partial<Record<string, string>>;
    const asList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.map(String)
        : typeof value === 'string' && value.trim()
          ? value.split(',').map((s) => s.trim()).filter(Boolean)
          : [];
    const legal = String(item.legal_status?.admission_type ?? '').toLowerCase();
    return {
      historyOfPresentIllness: item.history_of_present_illness ?? '',
      substanceUse: (item.substance_use?.substances ?? []).map((s) => ({
        substance: s.substance ?? '',
        frequency: s.frequency ?? '',
        lastUse: s.last_use ?? s.lastUse ?? '',
      })),
      medications: asList(item.psych_medications),
      mentalStatusExam: {
        appearance: mse.appearance ?? '',
        behavior: mse.behavior ?? '',
        speech: mse.speech ?? '',
        mood: mse.mood ?? '',
        affect: mse.affect ?? '',
        thoughtProcess: mse.thought_process ?? '',
        // Stored as a joined string; split back so the tags render as tags.
        thoughtContent: asList(mse.thought_content),
        perceptions: asList(mse.perceptions),
        cognition: mse.cognition ?? '',
        insight: mse.insight ?? '',
        judgment: mse.judgment ?? '',
      },
      legalStatus: (['', 'voluntary', 'involuntary', '5150', '5250', 'conservatorship'] as const).includes(
        legal as LegalStatus
      )
        ? (legal as LegalStatus)
        : '',
      diagnoses: asList(item.diagnoses ?? item.psych_history?.diagnoses),
      safetyPlan: asList(item.safety_plan),
      notes: item.notes ?? '',
      id: item.assessment_id ?? '',
      patientId: item.patient_id ?? '',
      chiefComplaint: item.chief_complaint ?? '',
      assessedBy: item.assessed_by ?? '',
      assessedAt: new Date((item.assessed_at ?? 0) * 1000).toISOString(),
      disposition: item.disposition ?? '',
      patientName:
        patients.find((patient) => patient.patient_id === item.patient_id)?.full_name ??
        item.patient_id ??
        '',
      suicideRisk: {
        ideation: toObservation(suicide.ideation),
        plan: toObservation(suicide.plan),
        intent: toObservation(suicide.intent),
        means: toObservation(suicide.access_to_means),
        priorAttempts: typeof suicide.attempt_count === 'number' ? suicide.attempt_count : null,
        recentAttempt: toObservation(suicide.recent_attempt),
        riskLevel: toRiskLevel(suicide.risk_level),
      },
      homicideRisk: {
        ideation: toObservation(homicide.ideation),
        target: toObservation(homicide.target_identified),
        plan: toObservation(homicide.plan),
        means: toObservation(homicide.access_to_weapons),
        riskLevel: toRiskLevel(homicide.risk_level),
      },
    };
  };
}

/** Display persisted assessment fields; absent observations are never inferred as normal or negative. */
function AssessmentDetails({ assessment: a }: { assessment: PsychAssessment }) {
  const observation = (value: boolean | null) => value === null ? 'Not recorded' : value ? 'Yes' : 'No';
  const mse = a.mentalStatusExam;
  const fields: Array<[string, string | number | null]> = [
    ['Appearance', mse.appearance], ['Behavior', mse.behavior], ['Speech', mse.speech],
    ['Mood', mse.mood], ['Affect', mse.affect], ['Thought process', mse.thoughtProcess],
    ['Thought content', mse.thoughtContent.join(', ')], ['Perceptions', mse.perceptions.join(', ')],
    ['Cognition', mse.cognition], ['Insight', mse.insight], ['Judgment', mse.judgment],
    ['Suicidal ideation', observation(a.suicideRisk.ideation)],
    ['Suicide plan', observation(a.suicideRisk.plan)], ['Intent', observation(a.suicideRisk.intent)],
    ['Access to means', observation(a.suicideRisk.means)], ['Prior attempts', a.suicideRisk.priorAttempts],
    ['Recent attempt', observation(a.suicideRisk.recentAttempt)],
    ['Homicidal ideation', observation(a.homicideRisk.ideation)],
    ['Homicide plan', observation(a.homicideRisk.plan)],
    ['Identified target', observation(a.homicideRisk.target)],
    ['Access to weapons', observation(a.homicideRisk.means)],
    ['Legal status', a.legalStatus ? a.legalStatus[0].toUpperCase() + a.legalStatus.slice(1) : null],
    ['Medications', a.medications.join(', ')],
  ];
  return <details className="mt-3 border-t pt-3">
    <summary className="cursor-pointer font-semibold focus-visible:outline focus-visible:outline-2">Assessment details</summary>
    <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      {fields.map(([label, value]) => <div key={label}>
        <dt className="font-semibold">{label}</dt>
        <dd className="whitespace-pre-wrap break-words">{value === null || value === '' ? 'Not recorded' : value}</dd>
      </div>)}
    </dl>
    <h4 className="mt-3 font-semibold">Substance history</h4>
    {a.substanceUse.length === 0 ? <p className="text-sm">No substance entries recorded</p> :
      <ul className="mt-2 space-y-2 text-sm">{a.substanceUse.map((entry, index) => <li key={index}>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div><dt className="font-semibold">Substance</dt><dd>{entry.substance || 'Not recorded'}</dd></div>
          <div><dt className="font-semibold">Frequency</dt><dd>{entry.frequency || 'Not recorded'}</dd></div>
          <div><dt className="font-semibold">Last use</dt><dd>{entry.lastUse || 'Not recorded'}</dd></div>
        </dl>
      </li>)}</ul>}
  </details>;
}

/** Translate known stored dispositions without inferring voluntary versus involuntary admission. */
function dispositionLabel(value: string): string {
  const labels: Record<string, string> = {
    DischargeHome: 'Discharge home', InpatientAdmission: 'Inpatient admission',
    TransferToPsychFacility: 'Transfer to psychiatric facility', CrisisStabilization: 'Crisis stabilization',
    OutpatientFollowUp: 'Outpatient follow-up',
  };
  return labels[value] ?? (value || 'Not recorded');
}

const psychiatricDiagnoses = [
  'Major Depressive Disorder', 'Bipolar I Disorder', 'Bipolar II Disorder',
  'Generalized Anxiety Disorder', 'Panic Disorder', 'PTSD',
  'Schizophrenia', 'Schizoaffective Disorder', 'Brief Psychotic Disorder',
  'Borderline Personality Disorder', 'Antisocial Personality Disorder',
  'Substance Use Disorder', 'Alcohol Use Disorder', 'Opioid Use Disorder',
  'ADHD', 'Autism Spectrum Disorder', 'Eating Disorder', 'OCD'
];

const PsychPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();
  const [patients, setPatients] = useState<Array<Pick<PatientDirectoryEntry, 'patient_id' | 'full_name'>>>([]);
  const [assessments, setAssessments] = useState<PsychAssessment[]>([]);
  const [activeTab, setActiveTab] = useState<'assessment' | 'history'>('assessment');
  const [selectedPatient, setSelectedPatient] = useState('');
  const [historyError, setHistoryError] = useState('');
  const savePending = useRef(false);
  const saveCommitted = useRef(false);
  const saveOperation = useRef<{ signature: string; key: string; id: string; assessedAt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [chiefComplaint, setChiefComplaint] = useState('');
  const [hpi, setHpi] = useState('');
  const [substances, setSubstances] = useState<SubstanceEntry[]>([]);
  const [selectedDiagnoses, setSelectedDiagnoses] = useState<string[]>([]);
  const [legalStatus, setLegalStatus] = useState<LegalStatus>('');
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');

  const [mse, setMse] = useState<MentalStatusExam>({
    appearance: '',
    behavior: '',
    speech: '',
    mood: '',
    affect: '',
    thoughtProcess: '',
    thoughtContent: [],
    perceptions: [],
    cognition: '',
    insight: '',
    judgment: ''
  });

  const [suicideRisk, setSuicideRisk] = useState<SuicideRisk>({
    ideation: null, plan: null, intent: null, means: null,
    priorAttempts: null, recentAttempt: null, riskLevel: 'unknown'
  });

  const [homicideRisk, setHomicideRisk] = useState<HomicideRisk>({
    ideation: null, plan: null, target: null, means: null, riskLevel: 'unknown'
  });

  const [safetyPlan, setSafetyPlan] = useState<string[]>([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const pts = await getPatients();
        setPatients(pts);
      } catch (err) {
        console.error('Failed to load patients:', err);
      }
    };
    loadData();
  }, []);

  const refreshAssessments = useCallback(async () => {
    if (!selectedPatient) return false;
    try {
      const { assessments: saved } = await getPsychForPatient(selectedPatient);
      setAssessments(saved.map(toStoredAssessment(patients)));
      setHistoryError('');
      return true;
    } catch (err) {
      console.error('Failed to load psychiatric assessments:', err);
      // Said out loud rather than left as an empty tab. "No prior
      // assessments" and "the history could not be loaded" are opposite
      // findings for a patient being assessed for suicide risk, and an empty
      // list asserts the first one.
      setHistoryError(t('docPsych.historyLoadFailed'));
      return false;
    }
  }, [selectedPatient, patients, t]);

  useEffect(() => {
    void refreshAssessments();
  }, [refreshAssessments]);

  // Auto-calculate suicide risk
  useEffect(() => {
    let level: RiskLevel = 'none';
    if (suicideRisk.ideation) level = 'low';
    if (suicideRisk.plan) level = 'moderate';
    if (suicideRisk.intent || suicideRisk.means) level = 'high';
    if (suicideRisk.recentAttempt || (suicideRisk.plan && suicideRisk.intent && suicideRisk.means)) level = 'imminent';
    if ([suicideRisk.ideation, suicideRisk.plan, suicideRisk.intent, suicideRisk.means, suicideRisk.recentAttempt].includes(null)) level = 'unknown';
    setSuicideRisk(prev => ({ ...prev, riskLevel: level }));
  }, [suicideRisk.ideation, suicideRisk.plan, suicideRisk.intent, suicideRisk.means, suicideRisk.recentAttempt]);

  // Auto-calculate homicide risk
  useEffect(() => {
    let level: RiskLevel = 'none';
    if (homicideRisk.ideation) level = 'low';
    if (homicideRisk.plan || homicideRisk.target) level = 'moderate';
    if (homicideRisk.means) level = 'high';
    if (homicideRisk.plan && homicideRisk.target && homicideRisk.means) level = 'imminent';
    if ([homicideRisk.ideation, homicideRisk.plan, homicideRisk.target, homicideRisk.means].includes(null)) level = 'unknown';
    setHomicideRisk(prev => ({ ...prev, riskLevel: level }));
  }, [homicideRisk.ideation, homicideRisk.plan, homicideRisk.target, homicideRisk.means]);

  const addSubstance = () => {
    if (substances.length >= MAX_SUBSTANCE_ROWS) return;
    setSubstances([...substances, { substance: '', frequency: '', lastUse: '' }]);
  };

  /** Edit an unsaved entry without mutating a prior state or submitted snapshot. */
  const updateSubstance = (index: number, field: keyof SubstanceEntry, value: string) => {
    setSubstances(previous => previous.map((entry, position) =>
      position === index ? { ...entry, [field]: value } : entry));
  };

  /** Start a new document explicitly; retain the selected patient but clear prior findings. */
  const startNewAssessment = () => {
    saveCommitted.current = false;
    saveOperation.current = null;
    setSaved(false); setSaveError('');
    setChiefComplaint(''); setHpi(''); setSubstances([]); setSelectedDiagnoses([]);
    setLegalStatus(''); setDisposition(''); setNotes(''); setSafetyPlan([]);
    setMse({ appearance: '', behavior: '', speech: '', mood: '', affect: '', thoughtProcess: '',
      thoughtContent: [], perceptions: [], cognition: '', insight: '', judgment: '' });
    setSuicideRisk({ ideation: null, plan: null, intent: null, means: null,
      priorAttempts: null, recentAttempt: null, riskLevel: 'unknown' });
    setHomicideRisk({ ideation: null, plan: null, target: null, means: null, riskLevel: 'unknown' });
  };

  /** Confirm a duplicate-operation response using its stored actor-bound correlation, not similar text. */
  const recoverSavedAssessment = async (operationKey: string) => {
    try {
      const { assessments: records } = await getPsychForPatient(selectedPatient);
      const matched = records.some(raw => {
        const record = raw as { client_operation_id?: string; assessed_by?: string };
        return record.client_operation_id === operationKey && record.assessed_by === user?.userId;
      });
      if (!matched) return false;
      setAssessments(records.map(toStoredAssessment(patients)));
      setHistoryError(''); setSaveError('');
      saveCommitted.current = true; setSaved(true);
      showSuccess(t('docPsych.saved'));
      return true;
    } catch (error) {
      console.error('Could not confirm psychiatric save through history:', error);
      setHistoryError(t('docPsych.historyLoadFailed'));
      return false;
    }
  };

  const handleSubmit = async () => {
    if (savePending.current || saveCommitted.current) return;
    if (!selectedPatient) {
      setSaveError(t('docPsych.errorSelectPatient'));
      showError(t('docPsych.errorSelectPatient'));
      return;
    }
    if (!disposition) {
      setSaveError('Select a disposition before saving the assessment.');
      showError('Select a disposition before saving the assessment.');
      return;
    }
    const draftError = validatePsychDraft(suicideRisk.priorAttempts, substances);
    if (draftError) {
      setSaveError(draftError); showError(draftError);
      return;
    }
    const apiDisposition: Record<string, string> = {
      discharge: 'DischargeHome',
      'admit-voluntary': 'InpatientAdmission',
      'admit-involuntary': 'InpatientAdmission',
      transfer: 'TransferToPsychFacility',
      'crisis-stabilization': 'CrisisStabilization',
      outpatient: 'OutpatientFollowUp',
    };
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const newAssessment: PsychAssessment = {
      id: `PSYCH-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      assessedBy: user?.userId || 'Unknown',
      assessedAt: new Date().toISOString(),
      chiefComplaint,
      historyOfPresentIllness: hpi,
      substanceUse: substances,
      medications: [],
      mentalStatusExam: mse,
      suicideRisk,
      homicideRisk,
      legalStatus,
      diagnoses: selectedDiagnoses,
      disposition: apiDisposition[disposition] as PsychAssessment['disposition'],
      safetyPlan,
      notes
    };
    // Retry timestamps and IDs must also match: the server compares the complete payload.
    const signature = JSON.stringify({ ...newAssessment, id: '', assessedAt: '' });
    if (saveOperation.current?.signature !== signature) {
      saveOperation.current = { signature, key: crypto.randomUUID(),
        id: newAssessment.id, assessedAt: newAssessment.assessedAt };
    }
    const operation = saveOperation.current;
    newAssessment.id = operation.id;
    newAssessment.assessedAt = operation.assessedAt;
    savePending.current = true;
    setSaveError('');
    setSaving(true);
    try {
      const result = await createPsych({
        assessment_id: newAssessment.id,
        patient_id: newAssessment.patientId,
        chief_complaint: newAssessment.chiefComplaint,
        history_of_present_illness: newAssessment.historyOfPresentIllness,
        diagnoses: newAssessment.diagnoses,
        legal_status: { admission_type: newAssessment.legalStatus || null },
        notes: newAssessment.notes,
        mental_status_exam: {
          appearance: newAssessment.mentalStatusExam.appearance,
          behavior: newAssessment.mentalStatusExam.behavior,
          speech: newAssessment.mentalStatusExam.speech,
          mood: newAssessment.mentalStatusExam.mood,
          affect: newAssessment.mentalStatusExam.affect,
          thought_process: newAssessment.mentalStatusExam.thoughtProcess,
          thought_content: newAssessment.mentalStatusExam.thoughtContent.join(', '),
          perceptions: newAssessment.mentalStatusExam.perceptions.join(', '),
          cognition: newAssessment.mentalStatusExam.cognition,
          insight: newAssessment.mentalStatusExam.insight,
          judgment: newAssessment.mentalStatusExam.judgment,
        },
        suicide_risk: {
          ideation: newAssessment.suicideRisk.ideation,
          ideation_description: null,
          plan: newAssessment.suicideRisk.plan,
          plan_description: null,
          intent: newAssessment.suicideRisk.intent,
          access_to_means: newAssessment.suicideRisk.means,
          means_description: null,
          prior_attempts: newAssessment.suicideRisk.priorAttempts === null ? null : newAssessment.suicideRisk.priorAttempts > 0,
          attempt_count: newAssessment.suicideRisk.priorAttempts,
          recent_attempt: newAssessment.suicideRisk.recentAttempt,
          recent_attempt_details: null,
          risk_factors: [],
          protective_factors: [],
          risk_level: ['unknown', 'none'].includes(newAssessment.suicideRisk.riskLevel) ? null : newAssessment.suicideRisk.riskLevel,
          cssrs_used: null,
          cssrs_score: null,
        },
        // Preserve the risk observations entered in this assessment.
        homicidal_risk: {
          ideation: newAssessment.homicideRisk.ideation,
          target_identified: newAssessment.homicideRisk.target,
          plan: newAssessment.homicideRisk.plan,
          access_to_weapons: newAssessment.homicideRisk.means,
          risk_level: ['unknown', 'none'].includes(newAssessment.homicideRisk.riskLevel) ? null : newAssessment.homicideRisk.riskLevel,
        },
        substance_use: {
          substances: newAssessment.substanceUse.map((item) => ({ ...item, last_use: item.lastUse })),
        },
        psych_history: {
          suicide_attempts: newAssessment.suicideRisk.priorAttempts,
        },
        safety_precautions: newAssessment.safetyPlan,
        disposition: newAssessment.disposition,
        safety_plan: newAssessment.safetyPlan.join(', ') || null,
        assessed_by: newAssessment.assessedBy,
        assessed_at: Math.floor(Date.parse(newAssessment.assessedAt) / 1000),
      }, operation.key) as { success?: boolean };
      if (result?.success === false) {
        throw new Error('Psychiatric assessment was not saved.');
      }
      saveCommitted.current = true;
      setSaved(true);
      // Re-read rather than prepending the object this page just built.
      // The optimistic entry showed the clinician their own input back, so a
      // field the API dropped -- and this handler flattens a psychiatric
      // history the form does not collect -- looked stored until the next
      // reload, by which time nobody connects the loss to the save.
      if (await refreshAssessments()) {
        showSuccess(t('docPsych.saved'));
      } else {
        setSaveError('The assessment was saved, but history could not be loaded. Open History and retry loading it.');
        showError('The assessment was saved, but history could not be loaded. Open History and retry loading it.');
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'IDEMPOTENCY_DUPLICATE'
        && await recoverSavedAssessment(operation.key)) return;
      console.error('Failed to save psychiatric assessment:', err);
      setSaveError('Save could not be confirmed. Your draft is retained. Retry without changing it to recover the original save.');
      showError('Psychiatric assessment save could not be confirmed.');
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-700 to-indigo-800 text-white p-6">
        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docPsych.title')}</h1>
            <p className="text-white">{t('docPsych.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Risk Alert Banner */}
      {(suicideRisk.riskLevel === 'high' || suicideRisk.riskLevel === 'imminent' ||
        homicideRisk.riskLevel === 'high' || homicideRisk.riskLevel === 'imminent') && (
          <div className="bg-critical text-critical-fg p-4 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6" />
            <span className="font-semibold">{t('docPsych.highRiskBanner')}</span>
            <Phone className="w-5 h-5 ml-auto" />
            <span>{t('docPsych.crisisLine')}</span>
          </div>
        )}

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {['assessment', 'history'].map(tab => (
            <button
              key={tab}
              disabled={saving}
              onClick={() => setActiveTab(tab as 'assessment' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-content-secondary border-b-2 border-purple-600'
                : 'text-content-muted hover:text-content-secondary'}`}
            >
              {tab === 'assessment' ? t('docPsych.tabAssessment') : t('docPsych.tabHistory')}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'assessment' ? (
          <div className="space-y-6">
          {saved && <div role="status" className="rounded border p-3">
            <p>Assessment saved. Start a new assessment to document another encounter.</p>
            <button onClick={startNewAssessment} className="mt-2 border rounded px-3 py-2">New assessment</button>
          </div>}
          <fieldset disabled={saving || saved} className="space-y-6" aria-busy={saving}>
            {saveError && <p role="alert" className="bg-critical-subtle text-critical-subtle-fg border border-critical rounded p-3">{saveError}</p>}
            {/* Patient Selection */}
            <div className="bg-surface rounded-lg shadow p-4">
              <label htmlFor="psych-patient" className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docPsych.patient')}
              </label>
              <PatientSelect
                id="psych-patient"
                value={selectedPatient}
                onChange={(selectedPatientId, patient) => {
                  if (patient) setPatients(previous => [...previous.filter(entry => entry.patient_id !== patient.patient_id), {
                    patient_id: patient.patient_id, full_name: patient.full_name,
                  }]);
                  setSelectedPatient(selectedPatientId);
                }}
              />
            </div>

            {/* Chief Complaint & HPI */}
            <div className="bg-surface rounded-lg shadow p-4">
              <label htmlFor="psych-chief-complaint" className="font-semibold mb-3 block">{t('docPsych.chiefComplaint')}</label>
              <input
                id="psych-chief-complaint"
                type="text"
                value={chiefComplaint}
                onChange={e => setChiefComplaint(e.target.value)}
                className="w-full border rounded p-2 mb-4"
                placeholder={t('docPsych.chiefComplaintPh')}
              />
              <label htmlFor="psych-hpi" className="font-semibold mb-3 block">{t('docPsych.hpi')}</label>
              <textarea
                id="psych-hpi"
                value={hpi}
                onChange={e => setHpi(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder={t('docPsych.hpiPh')}
              />
            </div>

            {/* Risk Assessment */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Suicide Risk */}
              <div className="bg-surface rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Shield className="w-5 h-5" /> {t('docPsych.suicideRiskTitle')}
                  </h2>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${riskLevelColors[suicideRisk.riskLevel]}`}>
                    {t(`docPsych.risk_${suicideRisk.riskLevel}`).toUpperCase()}
                  </span>
                </div>
                <div className="space-y-2">
                  {[
                    { key: 'ideation', label: t('docPsych.si_ideation') },
                    { key: 'plan', label: t('docPsych.si_plan') },
                    { key: 'intent', label: t('docPsych.si_intent') },
                    { key: 'means', label: t('docPsych.si_means') },
                    { key: 'recentAttempt', label: t('docPsych.si_recentAttempt') }
                  ].map(item => (
                    <ObservationSelect key={item.key} label={item.label}
                      value={suicideRisk[item.key as keyof SuicideRisk] as boolean | null}
                      onChange={value => setSuicideRisk({ ...suicideRisk, [item.key]: value })} />
                  ))}
                  <div className="flex items-center gap-2 mt-2">
                    <label htmlFor="psych-prior-attempts">{t('docPsych.priorAttempts')}</label>
                    <input
                      id="psych-prior-attempts"
                      type="number"
                      value={suicideRisk.priorAttempts ?? ''}
                      onChange={e => setSuicideRisk({ ...suicideRisk, priorAttempts: e.target.value === '' ? null : Number(e.target.value) })}
                      className="w-16 border rounded p-1"
                      min="0"
                    />
                  </div>
                </div>
              </div>

              {/* Homicide Risk */}
              <div className="bg-surface rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" /> {t('docPsych.homicideRiskTitle')}
                  </h2>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${riskLevelColors[homicideRisk.riskLevel]}`}>
                    {t(`docPsych.risk_${homicideRisk.riskLevel}`).toUpperCase()}
                  </span>
                </div>
                <div className="space-y-2">
                  {[
                    { key: 'ideation', label: t('docPsych.hi_ideation') },
                    { key: 'plan', label: t('docPsych.hi_plan') },
                    { key: 'target', label: t('docPsych.hi_target') },
                    { key: 'means', label: t('docPsych.hi_means') }
                  ].map(item => (
                    <ObservationSelect key={item.key} label={item.label}
                      value={homicideRisk[item.key as keyof HomicideRisk] as boolean | null}
                      onChange={value => setHomicideRisk({ ...homicideRisk, [item.key]: value })} />
                  ))}
                </div>
              </div>
            </div>

            {/* Mental Status Exam */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docPsych.mseTitle')}</h2>
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  { key: 'appearance', label: t('docPsych.mse_appearance') },
                  { key: 'behavior', label: t('docPsych.mse_behavior') },
                  { key: 'speech', label: t('docPsych.mse_speech') },
                  { key: 'mood', label: t('docPsych.mse_mood') },
                  { key: 'affect', label: t('docPsych.mse_affect') },
                  { key: 'thoughtProcess', label: t('docPsych.mse_thoughtProcess') },
                  { key: 'cognition', label: t('docPsych.mse_cognition') },
                  { key: 'insight', label: t('docPsych.mse_insight') },
                  { key: 'judgment', label: t('docPsych.mse_judgment') }
                ].map(field => (
                  <div key={field.key}>
                    <label htmlFor={`psych-mse-${field.key}`} className="text-sm text-content-muted">{field.label}</label>
                    <input
                      id={`psych-mse-${field.key}`}
                      type="text"
                      value={mse[field.key as keyof MentalStatusExam] as string}
                      onChange={e => setMse({ ...mse, [field.key]: e.target.value })}
                      className="w-full border rounded p-2"
                    />
                  </div>
                ))}
                <div className="md:col-span-2">
                  <label id="psych-thought-content-label" className="text-sm text-content-muted">{t('docPsych.thoughtContent')}</label>
                  <div className="flex flex-wrap gap-2 mt-1" role="group" aria-labelledby="psych-thought-content-label">
                    {['SI', 'HI', 'Paranoia', 'Delusions', 'Obsessions', 'Phobias'].map(item => (
                      <label key={item} className={`px-3 py-1 rounded border cursor-pointer ${mse.thoughtContent.includes(item) ? 'bg-surface-sunken border-purple-300' : 'bg-surface-sunken'}`}>
                        <input
                          type="checkbox"
                          checked={mse.thoughtContent.includes(item)}
                          onChange={e => {
                            if (e.target.checked) {
                              setMse({ ...mse, thoughtContent: [...mse.thoughtContent, item] });
                            } else {
                              setMse({ ...mse, thoughtContent: mse.thoughtContent.filter(x => x !== item) });
                            }
                          }}
                          className="mr-1"
                        />
                        {item}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label id="psych-perceptions-label" className="text-sm text-content-muted">{t('docPsych.perceptions')}</label>
                  <div className="flex flex-wrap gap-2 mt-1" role="group" aria-labelledby="psych-perceptions-label">
                    {['AVH', 'VH', 'AH', 'Illusions', 'Derealization', 'Depersonalization'].map(item => (
                      <label key={item} className={`px-3 py-1 rounded border cursor-pointer ${mse.perceptions.includes(item) ? 'bg-surface-sunken border-purple-300' : 'bg-surface-sunken'}`}>
                        <input
                          type="checkbox"
                          checked={mse.perceptions.includes(item)}
                          onChange={e => {
                            if (e.target.checked) {
                              setMse({ ...mse, perceptions: [...mse.perceptions, item] });
                            } else {
                              setMse({ ...mse, perceptions: mse.perceptions.filter(x => x !== item) });
                            }
                          }}
                          className="mr-1"
                        />
                        {item}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Substance Use */}
            <div className="bg-surface rounded-lg shadow p-4">
              <div className="flex justify-between items-center mb-3">
                <h2 className="font-semibold">{t('docPsych.substanceTitle')}</h2>
                <button onClick={addSubstance} disabled={substances.length >= MAX_SUBSTANCE_ROWS}
                  className="text-content-secondary hover:text-content-secondary flex items-center gap-1">
                  <Plus className="w-4 h-4" /> {t('docPsych.addBtn')}
                </button>
              </div>
              {substances.map((s, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                  <input
                    type="text"
                    value={s.substance}
                    aria-label={`${t('docPsych.phSubstance')} ${i + 1}`}
                    onChange={e => updateSubstance(i, 'substance', e.target.value)}
                    className="border rounded p-2"
                    placeholder={t('docPsych.phSubstance')}
                  />
                  <input
                    type="text"
                    value={s.frequency}
                    aria-label={`${t('docPsych.phFrequency')} ${i + 1}`}
                    onChange={e => updateSubstance(i, 'frequency', e.target.value)}
                    className="border rounded p-2"
                    placeholder={t('docPsych.phFrequency')}
                  />
                  <input
                    type="text"
                    value={s.lastUse}
                    aria-label={`${t('docPsych.phLastUse')} ${i + 1}`}
                    onChange={e => updateSubstance(i, 'lastUse', e.target.value)}
                    className="border rounded p-2"
                    placeholder={t('docPsych.phLastUse')}
                  />
                  <button onClick={() => setSubstances(previous => previous.filter((_, index) => index !== i))}
                    aria-label={t('docPsych.removeSubstance', { row: i + 1 })} className="text-content-secondary underline">
                    {t('docPsych.removeSubstance', { row: i + 1 })}
                  </button>
                </div>
              ))}
            </div>

            {/* Diagnoses */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docPsych.diagnosesTitle')}</h2>
              <div className="flex flex-wrap gap-2">
                {psychiatricDiagnoses.map(dx => (
                  <label key={dx} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedDiagnoses.includes(dx) ? 'bg-surface-sunken border-purple-300' : 'bg-surface-sunken'}`}>
                    <input
                      type="checkbox"
                      checked={selectedDiagnoses.includes(dx)}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedDiagnoses([...selectedDiagnoses, dx]);
                        } else {
                          setSelectedDiagnoses(selectedDiagnoses.filter(d => d !== dx));
                        }
                      }}
                      className="mr-1"
                    />
                    {dx}
                  </label>
                ))}
              </div>
            </div>

            {/* Legal Status & Disposition */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-surface rounded-lg shadow p-4">
                <label htmlFor="psych-legal-status" className="font-semibold mb-3 block">{t('docPsych.legalStatus')}</label>
                <select
                  id="psych-legal-status"
                  value={legalStatus}
                  onChange={e => setLegalStatus(e.target.value as LegalStatus)}
                  className="w-full border rounded p-2"
                >
                  <option value="">{t('docPsych.notAssessed')}</option>
                  <option value="voluntary">{t('docPsych.legal_voluntary')}</option>
                  <option value="involuntary">{t('docPsych.legal_involuntary')}</option>
                  <option value="5150">{t('docPsych.legal_5150')}</option>
                  <option value="5250">{t('docPsych.legal_5250')}</option>
                  <option value="conservatorship">{t('docPsych.legal_conservatorship')}</option>
                </select>
              </div>
              <div className="bg-surface rounded-lg shadow p-4">
                <label htmlFor="psych-disposition" className="font-semibold mb-3 block">{t('docPsych.disposition')}</label>
                <select
                  id="psych-disposition"
                  value={disposition}
                  onChange={e => setDisposition(e.target.value)}
                  className="w-full border rounded p-2"
                >
                  <option value="">{t('docPsych.dispSelect')}</option>
                  <option value="discharge">{t('docPsych.disp_discharge')}</option>
                  <option value="admit-voluntary">{t('docPsych.disp_admitVoluntary')}</option>
                  <option value="admit-involuntary">{t('docPsych.disp_admitInvoluntary')}</option>
                  <option value="transfer">{t('docPsych.disp_transfer')}</option>
                  <option value="crisis-stabilization">{t('docPsych.disp_crisis')}</option>
                  <option value="outpatient">{t('docPsych.disp_outpatient')}</option>
                </select>
              </div>
            </div>

            {/* Safety Plan */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docPsych.safetyPlanTitle')}</h2>
              <div className="space-y-2">
                {['Remove access to lethal means', 'Crisis hotline: 988', 'Emergency contact notified',
                  'Follow-up appointment scheduled', 'Medications reviewed', '1:1 observation ordered'].map(item => (
                    <label key={item} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={safetyPlan.includes(item)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSafetyPlan([...safetyPlan, item]);
                          } else {
                            setSafetyPlan(safetyPlan.filter(x => x !== item));
                          }
                        }}
                      />
                      {item}
                    </label>
                  ))}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-surface rounded-lg shadow p-4">
              <label htmlFor="psych-notes" className="font-semibold mb-3 block">{t('docPsych.notesTitle')}</label>
              <textarea
                id="psych-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder={t('docPsych.notesPh')}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={saving || saved}
              aria-busy={saving}
              className="w-full py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700"
            >
              {t('docPsych.save')}
            </button>
          </fieldset>
          </div>
        ) : (
          <div className="space-y-4">
            <PatientSelect id="psych-history-patient" label="Patient for history" value={selectedPatient}
              onChange={(patientId, patient) => {
                if (patient) setPatients(previous => [...previous.filter(entry => entry.patient_id !== patient.patient_id), {
                  patient_id: patient.patient_id, full_name: patient.full_name,
                }]);
                setSelectedPatient(patientId);
              }} />
            {historyError && (
              <div className="bg-critical-subtle border border-critical text-critical-subtle-fg rounded-lg p-3 text-sm">
                {historyError}
                <button onClick={() => { void refreshAssessments(); }} className="block mt-2 underline">
                  Retry loading history
                </button>
              </div>
            )}
            {assessments.length === 0 ? (
              <div className="text-center py-8 text-content-muted">
                {!selectedPatient ? 'Select a patient to view their assessments' :
                  historyError ? t('docPsych.historyUnknown') : t('docPsych.noAssessments')}
              </div>
            ) : (
              assessments.map(a => (
                <div key={a.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{a.patientName}</h3>
                      <p className="text-sm text-content-muted">{formatTimestamp(a.assessedAt)}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className={`px-2 py-1 text-xs rounded ${riskLevelColors[a.suicideRisk.riskLevel]}`}>
                        {t('docPsych.siBadge', { level: t(`docPsych.risk_${a.suicideRisk.riskLevel}`) })}
                      </span>
                      <span className={`px-2 py-1 text-xs rounded ${riskLevelColors[a.homicideRisk.riskLevel]}`}>
                        {t('docPsych.hiBadge', { level: t(`docPsych.risk_${a.homicideRisk.riskLevel}`) })}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm"><strong>{t('docPsych.lblCC')}</strong> {a.chiefComplaint}</p>
                  <p className="text-sm"><strong>{t('docPsych.lblDiagnoses')}</strong> {a.diagnoses.join(', ') || 'No diagnoses recorded'}</p>
                  <p className="text-sm"><strong>{t('docPsych.lblDisposition')}</strong> {dispositionLabel(a.disposition)}</p>
                  {a.historyOfPresentIllness && <p className="text-sm whitespace-pre-wrap">{a.historyOfPresentIllness}</p>}
                  {a.safetyPlan.length > 0 && <ul className="list-disc pl-5 text-sm">
                    {a.safetyPlan.map(item => <li key={item}>{item}</li>)}
                  </ul>}
                  {a.notes && <p className="text-sm whitespace-pre-wrap">{a.notes}</p>}
                  <AssessmentDetails assessment={a} />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PsychPage;
