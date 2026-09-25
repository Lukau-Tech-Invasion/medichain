import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createCardiac, getPatients, useTranslation, useScoringCatalog, getPatientCardiacEvents, formatDateOnly, type CardiacEventListRow, formatTimestamp } from '@medichain/shared';
import type { TimiCriteriaInput } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  Heart,
  HeartPulse,
  Activity,
  Clock,
  Save,
  Search,
  AlertTriangle,
  Zap,
  Plus,
  History
} from 'lucide-react';

interface CardiacEvent {
  time: string;
  type: string;
  details: string;
}

interface ECGReading {
  id: string;
  timestamp: string;
  rhythm: string;
  rate: number;
  interpretation: string;
  stElevation: boolean;
  leads: string[];
}

/**
 * The five TIMI criteria a clinician answers, in the order TIMI lists them.
 *
 * Age and the elevated cardiac marker are absent on purpose — the server
 * derives both, from the patient's date of birth and from the troponin value
 * on this form.
 */
const TIMI_CRITERIA_FIELDS: ReadonlyArray<{
  key: keyof TimiCriteriaInput;
  labelKey: string;
}> = [
  { key: 'three_or_more_cad_risk_factors', labelKey: 'docCardiac.timiRiskFactors' },
  { key: 'known_cad', labelKey: 'docCardiac.timiKnownCad' },
  { key: 'aspirin_in_past_7_days', labelKey: 'docCardiac.timiAspirin' },
  { key: 'severe_angina', labelKey: 'docCardiac.timiSevereAngina' },
  { key: 'st_deviation', labelKey: 'docCardiac.timiStDeviation' },
];



