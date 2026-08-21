import { useState, useEffect } from 'react';
import { Brain, AlertTriangle, Shield, User, Plus, Phone } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { getPatients, createPsych, getPsychForPatient, useTranslation } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';

type RiskLevel = 'none' | 'low' | 'moderate' | 'high' | 'imminent';
type LegalStatus = 'voluntary' | 'involuntary' | '5150' | '5250' | 'conservatorship';

interface SuicideRisk {
  ideation: boolean;
  plan: boolean;
  intent: boolean;
  means: boolean;
  priorAttempts: number;
  recentAttempt: boolean;
  riskLevel: RiskLevel;
}

interface HomicideRisk {
  ideation: boolean;
  plan: boolean;
  target: boolean;
  means: boolean;
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
  psychiatricHistory: string[];
  substanceUse: { substance: string; frequency: string; lastUse: string }[];
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
  none: 'bg-surface-sunken text-content-secondary',
  low: 'bg-ok-subtle text-ok-subtle-fg',
  moderate: 'bg-caution-subtle text-caution-subtle-fg',
  high: 'bg-surface-sunken text-content-secondary',
  imminent: 'bg-critical-subtle text-critical-subtle-fg'
};

/** Coerce a stored risk level onto the union the badge colours are keyed by. */
function toRiskLevel(value: unknown): RiskLevel {
  const level = String(value ?? '').toLowerCase();
  return (['none', 'low', 'moderate', 'high', 'imminent'] as const).includes(level as RiskLevel)
    ? (level as RiskLevel)
    : 'none';
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
    const item = raw as Record<string, any>;
    const suicide = item.suicide_risk ?? {};
    const homicide = item.homicidal_risk ?? {};
    const mse = item.mental_status ?? {};
    const asList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.map(String)
        : typeof value === 'string' && value.trim()
          ? value.split(',').map((s) => s.trim()).filter(Boolean)
          : [];
    const legal = String(item.legal_status?.admission_type ?? 'voluntary').toLowerCase();
    return {
      historyOfPresentIllness: item.history_of_present_illness ?? '',
      psychiatricHistory: asList(item.psych_history?.diagnoses),
      substanceUse: (item.substance_use?.substances ?? []).map((s: any) => ({
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
      legalStatus: (['voluntary', 'involuntary', '5150', '5250', 'conservatorship'] as const).includes(
        legal as LegalStatus
      )
        ? (legal as LegalStatus)
        : 'voluntary',
      diagnoses: asList(item.diagnoses),
      safetyPlan: asList(item.safety_plan),
      notes: item.notes ?? '',
      id: item.assessment_id,
      patientId: item.patient_id,
      chiefComplaint: item.chief_complaint,
      assessedBy: item.assessed_by,
      assessedAt: new Date((item.assessed_at ?? 0) * 1000).toISOString(),
      disposition: item.disposition,
      patientName:
        patients.find((patient) => patient.patient_id === item.patient_id)?.full_name ||
        item.patient_id,
      suicideRisk: {
        ideation: Boolean(suicide.ideation),
        plan: Boolean(suicide.plan),
        intent: Boolean(suicide.intent),
        means: Boolean(suicide.access_to_means),
        priorAttempts: Number(suicide.attempt_count ?? 0),
        recentAttempt: Boolean(suicide.recent_attempt_details),
        riskLevel: toRiskLevel(suicide.risk_level),
      },
      homicideRisk: {
        ideation: Boolean(homicide.ideation),
        target: Boolean(homicide.target_identified),
        plan: Boolean(homicide.plan),
        means: Boolean(homicide.access_to_weapons),
        riskLevel: toRiskLevel(homicide.risk_level),
      },
    };
  };
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
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [assessments, setAssessments] = useState<PsychAssessment[]>([]);
  const [activeTab, setActiveTab] = useState<'assessment' | 'history'>('assessment');
  const [selectedPatient, setSelectedPatient] = useState('');

  const [chiefComplaint, setChiefComplaint] = useState('');
  const [hpi, setHpi] = useState('');
  const [psychHistory, _setPsychHistory] = useState<string[]>([]);
  const [substances, setSubstances] = useState<{ substance: string; frequency: string; lastUse: string }[]>([]);
  const [selectedDiagnoses, setSelectedDiagnoses] = useState<string[]>([]);
  const [legalStatus, setLegalStatus] = useState<LegalStatus>('voluntary');
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');

  const [mse, setMse] = useState<MentalStatusExam>({
    appearance: 'Well-groomed, appropriate dress',
    behavior: 'Calm, cooperative',
    speech: 'Normal rate, rhythm, volume',
    mood: '',
    affect: 'Congruent, full range',
    thoughtProcess: 'Linear, goal-directed',
    thoughtContent: [],
    perceptions: [],
    cognition: 'Alert and oriented x4',
    insight: 'Fair',
    judgment: 'Fair'
  });

  const [suicideRisk, setSuicideRisk] = useState<SuicideRisk>({
    ideation: false, plan: false, intent: false, means: false,
    priorAttempts: 0, recentAttempt: false, riskLevel: 'none'
  });

  const [homicideRisk, setHomicideRisk] = useState<HomicideRisk>({
    ideation: false, plan: false, target: false, means: false, riskLevel: 'none'
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

  useEffect(() => {
    if (!selectedPatient) return;
    getPsychForPatient(selectedPatient)
      .then(({ assessments: saved }) => {
        setAssessments(saved.map(toStoredAssessment(patients)));
      })
      .catch((err) => console.error('Failed to load psychiatric assessments:', err));
  }, [selectedPatient, patients]);

  // Auto-calculate suicide risk
  useEffect(() => {
    let level: RiskLevel = 'none';
    if (suicideRisk.ideation) level = 'low';
    if (suicideRisk.plan) level = 'moderate';
    if (suicideRisk.intent || suicideRisk.means) level = 'high';
    if (suicideRisk.recentAttempt || (suicideRisk.plan && suicideRisk.intent && suicideRisk.means)) level = 'imminent';
    setSuicideRisk(prev => ({ ...prev, riskLevel: level }));
  }, [suicideRisk.ideation, suicideRisk.plan, suicideRisk.intent, suicideRisk.means, suicideRisk.recentAttempt]);

  // Auto-calculate homicide risk
  useEffect(() => {
    let level: RiskLevel = 'none';
    if (homicideRisk.ideation) level = 'low';
    if (homicideRisk.plan || homicideRisk.target) level = 'moderate';
    if (homicideRisk.means) level = 'high';
    if (homicideRisk.plan && homicideRisk.target && homicideRisk.means) level = 'imminent';
    setHomicideRisk(prev => ({ ...prev, riskLevel: level }));
  }, [homicideRisk.ideation, homicideRisk.plan, homicideRisk.target, homicideRisk.means]);

  const addSubstance = () => {
    setSubstances([...substances, { substance: '', frequency: '', lastUse: '' }]);
  };

  const handleSubmit = async () => {
    if (!selectedPatient) {
      showWarning(t('docPsych.warnSelectPatient'));
      return;
    }
    if (!disposition) {
      showWarning('Select a disposition before saving the assessment.');
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
      psychiatricHistory: psychHistory,
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
    try {
      const result = await createPsych({
        assessment_id: newAssessment.id,
        patient_id: newAssessment.patientId,
        chief_complaint: newAssessment.chiefComplaint,
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
          prior_attempts: newAssessment.suicideRisk.priorAttempts > 0,
          attempt_count: newAssessment.suicideRisk.priorAttempts || null,
          recent_attempt_details: null,
          risk_factors: [],
          protective_factors: [],
          risk_level: newAssessment.suicideRisk.riskLevel === 'none' ? 'Low' : newAssessment.suicideRisk.riskLevel[0].toUpperCase() + newAssessment.suicideRisk.riskLevel.slice(1),
          cssrs_used: false,
          cssrs_score: null,
        },
        homicidal_risk: {
          ideation: newAssessment.homicideRisk.ideation,
          target_identified: newAssessment.homicideRisk.target,
          target_description: null,
          plan: newAssessment.homicideRisk.plan,
          access_to_weapons: newAssessment.homicideRisk.means,
          history_of_violence: false,
          risk_level: newAssessment.homicideRisk.riskLevel,
          duty_to_warn: false,
          law_enforcement_notified: false,
        },
        substance_use: {
          currently_intoxicated: false,
          substances: newAssessment.substanceUse.map((item) => ({ ...item, route: '', amount: null, last_use: item.lastUse })),
          in_withdrawal: false,
          withdrawal_symptoms: [],
          withdrawal_score: null,
          withdrawal_protocol: false,
        },
        psych_history: {
          diagnoses: newAssessment.psychiatricHistory,
          hospitalizations: 0,
          suicide_attempts: newAssessment.suicideRisk.priorAttempts,
          self_harm_history: false,
          trauma_history: null,
          family_history: [],
        },
        psych_medications: newAssessment.medications,
        medication_compliant: null,
        social_history: {
          living_situation: '',
          support_system: '',
          employment: '',
          recent_stressors: [],
          legal_issues: null,
          financial_issues: null,
        },
        legal_status: { admission_type: 'Voluntary', hold_type: null, hold_expiration: null, court_hearing: null, guardian: null },
        safety_precautions: [],
        disposition: newAssessment.disposition,
        safety_plan: null,
        assessed_by: newAssessment.assessedBy,
        assessed_at: Math.floor(Date.now() / 1000),
      }) as { success?: boolean };
      if (result?.success === false) {
        throw new Error('Psychiatric assessment was not saved.');
      }
      setAssessments([newAssessment, ...assessments]);
      showSuccess(t('docPsych.saved'));
    } catch (err) {
      console.error('Failed to save psychiatric assessment:', err);
      showError('Psychiatric assessment could not be saved.');
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6">
        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docPsych.title')}</h1>
            <p className="text-purple-100">{t('docPsych.subtitle')}</p>
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
            {/* Patient Selection */}
            <div className="bg-surface rounded-lg shadow p-4">
              <label htmlFor="psych-patient" className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docPsych.patient')}
              </label>
              <select
                id="psych-patient"
                value={selectedPatient}
                onChange={e => setSelectedPatient(e.target.value)}
                className="w-full border rounded p-2"
              >
                <option value="">{t('docPsych.selectPatient')}</option>
                {patients.map(p => (
                  <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                ))}
              </select>
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
                    <label key={item.key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={suicideRisk[item.key as keyof SuicideRisk] as boolean}
                        onChange={e => setSuicideRisk({ ...suicideRisk, [item.key]: e.target.checked })}
                      />
                      {item.label}
                    </label>
                  ))}
                  <div className="flex items-center gap-2 mt-2">
                    <label htmlFor="psych-prior-attempts">{t('docPsych.priorAttempts')}</label>
                    <input
                      id="psych-prior-attempts"
                      type="number"
                      value={suicideRisk.priorAttempts}
                      onChange={e => setSuicideRisk({ ...suicideRisk, priorAttempts: Number(e.target.value) })}
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
                    <label key={item.key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={homicideRisk[item.key as keyof HomicideRisk] as boolean}
                        onChange={e => setHomicideRisk({ ...homicideRisk, [item.key]: e.target.checked })}
                      />
                      {item.label}
                    </label>
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
                <button onClick={addSubstance} className="text-content-secondary hover:text-content-secondary flex items-center gap-1">
                  <Plus className="w-4 h-4" /> {t('docPsych.addBtn')}
                </button>
              </div>
              {substances.map((s, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                  <input
                    type="text"
                    value={s.substance}
                    onChange={e => {
                      const updated = [...substances];
                      updated[i].substance = e.target.value;
                      setSubstances(updated);
                    }}
                    className="border rounded p-2"
                    placeholder={t('docPsych.phSubstance')}
                  />
                  <input
                    type="text"
                    value={s.frequency}
                    onChange={e => {
                      const updated = [...substances];
                      updated[i].frequency = e.target.value;
                      setSubstances(updated);
                    }}
                    className="border rounded p-2"
                    placeholder={t('docPsych.phFrequency')}
                  />
                  <input
                    type="text"
                    value={s.lastUse}
                    onChange={e => {
                      const updated = [...substances];
                      updated[i].lastUse = e.target.value;
                      setSubstances(updated);
                    }}
                    className="border rounded p-2"
                    placeholder={t('docPsych.phLastUse')}
                  />
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
              className="w-full py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700"
            >
              {t('docPsych.save')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {assessments.length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docPsych.noAssessments')}</div>
            ) : (
              assessments.map(a => (
                <div key={a.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{a.patientName}</h3>
                      <p className="text-sm text-content-muted">{new Date(a.assessedAt).toLocaleString()}</p>
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
                  <p className="text-sm"><strong>{t('docPsych.lblDiagnoses')}</strong> {a.diagnoses.join(', ') || t('docPsych.diagnosesNone')}</p>
                  <p className="text-sm"><strong>{t('docPsych.lblDisposition')}</strong> {a.disposition}</p>
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
