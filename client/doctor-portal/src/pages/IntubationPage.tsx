import React, { useState, useEffect } from 'react';
import { Wind, AlertTriangle, CheckCircle, Plus, Clock, User, Stethoscope } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { getPatients, createIntubation, useTranslation } from '@medichain/shared';
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

const intubationIndications = [
  'Respiratory failure', 'Airway protection', 'Altered mental status',
  'Anticipated clinical course', 'Trauma', 'Cardiac arrest',
  'Procedural sedation', 'Status epilepticus', 'Shock'
];

const INDICATION_KEYS: Record<string, string> = {
  'Respiratory failure': 'respiratoryFailure',
  'Airway protection': 'airwayProtection',
  'Altered mental status': 'alteredMentalStatus',
  'Anticipated clinical course': 'anticipatedClinicalCourse',
  'Trauma': 'trauma',
  'Cardiac arrest': 'cardiacArrest',
  'Procedural sedation': 'proceduralSedation',
  'Status epilepticus': 'statusEpilepticus',
  'Shock': 'shock',
};

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

const COMPLICATION_KEYS: Record<string, string> = {
  'None': 'none',
  'Esophageal intubation': 'esophageal',
  'Right mainstem': 'rightMainstem',
  'Hypoxia': 'hypoxia',
  'Hypotension': 'hypotension',
  'Bradycardia': 'bradycardia',
  'Dental trauma': 'dentalTrauma',
  'Aspiration': 'aspiration',
  'Laryngospasm': 'laryngospasm',
  'Pneumothorax': 'pneumothorax',
  'Cardiac arrest': 'cardiacArrest',
};

