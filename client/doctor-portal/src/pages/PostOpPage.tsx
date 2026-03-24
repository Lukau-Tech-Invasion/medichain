import React, { useState, useEffect } from 'react';
import { Activity, User, CheckCircle, AlertTriangle, ThermometerSun } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients, createPostOp } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';

interface AldreteCriteria {
  activity: 0 | 1 | 2;
  respiration: 0 | 1 | 2;
  circulation: 0 | 1 | 2;
  consciousness: 0 | 1 | 2;
  oxygenSaturation: 0 | 1 | 2;
}

interface PostOpNote {
  id: string;
  patientId: string;
  patientName: string;
  documentedBy: string;
  documentedAt: string;
  procedure: string;
  surgeon: string;
  anesthesiaType: string;
  arrivalTime: string;
  aldrete: AldreteCriteria;
  alderetScore: number;
  vitals: { bp: string; hr: number; rr: number; spo2: number; temp: number };
  painScore: number;
  nauseaVomiting: 'none' | 'mild' | 'moderate' | 'severe';
  bleeding: 'none' | 'minimal' | 'moderate' | 'significant';
  urineOutput: string;
  fluidIntake: string;
  oralIntake: string;
  ivAccess: string;
  medications: string;
  dressingStatus: string;
  drains: string;
  dischargeCriteria: string[];
  dischargeTime: string;
  dischargeDisposition: string;
  complications: string;
  notes: string;
}

const aldreteDescriptions = {
  activity: { 2: 'Moves all extremities', 1: 'Moves two extremities', 0: 'Unable to move' },
  respiration: { 2: 'Breathes deeply, coughs', 1: 'Dyspnea, limited breathing', 0: 'Apneic' },
  circulation: { 2: 'BP ±20% of pre-op', 1: 'BP ±20-50% of pre-op', 0: 'BP ±50% of pre-op' },
  consciousness: { 2: 'Fully awake', 1: 'Arousable', 0: 'Unresponsive' },
  oxygenSaturation: { 2: 'SpO2 >92% on room air', 1: 'Needs O2 for SpO2 >90%', 0: 'SpO2 <90% with O2' }
};

const dischargeCriteriaList = [
  'Aldrete score ≥9', 'Stable vital signs x30min', 'Pain controlled', 'Minimal nausea',
  'No significant bleeding', 'Able to ambulate (if appropriate)', 'Voided or catheter plan',
  'Tolerates fluids', 'Responsible adult present', 'Discharge instructions given',
  'Prescriptions provided', 'Follow-up scheduled'
];

const PostOpPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [notes, setNotes] = useState<PostOpNote[]>([]);
  const [activeTab, setActiveTab] = useState<'assessment' | 'history'>('assessment');
  const [selectedPatient, setSelectedPatient] = useState('');

  const [procedure, setProcedure] = useState('');
  const [surgeon, setSurgeon] = useState('');
  const [anesthesiaType, setAnesthesiaType] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [aldrete, setAldrete] = useState<AldreteCriteria>({
    activity: 2, respiration: 2, circulation: 2, consciousness: 2, oxygenSaturation: 2
  });
  const [vitals, setVitals] = useState({ bp: '120/80', hr: 80, rr: 16, spo2: 98, temp: 36.8 });
  const [painScore, setPainScore] = useState(3);
  const [nauseaVomiting, setNauseaVomiting] = useState<'none' | 'mild' | 'moderate' | 'severe'>('none');
  const [bleeding, setBleeding] = useState<'none' | 'minimal' | 'moderate' | 'significant'>('none');
  const [urineOutput, setUrineOutput] = useState('');
  const [fluidIntake, setFluidIntake] = useState('');
  const [oralIntake, setOralIntake] = useState('');
  const [ivAccess, setIvAccess] = useState('');
  const [medications, setMedications] = useState('');
  const [dressingStatus, setDressingStatus] = useState('');
  const [drains, setDrains] = useState('');
  const [selectedCriteria, setSelectedCriteria] = useState<string[]>([]);
  const [dischargeTime, setDischargeTime] = useState('');
  const [dischargeDisposition, setDischargeDisposition] = useState('');
  const [complications, setComplications] = useState('');
  const [notes2, setNotes2] = useState('');

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

  // Calculate Aldrete score
  const aldreteScore = Object.values(aldrete).reduce((a, b) => a + b, 0);
  const readyForDischarge = aldreteScore >= 9;

  const handleSubmit = async () => {
    if (!selectedPatient) {
      showWarning('Please select a patient');
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const note: PostOpNote = {
      id: `POST-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      documentedBy: user?.userId || 'Unknown',
      documentedAt: new Date().toISOString(),
      procedure, surgeon, anesthesiaType, arrivalTime, aldrete,
      alderetScore: aldreteScore, vitals, painScore, nauseaVomiting,
      bleeding, urineOutput, fluidIntake, oralIntake, ivAccess,
      medications, dressingStatus, drains,
      dischargeCriteria: selectedCriteria, dischargeTime, dischargeDisposition,
      complications, notes: notes2
    };
    try {
      await createPostOp(note);
    } catch (err) {
      console.error('Failed to save post-op note:', err);
    }
    setNotes([note, ...notes]);
    showSuccess('Post-Op note saved!');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-500 text-white p-6">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">Post-Operative Care</h1>
            <p className="text-violet-100">PACU assessment and discharge criteria</p>
          </div>
        </div>
      </div>

      {/* Aldrete Score Banner */}
      <div className={`p-4 flex items-center justify-between ${readyForDischarge ? 'bg-green-100' : 'bg-yellow-100'}`}>
        <div className="flex items-center gap-3">
          {readyForDischarge ? (
            <CheckCircle className="w-6 h-6 text-green-600" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-yellow-600" />
          )}
          <span className="font-semibold">
            Aldrete Score: {aldreteScore}/10 - {readyForDischarge ? 'Ready for discharge' : 'Continue monitoring'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {['assessment', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'assessment' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-violet-600 border-b-2 border-violet-600'
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
            {/* Patient & Procedure Info */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> Patient & Procedure
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="postop-patient" className="text-sm text-gray-600">Patient</label>
                  <select
                    id="postop-patient"
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
                  <label htmlFor="postop-procedure" className="text-sm text-gray-600">Procedure</label>
                  <input
                    id="postop-procedure"
                    type="text"
                    value={procedure}
                    onChange={e => setProcedure(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-surgeon" className="text-sm text-gray-600">Surgeon</label>
                  <input
                    id="postop-surgeon"
                    type="text"
                    value={surgeon}
                    onChange={e => setSurgeon(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-anesthesia" className="text-sm text-gray-600">Anesthesia</label>
                  <input
                    id="postop-anesthesia"
                    type="text"
                    value={anesthesiaType}
                    onChange={e => setAnesthesiaType(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., General"
                  />
                </div>
                <div>
                  <label htmlFor="postop-arrival-time" className="text-sm text-gray-600">PACU Arrival Time</label>
                  <input
                    id="postop-arrival-time"
                    type="time"
                    value={arrivalTime}
                    onChange={e => setArrivalTime(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
            </div>

            {/* Aldrete Score */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" /> Aldrete Score
              </h2>
              <div className="space-y-4">
                {(Object.keys(aldreteDescriptions) as (keyof AldreteCriteria)[]).map(key => (
                  <div key={key} className="flex items-center gap-4">
                    <span className="w-40 font-medium capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                    <div className="flex gap-2">
                      {[0, 1, 2].map(val => (
                        <button
                          key={val}
                          onClick={() => setAldrete({ ...aldrete, [key]: val as 0 | 1 | 2 })}
                          className={`px-4 py-2 rounded border ${aldrete[key] === val
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-white hover:bg-gray-50'}`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                    <span className="text-sm text-gray-500">
                      {aldreteDescriptions[key][aldrete[key]]}
                    </span>
                  </div>
                ))}
                <div className="mt-4 pt-4 border-t flex items-center justify-between">
                  <span className="text-xl font-bold">Total Score: {aldreteScore}/10</span>
                  <span className={`px-3 py-1 rounded ${readyForDischarge ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {readyForDischarge ? 'Discharge Ready (≥9)' : 'Not Ready (<9)'}
                  </span>
                </div>
              </div>
            </div>

            {/* Vital Signs */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <ThermometerSun className="w-5 h-5" /> Vital Signs & Assessment
              </h2>
              <div className="grid md:grid-cols-5 gap-4">
                <div>
                  <label htmlFor="postop-bp" className="text-sm text-gray-600">BP</label>
                  <input
                    id="postop-bp"
                    type="text"
                    value={vitals.bp}
                    onChange={e => setVitals({ ...vitals, bp: e.target.value })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-hr" className="text-sm text-gray-600">HR</label>
                  <input
                    id="postop-hr"
                    type="number"
                    value={vitals.hr}
                    onChange={e => setVitals({ ...vitals, hr: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-rr" className="text-sm text-gray-600">RR</label>
                  <input
                    id="postop-rr"
                    type="number"
                    value={vitals.rr}
                    onChange={e => setVitals({ ...vitals, rr: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-spo2" className="text-sm text-gray-600">SpO2 %</label>
                  <input
                    id="postop-spo2"
                    type="number"
                    value={vitals.spo2}
                    onChange={e => setVitals({ ...vitals, spo2: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-temp" className="text-sm text-gray-600">Temp °C</label>
                  <input
                    id="postop-temp"
                    type="number"
                    step="0.1"
                    value={vitals.temp}
                    onChange={e => setVitals({ ...vitals, temp: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-4 gap-4 mt-4">
                <div>
                  <label htmlFor="postop-pain-score" className="text-sm text-gray-600">Pain Score (0-10)</label>
                  <input
                    id="postop-pain-score"
                    type="range"
                    min="0" max="10"
                    value={painScore}
                    onChange={e => setPainScore(Number(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-center font-medium">{painScore}</p>
                </div>
                <div>
                  <label htmlFor="postop-nausea" className="text-sm text-gray-600">Nausea/Vomiting</label>
                  <select
                    id="postop-nausea"
                    value={nauseaVomiting}
                    onChange={e => setNauseaVomiting(e.target.value as 'none' | 'mild' | 'moderate' | 'severe')}
                    className="w-full border rounded p-2"
                  >
                    <option value="none">None</option>
                    <option value="mild">Mild</option>
                    <option value="moderate">Moderate</option>
                    <option value="severe">Severe</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="postop-bleeding" className="text-sm text-gray-600">Bleeding</label>
                  <select
                    id="postop-bleeding"
                    value={bleeding}
                    onChange={e => setBleeding(e.target.value as 'none' | 'minimal' | 'moderate' | 'significant')}
                    className="w-full border rounded p-2"
                  >
                    <option value="none">None</option>
                    <option value="minimal">Minimal</option>
                    <option value="moderate">Moderate</option>
                    <option value="significant">Significant</option>
                  </select>
                </div>
              </div>
            </div>

            {/* I&O, Meds, Dressing */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Intake/Output & Care</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="postop-urine-output" className="text-sm text-gray-600">Urine Output</label>
                  <input
                    id="postop-urine-output"
                    type="text"
                    value={urineOutput}
                    onChange={e => setUrineOutput(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., 200 mL"
                  />
                </div>
                <div>
                  <label htmlFor="postop-fluid-intake" className="text-sm text-gray-600">IV Fluid Intake</label>
                  <input
                    id="postop-fluid-intake"
                    type="text"
                    value={fluidIntake}
                    onChange={e => setFluidIntake(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., LR 500 mL"
                  />
                </div>
                <div>
                  <label htmlFor="postop-oral-intake" className="text-sm text-gray-600">Oral Intake</label>
                  <input
                    id="postop-oral-intake"
                    type="text"
                    value={oralIntake}
                    onChange={e => setOralIntake(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., Ice chips, water"
                  />
                </div>
                <div>
                  <label htmlFor="postop-iv-access" className="text-sm text-gray-600">IV Access</label>
                  <input
                    id="postop-iv-access"
                    type="text"
                    value={ivAccess}
                    onChange={e => setIvAccess(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., 20G L forearm"
                  />
                </div>
                <div>
                  <label htmlFor="postop-medications" className="text-sm text-gray-600">Medications Given</label>
                  <input
                    id="postop-medications"
                    type="text"
                    value={medications}
                    onChange={e => setMedications(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., Morphine 2mg IV"
                  />
                </div>
                <div>
                  <label htmlFor="postop-dressing" className="text-sm text-gray-600">Dressing Status</label>
                  <input
                    id="postop-dressing"
                    type="text"
                    value={dressingStatus}
                    onChange={e => setDressingStatus(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., CDI, no bleeding"
                  />
                </div>
                <div>
                  <label htmlFor="postop-drains" className="text-sm text-gray-600">Drains</label>
                  <input
                    id="postop-drains"
                    type="text"
                    value={drains}
                    onChange={e => setDrains(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., JP 50 mL serosang"
                  />
                </div>
              </div>
            </div>

            {/* Discharge Criteria */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Discharge Criteria</h2>
              <div className="flex flex-wrap gap-2 mb-4">
                {dischargeCriteriaList.map(c => (
                  <label key={c} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedCriteria.includes(c) ? 'bg-green-100 border-green-300' : 'bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={selectedCriteria.includes(c)}
                      onChange={e => {
                        if (e.target.checked) setSelectedCriteria([...selectedCriteria, c]);
                        else setSelectedCriteria(selectedCriteria.filter(x => x !== c));
                      }}
                      className="mr-1"
                    />
                    {c}
                  </label>
                ))}
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="postop-discharge-time" className="text-sm text-gray-600">Discharge Time</label>
                  <input
                    id="postop-discharge-time"
                    type="time"
                    value={dischargeTime}
                    onChange={e => setDischargeTime(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="postop-disposition" className="text-sm text-gray-600">Disposition</label>
                  <input
                    id="postop-disposition"
                    type="text"
                    value={dischargeDisposition}
                    onChange={e => setDischargeDisposition(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., Home with family"
                  />
                </div>
              </div>
            </div>

            {/* Complications & Notes */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Complications & Notes</h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="postop-complications" className="text-sm text-gray-600">Complications</label>
                  <input
                    id="postop-complications"
                    type="text"
                    value={complications}
                    onChange={e => setComplications(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="None, or describe..."
                  />
                </div>
                <div>
                  <label htmlFor="postop-notes" className="text-sm text-gray-600">Notes</label>
                  <textarea
                    id="postop-notes"
                    value={notes2}
                    onChange={e => setNotes2(e.target.value)}
                    className="w-full border rounded p-2 h-24"
                  />
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700"
            >
              Save Post-Op Note
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {notes.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No post-op notes yet</div>
            ) : (
              notes.map(n => (
                <div key={n.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{n.patientName}</h3>
                      <p className="text-sm text-gray-500">{new Date(n.documentedAt).toLocaleString()}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded ${n.alderetScore >= 9 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      Aldrete: {n.alderetScore}/10
                    </span>
                  </div>
                  <div className="text-sm">
                    <p><strong>Procedure:</strong> {n.procedure}</p>
                    <p>Pain: {n.painScore}/10 | Nausea: {n.nauseaVomiting} | Bleeding: {n.bleeding}</p>
                    {n.dischargeTime && <p className="text-green-600">Discharged: {n.dischargeTime}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PostOpPage;
