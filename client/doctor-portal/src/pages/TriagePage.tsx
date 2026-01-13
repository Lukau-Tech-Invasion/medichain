import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { apiUrl } from '@medichain/shared';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Activity,
  Heart,
  Thermometer,
  Wind,
  Droplet,
  Clock,
  User,
  Search,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Loader2,
  Plus,
} from 'lucide-react';

// ESI Level configuration
const ESI_LEVELS = [
  {
    level: 1,
    name: 'Resuscitation',
    color: 'bg-red-600',
    textColor: 'text-red-600',
    bgLight: 'bg-red-50',
    borderColor: 'border-red-500',
    description: 'Immediate life-saving intervention required',
    wait: 'Immediate (0 minutes)',
    examples: 'Cardiac arrest, severe respiratory distress, major trauma',
  },
  {
    level: 2,
    name: 'Emergent',
    color: 'bg-orange-500',
    textColor: 'text-orange-600',
    bgLight: 'bg-orange-50',
    borderColor: 'border-orange-500',
    description: 'High-risk, confused/lethargic, severe pain/distress',
    wait: 'Immediate to 10 minutes',
    examples: 'Chest pain, altered mental status, severe allergic reaction',
  },
  {
    level: 3,
    name: 'Urgent',
    color: 'bg-yellow-500',
    textColor: 'text-yellow-600',
    bgLight: 'bg-yellow-50',
    borderColor: 'border-yellow-500',
    description: 'Stable, multiple resources needed',
    wait: 'Up to 30 minutes',
    examples: 'Abdominal pain needing labs + imaging, high fever',
  },
  {
    level: 4,
    name: 'Less Urgent',
    color: 'bg-green-500',
    textColor: 'text-green-600',
    bgLight: 'bg-green-50',
    borderColor: 'border-green-500',
    description: 'Stable, one resource needed',
    wait: 'Up to 60 minutes',
    examples: 'Simple laceration, UTI symptoms, medication refill',
  },
  {
    level: 5,
    name: 'Non-Urgent',
    color: 'bg-blue-500',
    textColor: 'text-blue-600',
    bgLight: 'bg-blue-50',
    borderColor: 'border-blue-500',
    description: 'Stable, no resources needed',
    wait: 'Up to 120 minutes or next available',
    examples: 'Prescription refill, minor complaint, suture removal',
  },
];

interface VitalSigns {
  heart_rate: number | null;
  respiratory_rate: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  temperature_celsius: number | null;
  oxygen_saturation: number | null;
  pain_scale: number | null;
  gcs_score: number | null;
  blood_glucose: number | null;
  weight_kg: number | null;
}

interface TriageAssessment {
  assessment_id: string;
  patient_id: string;
  esi_level: { level: number };
  chief_complaint: string;
  vital_signs: VitalSigns;
  pain_scale: number | null;
  notes: string | null;
  performed_by: string;
  performed_at: number;
}

interface Patient {
  patient_id: string;
  full_name: string;
  health_id: string;
  date_of_birth: string;
}

