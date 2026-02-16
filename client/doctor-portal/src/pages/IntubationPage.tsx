import React, { useState, useEffect } from 'react';
import { Wind, AlertTriangle, CheckCircle, Plus, Clock, User, Stethoscope } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';

type MallampatiClass = 'I' | 'II' | 'III' | 'IV';
type IntubationMethod = 'oral' | 'nasal' | 'surgical' | 'video';
type BladeType = 'mac' | 'miller' | 'video' | 'glidescope';

interface AirwayAssessment {
  mallampati: MallampatiClass;
  mouthOpening: number;
  thyromental: number;
  neckMobility: 'full' | 'limited' | 'immobile';
  dentition: 'normal' | 'loose' | 'dentures' | 'edentulous';
  beardPresent: boolean;
  obeseNeck: boolean;
  predictedDifficult: boolean;
  lemonScore: number;
}

interface IntubationRecord {
  id: string;
  patientId: string;
  patientName: string;
  performedBy: string;
  performedAt: string;
  indication: string;
  method: IntubationMethod;
  bladeType: BladeType;
  bladeSize: number;
  tubeSize: number;
  tubeDepth: number;
  cuffPressure: number;
  attempts: number;
  successful: boolean;
  airwayAssessment: AirwayAssessment;
  preOxygenation: boolean;
  rsiUsed: boolean;
  medications: { name: string; dose: string; time: string }[];
  complications: string[];
  verification: { etco2: boolean; chestRise: boolean; breathSounds: boolean; xray: boolean };
  notes: string;
}

const mallampatiDescriptions: Record<MallampatiClass, string> = {
  'I': 'Soft palate, uvula, fauces, pillars visible',
  'II': 'Soft palate, uvula, fauces visible',
  'III': 'Soft palate, base of uvula visible',
  'IV': 'Hard palate only visible'
};

const intubationIndications = [
  'Respiratory failure', 'Airway protection', 'Altered mental status',
  'Anticipated clinical course', 'Trauma', 'Cardiac arrest',
  'Procedural sedation', 'Status epilepticus', 'Shock'
];

const rsiMedications = [
  { name: 'Etomidate', doses: ['20mg', '0.3mg/kg'] },
  { name: 'Ketamine', doses: ['100mg', '1-2mg/kg'] },
  { name: 'Propofol', doses: ['100mg', '1-2mg/kg'] },
  { name: 'Succinylcholine', doses: ['100mg', '1-1.5mg/kg'] },
  { name: 'Rocuronium', doses: ['50mg', '1-1.2mg/kg'] },
  { name: 'Fentanyl', doses: ['100mcg', '1-2mcg/kg'] },
  { name: 'Lidocaine', doses: ['100mg', '1.5mg/kg'] }
];

const complications = [
  'None', 'Esophageal intubation', 'Right mainstem', 'Hypoxia',
  'Hypotension', 'Bradycardia', 'Dental trauma', 'Aspiration',
  'Laryngospasm', 'Pneumothorax', 'Cardiac arrest'
];

const IntubationPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [records, setRecords] = useState<IntubationRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [selectedPatient, setSelectedPatient] = useState('');

  const [formData, setFormData] = useState({
    indication: '',
    method: 'oral' as IntubationMethod,
    bladeType: 'mac' as BladeType,
    bladeSize: 3,
    tubeSize: 7.5,
    tubeDepth: 22,
    cuffPressure: 25,
    attempts: 1,
    preOxygenation: true,
    rsiUsed: true,
    notes: ''
  });

  const [airway, setAirway] = useState<AirwayAssessment>({
    mallampati: 'I',
    mouthOpening: 4,
    thyromental: 6,
    neckMobility: 'full',
    dentition: 'normal',
    beardPresent: false,
    obeseNeck: false,
    predictedDifficult: false,
    lemonScore: 0
  });

  const [medications, setMedications] = useState<{ name: string; dose: string; time: string }[]>([]);
  const [selectedComplications, setSelectedComplications] = useState<string[]>(['None']);
  const [verification, setVerification] = useState({
    etco2: false, chestRise: false, breathSounds: false, xray: false
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

  // Calculate LEMON score
  useEffect(() => {
    let score = 0;
    if (airway.mallampati === 'III') score += 1;
    if (airway.mallampati === 'IV') score += 2;
    if (airway.mouthOpening < 3) score += 1;
    if (airway.thyromental < 6) score += 1;
    if (airway.neckMobility !== 'full') score += 1;
    if (airway.obeseNeck) score += 1;
    setAirway(prev => ({
      ...prev,
      lemonScore: score,
      predictedDifficult: score >= 3
    }));
  }, [airway.mallampati, airway.mouthOpening, airway.thyromental, airway.neckMobility, airway.obeseNeck]);

  const addMedication = (name: string, dose: string) => {
    setMedications([...medications, { name, dose, time: new Date().toLocaleTimeString() }]);
  };

  const handleSubmit = () => {
    if (!selectedPatient || !formData.indication) {
      showWarning('Please select a patient and indication');
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const newRecord: IntubationRecord = {
      id: `INT-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      performedBy: user?.userId || 'Unknown',
      performedAt: new Date().toISOString(),
      indication: formData.indication,
      method: formData.method,
      bladeType: formData.bladeType,
      bladeSize: formData.bladeSize,
      tubeSize: formData.tubeSize,
      tubeDepth: formData.tubeDepth,
      cuffPressure: formData.cuffPressure,
      attempts: formData.attempts,
      successful: verification.etco2 && verification.chestRise,
      airwayAssessment: airway,
      preOxygenation: formData.preOxygenation,
      rsiUsed: formData.rsiUsed,
      medications,
      complications: selectedComplications.filter(c => c !== 'None'),
      verification,
      notes: formData.notes
    };
    setRecords([newRecord, ...records]);
    showSuccess('Intubation documented successfully!');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-600 to-teal-600 text-white p-6">
        <div className="flex items-center gap-3">
          <Wind className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">Intubation & Airway Management</h1>
            <p className="text-cyan-100">RSI documentation and airway assessment</p>
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
                ? 'text-cyan-600 border-b-2 border-cyan-600'
                : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'new' ? 'New Intubation' : 'History'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'new' ? (
          <div className="space-y-6">
            {/* Patient Selection */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> Patient Selection
              </h2>
              <select
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

            {/* Airway Assessment */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Stethoscope className="w-5 h-5" /> Airway Assessment (LEMON)
                {airway.predictedDifficult && (
                  <span className="ml-2 px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Difficult Airway Predicted
                  </span>
                )}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="intubation-mallampati" className="text-sm text-gray-600">Mallampati Class</label>
                  <select
                    id="intubation-mallampati"
                    value={airway.mallampati}
                    onChange={e => setAirway({ ...airway, mallampati: e.target.value as MallampatiClass })}
                    className="w-full border rounded p-2"
                  >
                    {(['I', 'II', 'III', 'IV'] as MallampatiClass[]).map(c => (
                      <option key={c} value={c}>Class {c}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">{mallampatiDescriptions[airway.mallampati]}</p>
                </div>
                <div>
                  <label htmlFor="intubation-mouth-opening" className="text-sm text-gray-600">Mouth Opening (cm)</label>
                  <input
                    id="intubation-mouth-opening"
                    type="number"
                    value={airway.mouthOpening}
                    onChange={e => setAirway({ ...airway, mouthOpening: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                    step="0.5"
                  />
                  <p className="text-xs text-gray-500">&lt;3cm = difficult</p>
                </div>
                <div>
                  <label htmlFor="intubation-thyromental" className="text-sm text-gray-600">Thyromental (cm)</label>
                  <input
                    id="intubation-thyromental"
                    type="number"
                    value={airway.thyromental}
                    onChange={e => setAirway({ ...airway, thyromental: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                    step="0.5"
                  />
                  <p className="text-xs text-gray-500">&lt;6cm = difficult</p>
                </div>
                <div>
                  <label htmlFor="intubation-neck-mobility" className="text-sm text-gray-600">Neck Mobility</label>
                  <select
                    id="intubation-neck-mobility"
                    value={airway.neckMobility}
                    onChange={e => setAirway({ ...airway, neckMobility: e.target.value as 'full' | 'limited' | 'immobile' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="full">Full</option>
                    <option value="limited">Limited</option>
                    <option value="immobile">Immobile (C-spine)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="intubation-dentition" className="text-sm text-gray-600">Dentition</label>
                  <select
                    id="intubation-dentition"
                    value={airway.dentition}
                    onChange={e => setAirway({ ...airway, dentition: e.target.value as 'normal' | 'loose' | 'dentures' | 'edentulous' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="normal">Normal</option>
                    <option value="loose">Loose teeth</option>
                    <option value="dentures">Dentures</option>
                    <option value="edentulous">Edentulous</option>
                  </select>
                </div>
                <div className="flex items-center gap-4 col-span-2">
                  <label htmlFor="intub-beard-present" className="flex items-center gap-2">
                    <input
                      id="intub-beard-present"
                      type="checkbox"
                      checked={airway.beardPresent}
                      onChange={e => setAirway({ ...airway, beardPresent: e.target.checked })}
                    />
                    <span className="text-sm">Beard present</span>
                  </label>
                  <label htmlFor="intub-obese-neck" className="flex items-center gap-2">
                    <input
                      id="intub-obese-neck"
                      type="checkbox"
                      checked={airway.obeseNeck}
                      onChange={e => setAirway({ ...airway, obeseNeck: e.target.checked })}
                    />
                    <span className="text-sm">Obese neck</span>
                  </label>
                </div>
                <div className="bg-gray-50 p-3 rounded">
                  <span className="text-sm font-medium">LEMON Score: </span>
                  <span className={`font-bold ${airway.lemonScore >= 3 ? 'text-red-600' : 'text-green-600'}`}>
                    {airway.lemonScore}/6
                  </span>
                </div>
              </div>
            </div>

            {/* Procedure Details */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Procedure Details</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="intub-indication" className="text-sm text-gray-600">Indication</label>
                  <select
                    id="intub-indication"
                    value={formData.indication}
                    onChange={e => setFormData({ ...formData, indication: e.target.value })}
                    className="w-full border rounded p-2"
                  >
                    <option value="">Select...</option>
                    {intubationIndications.map(i => (
                      <option key={i} value={i}>{i}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="intub-method" className="text-sm text-gray-600">Method</label>
                  <select
                    id="intub-method"
                    value={formData.method}
                    onChange={e => setFormData({ ...formData, method: e.target.value as IntubationMethod })}
                    className="w-full border rounded p-2"
                  >
                    <option value="oral">Oral</option>
                    <option value="nasal">Nasal</option>
                    <option value="video">Video-assisted</option>
                    <option value="surgical">Surgical airway</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="intub-blade-type" className="text-sm text-gray-600">Blade Type</label>
                  <select
                    id="intub-blade-type"
                    value={formData.bladeType}
                    onChange={e => setFormData({ ...formData, bladeType: e.target.value as BladeType })}
                    className="w-full border rounded p-2"
                  >
                    <option value="mac">Macintosh</option>
                    <option value="miller">Miller</option>
                    <option value="video">Video</option>
                    <option value="glidescope">GlideScope</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="intub-blade-size" className="text-sm text-gray-600">Blade Size</label>
                  <select
                    id="intub-blade-size"
                    value={formData.bladeSize}
                    onChange={e => setFormData({ ...formData, bladeSize: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  >
                    {[0, 1, 2, 3, 4].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="intub-ett-size" className="text-sm text-gray-600">ETT Size (mm)</label>
                  <select
                    id="intub-ett-size"
                    value={formData.tubeSize}
                    onChange={e => setFormData({ ...formData, tubeSize: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  >
                    {[6, 6.5, 7, 7.5, 8, 8.5, 9].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="intub-depth-at-lip" className="text-sm text-gray-600">Depth at Lip (cm)</label>
                  <input
                    id="intub-depth-at-lip"
                    type="number"
                    value={formData.tubeDepth}
                    onChange={e => setFormData({ ...formData, tubeDepth: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="intub-cuff-pressure" className="text-sm text-gray-600">Cuff Pressure (cmH2O)</label>
                  <input
                    id="intub-cuff-pressure"
                    type="number"
                    value={formData.cuffPressure}
                    onChange={e => setFormData({ ...formData, cuffPressure: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="intub-attempts" className="text-sm text-gray-600">Attempts</label>
                  <select
                    id="intub-attempts"
                    value={formData.attempts}
                    onChange={e => setFormData({ ...formData, attempts: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  >
                    {[1, 2, 3, 4, 5].map(a => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-4 mt-4">
                <label htmlFor="intub-pre-oxygenation" className="flex items-center gap-2">
                  <input
                    id="intub-pre-oxygenation"
                    type="checkbox"
                    checked={formData.preOxygenation}
                    onChange={e => setFormData({ ...formData, preOxygenation: e.target.checked })}
                  />
                  <span>Pre-oxygenation performed</span>
                </label>
                <label htmlFor="intub-rsi-used" className="flex items-center gap-2">
                  <input
                    id="intub-rsi-used"
                    type="checkbox"
                    checked={formData.rsiUsed}
                    onChange={e => setFormData({ ...formData, rsiUsed: e.target.checked })}
                  />
                  <span>RSI used</span>
                </label>
              </div>
            </div>

            {/* RSI Medications */}
            {formData.rsiUsed && (
              <div className="bg-white rounded-lg shadow p-4">
                <h2 className="font-semibold mb-3">RSI Medications</h2>
                <div className="flex flex-wrap gap-2 mb-4">
                  {rsiMedications.map(med => (
                    <div key={med.name} className="flex items-center gap-1">
                      <span className="text-sm font-medium">{med.name}:</span>
                      {med.doses.map(dose => (
                        <button
                          key={dose}
                          onClick={() => addMedication(med.name, dose)}
                          className="px-2 py-1 text-xs bg-cyan-100 text-cyan-700 rounded hover:bg-cyan-200"
                        >
                          {dose}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                {medications.length > 0 && (
                  <div className="border rounded p-2">
                    <h3 className="text-sm font-medium mb-2">Medications Given:</h3>
                    {medications.map((med, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <span>{med.time}</span>
                        <span className="font-medium">{med.name}</span>
                        <span>{med.dose}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Verification */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" /> Tube Placement Verification
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(verification).map(([key, val]) => (
                  <label key={key} className={`flex items-center gap-2 p-3 rounded border ${val ? 'bg-green-50 border-green-300' : 'bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={e => setVerification({ ...verification, [key]: e.target.checked })}
                    />
                    <span className="capitalize">
                      {key === 'etco2' ? 'ETCO2 confirmed' :
                        key === 'chestRise' ? 'Bilateral chest rise' :
                          key === 'breathSounds' ? 'Breath sounds equal' : 'CXR confirmed'}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Complications */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Complications</h2>
              <div className="flex flex-wrap gap-2">
                {complications.map(c => (
                  <label key={c} className={`px-3 py-2 rounded border cursor-pointer ${
                    selectedComplications.includes(c) 
                      ? c === 'None' ? 'bg-green-100 border-green-300' : 'bg-red-100 border-red-300'
                      : 'bg-gray-50'
                  }`}>
                    <input
                      type="checkbox"
                      checked={selectedComplications.includes(c)}
                      onChange={e => {
                        if (c === 'None') {
                          setSelectedComplications(e.target.checked ? ['None'] : []);
                        } else {
                          const filtered = selectedComplications.filter(x => x !== 'None' && x !== c);
                          setSelectedComplications(e.target.checked ? [...filtered, c] : filtered);
                        }
                      }}
                      className="mr-2"
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Notes</h2>
              <textarea
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="w-full border rounded p-2 h-24"
                placeholder="Additional notes..."
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-cyan-600 text-white rounded-lg font-semibold hover:bg-cyan-700 flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" /> Document Intubation
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {records.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No intubation records yet</div>
            ) : (
              records.map(r => (
                <div key={r.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{r.patientName}</h3>
                      <p className="text-sm text-gray-500">{new Date(r.performedAt).toLocaleString()}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded ${r.successful ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {r.successful ? 'Successful' : 'Unsuccessful'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div><span className="text-gray-500">Indication:</span> {r.indication}</div>
                    <div><span className="text-gray-500">Method:</span> {r.method}</div>
                    <div><span className="text-gray-500">ETT Size:</span> {r.tubeSize}mm</div>
                    <div><span className="text-gray-500">Attempts:</span> {r.attempts}</div>
                  </div>
                  {r.complications.length > 0 && (
                    <div className="mt-2 text-sm text-red-600">
                      Complications: {r.complications.join(', ')}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IntubationPage;
