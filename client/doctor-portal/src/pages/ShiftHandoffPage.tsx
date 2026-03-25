import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createShiftHandoff, getPatients, apiUrl } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import {
  ArrowRightLeft,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  RefreshCw,
  MessageSquare,
  Pill,
  Send,
  Users,
  History
} from 'lucide-react';

type ShiftType = 'day-to-evening' | 'evening-to-night' | 'night-to-day';
type HandoffStatus = 'draft' | 'pending' | 'accepted' | 'acknowledged';
type Priority = 'routine' | 'urgent' | 'critical';

interface PatientHandoff {
  patientId: string;
  patientName: string;
  room: string;
  admitDate: string;
  diagnosis: string;
  codeStatus: string;
  isolation?: string;
  priority: Priority;
  sbar: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
  };
  ivAccess: string;
  diet: string;
  activity: string;
  pendingLabs: string;
  pendingTests: string;
  medications: {
    scheduled: string;
    prn: string;
    drips: string;
  };
  safetyRisks: string[];
  pendingOrders: string;
  familyUpdates: string;
  additionalNotes: string;
}

interface ShiftHandoff {
  id: string;
  shiftType: ShiftType;
  handoffDate: string;
  handoffTime: string;
  outgoingNurse: string;
  incomingNurse: string;
  unit: string;
  status: HandoffStatus;
  patients: PatientHandoff[];
  createdAt: string;
  acknowledgedAt?: string;
}

