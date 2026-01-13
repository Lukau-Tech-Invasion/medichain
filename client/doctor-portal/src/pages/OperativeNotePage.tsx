import React, { useState, useEffect } from 'react';
import { Scissors, User, FileText, Droplet, Package } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';

type AnesthesiaType = 'general' | 'spinal' | 'epidural' | 'regional' | 'local' | 'mac' | 'none';
type WoundClass = 'clean' | 'clean-contaminated' | 'contaminated' | 'dirty';

interface Specimen {
  id: string;
  description: string;
  disposition: 'pathology' | 'culture' | 'cytology' | 'discarded';
}

interface OperativeNote {
  id: string;
  patientId: string;
  patientName: string;
  surgeon: string;
  assistant: string;
  anesthesiologist: string;
  scrubNurse: string;
  circulator: string;
  procedureDate: string;
  preOpDiagnosis: string;
  postOpDiagnosis: string;
  procedureName: string;
  cptCodes: string;
  anesthesiaType: AnesthesiaType;
  incision: string;
  findings: string;
  procedure: string;
  closure: string;
  drains: string;
  ebl: number;
  urineOutput: number;
  fluidIn: number;
  specimens: Specimen[];
  woundClass: WoundClass;
  implants: string;
  complications: string;
  disposition: string;
  createdAt: string;
}

const commonProcedures = [
  'Appendectomy', 'Cholecystectomy', 'Hernia repair', 'Exploratory laparotomy',
  'Open reduction internal fixation', 'Arthroscopy', 'Laminectomy', 'Mastectomy',
  'Thyroidectomy', 'Colectomy', 'Coronary artery bypass', 'Valve replacement'
];

const woundClassDescriptions: Record<WoundClass, string> = {
  'clean': 'Class I - No inflammation, no break in sterile technique',
  'clean-contaminated': 'Class II - Entry into hollow viscus under controlled conditions',
  'contaminated': 'Class III - Open trauma, gross spillage from GI tract',
  'dirty': 'Class IV - Established infection, perforated viscus'
};

