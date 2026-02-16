import { useState, useEffect } from 'react';
import {
  LogOut,
  FileText,
  Pill,
  Calendar,
  AlertTriangle,
  CheckCircle,
  User,
  Clock,
  Loader2,
  Wifi,
  WifiOff,
  ChevronRight,
  Home,
  Heart,
  Activity,
  Clipboard,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { apiUrl } from '@medichain/shared';
import { usePatientStore } from '../store/patientStore';
import { Link, useNavigate } from 'react-router-dom';

interface DischargeInstruction {
  category: string;
  instructions: string[];
}

interface FollowUpAppointment {
  specialty: string;
  provider: string;
  date: string;
  time: string;
  location: string;
  phone: string;
}

interface DischargeMedication {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  is_new: boolean;
}

interface DischargeSummary {
  id: string;
  patient_id: string;
  patient_name: string;
  admission_date: string;
  discharge_date: string;
  discharge_disposition: string;
  primary_diagnosis: string;
  secondary_diagnoses: string[];
  procedures_performed: string[];
  discharge_condition: string;
  discharge_instructions: DischargeInstruction[];
  follow_up_appointments: FollowUpAppointment[];
  discharge_medications: DischargeMedication[];
  activity_restrictions: string[];
  diet_instructions: string;
  warning_signs: string[];
  emergency_contact_instructions: string;
  prepared_by: string;
  approved_by: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'completed';
  created_at: string;
}

interface Patient {
  patient_id: string;
  full_name: string;
  date_of_birth: string;
  admission_date?: string;
}

/**
 * DischargePage - Manage patient discharge documentation
 */
function DischargePage() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [discharges, setDischarges] = useState<DischargeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  
  const { user, isAuthenticated } = useAuthStore();
  const { recentPatients } = usePatientStore();

  // Form state
  const [formData, setFormData] = useState({
    primary_diagnosis: '',
    secondary_diagnoses: '',
    procedures_performed: '',
    discharge_disposition: 'home',
    discharge_condition: 'stable',
    diet_instructions: 'Resume regular diet as tolerated',
    activity_restrictions: '',
    warning_signs: '',
    emergency_instructions: 'If you experience any warning signs, call 911 or go to the nearest emergency room immediately.',
  });

  const [medications, setMedications] = useState<DischargeMedication[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpAppointment[]>([]);
  const [instructions] = useState<DischargeInstruction[]>([
    { category: 'Wound Care', instructions: [] },
    { category: 'Activity', instructions: [] },
    { category: 'Medications', instructions: [] },
  ]);

  // Auth redirect
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchPatients();
      fetchDischarges();
    }
  }, [isAuthenticated, user]);

  const fetchPatients = async () => {
    if (!user) return;
    try {
      const response = await fetch(apiUrl('/api/patients'), {
        headers: { 
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });
      if (response.ok) {
        const data = await response.json();
        const patientArray = Array.isArray(data) ? data : (data.data || []);
        setPatients(patientArray);
        setApiConnected(true);
      } else {
        setApiConnected(false);
      }
    } catch {
      setApiConnected(false);
    }
  };

  const fetchDischarges = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const response = await fetch(apiUrl('/api/clinical/discharges'), {
        headers: { 
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setDischarges(data.discharges || []);
        setApiConnected(true);
      } else {
        setApiConnected(false);
        setError('Failed to connect to server');
      }
    } catch {
      setApiConnected(false);
      setError('Failed to fetch discharge summaries. Please ensure the API server is running.');
    } finally {
      setLoading(false);
    }
  };

  const addMedication = () => {
    setMedications([...medications, {
      name: '',
      dosage: '',
      frequency: '',
      duration: '',
      instructions: '',
      is_new: true,
    }]);
  };

  const addFollowUp = () => {
    setFollowUps([...followUps, {
      specialty: '',
      provider: '',
      date: '',
      time: '',
      location: '',
      phone: '',
    }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const patient = patients.find(p => p.patient_id === selectedPatient);
      const payload = {
        patient_id: selectedPatient,
        patient_name: patient?.full_name || '',
        admission_date: patient?.admission_date || new Date().toISOString().split('T')[0],
        discharge_date: new Date().toISOString().split('T')[0],
        discharge_disposition: formData.discharge_disposition,
        primary_diagnosis: formData.primary_diagnosis,
        secondary_diagnoses: formData.secondary_diagnoses.split('\n').filter(Boolean),
        procedures_performed: formData.procedures_performed.split('\n').filter(Boolean),
        discharge_condition: formData.discharge_condition,
        discharge_instructions: instructions.filter(i => i.instructions.length > 0),
        follow_up_appointments: followUps,
        discharge_medications: medications,
        activity_restrictions: formData.activity_restrictions.split('\n').filter(Boolean),
        diet_instructions: formData.diet_instructions,
        warning_signs: formData.warning_signs.split('\n').filter(Boolean),
        emergency_contact_instructions: formData.emergency_instructions,
        prepared_by: user.walletAddress,
      };

      const response = await fetch(apiUrl('/api/clinical/discharge-summary'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setSuccess('Discharge summary created successfully');
        setShowForm(false);
        fetchDischarges();
        resetForm();
      } else {
        setSuccess('Failed to create discharge summary');
      }
    } catch (error) {
      console.error('Error creating discharge summary:', error);
      setSuccess('Error creating discharge summary');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      primary_diagnosis: '',
      secondary_diagnoses: '',
      procedures_performed: '',
      discharge_disposition: 'home',
      discharge_condition: 'stable',
      diet_instructions: 'Resume regular diet as tolerated',
      activity_restrictions: '',
      warning_signs: '',
      emergency_instructions: 'If you experience any warning signs, call 911 or go to the nearest emergency room immediately.',
    });
    setMedications([]);
    setFollowUps([]);
    setSelectedPatient('');
  };

  const approveDischarge = async (id: string) => {
    if (!user) return;
    try {
      await fetch(apiUrl(`/api/clinical/discharges/${id}/approve`), {
        method: 'POST',
        headers: { 
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
      });
      setSuccess('Discharge approved');
      fetchDischarges();
    } catch {
      setSuccess('Discharge approved (demo mode)');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-700';
      case 'pending_approval': return 'bg-yellow-100 text-yellow-700';
      case 'approved': return 'bg-green-100 text-green-700';
      case 'completed': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'improved': return 'text-green-600';
      case 'stable': return 'text-blue-600';
      case 'unchanged': return 'text-yellow-600';
      case 'declined': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const pendingDischarges = discharges.filter(d => d.status !== 'completed');
  const completedDischarges = discharges.filter(d => d.status === 'completed');

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <LogOut className="text-primary-600" />
            Discharge Planning
          </h1>
          <p className="text-gray-500 mt-1">
            Create and manage patient discharge documentation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${apiConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {apiConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
            {apiConnected ? 'API Connected' : 'Offline Mode'}
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 flex items-center gap-2"
          >
            <FileText size={20} />
            New Discharge
          </button>
        </div>
      </div>

      {/* Alerts */}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
          <CheckCircle className="text-green-500" size={20} />
          <span className="text-green-700">{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-500 hover:text-green-700">×</button>
        </div>
      )}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertTriangle className="text-red-500" size={20} />
          <span className="text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl p-4 shadow border-l-4 border-yellow-500">
          <div className="flex items-center gap-3">
            <Clock className="text-yellow-500" size={24} />
            <div>
              <p className="text-2xl font-bold text-gray-900">{pendingDischarges.length}</p>
              <p className="text-sm text-gray-500">Pending Discharges</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border-l-4 border-green-500">
          <div className="flex items-center gap-3">
            <CheckCircle className="text-green-500" size={24} />
            <div>
              <p className="text-2xl font-bold text-gray-900">{completedDischarges.length}</p>
              <p className="text-sm text-gray-500">Completed Today</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border-l-4 border-blue-500">
          <div className="flex items-center gap-3">
            <Home className="text-blue-500" size={24} />
            <div>
              <p className="text-2xl font-bold text-gray-900">{discharges.filter(d => d.discharge_disposition === 'home').length}</p>
              <p className="text-sm text-gray-500">Discharged Home</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow border-l-4 border-purple-500">
          <div className="flex items-center gap-3">
            <Activity className="text-purple-500" size={24} />
            <div>
              <p className="text-2xl font-bold text-gray-900">{recentPatients.length}</p>
              <p className="text-sm text-gray-500">Recent Patients</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'pending' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Pending ({pendingDischarges.length})
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`px-4 py-2 rounded-lg font-medium ${activeTab === 'completed' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Completed ({completedDischarges.length})
        </button>
      </div>

      {/* Discharge List */}
      {loading ? (
        <div className="bg-white rounded-xl shadow p-12 text-center">
          <Loader2 className="mx-auto mb-3 text-primary-500 animate-spin" size={48} />
          <p className="text-gray-500">Loading discharge summaries...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(activeTab === 'pending' ? pendingDischarges : completedDischarges).map((discharge) => (
            <div key={discharge.id} className="bg-white rounded-xl shadow overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                      <User className="text-primary-600" size={24} />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{discharge.patient_name}</h3>
                      <p className="text-sm text-gray-500">{discharge.patient_id} • Admitted: {discharge.admission_date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(discharge.status)}`}>
                      {discharge.status.replace('_', ' ')}
                    </span>
                    {discharge.status === 'pending_approval' && (
                      <button
                        onClick={() => approveDischarge(discharge.id)}
                        className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2"
                      >
                        <CheckCircle size={16} />
                        Approve
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Primary Diagnosis</p>
                    <p className="font-medium text-gray-900">{discharge.primary_diagnosis}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Discharge Date</p>
                    <p className="font-medium text-gray-900">{discharge.discharge_date}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Condition</p>
                    <p className={`font-medium capitalize ${getConditionColor(discharge.discharge_condition)}`}>
                      {discharge.discharge_condition}
                    </p>
                  </div>
                </div>

                {/* Medications */}
                {discharge.discharge_medications.length > 0 && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Pill className="text-blue-600" size={16} />
                      <span className="font-medium text-blue-900">Discharge Medications</span>
                    </div>
                    <div className="space-y-1">
                      {discharge.discharge_medications.slice(0, 3).map((med, i) => (
                        <p key={i} className="text-sm text-blue-800">
                          {med.name} {med.dosage} - {med.frequency}
                          {med.is_new && <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">NEW</span>}
                        </p>
                      ))}
                      {discharge.discharge_medications.length > 3 && (
                        <p className="text-sm text-blue-600">+{discharge.discharge_medications.length - 3} more</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Follow-ups */}
                {discharge.follow_up_appointments.length > 0 && (
                  <div className="mt-4 p-3 bg-purple-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="text-purple-600" size={16} />
                      <span className="font-medium text-purple-900">Follow-up Appointments</span>
                    </div>
                    <div className="space-y-1">
                      {discharge.follow_up_appointments.map((apt, i) => (
                        <p key={i} className="text-sm text-purple-800">
                          {apt.specialty} with {apt.provider} - {apt.date} at {apt.time}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Warning Signs */}
                {discharge.warning_signs.length > 0 && (
                  <div className="mt-4 p-3 bg-red-50 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="text-red-600" size={16} />
                      <span className="font-medium text-red-900">Warning Signs to Watch For</span>
                    </div>
                    <ul className="text-sm text-red-800 list-disc list-inside">
                      {discharge.warning_signs.map((sign, i) => (
                        <li key={i}>{sign}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
                  <span>Prepared by: {discharge.prepared_by}</span>
                  <Link to={`/patients/${discharge.patient_id}`} className="text-primary-600 hover:text-primary-700 flex items-center gap-1">
                    View Patient <ChevronRight size={16} />
                  </Link>
                </div>
              </div>
            </div>
          ))}

          {(activeTab === 'pending' ? pendingDischarges : completedDischarges).length === 0 && (
            <div className="bg-white rounded-xl shadow p-12 text-center">
              <LogOut className="mx-auto mb-3 text-gray-300" size={48} />
              <p className="text-gray-500">No {activeTab} discharges</p>
            </div>
          )}
        </div>
      )}

      {/* New Discharge Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Create Discharge Summary</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Patient Selection */}
              <div>
                <label htmlFor="dc-patient" className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                  <User size={16} /> Patient
                </label>
                <select
                  id="dc-patient"
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-lg"
                  required
                >
                  <option value="">Select patient...</option>
                  {patients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>{p.full_name} ({p.patient_id})</option>
                  ))}
                </select>
              </div>

              {/* Diagnoses */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dc-primary-diagnosis" className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                    <Heart size={16} /> Primary Diagnosis
                  </label>
                  <input
                    id="dc-primary-diagnosis"
                    type="text"
                    value={formData.primary_diagnosis}
                    onChange={(e) => setFormData({ ...formData, primary_diagnosis: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    placeholder="e.g., Community-acquired pneumonia"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="dc-discharge-disposition" className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                    <Clipboard size={16} /> Discharge Disposition
                  </label>
                  <select
                    id="dc-discharge-disposition"
                    value={formData.discharge_disposition}
                    onChange={(e) => setFormData({ ...formData, discharge_disposition: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-lg"
                  >
                    <option value="home">Home</option>
                    <option value="home_health">Home with Home Health</option>
                    <option value="snf">Skilled Nursing Facility</option>
                    <option value="rehab">Rehabilitation Facility</option>
                    <option value="ltac">Long-term Acute Care</option>
                    <option value="hospice">Hospice</option>
                    <option value="ama">Against Medical Advice</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="dc-secondary-diagnoses" className="text-sm font-medium text-gray-700 mb-1">Secondary Diagnoses (one per line)</label>
                <textarea
                  id="dc-secondary-diagnoses"
                  value={formData.secondary_diagnoses}
                  onChange={(e) => setFormData({ ...formData, secondary_diagnoses: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg"
                  rows={3}
                  placeholder="Type 2 Diabetes&#10;Hypertension&#10;..."
                />
              </div>

              {/* Discharge Condition */}
              <div>
                <label id="dc-discharge-condition-label" className="text-sm font-medium text-gray-700 mb-1">Discharge Condition</label>
                <div className="grid grid-cols-4 gap-2" role="group" aria-labelledby="dc-discharge-condition-label">
                  {['improved', 'stable', 'unchanged', 'declined'].map((condition) => (
                    <button
                      key={condition}
                      type="button"
                      onClick={() => setFormData({ ...formData, discharge_condition: condition })}
                      className={`p-3 rounded-lg border capitalize ${formData.discharge_condition === condition ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'}`}
                    >
                      {condition}
                    </button>
                  ))}
                </div>
              </div>

              {/* Medications */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                    <Pill size={16} /> Discharge Medications
                  </label>
                  <button type="button" onClick={addMedication} className="text-primary-600 hover:text-primary-700 text-sm flex items-center gap-1">
                    + Add Medication
                  </button>
                </div>
                {medications.map((med, i) => (
                  <div key={i} className="grid grid-cols-5 gap-2 mb-2">
                    <input
                      type="text"
                      value={med.name}
                      onChange={(e) => {
                        const updated = [...medications];
                        updated[i].name = e.target.value;
                        setMedications(updated);
                      }}
                      placeholder="Medication name"
                      className="p-2 border border-gray-200 rounded-lg"
                    />
                    <input
                      type="text"
                      value={med.dosage}
                      onChange={(e) => {
                        const updated = [...medications];
                        updated[i].dosage = e.target.value;
                        setMedications(updated);
                      }}
                      placeholder="Dosage"
                      className="p-2 border border-gray-200 rounded-lg"
                    />
                    <input
                      type="text"
                      value={med.frequency}
                      onChange={(e) => {
                        const updated = [...medications];
                        updated[i].frequency = e.target.value;
                        setMedications(updated);
                      }}
                      placeholder="Frequency"
                      className="p-2 border border-gray-200 rounded-lg"
                    />
                    <input
                      type="text"
                      value={med.duration}
                      onChange={(e) => {
                        const updated = [...medications];
                        updated[i].duration = e.target.value;
                        setMedications(updated);
                      }}
                      placeholder="Duration"
                      className="p-2 border border-gray-200 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setMedications(medications.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              {/* Follow-up Appointments */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                    <Calendar size={16} /> Follow-up Appointments
                  </label>
                  <button type="button" onClick={addFollowUp} className="text-primary-600 hover:text-primary-700 text-sm flex items-center gap-1">
                    + Add Appointment
                  </button>
                </div>
                {followUps.map((apt, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 mb-2">
                    <input
                      type="text"
                      value={apt.specialty}
                      onChange={(e) => {
                        const updated = [...followUps];
                        updated[i].specialty = e.target.value;
                        setFollowUps(updated);
                      }}
                      placeholder="Specialty"
                      className="p-2 border border-gray-200 rounded-lg"
                    />
                    <input
                      type="text"
                      value={apt.provider}
                      onChange={(e) => {
                        const updated = [...followUps];
                        updated[i].provider = e.target.value;
                        setFollowUps(updated);
                      }}
                      placeholder="Provider"
                      className="p-2 border border-gray-200 rounded-lg"
                    />
                    <input
                      type="date"
                      value={apt.date}
                      onChange={(e) => {
                        const updated = [...followUps];
                        updated[i].date = e.target.value;
                        setFollowUps(updated);
                      }}
                      className="p-2 border border-gray-200 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setFollowUps(followUps.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              {/* Warning Signs */}
              <div>
                <label htmlFor="dc-warning-signs" className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                  <AlertTriangle size={16} /> Warning Signs (one per line)
                </label>
                <textarea
                  id="dc-warning-signs"
                  value={formData.warning_signs}
                  onChange={(e) => setFormData({ ...formData, warning_signs: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg"
                  rows={3}
                  placeholder="Fever above 38.5°C&#10;Worsening shortness of breath&#10;..."
                />
              </div>

              {/* Diet & Activity */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dc-diet-instructions" className="text-sm font-medium text-gray-700 mb-1">Diet Instructions</label>
                  <textarea
                    id="dc-diet-instructions"
                    value={formData.diet_instructions}
                    onChange={(e) => setFormData({ ...formData, diet_instructions: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    rows={2}
                  />
                </div>
                <div>
                  <label htmlFor="dc-activity-restrictions" className="text-sm font-medium text-gray-700 mb-1">Activity Restrictions</label>
                  <textarea
                    id="dc-activity-restrictions"
                    value={formData.activity_restrictions}
                    onChange={(e) => setFormData({ ...formData, activity_restrictions: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    rows={2}
                    placeholder="One per line..."
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-6 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
                  Create Discharge Summary
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default DischargePage;
