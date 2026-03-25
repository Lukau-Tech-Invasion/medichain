import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createCodeBlue, getPatients, apiUrl } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import {
  Activity,
  AlertTriangle,
  Clock,
  Heart,
  Save,
  Search,
  Zap,
  Syringe,
  Play,
  Square,
  History
} from 'lucide-react';

interface EmergencyRecord {
  event_id: string;
  patient_id: string;
  event_type?: string;
  event_time?: number;
  code_called_at?: number;
  outcome?: string;
  narrative?: string;
}

export default function CodeBluePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { showError } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [emergencyHistory, setEmergencyHistory] = useState<EmergencyRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [events, setEvents] = useState<string[]>([]);
  const [teamMembers, setTeamMembers] = useState<string>('');
  const [narrative, setNarrative] = useState('');
  const [outcome, setOutcome] = useState('ongoing');

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isActive && startTime) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isActive, startTime]);

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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startCode = () => {
    if (!selectedPatient) return;
    setStartTime(Date.now());
    setIsActive(true);
    logEvent('Code Blue Started');
  };

  const stopCode = () => {
    setIsActive(false);
    logEvent('Code Blue Ended');
  };

  const logEvent = (event: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setEvents(prev => [`[${timestamp}] ${event}`, ...prev]);
  };

  const handleSubmit = async () => {
    if (!selectedPatient || !startTime) return;

    try {
      const codeData = {
        event_id: `CB-${Date.now()}`,
        patient_id: selectedPatient,
        code_called_at: Math.floor(startTime / 1000),
        code_called_by: user?.userId || 'unknown',
        location: 'Emergency Department',
        primary_cause: 'Cardiac Arrest',
        outcome,
        narrative: narrative + '\n\nLog:\n' + events.join('\n'),
        team_members: teamMembers.split(',').map(s => s.trim()),
        medications_administered: events.filter(e => e.includes('Medication')).map(e => e.replace(/.*Medication: /, '')),
        shocks_delivered: events.filter(e => e.includes('Shock')).length,
        cpr_cycles: events.filter(e => e.includes('CPR')).length,
      };

      await createCodeBlue(codeData);
      navigate('/dashboard');
    } catch (error) {
      console.error('Failed to save code blue record', error);
      showError('Failed to save record. Please try again.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <AlertTriangle className="h-8 w-8 text-red-600 mr-3" />
          Code Blue Management
        </h1>
        <p className="mt-2 text-gray-600">
          Real-time resuscitation documentation and event logging.
        </p>
      </div>

      {/* Emergency History */}
      {selectedPatient && (
        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <History className="h-5 w-5 text-red-500" />
            Past Emergency Events
          </h2>
          {historyLoading ? (
            <p className="text-gray-500 text-sm">Loading history...</p>
          ) : emergencyHistory.length === 0 ? (
            <p className="text-gray-400 text-sm italic">No prior emergency events recorded for this patient.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Event ID</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Time</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {emergencyHistory.map((ev) => (
                    <tr key={ev.event_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{ev.event_id}</td>
                      <td className="px-4 py-2">{ev.event_type || 'Code Blue'}</td>
                      <td className="px-4 py-2">
                        {ev.code_called_at ? new Date(ev.code_called_at * 1000).toLocaleString() :
                         ev.event_time ? new Date(ev.event_time * 1000).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          ev.outcome === 'rosc' ? 'bg-green-100 text-green-700' :
                          ev.outcome === 'expired' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {ev.outcome || 'Unknown'}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Controls & Patient */}
        <div className="lg:col-span-2 space-y-6">
          {/* Patient Selection */}
          <div className="bg-white shadow rounded-lg p-6">
            <label htmlFor="code-blue-patient" className="block text-sm font-medium text-gray-700 mb-2">
              Select Patient
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <select
                id="code-blue-patient"
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={selectedPatient}
                onChange={(e) => { setSelectedPatient(e.target.value); fetchEmergencyHistory(e.target.value); }}
                disabled={isActive}
              >
                <option value="">Select a patient...</option>
                {patients.map(patient => (
                  <option key={patient.patient_id} value={patient.patient_id}>
                    {patient.full_name} ({patient.national_id})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Timer & Main Controls */}
          <div className="bg-white shadow rounded-lg p-6 text-center">
            <div className="text-6xl font-mono font-bold text-gray-900 mb-6">
              {formatTime(elapsedTime)}
            </div>
            
            <div className="flex justify-center space-x-4">
              {!isActive ? (
                <button
                  onClick={startCode}
                  disabled={!selectedPatient}
                  className={`flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white ${
                    selectedPatient ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'
                  }`}
                >
                  <Play className="h-5 w-5 mr-2" />
                  Start Code
                </button>
              ) : (
                <button
                  onClick={stopCode}
                  className="flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
                >
                  <Square className="h-5 w-5 mr-2" />
                  Stop Code
                </button>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <button
                onClick={() => logEvent('CPR Cycle Started')}
                disabled={!isActive}
                className="flex flex-col items-center justify-center p-4 border-2 border-blue-100 rounded-lg hover:bg-blue-50 disabled:opacity-50"
              >
                <Activity className="h-8 w-8 text-blue-600 mb-2" />
                <span className="text-sm font-medium text-gray-900">CPR Cycle</span>
              </button>
              
              <button
                onClick={() => logEvent('Shock Delivered - 200J')}
                disabled={!isActive}
                className="flex flex-col items-center justify-center p-4 border-2 border-yellow-100 rounded-lg hover:bg-yellow-50 disabled:opacity-50"
              >
                <Zap className="h-8 w-8 text-yellow-600 mb-2" />
                <span className="text-sm font-medium text-gray-900">Shock</span>
              </button>

              <button
                onClick={() => logEvent('Medication: Epinephrine 1mg')}
                disabled={!isActive}
                className="flex flex-col items-center justify-center p-4 border-2 border-purple-100 rounded-lg hover:bg-purple-50 disabled:opacity-50"
              >
                <Syringe className="h-8 w-8 text-purple-600 mb-2" />
                <span className="text-sm font-medium text-gray-900">Epi 1mg</span>
              </button>

              <button
                onClick={() => logEvent('Pulse Check - Pulse Present')}
                disabled={!isActive}
                className="flex flex-col items-center justify-center p-4 border-2 border-green-100 rounded-lg hover:bg-green-50 disabled:opacity-50"
              >
                <Heart className="h-8 w-8 text-green-600 mb-2" />
                <span className="text-sm font-medium text-gray-900">ROSC</span>
              </button>
            </div>
          </div>

          {/* Documentation */}
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Documentation</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="code-blue-team" className="block text-sm font-medium text-gray-700">Team Members</label>
                <input
                  id="code-blue-team"
                  type="text"
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Dr. X, Nurse Y, RT Z..."
                  value={teamMembers}
                  onChange={(e) => setTeamMembers(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="code-blue-narrative" className="block text-sm font-medium text-gray-700">Narrative Note</label>
                <textarea
                  id="code-blue-narrative"
                  rows={4}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  value={narrative}
                  onChange={(e) => setNarrative(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="code-blue-outcome" className="block text-sm font-medium text-gray-700">Outcome</label>
                <select
                  id="code-blue-outcome"
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                >
                  <option value="ongoing">Ongoing</option>
                  <option value="rosc">ROSC (Return of Spontaneous Circulation)</option>
                  <option value="expired">Expired</option>
                  <option value="transferred">Transferred</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Event Log */}
        <div className="bg-white shadow rounded-lg p-6 h-full flex flex-col">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <Clock className="h-5 w-5 mr-2 text-gray-500" />
            Event Log
          </h3>
          <div className="flex-1 overflow-y-auto bg-gray-50 rounded-md p-4 space-y-2 max-h-[600px]">
            {events.length === 0 ? (
              <p className="text-gray-500 text-center italic">No events recorded</p>
            ) : (
              events.map((event, idx) => (
                <div key={idx} className="text-sm text-gray-700 border-b border-gray-200 pb-2 last:border-0">
                  {event}
                </div>
              ))
            )}
          </div>
          
          <div className="mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={handleSubmit}
              disabled={isActive || !startTime}
              className="w-full flex justify-center items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4 mr-2" />
              Finalize Record
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