export default function ShiftHandoffPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'handoff' | 'history'>('handoff');
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);

  // Handoff data
  const [handoff, setHandoff] = useState<Partial<ShiftHandoff>>({
    shiftType: 'day-to-evening',
    handoffDate: new Date().toISOString().split('T')[0],
    handoffTime: new Date().toTimeString().slice(0, 5),
    outgoingNurse: user?.userId || '',
    incomingNurse: '',
    unit: 'Medical-Surgical',
    patients: []
  });

  const [patientHandoffs, setPatientHandoffs] = useState<PatientHandoff[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [handoffHistory, setHandoffHistory] = useState<ShiftHandoff[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // New patient form
  const [newPatientHandoff, setNewPatientHandoff] = useState<Partial<PatientHandoff>>({
    room: '',
    diagnosis: '',
    codeStatus: 'Full Code',
    priority: 'routine',
    sbar: {
      situation: '',
      background: '',
      assessment: '',
      recommendation: ''
    },
    ivAccess: '',
    diet: '',
    activity: '',
    pendingLabs: '',
    pendingTests: '',
    medications: {
      scheduled: '',
      prn: '',
      drips: ''
    },
    safetyRisks: [],
    pendingOrders: '',
    familyUpdates: '',
    additionalNotes: ''
  });

  const shiftTypes: Record<ShiftType, { label: string; time: string }> = {
    'day-to-evening': { label: 'Day → Evening', time: '15:00' },
    'evening-to-night': { label: 'Evening → Night', time: '23:00' },
    'night-to-day': { label: 'Night → Day', time: '07:00' }
  };

  const units = [
    'Medical-Surgical', 'ICU', 'CCU', 'PICU', 'NICU', 'L&D', 'ED',
    'Oncology', 'Orthopedics', 'Neurology', 'Cardiology', 'Telemetry'
  ];

  const safetyRiskOptions = [
    'Fall Risk', 'Aspiration Risk', 'Elopement Risk', 'Pressure Injury Risk',
    'Suicide Precautions', 'Seizure Precautions', 'Bleeding Precautions',
    'DVT Risk', 'MRSA', 'C. Diff', 'Contact Isolation', 'Droplet Isolation'
  ];

  const codeStatuses = ['Full Code', 'DNR', 'DNR/DNI', 'Comfort Measures Only', 'Limited Code'];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const patientData = await getPatients();
        setPatients(patientData || []);
      } catch (err) {
        console.error('Failed to fetch patients', err);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (activeTab === 'history' && user) {
      const fetchHistory = async () => {
        setHistoryLoading(true);
        try {
          // Fetch recent handoffs (use user ID as the handoff ID reference)
          const res = await fetch(apiUrl(`/api/clinical/shift-handoff/${user.walletAddress}`), {
            headers: {
              'X-User-Id': user.walletAddress,
              'X-Provider-Role': user.role || 'Nurse',
            },
          });
          if (res.ok) {
            const data = await res.json();
            setHandoffHistory(Array.isArray(data) ? data : (data.handoffs || []));
          }
        } catch (err) {
          console.error('Failed to fetch handoff history:', err);
        } finally {
          setHistoryLoading(false);
        }
      };
      fetchHistory();
    }
  }, [activeTab, user]);

  const filteredPatients = patients.filter(p => 
    p.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.patient_id?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getPriorityColor = (priority: Priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-500 text-white';
      case 'urgent': return 'bg-yellow-500 text-white';
      default: return 'bg-green-500 text-white';
    }
  };

  const addPatientToHandoff = (patient: PatientProfile) => {
    const existingHandoff = patientHandoffs.find(p => p.patientId === patient.patient_id);
    if (existingHandoff) {
      setError('Patient already added to handoff');
      return;
    }

    const newHandoff: PatientHandoff = {
      patientId: patient.patient_id,
      patientName: patient.full_name,
      room: newPatientHandoff.room || '',
      admitDate: new Date().toISOString().split('T')[0],
      diagnosis: newPatientHandoff.diagnosis || '',
      codeStatus: newPatientHandoff.codeStatus || 'Full Code',
      priority: newPatientHandoff.priority || 'routine',
      sbar: {
        situation: newPatientHandoff.sbar?.situation || '',
        background: newPatientHandoff.sbar?.background || '',
        assessment: newPatientHandoff.sbar?.assessment || '',
        recommendation: newPatientHandoff.sbar?.recommendation || ''
      },
      ivAccess: newPatientHandoff.ivAccess || '',
      diet: newPatientHandoff.diet || '',
      activity: newPatientHandoff.activity || '',
      pendingLabs: newPatientHandoff.pendingLabs || '',
      pendingTests: newPatientHandoff.pendingTests || '',
      medications: {
        scheduled: newPatientHandoff.medications?.scheduled || '',
        prn: newPatientHandoff.medications?.prn || '',
        drips: newPatientHandoff.medications?.drips || ''
      },
      safetyRisks: newPatientHandoff.safetyRisks || [],
      pendingOrders: newPatientHandoff.pendingOrders || '',
      familyUpdates: newPatientHandoff.familyUpdates || '',
      additionalNotes: newPatientHandoff.additionalNotes || ''
    };

    setPatientHandoffs(prev => [...prev, newHandoff]);
    setShowAddPatient(false);
    resetNewPatientForm();
    setExpandedPatient(patient.patient_id);
  };

  const resetNewPatientForm = () => {
    setNewPatientHandoff({
      room: '',
      diagnosis: '',
      codeStatus: 'Full Code',
      priority: 'routine',
      sbar: { situation: '', background: '', assessment: '', recommendation: '' },
      ivAccess: '',
      diet: '',
      activity: '',
      pendingLabs: '',
      pendingTests: '',
      medications: { scheduled: '', prn: '', drips: '' },
      safetyRisks: [],
      pendingOrders: '',
      familyUpdates: '',
      additionalNotes: ''
    });
  };

  const updatePatientHandoff = (patientId: string, updates: Partial<PatientHandoff>) => {
    setPatientHandoffs(prev => prev.map(p => 
      p.patientId === patientId ? { ...p, ...updates } : p
    ));
  };

  const updatePatientSbar = (patientId: string, field: keyof PatientHandoff['sbar'], value: string) => {
    setPatientHandoffs(prev => prev.map(p => 
      p.patientId === patientId 
        ? { ...p, sbar: { ...p.sbar, [field]: value } }
        : p
    ));
  };

  const updatePatientMeds = (patientId: string, field: keyof PatientHandoff['medications'], value: string) => {
    setPatientHandoffs(prev => prev.map(p => 
      p.patientId === patientId 
        ? { ...p, medications: { ...p.medications, [field]: value } }
        : p
    ));
  };

  const toggleSafetyRisk = (patientId: string, risk: string) => {
    setPatientHandoffs(prev => prev.map(p => {
      if (p.patientId !== patientId) return p;
      const risks = p.safetyRisks.includes(risk)
        ? p.safetyRisks.filter(r => r !== risk)
        : [...p.safetyRisks, risk];
      return { ...p, safetyRisks: risks };
    }));
  };

  const removePatientFromHandoff = (patientId: string) => {
    setPatientHandoffs(prev => prev.filter(p => p.patientId !== patientId));
    if (expandedPatient === patientId) {
      setExpandedPatient(null);
    }
  };

  const handleSave = async () => {
    if (!handoff.incomingNurse) {
      setError('Please specify the incoming nurse');
      return;
    }

    if (patientHandoffs.length === 0) {
      setError('Please add at least one patient to the handoff');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const handoffData = {
        handoff_id: `HO-${Date.now()}`,
        shift_type: handoff.shiftType,
        handoff_date: handoff.handoffDate,
        handoff_time: handoff.handoffTime,
        outgoing_nurse: handoff.outgoingNurse,
        incoming_nurse: handoff.incomingNurse,
        unit: handoff.unit,
        patients: patientHandoffs,
        status: 'pending',
        created_by: user?.userId || 'unknown',
        created_at: Math.floor(Date.now() / 1000)
      };

      await createShiftHandoff(handoffData);
      setSuccess('Shift handoff submitted successfully!');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError('Failed to submit shift handoff. Please try again.');
      console.error('Failed to save shift handoff', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-white/20 rounded-full">
                <ArrowRightLeft className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Shift Handoff (SBAR)</h1>
                <p className="text-purple-100">Document comprehensive patient handoff information</p>
              </div>
            </div>
            <div className="text-right text-white">
              <p className="font-medium">{new Date().toLocaleDateString()}</p>
              <p className="text-sm opacity-75">{shiftTypes[handoff.shiftType as ShiftType]?.label}</p>
            </div>
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg flex items-center">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b flex">
            <button
              onClick={() => setActiveTab('handoff')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'handoff' 
                  ? 'border-b-2 border-purple-500 text-purple-600' 
                  : 'text-gray-500'
              }`}
            >
              <FileText className="h-5 w-5" />
              <span>Create Handoff</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'history' 
                  ? 'border-b-2 border-purple-500 text-purple-600' 
                  : 'text-gray-500'
              }`}
            >
              <History className="h-5 w-5" />
              <span>Handoff History</span>
            </button>
          </div>
        </div>

        {activeTab === 'handoff' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Handoff Details */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow p-4">
                <h2 className="font-bold text-gray-900 mb-4 flex items-center">
                  <Clock className="h-5 w-5 mr-2 text-purple-500" />
                  Handoff Details
                </h2>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="handoff-shift-type" className="block text-sm font-medium text-gray-700 mb-1">Shift Type</label>
                    <select
                      id="handoff-shift-type"
                      value={handoff.shiftType}
                      onChange={(e) => setHandoff({ ...handoff, shiftType: e.target.value as ShiftType })}
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    >
                      {Object.entries(shiftTypes).map(([value, { label }]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="handoff-date" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                      <input
                        id="handoff-date"
                        type="date"
                        value={handoff.handoffDate}
                        onChange={(e) => setHandoff({ ...handoff, handoffDate: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="handoff-time" className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                      <input
                        id="handoff-time"
                        type="time"
                        value={handoff.handoffTime}
                        onChange={(e) => setHandoff({ ...handoff, handoffTime: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="handoff-unit" className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                    <select
                      id="handoff-unit"
                      value={handoff.unit}
                      onChange={(e) => setHandoff({ ...handoff, unit: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded-lg"
                    >
                      {units.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="handoff-outgoing-nurse" className="block text-sm font-medium text-gray-700 mb-1">Outgoing Nurse</label>
                    <input
                      id="handoff-outgoing-nurse"
                      type="text"
                      value={handoff.outgoingNurse}
                      onChange={(e) => setHandoff({ ...handoff, outgoingNurse: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded-lg bg-gray-50"
                      readOnly
                    />
                  </div>

                  <div>
                    <label htmlFor="handoff-incoming-nurse" className="block text-sm font-medium text-gray-700 mb-1">Incoming Nurse *</label>
                    <input
                      id="handoff-incoming-nurse"
                      type="text"
                      value={handoff.incomingNurse}
                      onChange={(e) => setHandoff({ ...handoff, incomingNurse: e.target.value })}
                      placeholder="Enter incoming nurse name"
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Patient Summary */}
              <div className="bg-white rounded-lg shadow p-4 mt-4">
                <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                  <Users className="h-5 w-5 mr-2 text-purple-500" />
                  Patient Summary
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Patients:</span>
                    <span className="font-bold">{patientHandoffs.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Critical:</span>
                    <span className="font-bold text-red-600">
                      {patientHandoffs.filter(p => p.priority === 'critical').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Urgent:</span>
                    <span className="font-bold text-yellow-600">
                      {patientHandoffs.filter(p => p.priority === 'urgent').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Routine:</span>
                    <span className="font-bold text-green-600">
                      {patientHandoffs.filter(p => p.priority === 'routine').length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Add Patient Button */}
              <button
                onClick={() => setShowAddPatient(true)}
                className="w-full mt-4 bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 flex items-center justify-center"
              >
                <Plus className="h-5 w-5 mr-2" />
                Add Patient to Handoff
              </button>
            </div>

            {/* Patient Handoffs */}
            <div className="lg:col-span-2">
              {showAddPatient && (
                <div className="bg-white rounded-lg shadow p-4 mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-gray-900">Select Patient</h3>
                    <button
                      onClick={() => setShowAddPatient(false)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      ×
                    </button>
                  </div>
                  <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search patients..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2 mb-4">
                    {filteredPatients
                      .filter(p => !patientHandoffs.find(ph => ph.patientId === p.patient_id))
                      .map(patient => (
                        <button
                          key={patient.patient_id}
                          onClick={() => { setSelectedPatientId(patient.patient_id); }}
                          className={`w-full text-left p-3 rounded-lg transition-colors ${
                            selectedPatientId === patient.patient_id
                              ? 'bg-purple-100 border-2 border-purple-500'
                              : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                          }`}
                        >
                          <p className="font-medium text-gray-900">{patient.full_name}</p>
                          <p className="text-sm text-gray-500">{patient.patient_id}</p>
                        </button>
                      ))
                    }
                  </div>

                  {selectedPatientId && (
                    <div className="border-t pt-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="handoff-new-patient-room" className="block text-sm font-medium text-gray-700">Room</label>
                          <input
                            id="handoff-new-patient-room"
                            type="text"
                            value={newPatientHandoff.room}
                            onChange={(e) => setNewPatientHandoff({ ...newPatientHandoff, room: e.target.value })}
                            placeholder="e.g., 402A"
                            className="w-full p-2 border border-gray-300 rounded"
                          />
                        </div>
                        <div>
                          <label htmlFor="handoff-new-patient-priority" className="block text-sm font-medium text-gray-700">Priority</label>
                          <select
                            id="handoff-new-patient-priority"
                            value={newPatientHandoff.priority}
                            onChange={(e) => setNewPatientHandoff({ ...newPatientHandoff, priority: e.target.value as Priority })}
                            className="w-full p-2 border border-gray-300 rounded"
                          >
                            <option value="routine">Routine</option>
                            <option value="urgent">Urgent</option>
                            <option value="critical">Critical</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="handoff-new-patient-diagnosis" className="block text-sm font-medium text-gray-700">Diagnosis</label>
                        <input
                          id="handoff-new-patient-diagnosis"
                          type="text"
                          value={newPatientHandoff.diagnosis}
                          onChange={(e) => setNewPatientHandoff({ ...newPatientHandoff, diagnosis: e.target.value })}
                          placeholder="Primary diagnosis"
                          className="w-full p-2 border border-gray-300 rounded"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const patient = patients.find(p => p.patient_id === selectedPatientId);
                          if (patient) addPatientToHandoff(patient);
                        }}
                        className="w-full bg-purple-600 text-white py-2 rounded hover:bg-purple-700"
                      >
                        Add to Handoff
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Patient Handoff Cards */}
              <div className="space-y-4">
                {patientHandoffs.map(patient => (
                  <div key={patient.patientId} className="bg-white rounded-lg shadow overflow-hidden">
                    {/* Patient Header */}
                    <div
                      className={`p-4 cursor-pointer ${
                        patient.priority === 'critical' ? 'bg-red-50 border-l-4 border-red-500' :
                        patient.priority === 'urgent' ? 'bg-yellow-50 border-l-4 border-yellow-500' :
                        'bg-green-50 border-l-4 border-green-500'
                      }`}
                      onClick={() => setExpandedPatient(expandedPatient === patient.patientId ? null : patient.patientId)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center space-x-3">
                            <h3 className="font-bold text-gray-900">{patient.patientName}</h3>
                            <span className="text-sm text-gray-500">Room {patient.room || 'TBD'}</span>
                            <span className={`px-2 py-0.5 rounded text-xs ${getPriorityColor(patient.priority)}`}>
                              {patient.priority.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">{patient.diagnosis || 'Diagnosis pending'}</p>
                          <div className="flex items-center space-x-3 mt-1 text-xs text-gray-500">
                            <span>Code: {patient.codeStatus}</span>
                            {patient.isolation && <span className="text-orange-600">⚠ {patient.isolation}</span>}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-gray-400">
                            {expandedPatient === patient.patientId ? '▼' : '▶'}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removePatientFromHandoff(patient.patientId); }}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {expandedPatient === patient.patientId && (
                      <div className="p-4 border-t space-y-4">
                        {/* SBAR Section */}
                        <div className="bg-purple-50 rounded-lg p-4">
                          <h4 className="font-bold text-purple-800 mb-3 flex items-center">
                            <MessageSquare className="h-4 w-4 mr-2" />
                            SBAR Communication
                          </h4>
                          <div className="space-y-3">
                            <div>
                              <label htmlFor={`handoff-sbar-situation-${patient.patientId}`} className="block text-sm font-bold text-purple-700 mb-1">S - Situation</label>
                              <textarea
                                id={`handoff-sbar-situation-${patient.patientId}`}
                                value={patient.sbar.situation}
                                onChange={(e) => updatePatientSbar(patient.patientId, 'situation', e.target.value)}
                                placeholder="What is the current situation? Why are you calling/handing off?"
                                rows={2}
                                className="w-full p-2 border border-purple-200 rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-sbar-background-${patient.patientId}`} className="block text-sm font-bold text-purple-700 mb-1">B - Background</label>
                              <textarea
                                id={`handoff-sbar-background-${patient.patientId}`}
                                value={patient.sbar.background}
                                onChange={(e) => updatePatientSbar(patient.patientId, 'background', e.target.value)}
                                placeholder="Relevant history, recent changes, treatments given"
                                rows={2}
                                className="w-full p-2 border border-purple-200 rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-sbar-assessment-${patient.patientId}`} className="block text-sm font-bold text-purple-700 mb-1">A - Assessment</label>
                              <textarea
                                id={`handoff-sbar-assessment-${patient.patientId}`}
                                value={patient.sbar.assessment}
                                onChange={(e) => updatePatientSbar(patient.patientId, 'assessment', e.target.value)}
                                placeholder="Your clinical assessment of the situation"
                                rows={2}
                                className="w-full p-2 border border-purple-200 rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-sbar-recommendation-${patient.patientId}`} className="block text-sm font-bold text-purple-700 mb-1">R - Recommendation</label>
                              <textarea
                                id={`handoff-sbar-recommendation-${patient.patientId}`}
                                value={patient.sbar.recommendation}
                                onChange={(e) => updatePatientSbar(patient.patientId, 'recommendation', e.target.value)}
                                placeholder="What actions are needed? What do you recommend?"
                                rows={2}
                                className="w-full p-2 border border-purple-200 rounded"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Quick Info Grid */}
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label htmlFor={`handoff-code-status-${patient.patientId}`} className="block text-xs font-medium text-gray-600">Code Status</label>
                            <select
                              id={`handoff-code-status-${patient.patientId}`}
                              value={patient.codeStatus}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { codeStatus: e.target.value })}
                              className="w-full p-2 border border-gray-300 rounded text-sm"
                            >
                              {codeStatuses.map(s => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`handoff-iv-access-${patient.patientId}`} className="block text-xs font-medium text-gray-600">IV Access</label>
                            <input
                              id={`handoff-iv-access-${patient.patientId}`}
                              type="text"
                              value={patient.ivAccess}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { ivAccess: e.target.value })}
                              placeholder="e.g., 20G L hand"
                              className="w-full p-2 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-diet-${patient.patientId}`} className="block text-xs font-medium text-gray-600">Diet</label>
                            <input
                              id={`handoff-diet-${patient.patientId}`}
                              type="text"
                              value={patient.diet}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { diet: e.target.value })}
                              placeholder="e.g., NPO, Regular"
                              className="w-full p-2 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-activity-${patient.patientId}`} className="block text-xs font-medium text-gray-600">Activity</label>
                            <input
                              id={`handoff-activity-${patient.patientId}`}
                              type="text"
                              value={patient.activity}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { activity: e.target.value })}
                              placeholder="e.g., Bedrest, OOB TID"
                              className="w-full p-2 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-pending-labs-${patient.patientId}`} className="block text-xs font-medium text-gray-600">Pending Labs</label>
                            <input
                              id={`handoff-pending-labs-${patient.patientId}`}
                              type="text"
                              value={patient.pendingLabs}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { pendingLabs: e.target.value })}
                              placeholder="e.g., AM CBC, BMP"
                              className="w-full p-2 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-pending-tests-${patient.patientId}`} className="block text-xs font-medium text-gray-600">Pending Tests</label>
                            <input
                              id={`handoff-pending-tests-${patient.patientId}`}
                              type="text"
                              value={patient.pendingTests}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { pendingTests: e.target.value })}
                              placeholder="e.g., Echo @ 1400"
                              className="w-full p-2 border border-gray-300 rounded text-sm"
                            />
                          </div>
                        </div>

                        {/* Medications */}
                        <div className="bg-blue-50 rounded-lg p-3">
                          <h5 className="font-medium text-blue-800 mb-2 flex items-center">
                            <Pill className="h-4 w-4 mr-2" />
                            Medications
                          </h5>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <label htmlFor={`handoff-meds-scheduled-${patient.patientId}`} className="block text-xs text-blue-600">Scheduled</label>
                              <input
                                id={`handoff-meds-scheduled-${patient.patientId}`}
                                type="text"
                                value={patient.medications.scheduled}
                                onChange={(e) => updatePatientMeds(patient.patientId, 'scheduled', e.target.value)}
                                placeholder="Key scheduled meds"
                                className="w-full p-1 border border-blue-200 rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-meds-prn-${patient.patientId}`} className="block text-xs text-blue-600">PRN</label>
                              <input
                                id={`handoff-meds-prn-${patient.patientId}`}
                                type="text"
                                value={patient.medications.prn}
                                onChange={(e) => updatePatientMeds(patient.patientId, 'prn', e.target.value)}
                                placeholder="PRN meds given"
                                className="w-full p-1 border border-blue-200 rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-meds-drips-${patient.patientId}`} className="block text-xs text-blue-600">Drips/Infusions</label>
                              <input
                                id={`handoff-meds-drips-${patient.patientId}`}
                                type="text"
                                value={patient.medications.drips}
                                onChange={(e) => updatePatientMeds(patient.patientId, 'drips', e.target.value)}
                                placeholder="Active drips"
                                className="w-full p-1 border border-blue-200 rounded"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Safety Risks */}
                        <div className="bg-orange-50 rounded-lg p-3">
                          <h5 className="font-medium text-orange-800 mb-2 flex items-center">
                            <AlertTriangle className="h-4 w-4 mr-2" />
                            Safety Risks
                          </h5>
                          <div className="flex flex-wrap gap-2">
                            {safetyRiskOptions.map(risk => (
                              <button
                                key={risk}
                                type="button"
                                onClick={() => toggleSafetyRisk(patient.patientId, risk)}
                                className={`px-2 py-1 rounded text-xs ${
                                  patient.safetyRisks.includes(risk)
                                    ? 'bg-orange-500 text-white'
                                    : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                                }`}
                              >
                                {risk}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Additional Notes */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label htmlFor={`handoff-pending-orders-${patient.patientId}`} className="block text-xs font-medium text-gray-600">Pending Orders</label>
                            <input
                              id={`handoff-pending-orders-${patient.patientId}`}
                              type="text"
                              value={patient.pendingOrders}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { pendingOrders: e.target.value })}
                              placeholder="Orders to follow up on"
                              className="w-full p-2 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-family-updates-${patient.patientId}`} className="block text-xs font-medium text-gray-600">Family Updates</label>
                            <input
                              id={`handoff-family-updates-${patient.patientId}`}
                              type="text"
                              value={patient.familyUpdates}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { familyUpdates: e.target.value })}
                              placeholder="Family communication notes"
                              className="w-full p-2 border border-gray-300 rounded text-sm"
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor={`handoff-additional-notes-${patient.patientId}`} className="block text-xs font-medium text-gray-600">Additional Notes</label>
                          <textarea
                            id={`handoff-additional-notes-${patient.patientId}`}
                            value={patient.additionalNotes}
                            onChange={(e) => updatePatientHandoff(patient.patientId, { additionalNotes: e.target.value })}
                            placeholder="Any other important information..."
                            rows={2}
                            className="w-full p-2 border border-gray-300 rounded text-sm"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {patientHandoffs.length === 0 && !showAddPatient && (
                  <div className="bg-white rounded-lg shadow p-12 text-center">
                    <ArrowRightLeft className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                    <h2 className="text-xl font-bold text-gray-700 mb-2">No Patients Added</h2>
                    <p className="text-gray-500 mb-4">Add patients to begin documenting your shift handoff.</p>
                    <button
                      onClick={() => setShowAddPatient(true)}
                      className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
                    >
                      Add First Patient
                    </button>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              {patientHandoffs.length > 0 && (
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={isSubmitting}
                    className="bg-purple-600 text-white px-8 py-3 rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="animate-spin h-5 w-5 mr-2" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Send className="h-5 w-5 mr-2" />
                        Submit Handoff
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
              <History className="h-6 w-6 mr-2 text-purple-500" />
              Handoff History
            </h2>
            {historyLoading ? (
              <div className="text-center py-8 text-gray-500">Loading handoff history...</div>
            ) : handoffHistory.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No handoff history available.</p>
                <p className="text-sm mt-1">Previous handoffs will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {handoffHistory.map(h => (
                  <div key={h.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold">{shiftTypes[h.shiftType].label}</p>
                        <p className="text-sm text-gray-500">
                          {h.handoffDate} at {h.handoffTime} • {h.unit}
                        </p>
                        <p className="text-sm">
                          {h.outgoingNurse} → {h.incomingNurse}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded text-sm ${
                        h.status === 'acknowledged' ? 'bg-green-100 text-green-700' :
                        h.status === 'accepted' ? 'bg-blue-100 text-blue-700' :
                        h.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {h.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-2">{h.patients.length} patient(s)</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