export default function CardiacPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  // The list endpoint returns summary rows keyed `id`. This panel read
  // `event_id`, `event_type` and `outcome` off them -- names from the
  // full-record shape -- so every row showed a blank ID and "N/A".
  const [emergencyHistory, setEmergencyHistory] = useState<CardiacEventListRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Cardiac Event Form State
  const [eventType, setEventType] = useState<string>('stemi');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [symptomOnset, setSymptomOnset] = useState('');
  const [chestPainCharacter, setChestPainCharacter] = useState('');
  const [painRadiation, setPainRadiation] = useState<string[]>([]);
  const [associatedSymptoms, setAssociatedSymptoms] = useState<string[]>([]);
  const [heartRate, setHeartRate] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [troponinLevel, setTroponinLevel] = useState('');
  const [bnpLevel, setBnpLevel] = useState('');
  const [killipClass, setKillipClass] = useState('1');
  // The five TIMI criteria that are clinical judgements. Age and the cardiac
  // marker are not here: the server reads age from the patient's date of birth
  // and derives the marker from the troponin value below.
  //
  // This replaces a `calculateTIMI()` that inferred all seven from unrelated
  // controls, and got two of them wrong: it counted "3+ CAD risk factors" when
  // the symptom list contained diabetes *or* hypertension — one factor, not
  // three — and read "2+ anginal episodes in 24h" off a chest-pain *character*
  // dropdown, which describes quality, not frequency. Both errors score a
  // criterion that is not met, and TIMI decides who goes for early invasive
  // management.
  const [timiCriteria, setTimiCriteria] = useState<TimiCriteriaInput>({
    three_or_more_cad_risk_factors: false,
    known_cad: false,
    aspirin_in_past_7_days: false,
    severe_angina: false,
    st_deviation: false,
  });
  // What the server scored, once the record is filed.
  const [savedTimi, setSavedTimi] = useState<{ timi_score: number; timi_band: string } | null>(null);
  // The assay threshold is protocol, not a component constant. It was `0.04`
  // hardcoded twice on this page — once in the removed `calculateTIMI` and once
  // in the "elevated" hint below — so changing the assay meant editing TSX.
  const { catalog } = useScoringCatalog();
  const troponinThreshold = catalog?.timi?.troponin_threshold_ng_ml ?? null;
  const troponinElevated =
    troponinThreshold !== null && parseFloat(troponinLevel) > troponinThreshold;
  const [treatment, setTreatment] = useState<string[]>([]);
  const [disposition, setDisposition] = useState('');
  const [narrative, setNarrative] = useState('');

  // ECG Readings
  const [ecgReadings, setEcgReadings] = useState<ECGReading[]>([]);
  const [showECGForm, setShowECGForm] = useState(false);
  const [newECG, setNewECG] = useState<Partial<ECGReading>>({
    rhythm: 'normal_sinus',
    rate: 72,
    interpretation: '',
    stElevation: false,
    leads: []
  });

  // Event Timeline
  const [events, setEvents] = useState<CardiacEvent[]>([]);

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    try {
      const data = await getPatients();
      setPatients(data);
    } catch (err) {
      console.error('Failed to load patients', err);
    }
  };

  const fetchEmergencyHistory = async (patientId: string) => {
    if (!user || !patientId) return;
    setHistoryLoading(true);
    try {
      setEmergencyHistory(await getPatientCardiacEvents(patientId));
    } catch (e) {
      console.error(e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const filteredPatients = patients.filter(p =>
    (p.full_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (p.patient_id?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  const selectedPatientData = patients.find(p => p.patient_id === selectedPatient);

  const addEvent = (type: string, details: string) => {
    setEvents(prev => [
      ...prev,
      { time: new Date().toLocaleTimeString(), type, details }
    ]);
  };

  const addECGReading = () => {
    if (!newECG.rhythm) return;
    const reading: ECGReading = {
      id: `ECG-${Date.now()}`,
      timestamp: new Date().toISOString(),
      rhythm: newECG.rhythm || 'normal_sinus',
      rate: newECG.rate || 72,
      interpretation: newECG.interpretation || '',
      stElevation: newECG.stElevation || false,
      leads: newECG.leads || []
    };
    setEcgReadings(prev => [...prev, reading]);
    addEvent('ECG', `${reading.rhythm} - Rate: ${reading.rate}`);
    setShowECGForm(false);
    setNewECG({ rhythm: 'normal_sinus', rate: 72, interpretation: '', stElevation: false, leads: [] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) {
      setError(t('docCardiac.errorSelectPatient'));
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // `event_id` and `documented_by` are gone: the server generates the id
      // (a client-supplied one lets two submissions overwrite each other) and
      // attributes the record to whoever authenticated.
      //
      // `timi_score` is gone too. The five criteria go instead, and the server
      // scores them — see `timiCriteria` above for what the browser's version
      // was getting wrong.
      const cardiacData = {
        patient_id: selectedPatient,
        event_type: eventType,
        chief_complaint: chiefComplaint,
        symptom_onset: symptomOnset,
        chest_pain_character: chestPainCharacter,
        pain_radiation: painRadiation,
        associated_symptoms: associatedSymptoms,
        vital_signs: {
          heart_rate: parseInt(heartRate) || 0,
          blood_pressure: bloodPressure
        },
        lab_values: {
          troponin: parseFloat(troponinLevel) || 0,
          bnp: parseFloat(bnpLevel) || 0
        },
        killip_class: parseInt(killipClass),
        timi_criteria: timiCriteria,
        ecg_readings: ecgReadings,
        treatments: treatment,
        disposition,
        narrative,
        timeline: events
      };

      const saved = await createCardiac(cardiacData);
      setSavedTimi({ timi_score: saved.timi_score, timi_band: saved.timi_band });
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError(t('docCardiac.errorSaveFailed'));
      console.error('Failed to save cardiac event', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const eventTypes = [
    { value: 'stemi', label: t('docCardiac.eventType_stemi'), color: 'bg-critical text-critical-fg' },
    { value: 'nstemi', label: t('docCardiac.eventType_nstemi'), color: 'bg-orange-700 text-white' },
    { value: 'unstable_angina', label: t('docCardiac.eventType_unstable_angina'), color: 'bg-caution text-caution-fg' },
    { value: 'heart_failure', label: t('docCardiac.eventType_heart_failure'), color: 'bg-purple-700 text-white' },
    { value: 'arrhythmia', label: t('docCardiac.eventType_arrhythmia'), color: 'bg-blue-600 text-white' },
    { value: 'cardiac_arrest', label: t('docCardiac.eventType_cardiac_arrest'), color: 'bg-red-800 text-white' }
  ];

  const rhythmTypes = [
    'normal_sinus', 'sinus_tachycardia', 'sinus_bradycardia', 'atrial_fibrillation',
    'atrial_flutter', 'svt', 'ventricular_tachycardia', 'ventricular_fibrillation',
    'asystole', 'pea', 'first_degree_block', 'second_degree_type_1', 
    'second_degree_type_2', 'third_degree_block', 'paced_rhythm'
  ];

  const stemiLeads = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'I', 'II', 'III', 'aVR', 'aVL', 'aVF'];

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-700 to-pink-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-surface/20 rounded-full">
                <HeartPulse className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{t('docCardiac.title')}</h1>
                <p className="text-white">{t('docCardiac.subtitle')}</p>
              </div>
            </div>
            {eventType && (
              <div className={`px-4 py-2 rounded-full font-bold ${eventTypes.find(e => e.value === eventType)?.color}`}>
                {eventTypes.find(e => e.value === eventType)?.label}
              </div>
            )}
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-ok-subtle border border-ok text-ok-subtle-fg p-4 rounded-lg flex items-center">
            <Heart className="h-5 w-5 mr-2" />
            {t('docCardiac.successSaved')}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-critical-subtle border border-critical text-critical-subtle-fg p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Patient Selection & Event Type */}
            <div className="space-y-6">
              {/* Patient Selection */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4 flex items-center">
                  <Search className="h-5 w-5 mr-2 text-critical" />
                  {t('docCardiac.patientSelectionTitle')}
                </h2>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-content-muted" />
                  <input
                    type="text"
                    placeholder={t('docCardiac.searchPatientsPh')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <select
                  value={selectedPatient}
                  onChange={(e) => { setSelectedPatient(e.target.value); fetchEmergencyHistory(e.target.value); }}
                  className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                  required
                >
                  <option value="">{t('docCardiac.selectPatientOption')}</option>
                  {filteredPatients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} - {p.patient_id}
                    </option>
                  ))}
                </select>
                {selectedPatientData && (
                  <div className="mt-4 p-3 bg-surface-sunken rounded-lg">
                    <p className="font-medium">{selectedPatientData.full_name}</p>
                    <p className="text-sm text-content-muted">{t('docCardiac.dobLabel', { value: selectedPatientData.date_of_birth })}</p>
                    <p className="text-sm text-content-muted">{t('docCardiac.bloodTypeLabel', { value: selectedPatientData.emergency_info?.blood_type || t('docCardiac.bloodTypeUnknown') })}</p>
                  </div>
                )}
                {selectedPatient && (
                  <div className="mt-4">
                    <h4 className="font-medium text-sm text-content-secondary mb-2 flex items-center gap-1 min-h-[24px] py-1">
                      <History className="h-4 w-4 text-critical" /> {t('docCardiac.pastEmergencyEventsTitle')}
                    </h4>
                    {historyLoading ? (
                      <p className="text-content-muted text-xs">{t('docCardiac.loadingHistory')}</p>
                    ) : emergencyHistory.length === 0 ? (
                      <p className="text-content-muted text-xs italic">{t('docCardiac.noPriorEvents')}</p>
                    ) : (
                      <div className="space-y-1">
                        {emergencyHistory.slice(0, 5).map((ev) => (
                          <div key={ev.id} className="text-xs bg-critical-subtle text-critical-subtle-fg rounded p-2 flex justify-between">
                            <span>{ev.event_type || t('docCardiac.defaultEventLabel')}</span>
                            <span>{formatDateOnly(ev.documented_at * 1000) || '-'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Event Type */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4 flex items-center">
                  <Heart className="h-5 w-5 mr-2 text-critical" />
                  {t('docCardiac.eventTypeTitle')}
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {eventTypes.map(type => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => {
                        setEventType(type.value);
                        addEvent('Classification', type.label);
                      }}
                      className={`p-3 rounded-lg text-sm font-medium transition-all ${
                        eventType === type.value
                          ? type.color
                          : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Killip Classification */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4">{t('docCardiac.killipTitle')}</h2>
                <select
                  value={killipClass}
                  onChange={(e) => setKillipClass(e.target.value)}
                  className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                >
                  <option value="1">{t('docCardiac.killip_1')}</option>
                  <option value="2">{t('docCardiac.killip_2')}</option>
                  <option value="3">{t('docCardiac.killip_3')}</option>
                  <option value="4">{t('docCardiac.killip_4')}</option>
                </select>
                {/* TIMI criteria.

                    These used to be inferred from unrelated controls behind a
                    "Calculate" button. They are questions now, because five of
                    the seven are clinical judgements that nothing else on this
                    form records — and inferring them produced a score that was
                    wrong in the direction of "lower risk than the patient is".

                    The two that are not asked are derived by the server: age
                    from the patient's date of birth, and the cardiac marker
                    from the troponin entered below. */}
                <fieldset className="mt-4 p-3 bg-notice-subtle rounded-lg">
                  <legend className="text-sm font-medium text-notice-subtle-fg px-1">
                    {t('docCardiac.timiScoreLabel')}
                  </legend>
                  <div className="space-y-2 mt-2">
                    {TIMI_CRITERIA_FIELDS.map(({ key, labelKey }) => (
                      <label key={key} className="flex items-start gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={timiCriteria[key]}
                          onChange={(e) =>
                            setTimiCriteria((prev) => ({ ...prev, [key]: e.target.checked }))
                          }
                          className="mt-0.5 h-4 w-4 rounded border-border-interactive"
                        />
                        <span className="text-content-secondary">{t(labelKey)}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-content-secondary mt-3">
                    {t('docCardiac.timiDerivedNote')}
                  </p>
                  {/* The score is the server's, and only exists once the record
                      is filed. A preview here would be a fourth opinion. */}
                  <p className="text-2xl font-bold text-notice-subtle-fg mt-2">
                    {savedTimi
                      ? t('docCardiac.timiScoreValue', { score: savedTimi.timi_score })
                      : '—'}
                  </p>
                  {savedTimi && (
                    <p className="text-sm font-medium text-notice-subtle-fg capitalize">
                      {t(`docCardiac.timiBand_${savedTimi.timi_band}`)}
                    </p>
                  )}
                </fieldset>
              </div>
            </div>

            {/* Middle Column - Clinical Details */}
            <div className="space-y-6">
              {/* Symptoms */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4 flex items-center">
                  <Activity className="h-5 w-5 mr-2 text-critical" />
                  {t('docCardiac.clinicalPresentationTitle')}
                </h2>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="cardiac-chief-complaint" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.chiefComplaintLabel')}</label>
                    <input
                      id="cardiac-chief-complaint"
                      type="text"
                      value={chiefComplaint}
                      onChange={(e) => setChiefComplaint(e.target.value)}
                      placeholder={t('docCardiac.chiefComplaintPh')}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="cardiac-symptom-onset" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.symptomOnsetLabel')}</label>
                    <input
                      id="cardiac-symptom-onset"
                      type="datetime-local"
                      value={symptomOnset}
                      onChange={(e) => setSymptomOnset(e.target.value)}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="cardiac-chest-pain-character" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.chestPainCharacterLabel')}</label>
                    <select
                      id="cardiac-chest-pain-character"
                      value={chestPainCharacter}
                      onChange={(e) => setChestPainCharacter(e.target.value)}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                    >
                      <option value="">{t('docCardiac.selectCharacter')}</option>
                      <option value="crushing">{t('docCardiac.painChar_crushing')}</option>
                      <option value="sharp">{t('docCardiac.painChar_sharp')}</option>
                      <option value="burning">{t('docCardiac.painChar_burning')}</option>
                      <option value="aching">{t('docCardiac.painChar_aching')}</option>
                      <option value="squeezing">{t('docCardiac.painChar_squeezing')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-content-secondary mb-2">{t('docCardiac.painRadiationLabel')}</label>
                    <div className="flex flex-wrap gap-2">
                      {['Left arm', 'Right arm', 'Jaw', 'Back', 'Neck', 'Epigastric'].map(loc => (
                        <label key={loc} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={painRadiation.includes(loc)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPainRadiation([...painRadiation, loc]);
                              } else {
                                setPainRadiation(painRadiation.filter(l => l !== loc));
                              }
                            }}
                            className="rounded border-border-interactive text-critical-subtle-fg focus:ring-red-500"
                          />
                          <span className="text-sm text-content-muted">{loc}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-content-secondary mb-2">{t('docCardiac.associatedSymptomsLabel')}</label>
                    <div className="flex flex-wrap gap-2">
                      {['Diaphoresis', 'Dyspnea', 'Nausea', 'Vomiting', 'Syncope', 'Palpitations', 'Fatigue'].map(sym => (
                        <label key={sym} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={associatedSymptoms.includes(sym)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAssociatedSymptoms([...associatedSymptoms, sym]);
                              } else {
                                setAssociatedSymptoms(associatedSymptoms.filter(s => s !== sym));
                              }
                            }}
                            className="rounded border-border-interactive text-critical-subtle-fg focus:ring-red-500"
                          />
                          <span className="text-sm text-content-muted">{sym}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Vitals & Labs */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4">{t('docCardiac.vitalsLabsTitle')}</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="cardiac-heart-rate" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.heartRateLabel')}</label>
                    <input
                      id="cardiac-heart-rate"
                      type="number"
                      value={heartRate}
                      onChange={(e) => setHeartRate(e.target.value)}
                      placeholder="72"
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="cardiac-blood-pressure" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.bloodPressureLabel')}</label>
                    <input
                      id="cardiac-blood-pressure"
                      type="text"
                      value={bloodPressure}
                      onChange={(e) => setBloodPressure(e.target.value)}
                      placeholder="120/80"
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="cardiac-troponin" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.troponinLabel')}</label>
                    <input
                      id="cardiac-troponin"
                      type="number"
                      step="0.001"
                      value={troponinLevel}
                      onChange={(e) => setTroponinLevel(e.target.value)}
                      placeholder="0.04"
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                    {troponinElevated && (
                      <p className="text-xs text-critical-subtle-fg mt-1 flex items-center">
                        <AlertTriangle className="h-3 w-3 mr-1" /> {t('docCardiac.elevatedLabel')}
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="cardiac-bnp" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.bnpLabel')}</label>
                    <input
                      id="cardiac-bnp"
                      type="number"
                      value={bnpLevel}
                      onChange={(e) => setBnpLevel(e.target.value)}
                      placeholder="100"
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              </div>

              {/* Treatments */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4">{t('docCardiac.treatmentsTitle')}</h2>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'aspirin', label: t('docCardiac.tx_aspirin') },
                    { value: 'heparin', label: t('docCardiac.tx_heparin') },
                    { value: 'nitroglycerin', label: t('docCardiac.tx_nitroglycerin') },
                    { value: 'morphine', label: t('docCardiac.tx_morphine') },
                    { value: 'beta_blocker', label: t('docCardiac.tx_beta_blocker') },
                    { value: 'statin', label: t('docCardiac.tx_statin') },
                    { value: 'pci', label: t('docCardiac.tx_pci') },
                    { value: 'thrombolytics', label: t('docCardiac.tx_thrombolytics') },
                    { value: 'oxygen', label: t('docCardiac.tx_oxygen') },
                    { value: 'ace_inhibitor', label: t('docCardiac.tx_ace_inhibitor') }
                  ].map(tx => (
                    <label key={tx.value} className="flex items-center space-x-2 p-2 bg-surface-sunken rounded">
                      <input
                        type="checkbox"
                        checked={treatment.includes(tx.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTreatment([...treatment, tx.value]);
                            addEvent('Treatment', tx.label);
                          } else {
                            setTreatment(treatment.filter(t => t !== tx.value));
                          }
                        }}
                        className="rounded border-border-interactive text-critical-subtle-fg focus:ring-red-500"
                      />
                      <span className="text-sm">{tx.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column - ECG & Timeline */}
            <div className="space-y-6">
              {/* ECG Readings */}
              <div className="bg-surface rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-content flex items-center">
                    <Zap className="h-5 w-5 mr-2 text-critical" />
                    {t('docCardiac.ecgReadingsTitle')}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowECGForm(!showECGForm)}
                    className="flex items-center text-sm text-critical-subtle-fg hover:text-critical-subtle-fg min-h-[24px] py-1"
                  >
                    <Plus className="h-4 w-4 mr-1" /> {t('docCardiac.addECGBtn')}
                  </button>
                </div>

                {showECGForm && (
                  <div className="mb-4 p-4 bg-surface-sunken rounded-lg space-y-3">
                    <div>
                      <label htmlFor="cardiac-ecg-rhythm" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.rhythmLabel')}</label>
                      <select
                        id="cardiac-ecg-rhythm"
                        value={newECG.rhythm}
                        onChange={(e) => setNewECG({ ...newECG, rhythm: e.target.value })}
                        className="w-full p-2 border border-border-interactive rounded-lg text-sm"
                      >
                        {rhythmTypes.map(r => (
                          <option key={r} value={r}>{r.replace(/_/g, ' ').toUpperCase()}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="cardiac-ecg-rate" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.rateLabel')}</label>
                      <input
                        id="cardiac-ecg-rate"
                        type="number"
                        value={newECG.rate}
                        onChange={(e) => setNewECG({ ...newECG, rate: parseInt(e.target.value) })}
                        className="w-full p-2 border border-border-interactive rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={newECG.stElevation}
                          onChange={(e) => setNewECG({ ...newECG, stElevation: e.target.checked })}
                          className="rounded border-border-interactive text-critical-subtle-fg"
                        />
                        <span className="text-sm font-medium text-content-secondary">{t('docCardiac.stElevationLabel')}</span>
                      </label>
                    </div>
                    {newECG.stElevation && (
                      <div>
                        <label className="block text-sm font-medium text-content-secondary mb-2">{t('docCardiac.affectedLeadsLabel')}</label>
                        <div className="flex flex-wrap gap-2">
                          {stemiLeads.map(lead => (
                            <label key={lead} className="flex items-center space-x-1">
                              <input
                                type="checkbox"
                                checked={newECG.leads?.includes(lead)}
                                onChange={(e) => {
                                  const leads = newECG.leads || [];
                                  if (e.target.checked) {
                                    setNewECG({ ...newECG, leads: [...leads, lead] });
                                  } else {
                                    setNewECG({ ...newECG, leads: leads.filter(l => l !== lead) });
                                  }
                                }}
                                className="rounded border-border-interactive text-critical-subtle-fg"
                              />
                              <span className="text-xs">{lead}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <label htmlFor="cardiac-ecg-interpretation" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.interpretationLabel')}</label>
                      <textarea
                        id="cardiac-ecg-interpretation"
                        value={newECG.interpretation}
                        onChange={(e) => setNewECG({ ...newECG, interpretation: e.target.value })}
                        placeholder={t('docCardiac.interpretationPh')}
                        rows={2}
                        className="w-full p-2 border border-border-interactive rounded-lg text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addECGReading}
                      className="w-full bg-critical text-critical-fg py-2 rounded-lg hover:bg-critical"
                    >
                      {t('docCardiac.saveECGBtn')}
                    </button>
                  </div>
                )}

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {ecgReadings.length === 0 ? (
                    <p className="text-sm text-content-muted text-center py-4">{t('docCardiac.noECGReadings')}</p>
                  ) : (
                    ecgReadings.map(ecg => (
                      <div key={ecg.id} className="p-3 bg-surface-sunken rounded-lg">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-sm">{ecg.rhythm.replace(/_/g, ' ').toUpperCase()}</p>
                            <p className="text-xs text-content-muted">{t('docCardiac.rateLine', { value: ecg.rate })}</p>
                            {ecg.stElevation && (
                              <p className="text-xs text-critical-subtle-fg font-medium">
                                {t('docCardiac.stElevationLine', { leads: ecg.leads.join(', ') })}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-content-muted">
                            {formatTimestamp(ecg.timestamp, { timeStyle: 'short' })}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Event Timeline */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4 flex items-center">
                  <Clock className="h-5 w-5 mr-2 text-critical" />
                  {t('docCardiac.eventTimelineTitle')}
                </h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {events.length === 0 ? (
                    <p className="text-sm text-content-muted text-center py-4">{t('docCardiac.noEventsLogged')}</p>
                  ) : (
                    events.map((event, index) => (
                      <div key={index} className="flex items-start space-x-3 p-2 bg-surface-sunken rounded">
                        <div className="w-2 h-2 bg-red-500 rounded-full mt-2"></div>
                        <div className="flex-1">
                          <p className="text-xs text-content-muted">{event.time}</p>
                          <p className="text-sm font-medium text-content-secondary">{event.type}</p>
                          <p className="text-sm text-content-muted">{event.details}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Disposition & Narrative */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 id="cardiac-disposition-heading" className="text-lg font-semibold text-content mb-4">{t('docCardiac.dispositionTitle')}</h2>
                <select
                  id="cardiac-disposition"
                  aria-labelledby="cardiac-disposition-heading"
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value)}
                  className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500 mb-4"
                >
                  <option value="">{t('docCardiac.selectDisposition')}</option>
                  <option value="cath_lab">{t('docCardiac.disp_cath_lab')}</option>
                  <option value="ccu">{t('docCardiac.disp_ccu')}</option>
                  <option value="icu">{t('docCardiac.disp_icu')}</option>
                  <option value="telemetry">{t('docCardiac.disp_telemetry')}</option>
                  <option value="observation">{t('docCardiac.disp_observation')}</option>
                  <option value="transfer">{t('docCardiac.disp_transfer')}</option>
                  <option value="discharge">{t('docCardiac.disp_discharge')}</option>
                  <option value="deceased">{t('docCardiac.disp_deceased')}</option>
                </select>
                <div>
                  <label htmlFor="cardiac-clinical-narrative" className="block text-sm font-medium text-content-secondary mb-1">{t('docCardiac.clinicalNarrativeLabel')}</label>
                  <textarea
                    id="cardiac-clinical-narrative"
                    value={narrative}
                    onChange={(e) => setNarrative(e.target.value)}
                    placeholder={t('docCardiac.clinicalNarrativePh')}
                    rows={4}
                    className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="mt-6 flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3 bg-surface-sunken text-content-secondary rounded-lg hover:bg-gray-300"
            >
              {t('docCardiac.cancelBtn')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedPatient}
              className="px-6 py-3 bg-critical text-critical-fg rounded-lg hover:bg-critical disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed flex items-center"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {t('docCardiac.saving')}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t('docCardiac.saveCardiacEventBtn')}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
