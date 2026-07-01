import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createStroke, getPatients, apiUrl, useTranslation } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
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

export default function StrokePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { showError } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [emergencyHistory, setEmergencyHistory] = useState<Array<{event_id: string; event_type?: string; event_time?: number; assessed_at?: number; outcome?: string}>>([]);
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
      const data = await getPatients();
      setPatients(data);
    } catch (error) {
      console.error('Failed to load patients', error);
    }
  };

  const fetchEmergencyHistory = async (patientId: string) => {
    if (!user || !patientId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/clinical/patient/${patientId}/emergency`), {
        headers: { 'X-User-Id': user.walletAddress, 'X-Provider-Role': user.role },
      });
      if (res.ok) {
        const data = await res.json();
        setEmergencyHistory(data.events || data || []);
      }
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
        assessment_id: `STR-${Date.now()}`,
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
        assessed_by: user?.userId || 'unknown',
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
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <Brain className="h-8 w-8 text-purple-600 mr-3" />
          {t('docStroke.title')}
        </h1>
        <p className="mt-2 text-gray-600">
          {t('docStroke.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Patient Selection */}
        <div className="bg-white shadow rounded-lg p-6">
          <label htmlFor="stroke-patient" className="block text-sm font-medium text-gray-700 mb-2">
            {t('docStroke.selectPatient')}
          </label>
          <div className="relative max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <select
              id="stroke-patient"
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
              value={selectedPatient}
              onChange={(e) => { setSelectedPatient(e.target.value); fetchEmergencyHistory(e.target.value); }}
              required
            >
              <option value="">{t('docStroke.selectPatientPlaceholder')}</option>
              {patients.map(patient => (
                <option key={patient.patient_id} value={patient.patient_id}>
                  {patient.full_name} ({patient.national_id})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Emergency History */}
        {selectedPatient && (
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <History className="h-5 w-5 text-purple-500" />
              {t('docStroke.pastEvents')}
            </h3>
            {historyLoading ? (
              <p className="text-gray-500 text-sm">{t('docStroke.loadingHistory')}</p>
            ) : emergencyHistory.length === 0 ? (
              <p className="text-gray-400 text-sm italic">{t('docStroke.noEvents')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('docStroke.colEventId')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('docStroke.colType')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('docStroke.colTime')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('docStroke.colOutcome')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {emergencyHistory.map((ev) => (
                      <tr key={ev.event_id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs">{ev.event_id}</td>
                        <td className="px-4 py-2">{ev.event_type || t('docStroke.stroke')}</td>
                        <td className="px-4 py-2">
                          {ev.assessed_at ? new Date(ev.assessed_at * 1000).toLocaleString() :
                           ev.event_time ? new Date(ev.event_time * 1000).toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                            {ev.outcome || t('docStroke.na')}
                          </span>
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
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Clock className="h-5 w-5 mr-2 text-gray-500" />
              {t('docStroke.criticalTiming')}
            </h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="stroke-last-known-well" className="block text-sm font-medium text-gray-700">{t('docStroke.lastKnownWell')}</label>
                <input
                  id="stroke-last-known-well"
                  type="datetime-local"
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  value={lastKnownWell}
                  onChange={(e) => setLastKnownWell(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="stroke-symptom-onset" className="block text-sm font-medium text-gray-700">{t('docStroke.symptomDiscovery')}</label>
                <input
                  id="stroke-symptom-onset"
                  type="datetime-local"
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  value={symptomOnset}
                  onChange={(e) => setSymptomOnset(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Activity className="h-5 w-5 mr-2 text-gray-500" />
              {t('docStroke.fastAssessment')}
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{t('docStroke.faceDrooping')}</span>
                <button
                  type="button"
                  onClick={() => setFaceDroop(!faceDroop)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${faceDroop ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}
                >
                  {faceDroop ? t('docStroke.present') : t('docStroke.absent')}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{t('docStroke.armWeakness')}</span>
                <button
                  type="button"
                  onClick={() => setArmDrift(!armDrift)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${armDrift ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}
                >
                  {armDrift ? t('docStroke.present') : t('docStroke.absent')}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{t('docStroke.speechDifficulty')}</span>
                <button
                  type="button"
                  onClick={() => setSpeechDifficulty(!speechDifficulty)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${speechDifficulty ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}
                >
                  {speechDifficulty ? t('docStroke.present') : t('docStroke.absent')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Clinical Data */}
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <CheckCircle className="h-5 w-5 mr-2 text-gray-500" />
            {t('docStroke.clinicalData')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="stroke-nihss-score" className="block text-sm font-medium text-gray-700">{t('docStroke.nihssScore')}</label>
              <input
                id="stroke-nihss-score"
                type="number"
                min="0"
                max="42"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                value={nihssScore}
                onChange={(e) => setNihssScore(parseInt(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="stroke-blood-glucose" className="block text-sm font-medium text-gray-700">{t('docStroke.bloodGlucose')}</label>
              <input
                id="stroke-blood-glucose"
                type="number"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                value={bloodGlucose}
                onChange={(e) => setBloodGlucose(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="stroke-ct-head-result" className="block text-sm font-medium text-gray-700">{t('docStroke.ctHeadResult')}</label>
              <select
                id="stroke-ct-head-result"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
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
              <label htmlFor="stroke-tpa-eligibility" className="block text-sm font-medium text-gray-700">{t('docStroke.tpaEligibility')}</label>
              <select
                id="stroke-tpa-eligibility"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
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
        <div className="bg-white shadow rounded-lg p-6">
          <label htmlFor="stroke-notes" className="block text-sm font-medium text-gray-700 mb-2">{t('docStroke.additionalNotes')}</label>
          <textarea
            id="stroke-notes"
            rows={4}
            className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!selectedPatient}
            className="flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Save className="h-5 w-5 mr-2" />
            {t('docStroke.saveAssessment')}
          </button>
        </div>
      </form>
    </div>
  );
}
