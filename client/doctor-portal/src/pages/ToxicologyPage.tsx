import React, { useState, useEffect } from 'react';
import { Skull, Pill, Clock, User, Phone, Droplet } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { getPatients, createTox } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';

type Severity = 'mild' | 'moderate' | 'severe' | 'life-threatening';
type ExposureRoute = 'oral' | 'inhalation' | 'dermal' | 'injection' | 'ocular' | 'unknown';

interface ToxScreen {
  amphetamines: boolean;
  barbiturates: boolean;
  benzodiazepines: boolean;
  cannabinoids: boolean;
  cocaine: boolean;
  opiates: boolean;
  pcp: boolean;
  methadone: boolean;
  fentanyl: boolean;
  ethanol: number | null;
  acetaminophen: number | null;
  salicylate: number | null;
  lithium: number | null;
  digoxin: number | null;
}

interface ToxCase {
  id: string;
  patientId: string;
  patientName: string;
  assessedBy: string;
  assessedAt: string;
  substance: string;
  amount: string;
  timeOfExposure: string;
  route: ExposureRoute;
  intentional: boolean;
  severity: Severity;
  symptoms: string[];
  toxScreen: ToxScreen;
  antidotesGiven: { name: string; dose: string; time: string }[];
  decontamination: string[];
  labsOrdered: string[];
  disposition: string;
  poisonControlCalled: boolean;
  poisonControlCaseNumber: string;
  notes: string;
}

const severityColors: Record<Severity, string> = {
  mild: 'bg-green-100 text-green-700',
  moderate: 'bg-yellow-100 text-yellow-700',
  severe: 'bg-orange-100 text-orange-700',
  'life-threatening': 'bg-red-100 text-red-700'
};

const commonSubstances = [
  'Acetaminophen', 'Aspirin/Salicylates', 'Opioids', 'Benzodiazepines',
  'Tricyclic antidepressants', 'SSRIs', 'Beta blockers', 'Calcium channel blockers',
  'Digoxin', 'Lithium', 'Warfarin', 'Iron', 'Methanol', 'Ethylene glycol',
  'Carbon monoxide', 'Organophosphates', 'Mushrooms', 'Unknown'
];

const antidotes = [
  { substance: 'Acetaminophen', antidote: 'N-acetylcysteine (NAC)', doses: ['150mg/kg IV', '140mg/kg PO'] },
  { substance: 'Opioids', antidote: 'Naloxone', doses: ['0.4mg IV', '2mg IV', '4mg IN'] },
  { substance: 'Benzodiazepines', antidote: 'Flumazenil', doses: ['0.2mg IV'] },
  { substance: 'Beta blockers', antidote: 'Glucagon', doses: ['3-5mg IV', '10mg IV'] },
  { substance: 'Calcium channel blockers', antidote: 'Calcium gluconate', doses: ['1-3g IV'] },
  { substance: 'Digoxin', antidote: 'Digibind', doses: ['Based on level'] },
  { substance: 'TCAs', antidote: 'Sodium bicarbonate', doses: ['1-2 mEq/kg IV'] },
  { substance: 'Organophosphates', antidote: 'Atropine', doses: ['2mg IV', 'Pralidoxime 1-2g IV'] },
  { substance: 'Methanol/EG', antidote: 'Fomepizole', doses: ['15mg/kg IV'] },
  { substance: 'Iron', antidote: 'Deferoxamine', doses: ['15mg/kg/hr IV'] },
  { substance: 'Carbon monoxide', antidote: 'Oxygen 100%', doses: ['High-flow', 'Hyperbaric'] }
];

const symptoms = [
  'Altered mental status', 'Seizures', 'Respiratory depression', 'Tachycardia', 'Bradycardia',
  'Hypotension', 'Hypertension', 'Hyperthermia', 'Hypothermia', 'Mydriasis', 'Miosis',
  'Diaphoresis', 'Nausea/Vomiting', 'Abdominal pain', 'Metabolic acidosis', 'QRS prolongation',
  'QTc prolongation', 'Rhabdomyolysis', 'Renal failure', 'Hepatotoxicity'
];

