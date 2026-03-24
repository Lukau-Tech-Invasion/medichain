import { useState, useEffect } from 'react';
import { Brain, AlertTriangle, Shield, User, Plus, Phone } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { getPatients, createPsych } from '@medichain/shared';
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
  none: 'bg-gray-100 text-gray-700',
  low: 'bg-green-100 text-green-700',
  moderate: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  imminent: 'bg-red-100 text-red-700'
};

const psychiatricDiagnoses = [
  'Major Depressive Disorder', 'Bipolar I Disorder', 'Bipolar II Disorder',
  'Generalized Anxiety Disorder', 'Panic Disorder', 'PTSD',
  'Schizophrenia', 'Schizoaffective Disorder', 'Brief Psychotic Disorder',
  'Borderline Personality Disorder', 'Antisocial Personality Disorder',
  'Substance Use Disorder', 'Alcohol Use Disorder', 'Opioid Use Disorder',
  'ADHD', 'Autism Spectrum Disorder', 'Eating Disorder', 'OCD'
];

const PsychPage: React.FC = () => {
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
      showWarning('Please select a patient');
      return;
    }
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
      disposition,
      safetyPlan,
      notes
    };
    try {
      await createPsych(newAssessment);
    } catch (err) {
      console.error('Failed to save psychiatric assessment:', err);
    }
    setAssessments([newAssessment, ...assessments]);
    showSuccess('Psychiatric assessment saved!');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6">
        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">Psychiatric Assessment</h1>
            <p className="text-purple-100">Mental status exam and risk assessment</p>
          </div>
        </div>
      </div>

      {/* Risk Alert Banner */}
      {(suicideRisk.riskLevel === 'high' || suicideRisk.riskLevel === 'imminent' ||
        homicideRisk.riskLevel === 'high' || homicideRisk.riskLevel === 'imminent') && (
          <div className="bg-red-600 text-white p-4 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6" />
            <span className="font-semibold">HIGH RISK PATIENT - Implement safety precautions immediately</span>
            <Phone className="w-5 h-5 ml-auto" />
            <span>Crisis Line: 988</span>
          </div>
        )}

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {['assessment', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'assessment' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'assessment' ? (
          <div className="space-y-6">
            {/* Patient Selection */}
            <div className="bg-white rounded-lg shadow p-4">
              <label htmlFor="psych-patient" className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> Patient
              </label>
              <select
                id="psych-patient"
                value={selectedPatient}
                onChange={e => setSelectedPatient(e.target.value)}
                className="w-full border rounded p-2"
              >
                <option value="">Select patient...</option>
                {patients.map(p => (
                  <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                ))}
              </select>
            </div>

            {/* Chief Complaint & HPI */}
            <div className="bg-white rounded-lg shadow p-4">
              <label htmlFor="psych-chief-complaint" className="font-semibold mb-3 block">Chief Complaint</label>
              <input
                id="psych-chief-complaint"
                type="text"
                value={chiefComplaint}
                onChange={e => setChiefComplaint(e.target.value)}
                className="w-full border rounded p-2 mb-4"
                placeholder="Patient's main concern..."
              />
              <label htmlFor="psych-hpi" className="font-semibold mb-3 block">History of Present Illness</label>
              <textarea
                id="psych-hpi"
                value={hpi}
                onChange={e => setHpi(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder="Detailed history..."
              />
            </div>

            {/* Risk Assessment */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Suicide Risk */}
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Shield className="w-5 h-5" /> Suicide Risk Assessment
                  </h2>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${riskLevelColors[suicideRisk.riskLevel]}`}>
                    {suicideRisk.riskLevel.toUpperCase()}
                  </span>
                </div>
                <div className="space-y-2">
                  {[
                    { key: 'ideation', label: 'Suicidal ideation' },
                    { key: 'plan', label: 'Has specific plan' },
                    { key: 'intent', label: 'Intent to act' },
                    { key: 'means', label: 'Access to means' },
                    { key: 'recentAttempt', label: 'Recent attempt (past 30 days)' }
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
                    <label htmlFor="psych-prior-attempts">Prior attempts:</label>
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
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" /> Homicide Risk Assessment
                  </h2>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${riskLevelColors[homicideRisk.riskLevel]}`}>
                    {homicideRisk.riskLevel.toUpperCase()}
                  </span>
                </div>
                <div className="space-y-2">
                  {[
                    { key: 'ideation', label: 'Homicidal ideation' },
                    { key: 'plan', label: 'Has specific plan' },
                    { key: 'target', label: 'Identified target' },
                    { key: 'means', label: 'Access to means' }
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
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Mental Status Examination</h2>
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  { key: 'appearance', label: 'Appearance' },
                  { key: 'behavior', label: 'Behavior' },
                  { key: 'speech', label: 'Speech' },
                  { key: 'mood', label: 'Mood (patient states)' },
                  { key: 'affect', label: 'Affect (observed)' },
                  { key: 'thoughtProcess', label: 'Thought Process' },
                  { key: 'cognition', label: 'Cognition' },
                  { key: 'insight', label: 'Insight' },
                  { key: 'judgment', label: 'Judgment' }
                ].map(field => (
                  <div key={field.key}>
                    <label htmlFor={`psych-mse-${field.key}`} className="text-sm text-gray-600">{field.label}</label>
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
                  <label id="psych-thought-content-label" className="text-sm text-gray-600">Thought Content (select all that apply)</label>
                  <div className="flex flex-wrap gap-2 mt-1" role="group" aria-labelledby="psych-thought-content-label">
                    {['SI', 'HI', 'Paranoia', 'Delusions', 'Obsessions', 'Phobias'].map(item => (
                      <label key={item} className={`px-3 py-1 rounded border cursor-pointer ${mse.thoughtContent.includes(item) ? 'bg-purple-100 border-purple-300' : 'bg-gray-50'}`}>
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
                  <label id="psych-perceptions-label" className="text-sm text-gray-600">Perceptions</label>
                  <div className="flex flex-wrap gap-2 mt-1" role="group" aria-labelledby="psych-perceptions-label">
                    {['AVH', 'VH', 'AH', 'Illusions', 'Derealization', 'Depersonalization'].map(item => (
                      <label key={item} className={`px-3 py-1 rounded border cursor-pointer ${mse.perceptions.includes(item) ? 'bg-purple-100 border-purple-300' : 'bg-gray-50'}`}>
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
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-center mb-3">
                <h2 className="font-semibold">Substance Use History</h2>
                <button onClick={addSubstance} className="text-purple-600 hover:text-purple-700 flex items-center gap-1">
                  <Plus className="w-4 h-4" /> Add
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
                    placeholder="Substance"
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
                    placeholder="Frequency"
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
                    placeholder="Last use"
                  />
                </div>
              ))}
            </div>

            {/* Diagnoses */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Diagnoses</h2>
              <div className="flex flex-wrap gap-2">
                {psychiatricDiagnoses.map(dx => (
                  <label key={dx} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedDiagnoses.includes(dx) ? 'bg-purple-100 border-purple-300' : 'bg-gray-50'}`}>
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
              <div className="bg-white rounded-lg shadow p-4">
                <label htmlFor="psych-legal-status" className="font-semibold mb-3 block">Legal Status</label>
                <select
                  id="psych-legal-status"
                  value={legalStatus}
                  onChange={e => setLegalStatus(e.target.value as LegalStatus)}
                  className="w-full border rounded p-2"
                >
                  <option value="voluntary">Voluntary</option>
                  <option value="involuntary">Involuntary</option>
                  <option value="5150">5150 Hold (72hr)</option>
                  <option value="5250">5250 Hold (14 day)</option>
                  <option value="conservatorship">Conservatorship</option>
                </select>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <label htmlFor="psych-disposition" className="font-semibold mb-3 block">Disposition</label>
                <select
                  id="psych-disposition"
                  value={disposition}
                  onChange={e => setDisposition(e.target.value)}
                  className="w-full border rounded p-2"
                >
                  <option value="">Select...</option>
                  <option value="discharge">Discharge home</option>
                  <option value="admit-voluntary">Admit - Voluntary</option>
                  <option value="admit-involuntary">Admit - Involuntary</option>
                  <option value="transfer">Transfer to psychiatric facility</option>
                  <option value="crisis-stabilization">Crisis stabilization unit</option>
                  <option value="outpatient">Outpatient follow-up</option>
                </select>
              </div>
            </div>

            {/* Safety Plan */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Safety Plan</h2>
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
            <div className="bg-white rounded-lg shadow p-4">
              <label htmlFor="psych-notes" className="font-semibold mb-3 block">Additional Notes</label>
              <textarea
                id="psych-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder="Clinical notes..."
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700"
            >
              Save Assessment
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {assessments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No assessments yet</div>
            ) : (
              assessments.map(a => (
                <div key={a.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{a.patientName}</h3>
                      <p className="text-sm text-gray-500">{new Date(a.assessedAt).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className={`px-2 py-1 text-xs rounded ${riskLevelColors[a.suicideRisk.riskLevel]}`}>
                        SI: {a.suicideRisk.riskLevel}
                      </span>
                      <span className={`px-2 py-1 text-xs rounded ${riskLevelColors[a.homicideRisk.riskLevel]}`}>
                        HI: {a.homicideRisk.riskLevel}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm"><strong>CC:</strong> {a.chiefComplaint}</p>
                  <p className="text-sm"><strong>Diagnoses:</strong> {a.diagnoses.join(', ') || 'None'}</p>
                  <p className="text-sm"><strong>Disposition:</strong> {a.disposition}</p>
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
