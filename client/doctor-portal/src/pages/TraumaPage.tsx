import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createTrauma, getPatients, apiUrl, useTranslation } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import {
  AlertCircle,
  Save,
  Search,
  Activity,
  Shield,
  History
} from 'lucide-react';

interface EmergencyRecord {
  event_id: string;
  event_type?: string;
  event_time?: number;
  assessed_at?: number;
  outcome?: string;
}

export default function TraumaPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { showError } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [emergencyHistory, setEmergencyHistory] = useState<EmergencyRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  // Trauma Form State
  const [traumaType, setTraumaType] = useState('blunt');
  const [mechanism, setMechanism] = useState('');
  const [gcsScore, setGcsScore] = useState(15);
  const [issScore, setIssScore] = useState(0);
  
  // Primary Survey
  const [airway, setAirway] = useState('patent');
  const [breathing, setBreathing] = useState('spontaneous');
  const [circulation, setCirculation] = useState('stable');
  const [disability, setDisability] = useState('alert');
  const [exposure, _setExposure] = useState('none');

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
      console.error('Failed to fetch emergency history', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;

    try {
      const traumaData = {
        assessment_id: `TR-${Date.now()}`,
        patient_id: selectedPatient,
        trauma_type: traumaType,
        injury_severity_score: issScore,
        gcs_score: gcsScore,
        mechanism_of_injury: mechanism,
        injuries: [], // Injuries added via injury documentation form
        interventions: [],
        vital_signs: {
          // Default vitals - updated from patient monitoring
          bp: "120/80",
          hr: 80,
          rr: 16,
          spo2: 98
        },
        notes: `Primary Survey:\nA: ${airway}\nB: ${breathing}\nC: ${circulation}\nD: ${disability}\nE: ${exposure}\n\nNotes: ${notes}`,
        assessed_by: user?.userId || 'unknown',
        assessed_at: Math.floor(Date.now() / 1000)
      };

      await createTrauma(traumaData);
      navigate('/dashboard');
    } catch (error) {
      console.error('Failed to save trauma assessment', error);
      showError(t('docTrauma.saveFailed'));
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <Shield className="h-8 w-8 text-red-600 mr-3" />
          {t('docTrauma.title')}
        </h1>
        <p className="mt-2 text-gray-600">
          {t('docTrauma.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Patient Selection */}
        <div className="bg-white shadow rounded-lg p-6">
          <label htmlFor="trauma-patient" className="block text-sm font-medium text-gray-700 mb-2">
            {t('docTrauma.selectPatient')}
          </label>
          <div className="relative max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <select
              id="trauma-patient"
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              value={selectedPatient}
              onChange={(e) => { setSelectedPatient(e.target.value); fetchEmergencyHistory(e.target.value); }}
              required
            >
              <option value="">{t('docTrauma.selectPatientPlaceholder')}</option>
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
              <History className="h-5 w-5 text-red-500" />
              {t('docTrauma.pastEvents')}
            </h3>
            {historyLoading ? (
              <p className="text-gray-500 text-sm">{t('docTrauma.loadingHistory')}</p>
            ) : emergencyHistory.length === 0 ? (
              <p className="text-gray-400 text-sm italic">{t('docTrauma.noEvents')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('docTrauma.colEventId')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('docTrauma.colType')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('docTrauma.colTime')}</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">{t('docTrauma.colOutcome')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {emergencyHistory.map((ev) => (
                      <tr key={ev.event_id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs">{ev.event_id}</td>
                        <td className="px-4 py-2">{ev.event_type || t('docTrauma.trauma')}</td>
                        <td className="px-4 py-2">
                          {ev.assessed_at ? new Date(ev.assessed_at * 1000).toLocaleString() :
                           ev.event_time ? new Date(ev.event_time * 1000).toLocaleString() : '-'}
                        </td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {ev.outcome || t('docTrauma.na')}
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

        {/* Mechanism & Overview */}
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <AlertCircle className="h-5 w-5 mr-2 text-gray-500" />
            {t('docTrauma.injuryOverview')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="trauma-type" className="block text-sm font-medium text-gray-700">{t('docTrauma.traumaType')}</label>
              <select
                id="trauma-type"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={traumaType}
                onChange={(e) => setTraumaType(e.target.value)}
              >
                <option value="blunt">{t('docTrauma.typeBlunt')}</option>
                <option value="penetrating">{t('docTrauma.typePenetrating')}</option>
                <option value="burn">{t('docTrauma.typeBurn')}</option>
                <option value="blast">{t('docTrauma.typeBlast')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="trauma-mechanism" className="block text-sm font-medium text-gray-700">{t('docTrauma.mechanism')}</label>
              <input
                id="trauma-mechanism"
                type="text"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder={t('docTrauma.mechanismPlaceholder')}
                value={mechanism}
                onChange={(e) => setMechanism(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="trauma-gcs" className="block text-sm font-medium text-gray-700">{t('docTrauma.gcsScore')}</label>
              <input
                id="trauma-gcs"
                type="number"
                min="3"
                max="15"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={gcsScore}
                onChange={(e) => setGcsScore(parseInt(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="trauma-iss" className="block text-sm font-medium text-gray-700">{t('docTrauma.issScore')}</label>
              <input
                id="trauma-iss"
                type="number"
                min="0"
                max="75"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={issScore}
                onChange={(e) => setIssScore(parseInt(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Primary Survey (ABCDE) */}
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <Activity className="h-5 w-5 mr-2 text-gray-500" />
            {t('docTrauma.primarySurvey')}
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <label htmlFor="trauma-airway" className="font-medium text-gray-700">{t('docTrauma.airway')}</label>
              <select
                id="trauma-airway"
                className="md:col-span-2 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={airway}
                onChange={(e) => setAirway(e.target.value)}
              >
                <option value="patent">{t('docTrauma.airwayPatent')}</option>
                <option value="obstructed">{t('docTrauma.airwayObstructed')}</option>
                <option value="intubated">{t('docTrauma.airwayIntubated')}</option>
                <option value="c-spine">{t('docTrauma.airwayCSpine')}</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <label htmlFor="trauma-breathing" className="font-medium text-gray-700">{t('docTrauma.breathing')}</label>
              <select
                id="trauma-breathing"
                className="md:col-span-2 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={breathing}
                onChange={(e) => setBreathing(e.target.value)}
              >
                <option value="spontaneous">{t('docTrauma.breathingSpontaneous')}</option>
                <option value="labored">{t('docTrauma.breathingLabored')}</option>
                <option value="absent">{t('docTrauma.breathingAbsent')}</option>
                <option value="ventilated">{t('docTrauma.breathingVentilated')}</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <label htmlFor="trauma-circulation" className="font-medium text-gray-700">{t('docTrauma.circulation')}</label>
              <select
                id="trauma-circulation"
                className="md:col-span-2 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={circulation}
                onChange={(e) => setCirculation(e.target.value)}
              >
                <option value="stable">{t('docTrauma.circStable')}</option>
                <option value="tachycardic">{t('docTrauma.circTachycardic')}</option>
                <option value="weak">{t('docTrauma.circWeak')}</option>
                <option value="absent">{t('docTrauma.circAbsent')}</option>
                <option value="hemorrhage">{t('docTrauma.circHemorrhage')}</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <label htmlFor="trauma-disability" className="font-medium text-gray-700">{t('docTrauma.disability')}</label>
              <select
                id="trauma-disability"
                className="md:col-span-2 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={disability}
                onChange={(e) => setDisability(e.target.value)}
              >
                <option value="alert">{t('docTrauma.disAlert')}</option>
                <option value="voice">{t('docTrauma.disVoice')}</option>
                <option value="pain">{t('docTrauma.disPain')}</option>
                <option value="unresponsive">{t('docTrauma.disUnresponsive')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white shadow rounded-lg p-6">
          <label htmlFor="trauma-notes" className="block text-sm font-medium text-gray-700 mb-2">{t('docTrauma.additionalNotes')}</label>
          <textarea
            id="trauma-notes"
            rows={4}
            className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!selectedPatient}
            className="flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Save className="h-5 w-5 mr-2" />
            {t('docTrauma.saveAssessment')}
          </button>
        </div>
      </form>
    </div>
  );
}