const OperativeNotePage: React.FC = () => {
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [notes, setNotes] = useState<OperativeNote[]>([]);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [selectedPatient, setSelectedPatient] = useState('');

  // Form state
  const [surgeon, setSurgeon] = useState(user?.userId || '');
  const [assistant, setAssistant] = useState('');
  const [anesthesiologist, setAnesthesiologist] = useState('');
  const [scrubNurse, setScrubNurse] = useState('');
  const [circulator, setCirculator] = useState('');
  const [procedureDate, setProcedureDate] = useState(new Date().toISOString().split('T')[0]);
  const [preOpDiagnosis, setPreOpDiagnosis] = useState('');
  const [postOpDiagnosis, setPostOpDiagnosis] = useState('');
  const [procedureName, setProcedureName] = useState('');
  const [cptCodes, setCptCodes] = useState('');
  const [anesthesiaType, setAnesthesiaType] = useState<AnesthesiaType>('general');
  const [incision, setIncision] = useState('');
  const [findings, setFindings] = useState('');
  const [procedureText, setProcedureText] = useState('');
  const [closure, setClosure] = useState('');
  const [drains, setDrains] = useState('');
  const [ebl, setEbl] = useState(0);
  const [urineOutput, setUrineOutput] = useState(0);
  const [fluidIn, setFluidIn] = useState(0);
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [woundClass, setWoundClass] = useState<WoundClass>('clean');
  const [implants, setImplants] = useState('');
  const [complications, setComplications] = useState('');
  const [disposition, setDisposition] = useState('');

  const [newSpecimen, setNewSpecimen] = useState({ description: '', disposition: 'pathology' as Specimen['disposition'] });

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

  const addSpecimen = () => {
    if (!newSpecimen.description) return;
    setSpecimens([...specimens, { id: `SPEC-${Date.now()}`, ...newSpecimen }]);
    setNewSpecimen({ description: '', disposition: 'pathology' });
  };

  const removeSpecimen = (id: string) => {
    setSpecimens(specimens.filter(s => s.id !== id));
  };

  const handleSubmit = () => {
    if (!selectedPatient || !procedureName) {
      alert('Please select a patient and enter procedure name');
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const note: OperativeNote = {
      id: `OP-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      surgeon, assistant, anesthesiologist, scrubNurse, circulator,
      procedureDate, preOpDiagnosis, postOpDiagnosis, procedureName, cptCodes,
      anesthesiaType, incision, findings, procedure: procedureText, closure,
      drains, ebl, urineOutput, fluidIn, specimens, woundClass,
      implants, complications, disposition, createdAt: new Date().toISOString()
    };
    setNotes([note, ...notes]);
    alert('Operative note saved!');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white p-6">
        <div className="flex items-center gap-3">
          <Scissors className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">Operative Note</h1>
            <p className="text-emerald-100">Surgical procedure documentation</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="flex">
          {['new', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'new' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-emerald-600 border-b-2 border-emerald-600'
                : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'new' ? 'New Note' : 'History'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'new' ? (
          <div className="space-y-6">
            {/* Patient & Team */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> Patient & Surgical Team
              </h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-gray-600">Patient</label>
                  <select
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
                  <label className="text-sm text-gray-600">Procedure Date</label>
                  <input
                    type="date"
                    value={procedureDate}
                    onChange={e => setProcedureDate(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Surgeon</label>
                  <input
                    type="text"
                    value={surgeon}
                    onChange={e => setSurgeon(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Assistant</label>
                  <input
                    type="text"
                    value={assistant}
                    onChange={e => setAssistant(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Anesthesiologist</label>
                  <input
                    type="text"
                    value={anesthesiologist}
                    onChange={e => setAnesthesiologist(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Scrub Nurse</label>
                  <input
                    type="text"
                    value={scrubNurse}
                    onChange={e => setScrubNurse(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Circulator</label>
                  <input
                    type="text"
                    value={circulator}
                    onChange={e => setCirculator(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
            </div>

            {/* Diagnosis & Procedure */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5" /> Diagnosis & Procedure
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-600">Pre-operative Diagnosis</label>
                  <textarea
                    value={preOpDiagnosis}
                    onChange={e => setPreOpDiagnosis(e.target.value)}
                    className="w-full border rounded p-2 h-20"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Post-operative Diagnosis</label>
                  <textarea
                    value={postOpDiagnosis}
                    onChange={e => setPostOpDiagnosis(e.target.value)}
                    className="w-full border rounded p-2 h-20"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Procedure Name</label>
                  <input
                    list="procedures"
                    value={procedureName}
                    onChange={e => setProcedureName(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="Enter or select procedure"
                  />
                  <datalist id="procedures">
                    {commonProcedures.map(p => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <div>
                  <label className="text-sm text-gray-600">CPT Codes</label>
                  <input
                    type="text"
                    value={cptCodes}
                    onChange={e => setCptCodes(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., 44950, 44960"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Anesthesia Type</label>
                  <select
                    value={anesthesiaType}
                    onChange={e => setAnesthesiaType(e.target.value as AnesthesiaType)}
                    className="w-full border rounded p-2"
                  >
                    <option value="general">General</option>
                    <option value="spinal">Spinal</option>
                    <option value="epidural">Epidural</option>
                    <option value="regional">Regional block</option>
                    <option value="local">Local</option>
                    <option value="mac">MAC (Monitored Anesthesia Care)</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Wound Classification</label>
                  <select
                    value={woundClass}
                    onChange={e => setWoundClass(e.target.value as WoundClass)}
                    className="w-full border rounded p-2"
                  >
                    {Object.entries(woundClassDescriptions).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Operative Details */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Operative Details</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-600">Incision</label>
                  <input
                    type="text"
                    value={incision}
                    onChange={e => setIncision(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., Midline laparotomy, 10cm"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Findings</label>
                  <textarea
                    value={findings}
                    onChange={e => setFindings(e.target.value)}
                    className="w-full border rounded p-2 h-24"
                    placeholder="Describe intraoperative findings..."
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Procedure Description</label>
                  <textarea
                    value={procedureText}
                    onChange={e => setProcedureText(e.target.value)}
                    className="w-full border rounded p-2 h-32"
                    placeholder="Step-by-step procedure description..."
                  />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-600">Closure</label>
                    <input
                      type="text"
                      value={closure}
                      onChange={e => setClosure(e.target.value)}
                      className="w-full border rounded p-2"
                      placeholder="e.g., Layered closure with 0 Vicryl, 3-0 Monocryl"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">Drains</label>
                    <input
                      type="text"
                      value={drains}
                      onChange={e => setDrains(e.target.value)}
                      className="w-full border rounded p-2"
                      placeholder="e.g., 19 Fr Blake to bulb suction"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Fluids & EBL */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Droplet className="w-5 h-5" /> Fluids & Blood Loss
              </h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-gray-600">EBL (mL)</label>
                  <input
                    type="number"
                    value={ebl}
                    onChange={e => setEbl(Number(e.target.value))}
                    className={`w-full border rounded p-2 ${ebl > 500 ? 'border-red-500 bg-red-50' : ''}`}
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Fluids In (mL)</label>
                  <input
                    type="number"
                    value={fluidIn}
                    onChange={e => setFluidIn(Number(e.target.value))}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Urine Output (mL)</label>
                  <input
                    type="number"
                    value={urineOutput}
                    onChange={e => setUrineOutput(Number(e.target.value))}
                    className="w-full border rounded p-2"
                  />
                </div>
              </div>
            </div>

            {/* Specimens */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Package className="w-5 h-5" /> Specimens
              </h2>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newSpecimen.description}
                  onChange={e => setNewSpecimen({ ...newSpecimen, description: e.target.value })}
                  className="flex-1 border rounded p-2"
                  placeholder="Specimen description"
                />
                <select
                  value={newSpecimen.disposition}
                  onChange={e => setNewSpecimen({ ...newSpecimen, disposition: e.target.value as Specimen['disposition'] })}
                  className="border rounded p-2"
                >
                  <option value="pathology">Pathology</option>
                  <option value="culture">Culture</option>
                  <option value="cytology">Cytology</option>
                  <option value="discarded">Discarded</option>
                </select>
                <button
                  onClick={addSpecimen}
                  className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                >
                  Add
                </button>
              </div>
              {specimens.length > 0 ? (
                <ul className="space-y-2">
                  {specimens.map(s => (
                    <li key={s.id} className="flex justify-between items-center bg-gray-50 p-2 rounded">
                      <span>{s.description} → <span className="text-gray-500">{s.disposition}</span></span>
                      <button onClick={() => removeSpecimen(s.id)} className="text-red-500 text-sm">Remove</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-400 text-sm">No specimens added</p>
              )}
            </div>

            {/* Additional Info */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Additional Information</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-600">Implants</label>
                  <input
                    type="text"
                    value={implants}
                    onChange={e => setImplants(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., Mesh, hardware, prosthesis"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Disposition</label>
                  <input
                    type="text"
                    value={disposition}
                    onChange={e => setDisposition(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="e.g., PACU, stable condition"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-gray-600">Complications</label>
                  <textarea
                    value={complications}
                    onChange={e => setComplications(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="None, or describe any complications..."
                  />
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700"
            >
              Save Operative Note
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {notes.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No operative notes yet</div>
            ) : (
              notes.map(n => (
                <div key={n.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{n.patientName}</h3>
                      <p className="text-sm text-gray-500">{new Date(n.procedureDate).toLocaleDateString()}</p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-emerald-100 text-emerald-700 capitalize">
                      {n.woundClass.replace('-', ' ')}
                    </span>
                  </div>
                  <div className="text-sm space-y-1">
                    <p><strong>Procedure:</strong> {n.procedureName}</p>
                    <p><strong>Surgeon:</strong> {n.surgeon}</p>
                    <p><strong>EBL:</strong> {n.ebl} mL | <strong>Specimens:</strong> {n.specimens.length}</p>
                    {n.complications && <p className="text-red-600">Complications: {n.complications}</p>}
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

export default OperativeNotePage;
