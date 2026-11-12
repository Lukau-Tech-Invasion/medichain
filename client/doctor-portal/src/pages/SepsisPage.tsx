import React, { useState, useEffect, useReducer } from 'react';
import {
  emptySepsisForm, sepsisFormReducer, toSepsisRequest,
  type SepsisForm, type SepsisFormAction, type SofaField,
} from './SepsisPage.form';
import { useAuthStore } from '../store/authStore';
import { createSepsis, getPatientSepsisAssessments, formatDateOnly, useTranslation, clickable, type SepsisListRow, formatTimestamp, ChoiceChips, useLatestRequest } from '@medichain/shared';
import type { SepsisCreateResult } from '@medichain/shared';
import {
  Thermometer,
  Clock,
  Save,
  Search,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  Syringe,
  Droplets,
  Timer,
  Brain,
  Heart,
  Wind,
  History
} from 'lucide-react';
import PatientSelect, { useDirectoryPatient } from '../components/PatientSelect';
import { useReturnAfterSave } from '../workspace/useReturnAfterSave';

const INFECTION_SOURCE_KEYS: Record<string, string> = {
  'Pneumonia': 'pneumonia',
  'UTI': 'uti',
  'Abdominal': 'abdominal',
  'Skin/Soft Tissue': 'skin-soft-tissue',
  'Meningitis': 'meningitis',
  'Endocarditis': 'endocarditis',
  'Bone/Joint': 'bone-joint',
  'Catheter-Related': 'catheter-related',
  'Unknown': 'unknown'
};



