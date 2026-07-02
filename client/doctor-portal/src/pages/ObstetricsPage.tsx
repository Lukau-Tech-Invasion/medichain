import React, { useState, useEffect } from 'react';
import { Baby, Heart, AlertTriangle, Clock, User, Activity } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients, createOb, useTranslation } from '@medichain/shared';
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
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const fhrDesc = (cat: FetalHeartCategory): string => ({
    I: t('docObstetrics.fhrDescI'), II: t('docObstetrics.fhrDescII'), III: t('docObstetrics.fhrDescIII'),
  }[cat]);
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
      showWarning(t('docObstetrics.warnSelectPatient'));
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
    showSuccess(t('docObstetrics.saved'));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-600 to-rose-500 text-white p-6">
        <div className="flex items-center gap-3">
          <Baby className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docObstetrics.title')}</h1>
            <p className="text-pink-100">{t('docObstetrics.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* FHR Category Alert */}
      {fhr.category === 'III' && (
        <div className="bg-red-600 text-white p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6" />
          <span className="font-semibold">{t('docObstetrics.cat3Banner')}</span>
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
              {tab === 'assessment' ? t('docObstetrics.tabAssessment') : t('docObstetrics.tabHistory')}
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
                <User className="w-5 h-5" /> {t('docObstetrics.patientObHistory')}
              </h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="ob-patient" className="text-sm text-gray-600">{t('docObstetrics.patient')}</label>
                  <select
                    id="ob-patient"
                    value={selectedPatient}
                    onChange={e => setSelectedPatient(e.target.value)}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docObstetrics.select')}</option>
                    {patients.map(p => (
                      <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ob-gravida" className="text-sm text-gray-600">{t('docObstetrics.gravida')}</label>
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
                  <label htmlFor="ob-para" className="text-sm text-gray-600">{t('docObstetrics.para')}</label>
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
                  <label htmlFor="ob-gestational-age" className="text-sm text-gray-600">{t('docObstetrics.gaWeeks')}</label>
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
                  <label htmlFor="ob-edd" className="text-sm text-gray-600">{t('docObstetrics.edd')}</label>
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
                    <span>{t('docObstetrics.prenatalCare')}</span>
                  </label>
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="ob-chief-complaint" className="text-sm text-gray-600">{t('docObstetrics.chiefComplaint')}</label>
                  <input
                    id="ob-chief-complaint"
                    type="text"
                    value={chiefComplaint}
                    onChange={e => setChiefComplaint(e.target.value)}
                    className="w-full border rounded p-2"
                    placeholder={t('docObstetrics.chiefComplaintPh')}
                  />
                </div>
              </div>
            </div>

            {/* Labor Assessment */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5" /> {t('docObstetrics.laborAssessment')}
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
                    <span className="font-medium">{t('docObstetrics.contractions')}</span>
                  </label>
                  {contractions.present && (
                    <div className="space-y-2">
                      <label htmlFor="ob-contractions-frequency" className="sr-only">{t('docObstetrics.contractionsFreqAria')}</label>
                      <input
                        id="ob-contractions-frequency"
                        type="text"
                        value={contractions.frequency}
                        onChange={e => setContractions({ ...contractions, frequency: e.target.value })}
                        className="w-full border rounded p-2"
                        placeholder={t('docObstetrics.contractionsFreqPh')}
                      />
                      <label htmlFor="ob-contractions-duration" className="sr-only">{t('docObstetrics.contractionsDurAria')}</label>
                      <input
                        id="ob-contractions-duration"
                        type="text"
                        value={contractions.duration}
                        onChange={e => setContractions({ ...contractions, duration: e.target.value })}
                        className="w-full border rounded p-2"
                        placeholder={t('docObstetrics.contractionsDurPh')}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <label htmlFor="ob-membrane-status" className="text-sm text-gray-600">{t('docObstetrics.membraneStatus')}</label>
                  <select
                    id="ob-membrane-status"
                    value={membraneStatus}
                    onChange={e => setMembraneStatus(e.target.value as 'intact' | 'ruptured' | 'unknown')}
                    className="w-full border rounded p-2"
                  >
                    <option value="intact">{t('docObstetrics.msIntact')}</option>
                    <option value="ruptured">{t('docObstetrics.msRuptured')}</option>
                    <option value="unknown">{t('docObstetrics.msUnknown')}</option>
                  </select>
                  {membraneStatus === 'ruptured' && (
                    <>
                      <label htmlFor="ob-rupture-time" className="sr-only">{t('docObstetrics.ruptureTimeAria')}</label>
                      <input
                        id="ob-rupture-time"
                        type="datetime-local"
                        value={ruptureTime}
                        onChange={e => setRuptureTime(e.target.value)}
                        className="w-full border rounded p-2 mt-2"
                      />
                      <label htmlFor="ob-fluid-color" className="sr-only">{t('docObstetrics.fluidColorAria')}</label>
                      <select
                        id="ob-fluid-color"
                        value={fluidColor}
                        onChange={e => setFluidColor(e.target.value as 'clear' | 'meconium' | 'bloody' | 'unknown')}
                        className="w-full border rounded p-2 mt-2"
                      >
                        <option value="clear">{t('docObstetrics.fcClear')}</option>
                        <option value="meconium">{t('docObstetrics.fcMeconium')}</option>
                        <option value="bloody">{t('docObstetrics.fcBloody')}</option>
                        <option value="unknown">{t('docObstetrics.fcUnknown')}</option>
                      </select>
                    </>
                  )}
                </div>
                <div>
                  <label htmlFor="ob-presentation" className="text-sm text-gray-600">{t('docObstetrics.presentation')}</label>
                  <select
                    id="ob-presentation"
                    value={presentation}
                    onChange={e => setPresentation(e.target.value as 'cephalic' | 'breech' | 'transverse' | 'unknown')}
                    className="w-full border rounded p-2"
                  >
                    <option value="cephalic">{t('docObstetrics.presCephalic')}</option>
                    <option value="breech">{t('docObstetrics.presBreech')}</option>
                    <option value="transverse">{t('docObstetrics.presTransverse')}</option>
                    <option value="unknown">{t('docObstetrics.presUnknown')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ob-labor-stage" className="text-sm text-gray-600">{t('docObstetrics.laborStage')}</label>
                  <select
                    id="ob-labor-stage"
                    value={laborStage}
                    onChange={e => setLaborStage(e.target.value as LaborStage)}
                    className="w-full border rounded p-2"
                  >
                    <option value="latent">{t('docObstetrics.lsLatent')}</option>
                    <option value="active">{t('docObstetrics.lsActive')}</option>
                    <option value="second">{t('docObstetrics.lsSecond')}</option>
                    <option value="third">{t('docObstetrics.lsThird')}</option>
                    <option value="postpartum">{t('docObstetrics.lsPostpartum')}</option>
                  </select>
                </div>
              </div>
              <div className="grid md:grid-cols-3 gap-4 mt-4">
                <div>
                  <label htmlFor="ob-dilation" className="text-sm text-gray-600">{t('docObstetrics.dilation')}</label>
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
                  <label htmlFor="ob-effacement" className="text-sm text-gray-600">{t('docObstetrics.effacement')}</label>
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
                  <label htmlFor="ob-station" className="text-sm text-gray-600">{t('docObstetrics.station')}</label>
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
                  <Heart className="w-5 h-5" /> {t('docObstetrics.fhrMonitoring')}
                </h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${fhrCategories[fhr.category].color}`}>
                  {t('docObstetrics.categoryBadge', { cat: fhr.category })}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-4">{fhrDesc(fhr.category)}</p>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="ob-fhr-baseline" className="text-sm text-gray-600">{t('docObstetrics.baseline')}</label>
                  <input
                    id="ob-fhr-baseline"
                    type="number"
                    value={fhr.baseline}
                    onChange={e => setFhr({ ...fhr, baseline: Number(e.target.value) })}
                    className={`w-full border rounded p-2 ${fhr.baseline < 110 || fhr.baseline > 160 ? 'border-red-500 bg-red-50' : ''}`}
                  />
                  <p className="text-xs text-gray-400">{t('docObstetrics.baselineNormal')}</p>
                </div>
                <div>
                  <label htmlFor="ob-fhr-variability" className="text-sm text-gray-600">{t('docObstetrics.variability')}</label>
                  <select
                    id="ob-fhr-variability"
                    value={fhr.variability}
                    onChange={e => setFhr({ ...fhr, variability: e.target.value as 'absent' | 'minimal' | 'moderate' | 'marked' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="absent">{t('docObstetrics.varAbsent')}</option>
                    <option value="minimal">{t('docObstetrics.varMinimal')}</option>
                    <option value="moderate">{t('docObstetrics.varModerate')}</option>
                    <option value="marked">{t('docObstetrics.varMarked')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ob-fhr-accelerations" className="text-sm text-gray-600">{t('docObstetrics.accelerations')}</label>
                  <select
                    id="ob-fhr-accelerations"
                    value={fhr.accelerations ? 'yes' : 'no'}
                    onChange={e => setFhr({ ...fhr, accelerations: e.target.value === 'yes' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="yes">{t('docObstetrics.accPresent')}</option>
                    <option value="no">{t('docObstetrics.accAbsent')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ob-fhr-decelerations" className="text-sm text-gray-600">{t('docObstetrics.decelerations')}</label>
                  <select
                    id="ob-fhr-decelerations"
                    value={fhr.decelerations}
                    onChange={e => setFhr({ ...fhr, decelerations: e.target.value as 'none' | 'early' | 'variable' | 'late' | 'prolonged' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="none">{t('docObstetrics.decNone')}</option>
                    <option value="early">{t('docObstetrics.decEarly')}</option>
                    <option value="variable">{t('docObstetrics.decVariable')}</option>
                    <option value="late">{t('docObstetrics.decLate')}</option>
                    <option value="prolonged">{t('docObstetrics.decProlonged')}</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Complications */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> {t('docObstetrics.complications')}
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
                <Activity className="w-5 h-5" /> {t('docObstetrics.interventions')}
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
              <label htmlFor="ob-notes" className="font-semibold mb-3 block">{t('docObstetrics.notes')}</label>
              <textarea
                id="ob-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full border rounded p-2 h-24"
                placeholder={t('docObstetrics.notesPh')}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700"
            >
              {t('docObstetrics.save')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {assessments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">{t('docObstetrics.noAssessments')}</div>
            ) : (
              assessments.map(a => (
                <div key={a.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{a.patientName}</h3>
                      <p className="text-sm text-gray-500">{new Date(a.assessedAt).toLocaleString()}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded ${fhrCategories[a.fetalMonitoring.category].color}`}>
                      {t('docObstetrics.fhrCat', { cat: a.fetalMonitoring.category })}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <div><strong>G{a.gravida}P{a.para}</strong></div>
                    <div>{t('docObstetrics.gaValue', { weeks: a.gestationalAge })}</div>
                    <div>{a.cervicalExam.dilation}cm / {a.cervicalExam.effacement}%</div>
                    <div>{t('docObstetrics.stationValue', { station: a.cervicalExam.station })}</div>
                  </div>
                  {a.complications.length > 0 && (
                    <p className="text-sm text-red-600 mt-2">{t('docObstetrics.complicationsList', { list: a.complications.join(', ') })}</p>
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