function TriagePage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  
  const [activeTab, setActiveTab] = useState<'new' | 'queue'>('new');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  
  // Triage form state
  const [selectedESI, setSelectedESI] = useState<number | null>(null);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [notes, setNotes] = useState('');
  const [vitalSigns, setVitalSigns] = useState<VitalSigns>({
    heart_rate: null,
    respiratory_rate: null,
    bp_systolic: null,
    bp_diastolic: null,
    temperature_celsius: null,
    oxygen_saturation: null,
    pain_scale: null,
    gcs_score: null,
    blood_glucose: null,
    weight_kg: null,
  });
  
  // Triage queue state
  const [triageQueue, setTriageQueue] = useState<TriageAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Fetch patients
  useEffect(() => {
    if (!user) return;
    
    const fetchPatients = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/patients/list`, {
          headers: { 
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setPatients(data.patients);
          setApiConnected(true);
        }
      } catch (err) {
        console.error('Failed to fetch patients:', err);
        setApiConnected(false);
      }
    };
    fetchPatients();
  }, [user]);

  // Fetch triage queue
  useEffect(() => {
    if (!user) return;
    if (activeTab !== 'queue') return;
    
    const fetchTriageQueue = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${apiUrl}/api/clinical/triage/queue`, {
          headers: { 
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setTriageQueue(data.assessments || []);
        }
      } catch (err) {
        console.error('Failed to fetch triage queue:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTriageQueue();
  }, [activeTab, user?.userId]);

  // Filter patients based on search
  const filteredPatients = patients.filter(p =>
    p.full_name.toLowerCase().includes(patientSearch.toLowerCase()) ||
    p.patient_id.toLowerCase().includes(patientSearch.toLowerCase()) ||
    p.health_id.toLowerCase().includes(patientSearch.toLowerCase())
  );

  // Check for critical vital signs
  const hasCriticalVitals = (): boolean => {
    const { heart_rate, respiratory_rate, bp_systolic, temperature_celsius, oxygen_saturation, gcs_score } = vitalSigns;
    if (heart_rate && (heart_rate < 40 || heart_rate > 150)) return true;
    if (respiratory_rate && (respiratory_rate < 8 || respiratory_rate > 35)) return true;
    if (bp_systolic && (bp_systolic < 80 || bp_systolic > 220)) return true;
    if (temperature_celsius && (temperature_celsius < 35 || temperature_celsius > 40)) return true;
    if (oxygen_saturation && oxygen_saturation < 90) return true;
    if (gcs_score && gcs_score < 9) return true;
    return false;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedPatientId) {
      setError('Please select a patient');
      return;
    }
    if (selectedESI === null) {
      setError('Please select an ESI level');
      return;
    }
    if (!chiefComplaint.trim()) {
      setError('Please enter the chief complaint');
      return;
    }
    
    if (!user) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${apiUrl}/api/clinical/triage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify({
          patient_id: selectedPatientId,
          esi_level: selectedESI,
          chief_complaint: chiefComplaint,
          vital_signs: vitalSigns,
          pain_scale: vitalSigns.pain_scale,
          notes: notes || null,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(`Triage assessment created successfully! ID: ${data.assessment_id}. ESI Level ${data.esi_level} - ${data.expected_wait}`);
        // Reset form
        setSelectedPatientId('');
        setPatientSearch('');
        setSelectedESI(null);
        setChiefComplaint('');
        setNotes('');
        setVitalSigns({
          heart_rate: null,
          respiratory_rate: null,
          bp_systolic: null,
          bp_diastolic: null,
          temperature_celsius: null,
          oxygen_saturation: null,
          pain_scale: null,
          gcs_score: null,
          blood_glucose: null,
          weight_kg: null,
        });
      } else {
        setError(data.error || 'Failed to create triage assessment');
      }
    } catch (err) {
      setError('Failed to connect to API server');
    } finally {
      setSubmitting(false);
    }
  };

  // Update vital sign helper
  const updateVitalSign = (field: keyof VitalSigns, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    setVitalSigns(prev => ({ ...prev, [field]: numValue }));
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="text-orange-500" />
            ESI Triage Assessment
          </h1>
          <p className="text-gray-500 mt-1">
            Emergency Severity Index (ESI) 5-level triage system
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            <span className={`w-2 h-2 rounded-full ${apiConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            {apiConnected ? 'API Connected' : 'API Disconnected'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('new')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'new'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Plus size={16} className="inline mr-1" />
          New Assessment
        </button>
        <button
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'queue'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Clock size={16} className="inline mr-1" />
          Triage Queue
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertCircle size={20} />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
          <CheckCircle size={20} />
          {success}
        </div>
      )}

      {activeTab === 'new' ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Patient Selection */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <User size={20} />
              Patient Selection
            </h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={patientSearch}
                onChange={(e) => {
                  setPatientSearch(e.target.value);
                  setShowPatientDropdown(true);
                }}
                onFocus={() => setShowPatientDropdown(true)}
                placeholder="Search patient by name, ID, or Health ID..."
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
              {showPatientDropdown && filteredPatients.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {filteredPatients.slice(0, 10).map((patient) => (
                    <button
                      key={patient.patient_id}
                      type="button"
                      onClick={() => {
                        setSelectedPatientId(patient.patient_id);
                        setPatientSearch(patient.full_name);
                        setShowPatientDropdown(false);
                      }}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 ${
                        selectedPatientId === patient.patient_id ? 'bg-primary-50' : ''
                      }`}
                    >
                      <p className="font-medium text-gray-900">{patient.full_name}</p>
                      <p className="text-sm text-gray-500">
                        {patient.patient_id} • Health ID: {patient.health_id}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedPatientId && (
              <p className="mt-2 text-sm text-green-600 flex items-center gap-1">
                <CheckCircle size={16} />
                Patient selected: {selectedPatientId}
              </p>
            )}
          </div>

          {/* ESI Level Selection */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <AlertTriangle size={20} />
              ESI Level
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {ESI_LEVELS.map((esi) => (
                <button
                  key={esi.level}
                  type="button"
                  onClick={() => setSelectedESI(esi.level)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    selectedESI === esi.level
                      ? `${esi.borderColor} ${esi.bgLight}`
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-8 h-8 rounded-full ${esi.color} text-white flex items-center justify-center font-bold`}>
                      {esi.level}
                    </span>
                    <span className={`font-semibold ${esi.textColor}`}>{esi.name}</span>
                  </div>
                  <p className="text-xs text-gray-600 mb-1">{esi.description}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock size={12} />
                    {esi.wait}
                  </p>
                </button>
              ))}
            </div>
            {selectedESI !== null && (
              <div className={`mt-4 p-3 rounded-lg ${ESI_LEVELS[selectedESI - 1].bgLight}`}>
                <p className="text-sm text-gray-700">
                  <strong>Examples:</strong> {ESI_LEVELS[selectedESI - 1].examples}
                </p>
              </div>
            )}
          </div>

          {/* Chief Complaint */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Chief Complaint</h2>
            <textarea
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="Enter the patient's main reason for visit..."
              rows={3}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          {/* Vital Signs */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Activity size={20} />
              Vital Signs
              {hasCriticalVitals() && (
                <span className="ml-2 px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full animate-pulse">
                  Critical Values Detected
                </span>
              )}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Heart Rate */}
              <div>
                <label className="flex text-sm font-medium text-gray-700 mb-1 items-center gap-1">
                  <Heart size={14} className="text-red-500" />
                  Heart Rate (bpm)
                </label>
                <input
                  type="number"
                  value={vitalSigns.heart_rate ?? ''}
                  onChange={(e) => updateVitalSign('heart_rate', e.target.value)}
                  placeholder="60-100"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.heart_rate && (vitalSigns.heart_rate < 40 || vitalSigns.heart_rate > 150)
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200'
                  }`}
                />
              </div>
              
              {/* Respiratory Rate */}
              <div>
                <label className="flex text-sm font-medium text-gray-700 mb-1 items-center gap-1">
                  <Wind size={14} className="text-blue-500" />
                  Resp. Rate (bpm)
                </label>
                <input
                  type="number"
                  value={vitalSigns.respiratory_rate ?? ''}
                  onChange={(e) => updateVitalSign('respiratory_rate', e.target.value)}
                  placeholder="12-20"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.respiratory_rate && (vitalSigns.respiratory_rate < 8 || vitalSigns.respiratory_rate > 35)
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200'
                  }`}
                />
              </div>
              
              {/* Blood Pressure */}
              <div>
                <label className="flex text-sm font-medium text-gray-700 mb-1 items-center gap-1">
                  <Activity size={14} className="text-purple-500" />
                  BP Systolic (mmHg)
                </label>
                <input
                  type="number"
                  value={vitalSigns.bp_systolic ?? ''}
                  onChange={(e) => updateVitalSign('bp_systolic', e.target.value)}
                  placeholder="90-120"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.bp_systolic && (vitalSigns.bp_systolic < 80 || vitalSigns.bp_systolic > 220)
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200'
                  }`}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  BP Diastolic (mmHg)
                </label>
                <input
                  type="number"
                  value={vitalSigns.bp_diastolic ?? ''}
                  onChange={(e) => updateVitalSign('bp_diastolic', e.target.value)}
                  placeholder="60-80"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              
              {/* Temperature */}
              <div>
                <label className="flex text-sm font-medium text-gray-700 mb-1 items-center gap-1">
                  <Thermometer size={14} className="text-orange-500" />
                  Temperature (°C)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={vitalSigns.temperature_celsius ?? ''}
                  onChange={(e) => updateVitalSign('temperature_celsius', e.target.value)}
                  placeholder="36.1-37.2"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.temperature_celsius && (vitalSigns.temperature_celsius < 35 || vitalSigns.temperature_celsius > 40)
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200'
                  }`}
                />
              </div>
              
              {/* O2 Saturation */}
              <div>
                <label className="flex text-sm font-medium text-gray-700 mb-1 items-center gap-1">
                  <Droplet size={14} className="text-cyan-500" />
                  O2 Saturation (%)
                </label>
                <input
                  type="number"
                  value={vitalSigns.oxygen_saturation ?? ''}
                  onChange={(e) => updateVitalSign('oxygen_saturation', e.target.value)}
                  placeholder="95-100"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.oxygen_saturation && vitalSigns.oxygen_saturation < 90
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200'
                  }`}
                />
              </div>
              
              {/* Pain Scale */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Pain Scale (0-10)
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={vitalSigns.pain_scale ?? ''}
                  onChange={(e) => updateVitalSign('pain_scale', e.target.value)}
                  placeholder="0-10"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              
              {/* GCS */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  GCS Score (3-15)
                </label>
                <input
                  type="number"
                  min="3"
                  max="15"
                  value={vitalSigns.gcs_score ?? ''}
                  onChange={(e) => updateVitalSign('gcs_score', e.target.value)}
                  placeholder="15 = fully alert"
                  className={`w-full px-3 py-2 border rounded-lg ${
                    vitalSigns.gcs_score && vitalSigns.gcs_score < 9
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200'
                  }`}
                />
              </div>
              
              {/* Blood Glucose */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Blood Glucose (mg/dL)
                </label>
                <input
                  type="number"
                  value={vitalSigns.blood_glucose ?? ''}
                  onChange={(e) => updateVitalSign('blood_glucose', e.target.value)}
                  placeholder="70-100"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
              
              {/* Weight */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Weight (kg)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={vitalSigns.weight_kg ?? ''}
                  onChange={(e) => updateVitalSign('weight_kg', e.target.value)}
                  placeholder="Weight"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Additional Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional observations, pertinent negatives, or relevant history..."
              rows={3}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-4">
            <Link
              to="/dashboard"
              className="px-6 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !selectedPatientId || selectedESI === null || !chiefComplaint.trim()}
              className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Creating Assessment...
                </>
              ) : (
                <>
                  <CheckCircle size={20} />
                  Complete Triage Assessment
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        /* Triage Queue Tab */
        <div className="bg-white rounded-xl shadow">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Current Triage Queue</h2>
            <p className="text-sm text-gray-500">Patients sorted by ESI level and arrival time</p>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="mx-auto mb-3 text-primary-500 animate-spin" size={48} />
              <p className="text-gray-500">Loading triage queue...</p>
            </div>
          ) : triageQueue.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {triageQueue
                .sort((a, b) => {
                  const levelA = typeof a.esi_level === 'object' ? a.esi_level.level : a.esi_level;
                  const levelB = typeof b.esi_level === 'object' ? b.esi_level.level : b.esi_level;
                  return levelA - levelB;
                })
                .map((assessment) => {
                  const level = typeof assessment.esi_level === 'object' 
                    ? assessment.esi_level.level 
                    : assessment.esi_level;
                  const esiConfig = ESI_LEVELS[level - 1];
                  const patient = patients.find(p => p.patient_id === assessment.patient_id);
                  
                  return (
                    <Link
                      key={assessment.assessment_id}
                      to={`/patients/${assessment.patient_id}`}
                      className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <span className={`w-10 h-10 rounded-full ${esiConfig?.color || 'bg-gray-500'} text-white flex items-center justify-center font-bold`}>
                          {level}
                        </span>
                        <div>
                          <p className="font-medium text-gray-900">
                            {patient?.full_name || assessment.patient_id}
                          </p>
                          <p className="text-sm text-gray-500">{assessment.chief_complaint}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(assessment.performed_at * 1000).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${esiConfig?.bgLight} ${esiConfig?.textColor}`}>
                            ESI {level}: {esiConfig?.name}
                          </span>
                          <p className="text-xs text-gray-400 mt-1">{esiConfig?.wait}</p>
                        </div>
                        <ChevronRight className="text-gray-300" size={20} />
                      </div>
                    </Link>
                  );
                })}
            </div>
          ) : (
            <div className="p-12 text-center">
              <Clock className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-gray-500">No patients in triage queue</p>
              <button
                onClick={() => setActiveTab('new')}
                className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                Start New Triage
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TriagePage;