export default function SepsisPage() {
  const returnAfterSave = useReturnAfterSave();
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  // The list endpoint returns summary rows keyed `id`. This panel read
  // `event_id`, `event_type` and `outcome` off them -- names from the
  // full-record shape -- so every row showed a blank ID and "N/A".
  const [emergencyHistory, setEmergencyHistory] = useState<SepsisListRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [sepsisStartTime, setSepsisStartTime] = useState<Date | null>(null);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  // Everything the clinician enters is one object; SepsisPage.form.ts owns its rules.
  const [form, dispatch] = useReducer(sepsisFormReducer, undefined, emptySepsisForm);
  const {
    respiratoryRate, systolicBP, gcsScore, pao2fio2, respiratorySupport, platelets,
    bilirubin, map, creatinine, urineOutput, noradrenaline, lactateReadings,
    newLactate, classification, hour1Bundle, hour3Bundle, infectionSource, suspectedOrganism,
    antibioticsGiven, fluidVolume, vasopressorType, narrative,
  } = form;
  const setField = <K extends keyof SepsisForm>(field: K, value: SepsisForm[K]) =>
    dispatch({ type: 'set', field, value } as SepsisFormAction);

  // qSOFA Scoring
  const [qsofaScore, setQsofaScore] = useState(0);
  const qsofaComplete = respiratoryRate !== null && systolicBP !== null && gcsScore !== null;

  // What the server scored, once the assessment is filed.
  const [savedScores, setSavedScores] = useState<SepsisCreateResult | null>(null);

  useEffect(() => {
    // Calculate qSOFA
    let score = 0;
    if (respiratoryRate !== null && respiratoryRate >= 22) score++;
    if (systolicBP !== null && systolicBP <= 100) score++;
    if (gcsScore !== null && gcsScore < 15) score++;
    setQsofaScore(score);
  }, [respiratoryRate, systolicBP, gcsScore]);

  useEffect(() => {
    // Timer for elapsed time
    if (sepsisStartTime) {
      const interval = setInterval(() => {
        const now = new Date();
        const diff = Math.floor((now.getTime() - sepsisStartTime.getTime()) / 60000);
        setElapsedMinutes(diff);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [sepsisStartTime]);

  const beginHistoryRead = useLatestRequest();
  const fetchEmergencyHistory = async (patientId: string) => {
    // Only the patient now selected may answer: an earlier patient's history
    // arriving late would otherwise be listed under this one.
    const current = beginHistoryRead();
    if (!user || !patientId) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const history = await getPatientSepsisAssessments(patientId);
      if (current()) setEmergencyHistory(history);
    } catch {
      if (!current()) return;
      // Not "no events": a history that could not be read is unknown.
      setEmergencyHistory([]);
      setHistoryError(t('docSepsis.errorLoadHistory'));
    } finally {
      if (current()) setHistoryLoading(false);
    }
  };

  // The hand-rolled name/id filter went with the dropdown it fed:
  // `PatientSelect` searches the server rather than a page-held roster.

  // Resolved on the server: the first page of the directory held nobody past the fiftieth.
  const { entry: selectedPatientData } = useDirectoryPatient(selectedPatient);

  const startSepsisProtocol = () => {
    setSepsisStartTime(new Date());
  };

  const toggleBundleItem = (bundleType: 'hour1' | 'hour3', itemId: string) => {
    dispatch({ type: 'toggleBundleItem', bundle: bundleType, id: itemId, at: new Date().toISOString(), by: user?.userId });
  };

  /** Something else on the form shows the item was done. Never un-ticks it. */
  const completeBundleItem = (bundleType: 'hour1' | 'hour3', itemId: string) => {
    dispatch({ type: 'completeBundleItem', bundle: bundleType, id: itemId, at: new Date().toISOString(), by: user?.userId });
  };

  const addLactateReading = () => {
    const value = parseFloat(newLactate);
    if (isNaN(value)) return;
    
    dispatch({ type: 'addLactate', timestamp: new Date().toISOString() });
    
    // Auto-complete bundle item if this is first lactate
    if (lactateReadings.length === 0) {
      completeBundleItem('hour1', 'lactate');
    }
  };

  /** The SOFA measurements, in the order SOFA lists its organ systems. */
  const SOFA_FIELDS: { id: string; labelKey: string; value: string; field: SofaField; step: string }[] = [
    { id: 'pao2fio2', labelKey: 'docSepsis.sofaPao2Fio2', value: pao2fio2, field: 'pao2fio2', step: '1' },
    { id: 'platelets', labelKey: 'docSepsis.sofaPlatelets', value: platelets, field: 'platelets', step: '1' },
    { id: 'bilirubin', labelKey: 'docSepsis.sofaBilirubin', value: bilirubin, field: 'bilirubin', step: '1' },
    { id: 'map', labelKey: 'docSepsis.sofaMap', value: map, field: 'map', step: '1' },
    { id: 'noradrenaline', labelKey: 'docSepsis.sofaNoradrenaline', value: noradrenaline, field: 'noradrenaline', step: '0.01' },
    { id: 'creatinine', labelKey: 'docSepsis.sofaCreatinine', value: creatinine, field: 'creatinine', step: '1' },
    { id: 'urine-output', labelKey: 'docSepsis.sofaUrineOutput', value: urineOutput, field: 'urineOutput', step: '10' },
  ];

  // SOFA is scored by the API, from the measurements below.
  //
  // The version that stood here was never called and was incomplete besides:
  // its cardiovascular component scored only `map < 70 -> 1`, under a comment
  // reading "Add more for vasopressor use...". A patient on high-dose
  // noradrenaline scored the same as one with a slightly soft pressure — three
  // SOFA points apart, and the difference between sepsis and septic shock.

  const hour1Complete = hour1Bundle.every(item => item.completed);
  const hour3Complete = hour3Bundle.every(item => item.completed);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selectedPatient) {
      setError(t('docSepsis.errorSelectPatient'));
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // A number the clinician did not enter is sent as absent, not as a
      // normal result, and neither score is sent: qSOFA and SOFA are both
      // computed by the API from the measurements.
      const sepsisData = toSepsisRequest(form, {
        patientId: selectedPatient,
        protocolStartTime: sepsisStartTime?.toISOString(),
        elapsedMinutes,
      });

      const saved = await createSepsis(sepsisData);
      // Show what the server scored, including how much of SOFA was actually
      // measured — a total of 2 from six systems and 2 from one are different
      // clinical pictures.
      setSavedScores(saved);
      setSuccess(true);
      setTimeout(() => returnAfterSave(), 2000);
    } catch (err) {
      setError(t('docSepsis.errorSaveFailed'));
      console.error('Failed to save sepsis data', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTimeColor = () => {
    if (elapsedMinutes <= 60) return 'text-ok-subtle-fg';
    if (elapsedMinutes <= 180) return 'text-caution-subtle-fg';
    return 'text-critical-subtle-fg';
  };

  const infectionSources = [
    'Pneumonia', 'UTI', 'Abdominal', 'Skin/Soft Tissue', 
    'Meningitis', 'Endocarditis', 'Bone/Joint', 'Catheter-Related', 'Unknown'
  ];

  const antibioticOptions = [
    'Vancomycin', 'Piperacillin-Tazobactam', 'Meropenem', 'Cefepime',
    'Ceftriaxone', 'Metronidazole', 'Azithromycin', 'Levofloxacin',
    'Gentamicin', 'Daptomycin'
  ];

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header with Timer */}
        <div className="bg-gradient-to-r from-orange-700 to-red-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-surface/20 rounded-full">
                <Thermometer className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{t('docSepsis.title')}</h1>
                <p className="text-white">{t('docSepsis.subtitle')}</p>
              </div>
            </div>
            <div className="text-right">
              {sepsisStartTime ? (
                <div className="bg-surface/20 rounded-lg p-4">
                  <p className="text-sm text-white">{t('docSepsis.protocolActive')}</p>
                  <p className={`text-3xl font-bold ${getTimeColor()} bg-surface rounded px-3 py-1`}>
                    {Math.floor(elapsedMinutes / 60)}:{(elapsedMinutes % 60).toString().padStart(2, '0')}
                  </p>
                  <p className="text-xs text-white mt-1">
                    {elapsedMinutes > 60 ? (
                      <span className="inline-flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> {t('docSepsis.exceedsTarget')}</span>
                    ) : t('docSepsis.withinTarget')}
                  </p>
                </div>
              ) : (
                <button
                  onClick={startSepsisProtocol}
                  className="bg-surface text-content-secondary px-6 py-3 rounded-lg font-bold hover:bg-surface-sunken flex items-center"
                >
                  <Timer className="h-5 w-5 mr-2" />
                  {t('docSepsis.startProtocolTimer')}
                </button>
              )}
            </div>
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-ok-subtle border border-ok text-ok-subtle-fg p-4 rounded-lg flex items-center">
            <CheckCircle className="h-5 w-5 mr-2" />
            {t('docSepsis.successMessage')}
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
            {/* Left Column - Patient & Scoring */}
            <div className="space-y-6">
              {/* Patient Selection */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4 flex items-center">
                  <Search className="h-5 w-5 mr-2 text-caution" />
                  {t('docSepsis.patientSelection')}
                </h2>
                <div className="relative mb-4">
                  <label htmlFor="sepsis-patient-search" className="sr-only">{t('docSepsis.searchPatients')}</label>
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-content-muted" />
                  <input
                    id="sepsis-patient-search"
                    type="text"
                    placeholder={t('docSepsis.searchPatientsPlaceholder')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
                <PatientSelect
                  id="sepsis-patient-select"
                  label={t('docSepsis.selectPatient')}
                  value={selectedPatient}
                  onChange={(selectedPatientId) => { setSelectedPatient(selectedPatientId); fetchEmergencyHistory(selectedPatientId); }}
                  required
                />
                {selectedPatient && (
                  <div className="mt-3">
                    <h4 className="text-xs font-medium text-content-muted mb-1 flex items-center gap-1">
                      <History className="h-3 w-3 text-caution" /> {t('docSepsis.pastEmergencyEvents')}
                    </h4>
                    {historyLoading ? (
                      <p className="text-content-muted text-xs">{t('docSepsis.loading')}</p>
                    ) : historyError ? (
                      <p role="alert" className="text-sm text-critical-subtle-fg">{historyError}</p>
                    ) : emergencyHistory.length === 0 ? (
                      <p className="text-content-muted text-xs italic">{t('docSepsis.noPriorEvents')}</p>
                    ) : (
                      <div className="space-y-1">
                        {emergencyHistory.slice(0, 3).map((ev) => (
                          <div key={ev.id} className="text-xs bg-surface-sunken rounded p-1.5 flex justify-between">
                            <span>{ev.severity || t('docSepsis.defaultEventType')}</span>
                            <span className="text-content-muted">{formatDateOnly(ev.assessed_at * 1000) || '-'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Classification */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4">{t('docSepsis.classification')}</h2>
                <div className="space-y-2">
                  {[
                    { value: 'sirs', label: t('docSepsis.classification_sirs'), color: 'bg-caution text-caution-fg' },
                    { value: 'sepsis', label: t('docSepsis.classification_sepsis'), color: 'bg-orange-700 text-white' },
                    { value: 'severe_sepsis', label: t('docSepsis.classification_severe_sepsis'), color: 'bg-red-700 text-white' },
                    { value: 'septic_shock', label: t('docSepsis.classification_septic_shock'), color: 'bg-red-900 text-white' }
                  ].map(cls => (
                    <button
                      key={cls.value}
                      type="button"
                      onClick={() => setField('classification', cls.value as typeof classification)}
                      className={`w-full p-3 rounded-lg text-left font-medium transition-all ${
                        classification === cls.value
                          ? cls.color
                          : 'bg-surface-sunken text-content-secondary hover:bg-surface-sunken'
                      }`}
                    >
                      {cls.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* qSOFA Score */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4 flex items-center">
                  <Brain className="h-5 w-5 mr-2 text-caution" />
                  {t('docSepsis.qsofaScore')}
                </h2>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="sepsis-respiratory-rate" className="flex items-center justify-between">
                      <span className="text-sm text-content-secondary">
                        <Wind className="h-4 w-4 inline mr-1" />
                        {t('docSepsis.qsofaRR')}
                      </span>
                      <span className={`font-bold ${respiratoryRate !== null && respiratoryRate >= 22 ? 'text-critical-subtle-fg' : 'text-content-muted'}`}>
                        {respiratoryRate === null ? '—' : respiratoryRate >= 22 ? '1' : '0'}
                      </span>
                    </label>
                    <input
                      id="sepsis-respiratory-rate"
                      type="number"
                      min="10"
                      max="40"
                      value={respiratoryRate ?? ''}
                      onChange={(e) => setField('respiratoryRate', e.target.value === '' ? null : Number(e.target.value))}
                      className="w-full mt-1"
                    />
                    <p className="text-xs text-content-muted text-center">{respiratoryRate ?? '—'} {t('docSepsis.perMin')}</p>
                  </div>
                  <div>
                    <label htmlFor="sepsis-systolic-bp" className="flex items-center justify-between">
                      <span className="text-sm text-content-secondary">
                        <Heart className="h-4 w-4 inline mr-1" />
                        {t('docSepsis.qsofaSBP')}
                      </span>
                      <span className={`font-bold ${systolicBP !== null && systolicBP <= 100 ? 'text-critical-subtle-fg' : 'text-content-muted'}`}>
                        {systolicBP === null ? '—' : systolicBP <= 100 ? '1' : '0'}
                      </span>
                    </label>
                    <input
                      id="sepsis-systolic-bp"
                      type="number"
                      min="60"
                      max="180"
                      value={systolicBP ?? ''}
                      onChange={(e) => setField('systolicBP', e.target.value === '' ? null : Number(e.target.value))}
                      className="w-full mt-1"
                    />
                    <p className="text-xs text-content-muted text-center">{systolicBP ?? '—'} {t('docSepsis.mmHg')}</p>
                  </div>
                  <div>
                    <label htmlFor="sepsis-gcs-score" className="flex items-center justify-between">
                      <span className="text-sm text-content-secondary">
                        <Brain className="h-4 w-4 inline mr-1" />
                        {t('docSepsis.qsofaGCS')}
                      </span>
                      <span className={`font-bold ${gcsScore !== null && gcsScore < 15 ? 'text-critical-subtle-fg' : 'text-content-muted'}`}>
                        {gcsScore === null ? '—' : gcsScore < 15 ? '1' : '0'}
                      </span>
                    </label>
                    <input
                      id="sepsis-gcs-score"
                      type="number"
                      min="3"
                      max="15"
                      value={gcsScore ?? ''}
                      onChange={(e) => setField('gcsScore', e.target.value === '' ? null : Number(e.target.value))}
                      className="w-full mt-1"
                    />
                    <p className="text-xs text-content-muted text-center">{t('docSepsis.gcsLabel', { score: gcsScore ?? '—' })}</p>
                  </div>
                </div>
                <div className={`mt-4 p-4 rounded-lg text-center ${
                  !qsofaComplete ? 'bg-surface-sunken' : qsofaScore >= 2 ? 'bg-critical-subtle' : 'bg-ok-subtle'
                }`}>
                  <p className="text-sm font-medium text-content-secondary">{t('docSepsis.qsofaScore')}</p>
                  <p className={`text-4xl font-bold ${!qsofaComplete ? 'text-content-muted' : qsofaScore >= 2 ? 'text-critical-subtle-fg' : 'text-ok-subtle-fg'}`}>
                    {qsofaComplete ? `${qsofaScore}/3` : '—'}
                  </p>
                  {qsofaComplete && qsofaScore >= 2 && (
                    <p className="flex items-center gap-1 text-xs text-critical-subtle-fg mt-1">
                      <AlertTriangle size={12} aria-hidden="true" /> {t('docSepsis.qsofaHighRisk')}
                    </p>
                  )}
                </div>
              </div>

              {/* SOFA measurements.

                  These are the five inputs `_calculateSOFA` read and no
                  control ever wrote, pre-filled with normal values — so the
                  page submitted SOFA 0 for every patient. They are blank now,
                  and blank is sent as absent: the API scores an organ nobody
                  measured as unmeasured rather than as working. */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-1">
                  {t('docSepsis.sofaTitle')}
                </h2>
                <p className="text-xs text-content-muted mb-4">{t('docSepsis.sofaInfo')}</p>
                <div className="grid grid-cols-2 gap-3">
                  {SOFA_FIELDS.map(({ id, labelKey, value, field, step }) => (
                    <div key={id}>
                      <label htmlFor={`sepsis-${id}`} className="block text-xs text-content-secondary mb-1">
                        {t(labelKey)}
                      </label>
                      <input
                        id={`sepsis-${id}`}
                        type="number"
                        step={step}
                        min="0"
                        value={value}
                        onChange={(e) => setField(field, e.target.value)}
                        placeholder={t('docSepsis.notMeasured')}
                        className="w-full p-2 border border-border-interactive rounded text-sm"
                      />
                    </div>
                  ))}
                </div>
                <label htmlFor="sepsis-respiratory-support" className="flex items-center gap-2 mt-3 text-sm cursor-pointer min-h-[24px] py-1">
                  <input
                    id="sepsis-respiratory-support"
                    type="checkbox"
                    checked={respiratorySupport}
                    onChange={(e) => setField('respiratorySupport', e.target.checked)}
                    className="h-4 w-4 rounded border-border-interactive"
                  />
                  <span className="text-content-secondary">{t('docSepsis.respiratorySupport')}</span>
                </label>
                {/* The score is the server's, and only exists once filed. */}
                <div className="mt-4 p-4 rounded-lg text-center bg-surface-sunken">
                  <p className="text-sm font-medium text-content-secondary">{t('docSepsis.sofaScore')}</p>
                  <p className="text-4xl font-bold text-content">
                    {savedScores ? `${savedScores.sofa.total}/24` : '—'}
                  </p>
                  {savedScores && (
                    <p className="text-xs text-content-muted mt-1">
                      {t('docSepsis.sofaSystemsMeasured', {
                        measured: savedScores.sofa.systems_measured
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Middle Column - Hour-1 Bundle */}
            <div className="space-y-6">
              {/* Hour-1 Bundle */}
              <div className="bg-surface rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-content flex items-center">
                    <Clock className="h-5 w-5 mr-2 text-caution" />
                    {t('docSepsis.hour1BundleTitle')}
                  </h2>
                  {hour1Complete ? (
                    <span className="bg-ok-subtle text-ok-subtle-fg text-xs font-bold px-3 py-1 rounded-full">
                      {t('docSepsis.completeBadge')}
                    </span>
                  ) : (
                    <span className="bg-caution-subtle text-caution-subtle-fg text-xs font-bold px-3 py-1 rounded-full">
                      {hour1Bundle.filter(i => i.completed).length}/{hour1Bundle.length}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {hour1Bundle.map(item => (
                    <div
                      key={item.id}
                      {...clickable(() => toggleBundleItem('hour1', item.id))}
                      className={`p-4 rounded-lg cursor-pointer transition-all ${
                        item.completed
                          ? 'bg-ok-subtle border-2 border-green-500'
                          : 'bg-surface-sunken border-2 border-transparent hover:border-orange-300'
                      }`}
                    >
                      <div className="flex items-start">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center mr-3 ${
                          item.completed ? 'bg-green-500' : 'bg-gray-300'
                        }`}>
                          {item.completed ? (
                            <CheckCircle className="h-4 w-4 text-white" />
                          ) : (
                            <span className="w-3 h-3 bg-surface rounded-full" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={`font-medium ${item.completed ? 'text-ok-subtle-fg' : 'text-content-secondary'}`}>
                            {t(`docSepsis.hour1_${item.id}_label`)}
                          </p>
                          <p className="text-xs text-content-muted">{t(`docSepsis.hour1_${item.id}_desc`)}</p>
                          {item.completedAt && (
                            <p className="text-xs text-ok-subtle-fg mt-1">
                              ✓ {formatTimestamp(item.completedAt, { timeStyle: 'short' })}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lactate Trending */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4 flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2 text-caution" />
                  {t('docSepsis.lactateTrending')}
                </h2>
                <div className="flex space-x-2 mb-4">
                  <label htmlFor="sepsis-lactate" className="sr-only">{t('docSepsis.lactateInputLabel')}</label>
                  <input
                    id="sepsis-lactate"
                    type="number"
                    step="0.1"
                    value={newLactate}
                    onChange={(e) => setField('newLactate', e.target.value)}
                    placeholder={t('docSepsis.lactatePlaceholder')}
                    className="flex-1 p-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                  <button
                    type="button"
                    onClick={addLactateReading}
                    className="bg-orange-700 text-white px-4 py-2 rounded-lg hover:bg-orange-800"
                  >
                    {t('docSepsis.add')}
                  </button>
                </div>
                <div className="space-y-2">
                  {lactateReadings.length === 0 ? (
                    <p className="text-sm text-content-muted text-center py-4">{t('docSepsis.noLactateReadings')}</p>
                  ) : (
                    lactateReadings.map((reading, index) => (
                      <div key={index} className={`p-3 rounded-lg flex justify-between items-center ${
                        reading.value >= 4 ? 'bg-critical-subtle' : reading.value >= 2 ? 'bg-caution-subtle' : 'bg-ok-subtle'
                      }`}>
                        <div>
                          <span className={`text-lg font-bold ${
                            reading.value >= 4 ? 'text-critical-subtle-fg' : reading.value >= 2 ? 'text-caution-subtle-fg' : 'text-ok-subtle-fg'
                          }`}>
                            {reading.value} mmol/L
                          </span>
                          {reading.value >= 4 && (
                            <span className="ml-2 text-xs bg-critical-subtle text-critical-subtle-fg px-2 py-0.5 rounded">{t('docSepsis.critical')}</span>
                          )}
                        </div>
                        <span className="text-xs text-content-muted">
                          {formatTimestamp(reading.timestamp, { timeStyle: 'short' })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                {lactateReadings.length >= 2 && (
                  <div className="mt-3 p-3 bg-notice-subtle rounded-lg">
                    <p className="text-sm text-notice-subtle-fg">
                      {t('docSepsis.trendPrefix', { trend: lactateReadings[lactateReadings.length - 1].value < lactateReadings[0].value
                        ? t('docSepsis.trendImproving') : t('docSepsis.trendWorsening') })}
                    </p>
                    <p className="text-xs text-notice-subtle-fg">
                      {t('docSepsis.lactateTarget')}
                    </p>
                  </div>
                )}
              </div>

              {/* Infection Source */}
              <div className="bg-surface rounded-lg shadow p-6">
                <label htmlFor="sepsis-infection-source" className="text-lg font-semibold text-content mb-4 block">{t('docSepsis.infectionSource')}</label>
                <select
                  id="sepsis-infection-source"
                  value={infectionSource}
                  onChange={(e) => setField('infectionSource', e.target.value)}
                  className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500 mb-4"
                >
                  <option value="">{t('docSepsis.selectSource')}</option>
                  {infectionSources.map(src => (
                    <option key={src} value={src}>{t(`docSepsis.source_${INFECTION_SOURCE_KEYS[src]}`)}</option>
                  ))}
                </select>
                <label htmlFor="sepsis-suspected-organism" className="sr-only">{t('docSepsis.suspectedOrganismPlaceholder')}</label>
                <input
                  id="sepsis-suspected-organism"
                  type="text"
                  value={suspectedOrganism}
                  onChange={(e) => setField('suspectedOrganism', e.target.value)}
                  placeholder={t('docSepsis.suspectedOrganismPlaceholder')}
                  className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            {/* Right Column - Treatment & Documentation */}
            <div className="space-y-6">
              {/* Antibiotics */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4 flex items-center">
                  <Syringe className="h-5 w-5 mr-2 text-caution" />
                  {t('docSepsis.antibioticsAdministered')}
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {antibioticOptions.map(abx => (
                    <label key={abx} htmlFor={`sepsis-antibiotic-${abx.toLowerCase().replace(/[^a-z0-9]/g, '-')}`} className="flex items-center space-x-2 p-2 bg-surface-sunken rounded">
                      <input
                        id={`sepsis-antibiotic-${abx.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                        type="checkbox"
                        checked={antibioticsGiven.includes(abx)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setField('antibioticsGiven', [...antibioticsGiven, abx]);
                            if (antibioticsGiven.length === 0) {
                              completeBundleItem('hour1', 'antibiotics');
                            }
                          } else {
                            setField('antibioticsGiven', antibioticsGiven.filter(a => a !== abx));
                          }
                        }}
                        className="rounded border-border-interactive text-content-secondary focus:ring-orange-500"
                      />
                      <span className="text-sm">{abx}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Fluid Resuscitation */}
              <div className="bg-surface rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-content mb-4 flex items-center">
                  <Droplets className="h-5 w-5 mr-2 text-caution" />
                  {t('docSepsis.fluidResuscitation')}
                </h2>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="sepsis-fluid-volume" className="block text-sm font-medium text-content-secondary mb-1">
                      {t('docSepsis.crystalloidVolume')}
                    </label>
                    <input
                      id="sepsis-fluid-volume"
                      type="number"
                      value={fluidVolume}
                      onChange={(e) => {
                        setField('fluidVolume', parseInt(e.target.value));
                        if (parseInt(e.target.value) >= 2000) {
                          completeBundleItem('hour1', 'fluids');
                        }
                      }}
                      placeholder={t('docSepsis.fluidVolumePlaceholder')}
                      className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                    />
                    {selectedPatientData && fluidVolume > 0 && (
                      <p className="text-xs text-content-muted mt-1">
                        {t('docSepsis.fluidTarget', { volume: Math.round(70 * 30) })}
                      </p>
                    )}
                  </div>
                  <div>
                    <ChoiceChips
                      id="sepsis-vasopressor"
                      label={t('docSepsis.vasopressorLabel')}
                      value={(vasopressorType) || undefined}
                      onChange={(chosen) => { const next = chosen ?? ''; setField('vasopressorType', next);
                        if (next) {
                          completeBundleItem('hour1', 'vasopressors');
                        } }}
                      options={[
                        { value: 'norepinephrine', label: 'Norepinephrine (1st line)' },
                        { value: 'vasopressin', label: 'Vasopressin' },
                        { value: 'epinephrine', label: 'Epinephrine' },
                        { value: 'dopamine', label: 'Dopamine' },
                        { value: 'phenylephrine', label: 'Phenylephrine' },
                      ]}
                    />
                  </div>
                </div>
              </div>

              {/* 3-Hour Bundle */}
              <div className="bg-surface rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-content">{t('docSepsis.hour3Title')}</h2>
                  {hour3Complete ? (
                    <span className="bg-ok-subtle text-ok-subtle-fg text-xs font-bold px-3 py-1 rounded-full">
                      {t('docSepsis.completeBadge')}
                    </span>
                  ) : (
                    <span className="bg-surface-sunken text-content-muted text-xs font-bold px-3 py-1 rounded-full">
                      {hour3Bundle.filter(i => i.completed).length}/{hour3Bundle.length}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {hour3Bundle.map(item => (
                    <div
                      key={item.id}
                      {...clickable(() => toggleBundleItem('hour3', item.id))}
                      className={`p-3 rounded-lg cursor-pointer text-sm ${
                        item.completed
                          ? 'bg-ok-subtle border border-ok'
                          : 'bg-surface-sunken hover:bg-surface-sunken'
                      }`}
                    >
                      <div className="flex items-center">
                        {item.completed ? (
                          <CheckCircle className="h-4 w-4 text-ok mr-2" />
                        ) : (
                          <XCircle className="h-4 w-4 text-content-muted mr-2" />
                        )}
                        <span>{t(`docSepsis.hour3_${item.id}_label`)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Clinical Narrative */}
              <div className="bg-surface rounded-lg shadow p-6">
                <label htmlFor="sepsis-narrative" className="text-lg font-semibold text-content mb-4 block">{t('docSepsis.clinicalNarrative')}</label>
                <textarea
                  id="sepsis-narrative"
                  value={narrative}
                  onChange={(e) => setField('narrative', e.target.value)}
                  placeholder={t('docSepsis.narrativePlaceholder')}
                  rows={5}
                  className="w-full p-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="mt-6 flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => returnAfterSave()}
              className="px-6 py-3 bg-surface-sunken text-content-secondary rounded-lg hover:bg-gray-300"
            >
              {t('docSepsis.cancel')}
            </button>
            <button
              type="submit"
              aria-disabled={isSubmitting || undefined}
              className="aria-disabled:cursor-wait px-6 py-3 bg-orange-700 text-white rounded-lg hover:bg-orange-800 flex items-center"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  {t('docSepsis.saving')}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t('docSepsis.saveSepsisProtocol')}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