const IntubationPage: React.FC = () => {
  const { t } = useTranslation();
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

  const handleSubmit = async () => {
    if (!selectedPatient || !formData.indication) {
      showWarning(t('docIntubation.warningSelectPatientIndication'));
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
    try {
      await createIntubation(newRecord);
    } catch (err) {
      console.error('Failed to save intubation record:', err);
    }
    setRecords([newRecord, ...records]);
    showSuccess(t('docIntubation.successDocumented'));
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-600 to-teal-600 text-white p-6">
        <div className="flex items-center gap-3">
          <Wind className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docIntubation.title')}</h1>
            <p className="text-cyan-100">{t('docIntubation.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b">
        <div className="flex">
          {['new', 'history'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'new' | 'history')}
              className={`px-6 py-3 font-medium ${activeTab === tab
                ? 'text-cyan-600 border-b-2 border-cyan-600'
                : 'text-content-muted hover:text-content-secondary'}`}
            >
              {tab === 'new' ? t('docIntubation.tabNew') : t('docIntubation.tabHistory')}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'new' ? (
          <div className="space-y-6">
            {/* Patient Selection */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docIntubation.patientSelectionHeading')}
              </h2>
              <select
                value={selectedPatient}
                onChange={e => setSelectedPatient(e.target.value)}
                className="w-full border rounded p-2"
              >
                <option value="">{t('docIntubation.selectPatientPh')}</option>
                {patients.map(p => (
                  <option key={p.patient_id} value={p.patient_id}>{p.full_name}</option>
                ))}
              </select>
            </div>

            {/* Airway Assessment */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Stethoscope className="w-5 h-5" /> {t('docIntubation.airwayAssessmentHeading')}
                {airway.predictedDifficult && (
                  <span className="ml-2 px-2 py-1 bg-critical-subtle text-critical-subtle-fg text-xs rounded-full flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {t('docIntubation.difficultAirwayBadge')}
                  </span>
                )}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="intubation-mallampati" className="text-sm text-content-muted">{t('docIntubation.mallampatiClassLabel')}</label>
                  <select
                    id="intubation-mallampati"
                    value={airway.mallampati}
                    onChange={e => setAirway({ ...airway, mallampati: e.target.value as MallampatiClass })}
                    className="w-full border rounded p-2"
                  >
                    {(['I', 'II', 'III', 'IV'] as MallampatiClass[]).map(c => (
                      <option key={c} value={c}>{t('docIntubation.classOption', { c })}</option>
                    ))}
                  </select>
                  <p className="text-xs text-content-muted mt-1">{t(`docIntubation.mallampati_${airway.mallampati}`)}</p>
                </div>
                <div>
                  <label htmlFor="intubation-mouth-opening" className="text-sm text-content-muted">{t('docIntubation.mouthOpeningLabel')}</label>
                  <input
                    id="intubation-mouth-opening"
                    type="number"
                    value={airway.mouthOpening}
                    onChange={e => setAirway({ ...airway, mouthOpening: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                    step="0.5"
                  />
                  <p className="text-xs text-content-muted">{t('docIntubation.mouthOpeningHint')}</p>
                </div>
                <div>
                  <label htmlFor="intubation-thyromental" className="text-sm text-content-muted">{t('docIntubation.thyromentalLabel')}</label>
                  <input
                    id="intubation-thyromental"
                    type="number"
                    value={airway.thyromental}
                    onChange={e => setAirway({ ...airway, thyromental: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                    step="0.5"
                  />
                  <p className="text-xs text-content-muted">{t('docIntubation.thyromentalHint')}</p>
                </div>
                <div>
                  <label htmlFor="intubation-neck-mobility" className="text-sm text-content-muted">{t('docIntubation.neckMobilityLabel')}</label>
                  <select
                    id="intubation-neck-mobility"
                    value={airway.neckMobility}
                    onChange={e => setAirway({ ...airway, neckMobility: e.target.value as 'full' | 'limited' | 'immobile' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="full">{t('docIntubation.neckMobility_full')}</option>
                    <option value="limited">{t('docIntubation.neckMobility_limited')}</option>
                    <option value="immobile">{t('docIntubation.neckMobility_immobile')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="intubation-dentition" className="text-sm text-content-muted">{t('docIntubation.dentitionLabel')}</label>
                  <select
                    id="intubation-dentition"
                    value={airway.dentition}
                    onChange={e => setAirway({ ...airway, dentition: e.target.value as 'normal' | 'loose' | 'dentures' | 'edentulous' })}
                    className="w-full border rounded p-2"
                  >
                    <option value="normal">{t('docIntubation.dentition_normal')}</option>
                    <option value="loose">{t('docIntubation.dentition_loose')}</option>
                    <option value="dentures">{t('docIntubation.dentition_dentures')}</option>
                    <option value="edentulous">{t('docIntubation.dentition_edentulous')}</option>
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
                    <span className="text-sm">{t('docIntubation.beardPresentCheckbox')}</span>
                  </label>
                  <label htmlFor="intub-obese-neck" className="flex items-center gap-2">
                    <input
                      id="intub-obese-neck"
                      type="checkbox"
                      checked={airway.obeseNeck}
                      onChange={e => setAirway({ ...airway, obeseNeck: e.target.checked })}
                    />
                    <span className="text-sm">{t('docIntubation.obeseNeckCheckbox')}</span>
                  </label>
                </div>
                <div className="bg-surface-sunken p-3 rounded">
                  <span className="text-sm font-medium">{t('docIntubation.lemonScoreLabel')}</span>
                  <span className={`font-bold ${airway.lemonScore >= 3 ? 'text-critical-subtle-fg' : 'text-ok-subtle-fg'}`}>
                    {airway.lemonScore}{t('docIntubation.lemonScoreSuffix')}
                  </span>
                </div>
              </div>
            </div>

            {/* Procedure Details */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docIntubation.procedureDetailsHeading')}</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="intub-indication" className="text-sm text-content-muted">{t('docIntubation.indicationLabel')}</label>
                  <select
                    id="intub-indication"
                    value={formData.indication}
                    onChange={e => setFormData({ ...formData, indication: e.target.value })}
                    className="w-full border rounded p-2"
                  >
                    <option value="">{t('docIntubation.selectEllipsis')}</option>
                    {intubationIndications.map(i => (
                      <option key={i} value={i}>{t(`docIntubation.indication_${INDICATION_KEYS[i]}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="intub-method" className="text-sm text-content-muted">{t('docIntubation.methodLabel')}</label>
                  <select
                    id="intub-method"
                    value={formData.method}
                    onChange={e => setFormData({ ...formData, method: e.target.value as IntubationMethod })}
                    className="w-full border rounded p-2"
                  >
                    <option value="oral">{t('docIntubation.method_oral')}</option>
                    <option value="nasal">{t('docIntubation.method_nasal')}</option>
                    <option value="video">{t('docIntubation.method_video')}</option>
                    <option value="surgical">{t('docIntubation.method_surgical')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="intub-blade-type" className="text-sm text-content-muted">{t('docIntubation.bladeTypeLabel')}</label>
                  <select
                    id="intub-blade-type"
                    value={formData.bladeType}
                    onChange={e => setFormData({ ...formData, bladeType: e.target.value as BladeType })}
                    className="w-full border rounded p-2"
                  >
                    <option value="mac">{t('docIntubation.bladeType_mac')}</option>
                    <option value="miller">{t('docIntubation.bladeType_miller')}</option>
                    <option value="video">{t('docIntubation.bladeType_video')}</option>
                    <option value="glidescope">{t('docIntubation.bladeType_glidescope')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="intub-blade-size" className="text-sm text-content-muted">{t('docIntubation.bladeSizeLabel')}</label>
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
                  <label htmlFor="intub-ett-size" className="text-sm text-content-muted">{t('docIntubation.ettSizeLabel')}</label>
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
                  <label htmlFor="intub-depth-at-lip" className="text-sm text-content-muted">{t('docIntubation.depthAtLipLabel')}</label>
                  <input
                    id="intub-depth-at-lip"
                    type="number"
                    value={formData.tubeDepth}
                    onChange={e => setFormData({ ...formData, tubeDepth: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="intub-cuff-pressure" className="text-sm text-content-muted">{t('docIntubation.cuffPressureLabel')}</label>
                  <input
                    id="intub-cuff-pressure"
                    type="number"
                    value={formData.cuffPressure}
                    onChange={e => setFormData({ ...formData, cuffPressure: Number(e.target.value) })}
                    className="w-full border rounded p-2"
                  />
                </div>
                <div>
                  <label htmlFor="intub-attempts" className="text-sm text-content-muted">{t('docIntubation.attemptsLabel')}</label>
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
                  <span>{t('docIntubation.preOxygenationCheckbox')}</span>
                </label>
                <label htmlFor="intub-rsi-used" className="flex items-center gap-2">
                  <input
                    id="intub-rsi-used"
                    type="checkbox"
                    checked={formData.rsiUsed}
                    onChange={e => setFormData({ ...formData, rsiUsed: e.target.checked })}
                  />
                  <span>{t('docIntubation.rsiUsedCheckbox')}</span>
                </label>
              </div>
            </div>

            {/* RSI Medications */}
            {formData.rsiUsed && (
              <div className="bg-surface rounded-lg shadow p-4">
                <h2 className="font-semibold mb-3">{t('docIntubation.rsiMedicationsHeading')}</h2>
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
                    <h3 className="text-sm font-medium mb-2">{t('docIntubation.medicationsGivenLabel')}</h3>
                    {medications.map((med, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-content-muted" />
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
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" /> {t('docIntubation.verificationHeading')}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(verification).map(([key, val]) => (
                  <label key={key} className={`flex items-center gap-2 p-3 rounded border ${val ? 'bg-ok-subtle border-ok' : 'bg-surface-sunken'}`}>
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={e => setVerification({ ...verification, [key]: e.target.checked })}
                    />
                    <span>{t(`docIntubation.verification_${key}`)}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Complications */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docIntubation.complicationsHeading')}</h2>
              <div className="flex flex-wrap gap-2">
                {complications.map(c => (
                  <label key={c} className={`px-3 py-2 rounded border cursor-pointer ${
                    selectedComplications.includes(c)
                      ? c === 'None' ? 'bg-ok-subtle border-ok' : 'bg-critical-subtle border-critical'
                      : 'bg-surface-sunken'
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
                    {t(`docIntubation.complication_${COMPLICATION_KEYS[c]}`)}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">{t('docIntubation.notesHeading')}</h2>
              <textarea
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="w-full border rounded p-2 h-24"
                placeholder={t('docIntubation.notesPh')}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-3 bg-cyan-600 text-white rounded-lg font-semibold hover:bg-cyan-700 flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" /> {t('docIntubation.documentIntubationButton')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {records.length === 0 ? (
              <div className="text-center py-8 text-content-muted">{t('docIntubation.noRecordsYet')}</div>
            ) : (
              records.map(r => (
                <div key={r.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold">{r.patientName}</h3>
                      <p className="text-sm text-content-muted">{new Date(r.performedAt).toLocaleString()}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded ${r.successful ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-critical-subtle text-critical-subtle-fg'}`}>
                      {r.successful ? t('docIntubation.successfulBadge') : t('docIntubation.unsuccessfulBadge')}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div><span className="text-content-muted">{t('docIntubation.indicationColLabel')}</span> {INDICATION_KEYS[r.indication] ? t(`docIntubation.indication_${INDICATION_KEYS[r.indication]}`) : r.indication}</div>
                    <div><span className="text-content-muted">{t('docIntubation.methodColLabel')}</span> {t(`docIntubation.method_${r.method}`)}</div>
                    <div><span className="text-content-muted">{t('docIntubation.ettSizeColLabel')}</span> {r.tubeSize}mm</div>
                    <div><span className="text-content-muted">{t('docIntubation.attemptsColLabel')}</span> {r.attempts}</div>
                  </div>
                  {r.complications.length > 0 && (
                    <div className="mt-2 text-sm text-critical-subtle-fg">
                      {t('docIntubation.complicationsLine', { list: r.complications.map(c => COMPLICATION_KEYS[c] ? t(`docIntubation.complication_${COMPLICATION_KEYS[c]}`) : c).join(', ') })}
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
