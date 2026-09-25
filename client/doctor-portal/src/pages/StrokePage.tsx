import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createStroke, getPatients, getPatientStrokes, formatTimestamp, useTranslation, type StrokeListRow } from '@medichain/shared';
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



export default function StrokePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
      console.error('Failed to load patients', error);
    }
  };

  const fetchEmergencyHistory = async (patientId: string) => {
    if (!user || !patientId) return;
    setHistoryLoading(true);
    try {
      setEmergencyHistory(await getPatientStrokes(patientId));
    } catch (e) {
      console.error(e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;

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

      await createStroke(strokeData);
      navigate('/dashboard');
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
              <label htmlFor="stroke-ct-head-result" className="block text-sm font-medium text-content-secondary">{t('docStroke.ctHeadResult')}</label>
              <select
                id="stroke-ct-head-result"
                className="mt-1 block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                value={ctHeadResult}
                onChange={(e) => setCtHeadResult(e.target.value)}
              >
                <option value="pending">{t('docStroke.ctPending')}</option>
                <option value="negative">{t('docStroke.ctNegative')}</option>
                <option value="hemorrhage">{t('docStroke.ctHemorrhage')}</option>
                <option value="infarct">{t('docStroke.ctInfarct')}</option>
                <option value="tumor">{t('docStroke.ctTumor')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="stroke-tpa-eligibility" className="block text-sm font-medium text-content-secondary">{t('docStroke.tpaEligibility')}</label>
              <select
                id="stroke-tpa-eligibility"
                className="mt-1 block w-full border border-border-interactive rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                value={tpaCandidate}
                onChange={(e) => setTpaCandidate(e.target.value)}
              >
                <option value="evaluating">{t('docStroke.tpaEvaluating')}</option>
                <option value="eligible">{t('docStroke.tpaEligible')}</option>
                <option value="contraindicated">{t('docStroke.tpaContraindicated')}</option>
                <option value="refused">{t('docStroke.tpaRefused')}</option>
              </select>
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
            disabled={!selectedPatient}
            className="flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 disabled:bg-disabled disabled:text-disabled-fg disabled:cursor-not-allowed"
          >
            <Save className="h-5 w-5 mr-2" />
            {t('docStroke.saveAssessment')}
          </button>
        </div>
      </form>
    </div>
  );
}