const decontaminationMethods = [
  'Activated charcoal', 'Whole bowel irrigation', 'Gastric lavage', 'Skin decontamination',
  'Eye irrigation', 'Hemodialysis', 'Hemoperfusion', 'None indicated'
];

const ToxicologyPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [cases, setCases] = useState<ToxCase[]>([]);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [selectedPatient, setSelectedPatient] = useState('');

  const [substance, setSubstance] = useState('');
  const [amount, setAmount] = useState('');
  const [timeOfExposure, setTimeOfExposure] = useState('');
  const [route, setRoute] = useState<ExposureRoute>('oral');
  const [intentional, setIntentional] = useState(false);
  const [severity, setSeverity] = useState<Severity>('mild');
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [selectedDecon, setSelectedDecon] = useState<string[]>([]);
  const [givenAntidotes, setGivenAntidotes] = useState<{ name: string; dose: string; time: string }[]>([]);
  const [disposition, setDisposition] = useState('');
  const [poisonControlCalled, setPoisonControlCalled] = useState(false);
  const [caseNumber, setCaseNumber] = useState('');
  const [notes, setNotes] = useState('');

  const [toxScreen, setToxScreen] = useState<ToxScreen>({
    amphetamines: false, barbiturates: false, benzodiazepines: false,
    cannabinoids: false, cocaine: false, opiates: false, pcp: false,
    methadone: false, fentanyl: false, ethanol: null, acetaminophen: null,
    salicylate: null, lithium: null, digoxin: null
  });

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

  const addAntidote = (name: string, dose: string) => {
    setGivenAntidotes([...givenAntidotes, { name, dose, time: new Date().toLocaleTimeString() }]);
  };

  const handleSubmit = async () => {
    if (!selectedPatient || !substance) {
      showWarning('Please select patient and substance');
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const newCase: ToxCase = {
      id: `TOX-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      assessedBy: user?.userId || 'Unknown',
      assessedAt: new Date().toISOString(),
      substance, amount, timeOfExposure, route, intentional, severity,
      symptoms: selectedSymptoms,
      toxScreen,
      antidotesGiven: givenAntidotes,
      decontamination: selectedDecon,
      labsOrdered: [],
      disposition,
      poisonControlCalled,
      poisonControlCaseNumber: caseNumber,
      notes
    };
    try {
      await createTox(newCase);
    } catch (err) {
      console.error('Failed to save toxicology case:', err);
    }
    setCases([newCase, ...cases]);
    showSuccess('Toxicology case saved!');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-rose-600 text-white p-6">
        <div className="flex items-center gap-3">
          <Skull className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">Toxicology / Overdose</h1>
            <p className="text-red-100">Poisoning assessment and antidote management</p>
          </div>
        </div>
      </div>

      {/* Poison Control Banner */}
      <div className="bg-blue-600 text-white p-3 flex items-center gap-3">
        <Phone className="w-5 h-5" />
        <span className="font-semibold">Poison Control: 1-800-222-1222</span>
        <span className="text-blue-200 text-sm ml-4">Available 24/7 for expert toxicology consultation</span>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {['new', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'new' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-red-600 border-b-2 border-red-600'
                : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'new' ? 'New Case' : 'History'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'new' ? (
          <div className="space-y-6">
            {/* Patient & Exposure */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> Exposure Information
              </h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="tox-patient" className="text-sm text-gray-600">Patient</label>
                  <select
                    id="tox-patient"
                    value={selectedPatient}
                    onChange={e => setSelectedPatient(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">Select...</option>
                    {patients.map(p => (
                      <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="tox-substance" className="text-sm text-gray-600">Substance</label>
                  <select
                    id="tox-substance"
                    value={substance}
                    onChange={e => setSubstance(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">Select...</option>
                    {commonSubstances.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="tox-amount" className="text-sm text-gray-600">Amount/Dose</label>
                  <input
                    id="tox-amount"
                    type="text"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., 50 tablets, unknown"
                  />
                </div>
                <div>
                  <label htmlFor="tox-time-of-exposure" className="text-sm text-gray-600">Time of Exposure</label>
                  <input
                    id="tox-time-of-exposure"
                    type="datetime-local"
                    value={timeOfExposure}
                    onChange={e => setTimeOfExposure(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="tox-route" className="text-sm text-gray-600">Route</label>
                  <select
                    id="tox-route"
                    value={route}
                    onChange={e => setRoute(e.target.value as ExposureRoute)}
                    className="w-full border rounded p-2"
                  >
                    <option value="oral">Oral/Ingestion</option>
                    <option value="inhalation">Inhalation</option>
                    <option value="dermal">Dermal/Skin</option>
                    <option value="injection">Injection</option>
                    <option value="ocular">Ocular/Eye</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="tox-severity" className="text-sm text-gray-600">Severity</label>
                  <select
                    id="tox-severity"
                    value={severity}
                    onChange={e => setSeverity(e.target.value as Severity)}
                    className="w-full border rounded p-2"
                  >
                    <option value="mild">Mild</option>
                    <option value="moderate">Moderate</option>
                    <option value="severe">Severe</option>
                    <option value="life-threatening">Life-threatening</option>
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <label htmlFor="tox-intentional" className="flex items-center gap-2">
                  <input
                    id="tox-intentional"
                    type="checkbox"
                    checked={intentional}
                    onChange={e => setIntentional(e.target.checked)}
                  />
                  <span>Intentional exposure (self-harm)</span>
                </label>
              </div>
            </div>

            {/* Tox Screen */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Droplet className="w-5 h-5" /> Toxicology Screen
              </h2>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mb-4">
                {['amphetamines', 'barbiturates', 'benzodiazepines', 'cannabinoids', 'cocaine',
                  'opiates', 'pcp', 'methadone', 'fentanyl'].map(drug => (
                    <label key={drug} className={`flex items-center gap-2 p-2 rounded border ${toxScreen[drug as keyof ToxScreen] === true ? 'bg-red-50 border-red-300' : 'bg-gray-50'}`}>
                      <input
                        type="checkbox"
                        checked={toxScreen[drug as keyof ToxScreen] === true}
                        onChange={e => setToxScreen({ ...toxScreen, [drug]: e.target.checked })}
                      />
                      <span className="text-sm capitalize">{drug}</span>
                    </label>
                  ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { key: 'ethanol', label: 'Ethanol (mg/dL)', toxic: 80 },
                  { key: 'acetaminophen', label: 'APAP (mcg/mL)', toxic: 150 },
                  { key: 'salicylate', label: 'Salicylate (mg/dL)', toxic: 30 },
                  { key: 'lithium', label: 'Lithium (mEq/L)', toxic: 1.5 },
                  { key: 'digoxin', label: 'Digoxin (ng/mL)', toxic: 2.0 }
                ].map(item => {
                  const value = toxScreen[item.key as keyof ToxScreen] as number | null;
                  return (
                    <div key={item.key}>
                      <label className="text-xs text-gray-600">{item.label}</label>
                      <input
                        type="number"
                        value={value ?? ''}
                        onChange={e => setToxScreen({ ...toxScreen, [item.key]: e.target.value ? Number(e.target.value) : null })}
                        className={`w-full border rounded p-2 ${value !== null && value > item.toxic ? 'border-red-500 bg-red-50' : ''}`}
                        step="0.1"
                      />
                      <p className="text-xs text-gray-400">Toxic: &gt;{item.toxic}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Symptoms */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Signs & Symptoms</h2>
              <div className="flex flex-wrap gap-2">
                {symptoms.map(s => (
                  <label key={s} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedSymptoms.includes(s) ? 'bg-red-100 border-red-300' : 'bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={selectedSymptoms.includes(s)}
                      onChange={e => {
                        if (e.target.checked) setSelectedSymptoms([...selectedSymptoms, s]);
                        else setSelectedSymptoms(selectedSymptoms.filter(x => x !== s));
                      }}
                      className="mr-1"
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>

            {/* Antidotes */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Pill className="w-5 h-5" /> Antidotes
              </h2>
              <div className="space-y-2 mb-4">
                {antidotes.map(a => (
                  <div key={a.antidote} className="flex items-center gap-2 text-sm">
                    <span className="w-40 font-medium">{a.substance}:</span>
                    <span className="w-40 text-gray-600">{a.antidote}</span>
                    {a.doses.map(d => (
                      <button
                        key={d}
                        onClick={() => addAntidote(a.antidote, d)}
                        className="px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs"
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              {givenAntidotes.length > 0 && (
                <div className="border rounded p-3 bg-green-50">
                  <h3 className="font-medium text-green-800 mb-2">Antidotes Given:</h3>
                  {givenAntidotes.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span>{a.time}</span>
                      <span className="font-medium">{a.name}</span>
                      <span>{a.dose}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Decontamination */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Decontamination</h2>
              <div className="flex flex-wrap gap-2">
                {decontaminationMethods.map(m => (
                  <label key={m} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedDecon.includes(m) ? 'bg-blue-100 border-blue-300' : 'bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={selectedDecon.includes(m)}
                      onChange={e => {
                        if (e.target.checked) setSelectedDecon([...selectedDecon, m]);
                        else setSelectedDecon(selectedDecon.filter(x => x !== m));
                      }}
                      className="mr-1"
                    />
                    {m}
                  </label>
                ))}
              </div>
            </div>

            {/* Poison Control */}
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center gap-4">
                <label htmlFor="tox-poison-control" className="flex items-center gap-2">
                  <input
                    id="tox-poison-control"
                    type="checkbox"
                    checked={poisonControlCalled}
                    onChange={e => setPoisonControlCalled(e.target.checked)}
                  />
                  <span className="font-medium">Poison Control Contacted</span>
                </label>
                {poisonControlCalled && (
                  <input
                    type="text"
                    value={caseNumber}
                    onChange={e => setCaseNumber(e.target.value)}
                    className="border rounded p-2 flex-1"
                    placeholder="Case number"
                  />
                )}
              </div>
            </div>

            {/* Disposition */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Disposition</h2>
              <select
                value={disposition}
                onChange={e => setDisposition(e.target.value)}
                className="w-full border rounded p-2"
              >
                <option value="">Select...</option>
                <option value="discharge">Discharge with poison control follow-up</option>
                <option value="observation">Observation unit</option>
                <option value="admit-floor">Admit to floor</option>
                <option value="admit-icu">Admit to ICU</option>
                <option value="admit-tele">Admit to telemetry</option>
                <option value="psych">Psychiatric evaluation</option>
                <option value="transfer">Transfer to higher level of care</option>
              </select>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Notes</h2>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder="Clinical notes..."
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700"
            >
              Save Toxicology Case
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {cases.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No cases yet</div>
            ) : (
              cases.map(c => (
                <div key={c.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{c.patientName}</h3>
                      <p className="text-sm text-gray-500">{new Date(c.assessedAt).toLocaleString()}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded ${severityColors[c.severity]}`}>
                      {c.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm"><strong>Substance:</strong> {c.substance} ({c.amount})</p>
                  <p className="text-sm"><strong>Route:</strong> {c.route}</p>
                  {c.antidotesGiven.length > 0 && (
                    <p className="text-sm"><strong>Antidotes:</strong> {c.antidotesGiven.map(a => a.name).join(', ')}</p>
                  )}
                  <p className="text-sm"><strong>Disposition:</strong> {c.disposition}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ToxicologyPage;
