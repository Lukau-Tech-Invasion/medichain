import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { createStroke, getPatients, getPatientStrokes, formatTimestamp, notifySuccess, useTranslation, type StrokeListRow, ChoiceChips, submitOnce, useSubmission } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import {
  Activity,
  Brain,
  Clock,
  Save,
  Search,
  CheckCircle,
  History
} from 'lucide-react';
import PatientSelect from '../components/PatientSelect';
import { useReturnAfterSave } from '../workspace/useReturnAfterSave';



export default function StrokePage() {
  const { t } = useTranslation();
  const returnAfterSave = useReturnAfterSave();
  const { user } = useAuthStore();
  const { showError } = useToastActions();
  // The roster this page fetched existed only to fill a patient dropdown.
  // `PatientSelect` queries the server as the clinician types.
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  // The list endpoint returns summary rows keyed `id`. This panel read
  // `event_id`, `event_type` and `outcome` off them -- names from the
  // full-record shape -- so every row showed a blank ID and "N/A".
  const [emergencyHistory, setEmergencyHistory] = useState<StrokeListRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const submission = useSubmission('stroke');
  
  // Stroke Assessment State
  const [lastKnownWell, setLastKnownWell] = useState('');
  const [symptomOnset, setSymptomOnset] = useState('');
  const [nihssScore, setNihssScore] = useState<number>(0);
  
  // FAST Assessment
  const [faceDroop, setFaceDroop] = useState(false);
  const [armDrift, setArmDrift] = useState(false);
  const [speechDifficulty, setSpeechDifficulty] = useState(false);
  
  // Clinical Data
  const [bloodGlucose, setBloodGlucose] = useState('');
  const [ctHeadResult, setCtHeadResult] = useState('pending');
  const [tpaCandidate, setTpaCandidate] = useState('evaluating');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    try {
      await getPatients();
    } catch (error) {
      // ux-allow(console-catch): a warm-up whose result is discarded; nothing on screen depends on it (debt register).
      console.error('Failed to load patients', error);
    }
  };

  const fetchEmergencyHistory = async (patientId: string) => {
    if (!user || !patientId) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      setEmergencyHistory(await getPatientStrokes(patientId));
    } catch {
      // Not "no events": a history that could not be read is unknown.
      setEmergencyHistory([]);
      setHistoryError(t('docStroke.errorLoadHistory'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Said in words; the button is no longer greyed out to mean "choose a patient".
    if (!selectedPatient) { showError(t('docStroke.errorSelectPatient')); return; }

    try {
      const strokeData = {
        patient_id: selectedPatient,
        last_known_well: new Date(lastKnownWell).getTime() / 1000,
        symptom_onset: new Date(symptomOnset).getTime() / 1000,
        fast_exam: {
          face: faceDroop,
          arms: armDrift,
          speech: speechDifficulty,
          time: true // Implied by filling the form
        },
        nihss_score: nihssScore,
        blood_glucose: parseFloat(bloodGlucose),
        ct_head_interpretation: ctHeadResult,
        tpa_eligibility: tpaCandidate,
        notes,
        assessed_at: Math.floor(Date.now() / 1000)
      };

      // One record per event: a double click or a retry is the same submission.
      const saved = await submitOnce(submission, strokeData, () => createStroke(strokeData));
      if (saved === 'busy') return;
      notifySuccess(t(saved === 'saved' ? 'forms.saved' : saved === 'duplicate' ? 'forms.alreadySaved' : 'forms.queued'));
      returnAfterSave();
    } catch (error) {
      console.error('Failed to save stroke assessment', error);
      showError(t('docStroke.saveFailed'));
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-content flex items-center">
          <Brain className="h-8 w-8 text-content-secondary mr-3" />
          {t('docStroke.title')}
        </h1>
        <p className="mt-2 text-content-muted">
          {t('docStroke.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Patient Selection */}
        <div className="bg-surface shadow rounded-lg p-6">
          <label htmlFor="stroke-patient" className="block text-sm font-medium text-content-secondary mb-2">
            {t('docStroke.selectPatient')}
          </label>
          <div className="relative max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-content-muted" />
            </div>
            <PatientSelect
              id="stroke-patient"
              value={selectedPatient}
              onChange={(selectedPatientId) => { setSelectedPatient(selectedPatientId); fetchEmergencyHistory(selectedPatientId); }}
              required
            />
          </div>
        </div>

        {/* Emergency History */}
        {selectedPatient && (
          <div className="bg-surface shadow rounded-lg p-6">
            <h3 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
              <History className="h-5 w-5 text-purple-500" />
              {t('docStroke.pastEvents')}
            </h3>
            {historyLoading ? (
              <p className="text-content-muted text-sm">{t('docStroke.loadingHistory')}</p>
            ) : historyError ? (
              <p role="alert" className="text-sm text-critical-subtle-fg">{historyError}</p>
            ) : emergencyHistory.length === 0 ? (
              <p className="text-content-muted text-sm italic">{t('docStroke.noEvents')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-sunken">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-content-muted">{t('docStroke.colEventId')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-content-muted">{t('docStroke.colNihss')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-content-muted">{t('docStroke.colTime')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-content-muted">{t('docStroke.colTpaEligible')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {emergencyHistory.map((ev) => (
                      <tr key={ev.id} className="hover:bg-surface-sunken">
                        <td className="px-4 py-2 font-mono text-xs">{ev.id}</td>
                        <td className="px-4 py-2">{ev.nihss_total ?? t('docStroke.na')}</td>
                        <td className="px-4 py-2">{formatTimestamp(ev.assessed_at * 1000) || '-'}</td>
                        <td className="px-4 py-2">
                          {ev.tpa_eligible === null
                            ? t('docStroke.na')
                            : ev.tpa_eligible ? t('docStroke.yes') : t('docStroke.no')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Timing & FAST */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-surface shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-content mb-4 flex items-center">
              <Clock className="h-5 w-5 mr-2 text-content-muted" />
              {t('docStroke.criticalTiming')}
            </h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="stroke-last-known-well" className="block text-sm font-medium text-content-secondary">{t('docStroke.lastKnownWell')}</label>
                <input
                  id="stroke-last-known-well"
                  type="datetime-local"
                  className="mt-1 block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  value={lastKnownWell}
                  onChange={(e) => setLastKnownWell(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="stroke-symptom-onset" className="block text-sm font-medium text-content-secondary">{t('docStroke.symptomDiscovery')}</label>
                <input
                  id="stroke-symptom-onset"
                  type="datetime-local"
                  className="mt-1 block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  value={symptomOnset}
                  onChange={(e) => setSymptomOnset(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="bg-surface shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-content mb-4 flex items-center">
              <Activity className="h-5 w-5 mr-2 text-content-muted" />
              {t('docStroke.fastAssessment')}
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-content-secondary">{t('docStroke.faceDrooping')}</span>
                <button
                  type="button"
                  onClick={() => setFaceDroop(!faceDroop)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${faceDroop ? 'bg-critical-subtle text-critical-subtle-fg' : 'bg-surface-sunken text-content-secondary'}`}
                >
                  {faceDroop ? t('docStroke.present') : t('docStroke.absent')}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-content-secondary">{t('docStroke.armWeakness')}</span>
                <button
                  type="button"
                  onClick={() => setArmDrift(!armDrift)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${armDrift ? 'bg-critical-subtle text-critical-subtle-fg' : 'bg-surface-sunken text-content-secondary'}`}
                >
                  {armDrift ? t('docStroke.present') : t('docStroke.absent')}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-content-secondary">{t('docStroke.speechDifficulty')}</span>
                <button
                  type="button"
                  onClick={() => setSpeechDifficulty(!speechDifficulty)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${speechDifficulty ? 'bg-critical-subtle text-critical-subtle-fg' : 'bg-surface-sunken text-content-secondary'}`}
                >
                  {speechDifficulty ? t('docStroke.present') : t('docStroke.absent')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Clinical Data */}
        <div className="bg-surface shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-content mb-4 flex items-center">
            <CheckCircle className="h-5 w-5 mr-2 text-content-muted" />
            {t('docStroke.clinicalData')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="stroke-nihss-score" className="block text-sm font-medium text-content-secondary">{t('docStroke.nihssScore')}</label>
              <input
                id="stroke-nihss-score"
                type="number"
                min="0"
                max="42"
                className="mt-1 block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                value={nihssScore}
                onChange={(e) => setNihssScore(parseInt(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="stroke-blood-glucose" className="block text-sm font-medium text-content-secondary">{t('docStroke.bloodGlucose')}</label>
              <input
                id="stroke-blood-glucose"
                type="number"
                step="0.1"
                className="mt-1 block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                value={bloodGlucose}
                onChange={(e) => setBloodGlucose(e.target.value)}
              />
            </div>
            <div>
              <ChoiceChips
                id="stroke-ct-head-result"
                label={t('docStroke.ctHeadResult')}
                value={ctHeadResult}
                onChange={(next) => { if (next === undefined) return; setCtHeadResult(next); }}
                options={[
                  { value: 'pending', label: t('docStroke.ctPending') },
                  { value: 'negative', label: t('docStroke.ctNegative') },
                  { value: 'hemorrhage', label: t('docStroke.ctHemorrhage') },
                  { value: 'infarct', label: t('docStroke.ctInfarct') },
                  { value: 'tumor', label: t('docStroke.ctTumor') },
                ]}
              />
            </div>
            <div>
              <ChoiceChips
                id="stroke-tpa-eligibility"
                label={t('docStroke.tpaEligibility')}
                value={tpaCandidate}
                onChange={(next) => { if (next === undefined) return; setTpaCandidate(next); }}
                options={[
                  { value: 'evaluating', label: t('docStroke.tpaEvaluating') },
                  { value: 'eligible', label: t('docStroke.tpaEligible') },
                  { value: 'contraindicated', label: t('docStroke.tpaContraindicated') },
                  { value: 'refused', label: t('docStroke.tpaRefused') },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-surface shadow rounded-lg p-6">
          <label htmlFor="stroke-notes" className="block text-sm font-medium text-content-secondary mb-2">{t('docStroke.additionalNotes')}</label>
          <textarea
            id="stroke-notes"
            rows={4}
            className="block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            aria-disabled={submission.status === 'saving' || undefined}
            className="aria-disabled:cursor-wait flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700"
          >
            <Save className="h-5 w-5 mr-2" />
            {t('docStroke.saveAssessment')}
          </button>
        </div>
      </form>
    </div>
  );
}
