import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Wind, AlertTriangle, CheckCircle, Plus, Clock, User, Stethoscope } from 'lucide-react';
import PatientSelect, { useDirectoryPatient } from '../components/PatientSelect';
import { useAuthStore } from '../store/authStore';
import {
  createIntubation,
  fromStoredRecord,
  getApiClient,
  rowsOfResponse,
  useTranslation,
  formatTimestamp, ChoiceChips
} from '@medichain/shared';
import { useToastActions } from '../components/Toast';

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

/** Return a fresh procedure draft using the existing form defaults. */
function initialProcedureFields() {
  return {
    indication: '', method: 'oral' as IntubationMethod, bladeType: 'mac' as BladeType,
    bladeSize: 3, tubeSize: 7.5, tubeDepth: 22, cuffPressure: 25, attempts: 1,
    preOxygenation: true, rsiUsed: true, notes: '',
  };
}

/** Return a fresh airway draft; shared only by initial render and successful reset. */
function initialAirwayFields(): AirwayAssessment {
  return {
    mallampati: 'I', mouthOpening: 4, thyromental: 6, neckMobility: 'full',
    dentition: 'normal', beardPresent: false, obeseNeck: false,
    predictedDifficult: false, lemonScore: 0,
  };
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
  const { showSuccess, showError } = useToastActions();
  const [records, setRecords] = useState<IntubationRecord[]>([]);

  /**
   * Read the ward's records back from the API.
   *
   * This screen had no read path at all: it posted, then did
   * `setRecords([...])` with its own local object. What it displayed was
   * this session's typing, and a reload emptied it -- while every record was
   * safely in the database, reachable only by an id the screen never showed.
   *
   * The stored rows carry the whole submission in `data`, so they come back
   * in this screen's own shape; `fromStoredRecord` overlays the
   * server-assigned id and the column the server stamped rather than
   * accepted.
   */
  const loadIntubationRecords = useCallback(async () => {
    try {
      const body = await getApiClient().get<unknown>('/api/clinical/intubation-records');
      setRecords(
        rowsOfResponse(body).map((row) =>
          fromStoredRecord<IntubationRecord>(row, { performedBy: 'intubator_id' })
        )
      );
    } catch (err) {
      // A failed read must not look like an empty ward.
      console.error('Failed to load records:', err);
    }
  }, []);

  useEffect(() => {
    loadIntubationRecords();
  }, [loadIntubationRecords]);
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [selectedPatient, setSelectedPatient] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionPending = useRef(false);
  const [formData, setFormData] = useState(initialProcedureFields);
  const [airway, setAirway] = useState<AirwayAssessment>(initialAirwayFields);

  const [medications, setMedications] = useState<{ name: string; dose: string; time: string }[]>([]);
  const [selectedComplications, setSelectedComplications] = useState<string[]>(['None']);
  const [verification, setVerification] = useState({
    etco2: false, chestRise: false, breathSounds: false, xray: false
  });


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
    setMedications(current => [...current, { name, dose, time: new Date().toLocaleTimeString() }]);
  };

  /** Clear completed patient-specific inputs before another procedure is started. */
  const resetCompletedDraft = () => {
    setSelectedPatient('');
    setFormData(initialProcedureFields());
    setAirway(initialAirwayFields());
    setMedications([]);
    setSelectedComplications(['None']);
    setVerification({ etco2: false, chestRise: false, breathSounds: false, xray: false });
    setActiveTab('history');
  };

  const { entry: selectedPatientEntry } = useDirectoryPatient(selectedPatient);
  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (submissionPending.current) return;
    if (!selectedPatient || !formData.indication) {
      showError(t('docIntubation.errorSelectPatientIndication'));
      return;
    }
    submissionPending.current = true;
    setIsSubmitting(true);
    // Resolved on the server when the patient was chosen (the first page of the
    // directory held nobody past the fiftieth). Read synchronously: awaiting here,
    // before the pending-save guard is set, let a double press submit twice.
    const patient = selectedPatientEntry;
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
      await loadIntubationRecords();
      resetCompletedDraft();
      showSuccess(t('docIntubation.successDocumented'));
    } catch (err) {
      console.error('Failed to save intubation record:', err);
      // Stop here. Falling through added the record to the local list
      // and toasted success for a write that never happened.
      showError(t('common.saveFailed'));
    } finally {
      submissionPending.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-700 to-teal-800 text-white p-6">
        <div className="flex items-center gap-3">
          <Wind className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold">{t('docIntubation.title')}</h1>
            <p className="text-white">{t('docIntubation.subtitle')}</p>
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
                ? 'text-content-secondary border-b-2 border-cyan-600'
                : 'text-content-muted hover:text-content-secondary'}`}
            >
              {tab === 'new' ? t('docIntubation.tabNew') : t('docIntubation.tabHistory')}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {activeTab === 'new' ? (
          <form onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }} noValidate>
          <fieldset disabled={isSubmitting} className="space-y-6">
            {/* Patient Selection */}
            <div className="bg-surface rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <User className="w-5 h-5" /> {t('docIntubation.patientSelectionHeading')}
              </h2>
              <PatientSelect
                id="intub-patient"
                value={selectedPatient}
                onChange={(selectedPatientId) => setSelectedPatient(selectedPatientId)}
              />
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
                  <ChoiceChips
                    id="intubation-neck-mobility"
                    label={t('docIntubation.neckMobilityLabel')}
                    value={airway.neckMobility}
                    onChange={(next) => { if (next === undefined) return; setAirway({ ...airway, neckMobility: next as 'full' | 'limited' | 'immobile' }); }}
                    options={[
                      { value: 'full', label: t('docIntubation.neckMobility_full') },
                      { value: 'limited', label: t('docIntubation.neckMobility_limited') },
                      { value: 'immobile', label: t('docIntubation.neckMobility_immobile') },
                    ]}
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="intubation-dentition"
                    label={t('docIntubation.dentitionLabel')}
                    value={airway.dentition}
                    onChange={(next) => { if (next === undefined) return; setAirway({ ...airway, dentition: next as 'normal' | 'loose' | 'dentures' | 'edentulous' }); }}
                    options={[
                      { value: 'normal', label: t('docIntubation.dentition_normal') },
                      { value: 'loose', label: t('docIntubation.dentition_loose') },
                      { value: 'dentures', label: t('docIntubation.dentition_dentures') },
                      { value: 'edentulous', label: t('docIntubation.dentition_edentulous') },
                    ]}
                  />
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
                  <ChoiceChips
                    id="intub-method"
                    label={t('docIntubation.methodLabel')}
                    value={formData.method}
                    onChange={(next) => { if (next === undefined) return; setFormData({ ...formData, method: next as IntubationMethod }); }}
                    options={[
                      { value: 'oral', label: t('docIntubation.method_oral') },
                      { value: 'nasal', label: t('docIntubation.method_nasal') },
                      { value: 'video', label: t('docIntubation.method_video') },
                      { value: 'surgical', label: t('docIntubation.method_surgical') },
                    ]}
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="intub-blade-type"
                    label={t('docIntubation.bladeTypeLabel')}
                    value={formData.bladeType}
                    onChange={(next) => { if (next === undefined) return; setFormData({ ...formData, bladeType: next as BladeType }); }}
                    options={[
                      { value: 'mac', label: t('docIntubation.bladeType_mac') },
                      { value: 'miller', label: t('docIntubation.bladeType_miller') },
                      { value: 'video', label: t('docIntubation.bladeType_video') },
                      { value: 'glidescope', label: t('docIntubation.bladeType_glidescope') },
                    ]}
                  />
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
            {(formData.rsiUsed || medications.length > 0) && (
              <div className="bg-surface rounded-lg shadow p-4">
                <h2 className="font-semibold mb-3">{t('docIntubation.rsiMedicationsHeading')}</h2>
                {formData.rsiUsed && <div className="flex flex-wrap gap-2 mb-4">
                  {rsiMedications.map(med => (
                    <div key={med.name} className="flex items-center gap-1">
                      <span className="text-sm font-medium">{med.name}:</span>
                      {med.doses.map(dose => (
                        <button type="button"
                          key={dose}
                          onClick={() => addMedication(med.name, dose)}
                          className="px-2 py-1 text-xs bg-surface-sunken text-content-secondary rounded hover:bg-cyan-200"
                        >
                          {dose}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>}
                {medications.length > 0 && (
                  <div className="border rounded p-2">
                    <h3 className="text-sm font-medium mb-2">{t('docIntubation.medicationsGivenLabel')}</h3>
                    {medications.map((med, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm min-h-[24px] py-1">
                        <Clock className="w-4 h-4 text-content-muted" />
                        <span>{med.time}</span>
                        <span className="font-medium">{med.name}</span>
                        <span>{med.dose}</span>
                        <button type="button"
                          aria-label={t('docIntubation.removeMedication', { name: med.name, dose: med.dose })}
                          onClick={() => setMedications(current => current.filter((_, index) => index !== i))}
                          className="ml-auto rounded px-2 py-1 text-critical hover:bg-critical-subtle focus-visible:outline focus-visible:outline-2">
                          {t('common.remove')}
                        </button>
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
              <textarea aria-label={t('docIntubation.notesPh')}
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="w-full border rounded p-2 h-24"
                placeholder={t('docIntubation.notesPh')}
              />
            </div>

            {/* Submit */}
            <button type="submit"
              aria-disabled={isSubmitting || undefined}
              aria-busy={isSubmitting}
              className="aria-disabled:cursor-wait w-full py-3 bg-cyan-700 text-white rounded-lg font-semibold hover:bg-cyan-800 flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" /> {t('docIntubation.documentIntubationButton')}
            </button>
          </fieldset>
          </form>
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
                      <p className="text-sm text-content-muted">{r.performedAt ? formatTimestamp(r.performedAt) : ""}</p>
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
                  {(r.complications?.length ?? 0) > 0 && (
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
