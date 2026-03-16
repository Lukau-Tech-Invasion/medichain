import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createTrauma, getPatients } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import { 
  AlertCircle, 
  Save, 
  Search,
  Activity,
  Shield
} from 'lucide-react';

export default function TraumaPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { showError } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  
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
      showError('Failed to save assessment. Please try again.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <Shield className="h-8 w-8 text-red-600 mr-3" />
          Trauma Assessment
        </h1>
        <p className="mt-2 text-gray-600">
          Document trauma mechanism, primary survey, and injury severity.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Patient Selection */}
        <div className="bg-white shadow rounded-lg p-6">
          <label htmlFor="trauma-patient" className="block text-sm font-medium text-gray-700 mb-2">
            Select Patient
          </label>
          <div className="relative max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <select
              id="trauma-patient"
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              value={selectedPatient}
              onChange={(e) => setSelectedPatient(e.target.value)}
              required
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

        {/* Mechanism & Overview */}
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <AlertCircle className="h-5 w-5 mr-2 text-gray-500" />
            Injury Overview
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="trauma-type" className="block text-sm font-medium text-gray-700">Trauma Type</label>
              <select
                id="trauma-type"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={traumaType}
                onChange={(e) => setTraumaType(e.target.value)}
              >
                <option value="blunt">Blunt Force</option>
                <option value="penetrating">Penetrating</option>
                <option value="burn">Burn</option>
                <option value="blast">Blast</option>
              </select>
            </div>
            <div>
              <label htmlFor="trauma-mechanism" className="block text-sm font-medium text-gray-700">Mechanism of Injury</label>
              <input
                id="trauma-mechanism"
                type="text"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="e.g., MVC, Fall from height..."
                value={mechanism}
                onChange={(e) => setMechanism(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="trauma-gcs" className="block text-sm font-medium text-gray-700">GCS Score (3-15)</label>
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
              <label htmlFor="trauma-iss" className="block text-sm font-medium text-gray-700">Injury Severity Score (ISS)</label>
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
            Primary Survey (ABCDE)
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <label htmlFor="trauma-airway" className="font-medium text-gray-700">A - Airway</label>
              <select
                id="trauma-airway"
                className="md:col-span-2 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={airway}
                onChange={(e) => setAirway(e.target.value)}
              >
                <option value="patent">Patent</option>
                <option value="obstructed">Obstructed</option>
                <option value="intubated">Intubated</option>
                <option value="c-spine">C-Spine Precautions</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <label htmlFor="trauma-breathing" className="font-medium text-gray-700">B - Breathing</label>
              <select
                id="trauma-breathing"
                className="md:col-span-2 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={breathing}
                onChange={(e) => setBreathing(e.target.value)}
              >
                <option value="spontaneous">Spontaneous & Effective</option>
                <option value="labored">Labored</option>
                <option value="absent">Absent/Apneic</option>
                <option value="ventilated">Ventilated</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <label htmlFor="trauma-circulation" className="font-medium text-gray-700">C - Circulation</label>
              <select
                id="trauma-circulation"
                className="md:col-span-2 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={circulation}
                onChange={(e) => setCirculation(e.target.value)}
              >
                <option value="stable">Stable Pulses</option>
                <option value="tachycardic">Tachycardic</option>
                <option value="weak">Weak/Thready</option>
                <option value="absent">Absent Pulses</option>
                <option value="hemorrhage">Active Hemorrhage</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <label htmlFor="trauma-disability" className="font-medium text-gray-700">D - Disability</label>
              <select
                id="trauma-disability"
                className="md:col-span-2 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                value={disability}
                onChange={(e) => setDisability(e.target.value)}
              >
                <option value="alert">Alert (A)</option>
                <option value="voice">Responds to Voice (V)</option>
                <option value="pain">Responds to Pain (P)</option>
                <option value="unresponsive">Unresponsive (U)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white shadow rounded-lg p-6">
          <label htmlFor="trauma-notes" className="block text-sm font-medium text-gray-700 mb-2">Additional Notes</label>
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
            Save Assessment
          </button>
        </div>
      </form>
    </div>
  );
}
