import React, { useState, useEffect } from 'react';
import { Baby, Heart, AlertTriangle, Clock, User, Activity } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients, createOb } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';

type FetalHeartCategory = 'I' | 'II' | 'III';
type LaborStage = 'latent' | 'active' | 'second' | 'third' | 'postpartum';

interface FetalHeartMonitoring {
  baseline: number;
  variability: 'absent' | 'minimal' | 'moderate' | 'marked';
  accelerations: boolean;
  decelerations: 'none' | 'early' | 'variable' | 'late' | 'prolonged';
  category: FetalHeartCategory;
}

interface ObAssessment {
  id: string;
  patientId: string;
  patientName: string;
  assessedBy: string;
  assessedAt: string;
  gravida: number;
  para: number;
  gestationalAge: number;
  edd: string;
  prenatalCare: boolean;
  chiefComplaint: string;
  contractions: { present: boolean; frequency: string; duration: string };
  membraneStatus: 'intact' | 'ruptured' | 'unknown';
  ruptureTime: string;
  fluidColor: 'clear' | 'meconium' | 'bloody' | 'unknown';
  cervicalExam: { dilation: number; effacement: number; station: number };
  laborStage: LaborStage;
  fetalMonitoring: FetalHeartMonitoring;
  presentation: 'cephalic' | 'breech' | 'transverse' | 'unknown';
  complications: string[];
  interventions: string[];
  notes: string;
}

const fhrCategories: Record<FetalHeartCategory, { desc: string; color: string }> = {
  'I': { desc: 'Normal - Continue routine monitoring', color: 'bg-green-100 text-green-700' },
  'II': { desc: 'Indeterminate - Evaluate and continue monitoring', color: 'bg-yellow-100 text-yellow-700' },
  'III': { desc: 'Abnormal - Requires immediate evaluation', color: 'bg-red-100 text-red-700' }
};

const obComplications = [
  'Preeclampsia', 'Eclampsia', 'HELLP syndrome', 'Placenta previa', 'Placental abruption',
  'Cord prolapse', 'Shoulder dystocia', 'Postpartum hemorrhage', 'Uterine rupture',
  'Chorioamnionitis', 'Preterm labor', 'PPROM', 'Fetal distress', 'Breech presentation'
];

const obInterventions = [
  'IV access', 'Fluid bolus', 'Magnesium sulfate', 'Betamethasone', 'Terbutaline',
  'Oxytocin augmentation', 'Amniotomy', 'Foley bulb', 'Epidural', 'C-section',
  'Vacuum assist', 'Forceps assist', 'Manual placenta removal', 'Uterine massage',
  'Methergine', 'Hemabate', 'Bakri balloon', 'Blood transfusion'
];

const ObstetricsPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [assessments, setAssessments] = useState<ObAssessment[]>([]);
  const [activeTab, setActiveTab] = useState<'assessment' | 'history'>('assessment');
  const [selectedPatient, setSelectedPatient] = useState('');

  const [gravida, setGravida] = useState(1);
  const [para, setPara] = useState(0);
  const [gestationalAge, setGestationalAge] = useState(40);
  const [edd, setEdd] = useState('');
  const [prenatalCare, setPrenatalCare] = useState(true);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [contractions, setContractions] = useState({ present: false, frequency: '', duration: '' });
  const [membraneStatus, setMembraneStatus] = useState<'intact' | 'ruptured' | 'unknown'>('intact');
  const [ruptureTime, setRuptureTime] = useState('');
  const [fluidColor, setFluidColor] = useState<'clear' | 'meconium' | 'bloody' | 'unknown'>('clear');
  const [cervicalExam, setCervicalExam] = useState({ dilation: 0, effacement: 0, station: 0 });
  const [laborStage, setLaborStage] = useState<LaborStage>('latent');
  const [presentation, setPresentation] = useState<'cephalic' | 'breech' | 'transverse' | 'unknown'>('cephalic');
  const [selectedComplications, setSelectedComplications] = useState<string[]>([]);
  const [selectedInterventions, setSelectedInterventions] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const [fhr, setFhr] = useState<FetalHeartMonitoring>({
    baseline: 140,
    variability: 'moderate',
    accelerations: true,
    decelerations: 'none',
    category: 'I'
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

  // Auto-calculate FHR category
  useEffect(() => {
    let cat: FetalHeartCategory = 'I';
    // Category I: Normal baseline (110-160), moderate variability, accelerations present, no concerning decels
    if (fhr.baseline >= 110 && fhr.baseline <= 160 && fhr.variability === 'moderate' &&
      fhr.accelerations && (fhr.decelerations === 'none' || fhr.decelerations === 'early')) {
      cat = 'I';
    }
    // Category III: Absent variability with recurrent late/variable decels, bradycardia, sinusoidal
    else if (fhr.variability === 'absent' || fhr.decelerations === 'late' || fhr.decelerations === 'prolonged' ||
      fhr.baseline < 110 || fhr.baseline > 160) {
      cat = fhr.variability === 'absent' && (fhr.decelerations === 'late' || fhr.decelerations === 'variable') ? 'III' : 'II';
    } else {
      cat = 'II';
    }
    setFhr(prev => ({ ...prev, category: cat }));
  }, [fhr.baseline, fhr.variability, fhr.accelerations, fhr.decelerations]);

  const handleSubmit = async () => {
    if (!selectedPatient) {
      showWarning('Please select a patient');
      return;
    }
    const patient = patients.find(p => p.patient_id === selectedPatient);
    const newAssessment: ObAssessment = {
      id: `OB-${Date.now()}`,
      patientId: selectedPatient,
      patientName: patient ? patient.full_name : '',
      assessedBy: user?.userId || 'Unknown',
      assessedAt: new Date().toISOString(),
      gravida, para, gestationalAge, edd, prenatalCare, chiefComplaint,
      contractions, membraneStatus, ruptureTime, fluidColor,
      cervicalExam, laborStage, fetalMonitoring: fhr, presentation,
      complications: selectedComplications, interventions: selectedInterventions, notes
    };
    try {
      await createOb(newAssessment);
    } catch (err) {
      console.error('Failed to save OB assessment:', err);
    }
    setAssessments([newAssessment, ...assessments]);
    showSuccess('OB assessment saved!');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-600 to-rose-500 text-white p-6">
        <div className="flex items-center gap-3">
          <Baby className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">Obstetric Emergency</h1>
            <p className="text-pink-100">Labor assessment and fetal monitoring</p>
          </div>
        </div>
      </div>

      {/* FHR Category Alert */}
      {fhr.category === 'III' && (
        <div className="bg-red-600 text-white p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6" />
          <span className="font-semibold">CATEGORY III FHR - Immediate intervention required!</span>
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
                ? 'text-pink-600 border-b-2 border-pink-600'
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
            {/* Patient & OB History */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> Patient & OB History
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="ob-patient" className="text-sm text-gray-600">Patient</label>
                  <select
                    id="ob-patient"
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
                  <label htmlFor="ob-gravida" className="text-sm text-gray-600">G (Gravida)</label>
                  <input
                    id="ob-gravida"
                    type="number"
                    value={gravida}
                    onChange={e => setGravida(Number(e.target.value))}
                    className="w-full border rounded p-2"
                    min="1"
                  />
                </div>
                <div>
                  <label htmlFor="ob-para" className="text-sm text-gray-600">P (Para)</label>
                  <input
                    id="ob-para"
                    type="number"
                    value={para}
                    onChange={e => setPara(Number(e.target.value))}
                    className="w-full border rounded p-2"
                    min="0"
                  />
                </div>
                <div>
                  <label htmlFor="ob-gestational-age" className="text-sm text-gray-600">GA (weeks)</label>
                  <input
                    id="ob-gestational-age"
                    type="number"
                    value={gestationalAge}
                    onChange={e => setGestationalAge(Number(e.target.value))}
                    className="w-full border rounded p-2"
                    step="0.1"
                  />
                </div>
                <div>
                  <label htmlFor="ob-edd" className="text-sm text-gray-600">EDD</label>
                  <input
                    id="ob-edd"
                    type="date"
                    value={edd}
                    onChange={e => setEdd(e.target.value)}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div className="flex items-center">
                  <label htmlFor="ob-prenatal-care" className="flex items-center gap-2">
                    <input
                      id="ob-prenatal-care"
                      type="checkbox"
                      checked={prenatalCare}
                      onChange={e => setPrenatalCare(e.target.checked)}
                    />
                    <span>Prenatal care received</span>
                  </label>
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="ob-chief-complaint" className="text-sm text-gray-600">Chief Complaint</label>
                  <input
                    id="ob-chief-complaint"
                    type="text"
                    value={chiefComplaint}
                    onChange={e => setChiefComplaint(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder="Labor, bleeding, etc."
                  />
                </div>
              </div>
            </div>

            {/* Labor Assessment */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5" /> Labor Assessment
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="ob-contractions" className="flex items-center gap-2 mb-2">
                    <input
                      id="ob-contractions"
                      type="checkbox"
                      checked={contractions.present}
                      onChange={e => setContractions({ ...contractions, present: e.target.checked })}
                    />
                    <span className="font-medium">Contractions</span>
                  </label>
                  {contractions.present && (
                    <div className="space-y-2">
                      <label htmlFor="ob-contractions-frequency" className="sr-only">Contraction Frequency</label>
                      <input
                        id="ob-contractions-frequency"
                        type="text"
                        value={contractions.frequency}
                        onChange={e => setContractions({ ...contractions, frequency: e.target.value })}
                        className="w-full border rounded p-2"
                        placeholder="Frequency (e.g., q3min)"
                      />
                      <label htmlFor="ob-contractions-duration" className="sr-only">Contraction Duration</label>
                      <input
                        id="ob-contractions-duration"
                        type="text"
                        value={contractions.duration}
                        onChange={e => setContractions({ ...contractions, duration: e.target.value })}
                        className="w-full border rounded p-2"
                        placeholder="Duration (e.g., 60sec)"
                      />
                    </div>
                  )}
                </div>
                <div>
                  <label htmlFor="ob-membrane-status" className="text-sm text-gray-600">Membrane Status</label>
                  <select
                    id="ob-membrane-status"
                    value={membraneStatus}
                    onChange={e => setMembraneStatus(e.target.value as 'intact' | 'ruptured' | 'unknown')}
                    className="w-full border rounded p-2"
                  >
                    <option value="intact">Intact</option>
                    <option value="ruptured">Ruptured (ROM)</option>
                    <option value="unknown">Unknown</option>
                  </select>
                  {membraneStatus === 'ruptured' && (
                    <>
                      <label htmlFor="ob-rupture-time" className="sr-only">Rupture Time</label>
                      <input
                        id="ob-rupture-time"
                        type="datetime-local"
                        value={ruptureTime}
                        onChange={e => setRuptureTime(e.target.value)}
                        className="w-full border rounded p-2 mt-2"
                      />
                      <label htmlFor="ob-fluid-color" className="sr-only">Fluid Color</label>
                      <select
                        id="ob-fluid-color"
                        value={fluidColor}
                        onChange={e => setFluidColor(e.target.value as 'clear' | 'meconium' | 'bloody' | 'unknown')}
                        className="w-full border rounded p-2 mt-2"
                      >
                        <option value="clear">Clear fluid</option>
                        <option value="meconium">Meconium-stained</option>
                        <option value="bloody">Bloody</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </>
                  )}
                </div>
                <div>
                  <label htmlFor="ob-presentation" className="text-sm text-gray-600">Presentation</label>
                  <select
                    id="ob-presentation"
                    value={presentation}
                    onChange={e => setPresentation(e.target.value as 'cephalic' | 'breech' | 'transverse' | 'unknown')}
                    className="w-full border rounded p-2"
                  >
                    <option value="cephalic">Cephalic (vertex)</option>
                    <option value="breech">Breech</option>
                    <option value="transverse">Transverse</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ob-labor-stage" className="text-sm text-gray-600">Labor Stage</label>
                  <select
                    id="ob-labor-stage"
                    value={laborStage}
                    onChange={e => setLaborStage(e.target.value as LaborStage)}
                    className="w-full border rounded p-2"
                  >
                    <option value="latent">Latent (0-6cm)</option>
                    <option value="active">Active (6-10cm)</option>
                    <option value="second">Second stage (pushing)</option>
                    <option value="third">Third stage (placenta)</option>
                    <option value="postpartum">Postpartum</option>
                  </select>
                </div>
              </div>
              <div className="grid md:grid-cols-3 gap-4 mt-4">
                <div>
                  <label htmlFor="ob-dilation" className="text-sm text-gray-600">Dilation (cm)</label>
                  <input
                    id="ob-dilation"
                    type="number"
                    value={cervicalExam.dilation}
                    onChange={e => setCervicalExam({ ...cervicalExam, dilation: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                    min="0" max="10"
                  />
                </div>
                <div>
                  <label htmlFor="ob-effacement" className="text-sm text-gray-600">Effacement (%)</label>
                  <input
                    id="ob-effacement"
                    type="number"
                    value={cervicalExam.effacement}
                    onChange={e => setCervicalExam({ ...cervicalExam, effacement: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                    min="0" max="100"
                  />
                </div>
                <div>
                  <label htmlFor="ob-station" className="text-sm text-gray-600">Station (-3 to +3)</label>
                  <select
                    id="ob-station"
                    value={cervicalExam.station}
                    onChange={e => setCervicalExam({ ...cervicalExam, station: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  >
                    {[-3, -2, -1, 0, 1, 2, 3].map(s => (
                      <option key={s} value={s}>{s > 0 ? `+${s}` : s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Fetal Heart Rate Monitoring */}
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <Heart className="w-5 h-5" /> Fetal Heart Rate Monitoring
                </h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${fhrCategories[fhr.category].color}`}>
                  Category {fhr.category}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-4">{fhrCategories[fhr.category].desc}</p>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="ob-fhr-baseline" className="text-sm text-gray-600">Baseline (bpm)</label>
                  <input
                    id="ob-fhr-baseline"
                    type="number"
                    value={fhr.baseline}
                    onChange={e => setFhr({ ...fhr, baseline: Number(e.target.value) })}
                    className={`w-full border rounded p-2 ${fhr.baseline < 110 || fhr.baseline > 160 ? 'border-red-500 bg-red-50' : ''}`}
                  />
                  <p className="text-xs text-gray-400">Normal: 110-160</p>
                </div>
                <div>
                  <label htmlFor="ob-fhr-variability" className="text-sm text-gray-600">Variability</label>
                  <select
                    id="ob-fhr-variability"
                    value={fhr.variability}
                    onChange={e => setFhr({ ...fhr, variability: e.target.value as 'absent' | 'minimal' | 'moderate' | 'marked' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="absent">Absent (&lt;5 bpm)</option>
                    <option value="minimal">Minimal (5-10 bpm)</option>
                    <option value="moderate">Moderate (10-25 bpm)</option>
                    <option value="marked">Marked (&gt;25 bpm)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ob-fhr-accelerations" className="text-sm text-gray-600">Accelerations</label>
                  <select
                    id="ob-fhr-accelerations"
                    value={fhr.accelerations ? 'yes' : 'no'}
                    onChange={e => setFhr({ ...fhr, accelerations: e.target.value === 'yes' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="yes">Present</option>
                    <option value="no">Absent</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ob-fhr-decelerations" className="text-sm text-gray-600">Decelerations</label>
                  <select
                    id="ob-fhr-decelerations"
                    value={fhr.decelerations}
                    onChange={e => setFhr({ ...fhr, decelerations: e.target.value as 'none' | 'early' | 'variable' | 'late' | 'prolonged' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="none">None</option>
                    <option value="early">Early</option>
                    <option value="variable">Variable</option>
                    <option value="late">Late</option>
                    <option value="prolonged">Prolonged</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Complications */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> Complications
              </h2>
              <div className="flex flex-wrap gap-2">
                {obComplications.map(c => (
                  <label key={c} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedComplications.includes(c) ? 'bg-red-100 border-red-300' : 'bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={selectedComplications.includes(c)}
                      onChange={e => {
                        if (e.target.checked) setSelectedComplications([...selectedComplications, c]);
                        else setSelectedComplications(selectedComplications.filter(x => x !== c));
                      }}
                      className="mr-1"
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            {/* Interventions */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-5 h-5" /> Interventions
              </h2>
              <div className="flex flex-wrap gap-2">
                {obInterventions.map(i => (
                  <label key={i} className={`px-3 py-1 rounded border cursor-pointer text-sm ${selectedInterventions.includes(i) ? 'bg-green-100 border-green-300' : 'bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={selectedInterventions.includes(i)}
                      onChange={e => {
                        if (e.target.checked) setSelectedInterventions([...selectedInterventions, i]);
                        else setSelectedInterventions(selectedInterventions.filter(x => x !== i));
                      }}
                      className="mr-1"
                    />
                    {i}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-lg shadow p-4">
              <label htmlFor="ob-notes" className="font-semibold mb-3 block">Notes</label>
              <textarea
                id="ob-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder="Clinical notes..."
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700"
            >
              Save OB Assessment
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
                    <span className={`px-2 py-1 text-xs rounded ${fhrCategories[a.fetalMonitoring.category].color}`}>
                      FHR Cat {a.fetalMonitoring.category}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <div><strong>G{a.gravida}P{a.para}</strong></div>
                    <div>GA: {a.gestationalAge}wks</div>
                    <div>{a.cervicalExam.dilation}cm / {a.cervicalExam.effacement}%</div>
                    <div>Station: {a.cervicalExam.station}</div>
                  </div>
                  {a.complications.length > 0 && (
                    <p className="text-sm text-red-600 mt-2">Complications: {a.complications.join(', ')}</p>
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

export default ObstetricsPage;
