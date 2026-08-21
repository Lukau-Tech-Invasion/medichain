import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createShiftHandoff, getPatients, apiUrl, useTranslation } from '@medichain/shared';
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

const UNIT_KEYS: Record<string, string> = {
  'Medical-Surgical': 'medical-surgical',
  'ICU': 'icu',
  'CCU': 'ccu',
  'PICU': 'picu',
  'NICU': 'nicu',
  'L&D': 'ld',
  'ED': 'ed',
  'Oncology': 'oncology',
  'Orthopedics': 'orthopedics',
  'Neurology': 'neurology',
  'Cardiology': 'cardiology',
  'Telemetry': 'telemetry'
};

const SAFETY_RISK_KEYS: Record<string, string> = {
  'Fall Risk': 'fall-risk',
  'Aspiration Risk': 'aspiration-risk',
  'Elopement Risk': 'elopement-risk',
  'Pressure Injury Risk': 'pressure-injury-risk',
  'Suicide Precautions': 'suicide-precautions',
  'Seizure Precautions': 'seizure-precautions',
  'Bleeding Precautions': 'bleeding-precautions',
  'DVT Risk': 'dvt-risk',
  'MRSA': 'mrsa',
  'C. Diff': 'c-diff',
  'Contact Isolation': 'contact-isolation',
  'Droplet Isolation': 'droplet-isolation'
};

const CODE_STATUS_KEYS: Record<string, string> = {
  'Full Code': 'full-code',
  'DNR': 'dnr',
  'DNR/DNI': 'dnr-dni',
  'Comfort Measures Only': 'comfort-measures-only',
  'Limited Code': 'limited-code'
};

export default function ShiftHandoffPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
    'day-to-evening': { label: t('docShiftHandoff.shiftType_day-to-evening'), time: '15:00' },
    'evening-to-night': { label: t('docShiftHandoff.shiftType_evening-to-night'), time: '23:00' },
    'night-to-day': { label: t('docShiftHandoff.shiftType_night-to-day'), time: '07:00' }
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
      case 'urgent': return 'bg-caution text-white';
      default: return 'bg-green-500 text-white';
    }
  };

  const addPatientToHandoff = (patient: PatientProfile) => {
    const existingHandoff = patientHandoffs.find(p => p.patientId === patient.patient_id);
    if (existingHandoff) {
      setError(t('docShiftHandoff.errorPatientAlreadyAdded'));
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
      setError(t('docShiftHandoff.errorIncomingNurseRequired'));
      return;
    }

    if (patientHandoffs.length === 0) {
      setError(t('docShiftHandoff.errorNoPatients'));
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
      setSuccess(t('docShiftHandoff.successMessage'));
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      setError(t('docShiftHandoff.errorSaveFailed'));
      console.error('Failed to save shift handoff', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-surface/20 rounded-full">
                <ArrowRightLeft className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{t('docShiftHandoff.title')}</h1>
                <p className="text-purple-100">{t('docShiftHandoff.subtitle')}</p>
              </div>
            </div>
            <div className="text-right text-white">
              <p className="font-medium">{new Date().toLocaleDateString()}</p>
              <p className="text-sm opacity-75">{shiftTypes[handoff.shiftType as ShiftType]?.label}</p>
            </div>
          </div>
        </div>

        {success && (
          <div className="mb-6 bg-ok-subtle border border-ok text-ok-subtle-fg p-4 rounded-lg flex items-center">
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {success}
          </div>
        )}

        {error && (
          <div className="mb-6 bg-critical-subtle border border-critical text-critical-subtle-fg p-4 rounded-lg flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2" />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="bg-surface rounded-lg shadow mb-6">
          <div className="border-b flex">
            <button
              onClick={() => setActiveTab('handoff')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'handoff' 
                  ? 'border-b-2 border-purple-500 text-content-secondary' 
                  : 'text-content-muted'
              }`}
            >
              <FileText className="h-5 w-5" />
              <span>{t('docShiftHandoff.tabCreateHandoff')}</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-4 px-6 font-medium flex items-center justify-center space-x-2 ${
                activeTab === 'history'
                  ? 'border-b-2 border-purple-500 text-content-secondary'
                  : 'text-content-muted'
              }`}
            >
              <History className="h-5 w-5" />
              <span>{t('docShiftHandoff.tabHandoffHistory')}</span>
            </button>
          </div>
        </div>

        {activeTab === 'handoff' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Handoff Details */}
            <div className="lg:col-span-1">
              <div className="bg-surface rounded-lg shadow p-4">
                <h2 className="font-bold text-content mb-4 flex items-center">
                  <Clock className="h-5 w-5 mr-2 text-purple-500" />
                  {t('docShiftHandoff.handoffDetailsTitle')}
                </h2>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="handoff-shift-type" className="block text-sm font-medium text-content-secondary mb-1">{t('docShiftHandoff.shiftTypeLabel')}</label>
                    <select
                      id="handoff-shift-type"
                      value={handoff.shiftType}
                      onChange={(e) => setHandoff({ ...handoff, shiftType: e.target.value as ShiftType })}
                      className="w-full p-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-purple-500"
                    >
                      {Object.entries(shiftTypes).map(([value, { label }]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="handoff-date" className="block text-sm font-medium text-content-secondary mb-1">{t('docShiftHandoff.dateLabel')}</label>
                      <input
                        id="handoff-date"
                        type="date"
                        value={handoff.handoffDate}
                        onChange={(e) => setHandoff({ ...handoff, handoffDate: e.target.value })}
                        className="w-full p-2 border border-border-strong rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="handoff-time" className="block text-sm font-medium text-content-secondary mb-1">{t('docShiftHandoff.timeLabel')}</label>
                      <input
                        id="handoff-time"
                        type="time"
                        value={handoff.handoffTime}
                        onChange={(e) => setHandoff({ ...handoff, handoffTime: e.target.value })}
                        className="w-full p-2 border border-border-strong rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="handoff-unit" className="block text-sm font-medium text-content-secondary mb-1">{t('docShiftHandoff.unitLabel')}</label>
                    <select
                      id="handoff-unit"
                      value={handoff.unit}
                      onChange={(e) => setHandoff({ ...handoff, unit: e.target.value })}
                      className="w-full p-2 border border-border-strong rounded-lg"
                    >
                      {units.map(u => (
                        <option key={u} value={u}>{t(`docShiftHandoff.unit_${UNIT_KEYS[u]}`)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="handoff-outgoing-nurse" className="block text-sm font-medium text-content-secondary mb-1">{t('docShiftHandoff.outgoingNurseLabel')}</label>
                    <input
                      id="handoff-outgoing-nurse"
                      type="text"
                      value={handoff.outgoingNurse}
                      onChange={(e) => setHandoff({ ...handoff, outgoingNurse: e.target.value })}
                      className="w-full p-2 border border-border-strong rounded-lg bg-surface-sunken"
                      readOnly
                    />
                  </div>

                  <div>
                    <label htmlFor="handoff-incoming-nurse" className="block text-sm font-medium text-content-secondary mb-1">{t('docShiftHandoff.incomingNurseLabel')}</label>
                    <input
                      id="handoff-incoming-nurse"
                      type="text"
                      value={handoff.incomingNurse}
                      onChange={(e) => setHandoff({ ...handoff, incomingNurse: e.target.value })}
                      placeholder={t('docShiftHandoff.incomingNursePlaceholder')}
                      className="w-full p-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Patient Summary */}
              <div className="bg-surface rounded-lg shadow p-4 mt-4">
                <h3 className="font-bold text-content mb-3 flex items-center">
                  <Users className="h-5 w-5 mr-2 text-purple-500" />
                  {t('docShiftHandoff.patientSummaryTitle')}
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-content-muted">{t('docShiftHandoff.totalPatients')}</span>
                    <span className="font-bold">{patientHandoffs.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-content-muted">{t('docShiftHandoff.criticalLabel')}</span>
                    <span className="font-bold text-critical-subtle-fg">
                      {patientHandoffs.filter(p => p.priority === 'critical').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-content-muted">{t('docShiftHandoff.urgentLabel')}</span>
                    <span className="font-bold text-caution-subtle-fg">
                      {patientHandoffs.filter(p => p.priority === 'urgent').length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-content-muted">{t('docShiftHandoff.routineLabel')}</span>
                    <span className="font-bold text-ok-subtle-fg">
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
                {t('docShiftHandoff.addPatientButton')}
              </button>
            </div>

            {/* Patient Handoffs */}
            <div className="lg:col-span-2">
              {showAddPatient && (
                <div className="bg-surface rounded-lg shadow p-4 mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-content">{t('docShiftHandoff.selectPatientTitle')}</h3>
                    <button
                      onClick={() => setShowAddPatient(false)}
                      className="text-content-muted hover:text-content-secondary"
                    >
                      ×
                    </button>
                  </div>
                  <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-content-muted" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder={t('docShiftHandoff.searchPatientsPlaceholder')}
                      className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg"
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
                              ? 'bg-surface-sunken border-2 border-purple-500'
                              : 'bg-surface-sunken hover:bg-surface-sunken border-2 border-transparent'
                          }`}
                        >
                          <p className="font-medium text-content">{patient.full_name}</p>
                          <p className="text-sm text-content-muted">{patient.patient_id}</p>
                        </button>
                      ))
                    }
                  </div>

                  {selectedPatientId && (
                    <div className="border-t pt-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="handoff-new-patient-room" className="block text-sm font-medium text-content-secondary">{t('docShiftHandoff.roomLabel')}</label>
                          <input
                            id="handoff-new-patient-room"
                            type="text"
                            value={newPatientHandoff.room}
                            onChange={(e) => setNewPatientHandoff({ ...newPatientHandoff, room: e.target.value })}
                            placeholder={t('docShiftHandoff.roomPlaceholder')}
                            className="w-full p-2 border border-border-strong rounded"
                          />
                        </div>
                        <div>
                          <label htmlFor="handoff-new-patient-priority" className="block text-sm font-medium text-content-secondary">{t('docShiftHandoff.priorityLabel')}</label>
                          <select
                            id="handoff-new-patient-priority"
                            value={newPatientHandoff.priority}
                            onChange={(e) => setNewPatientHandoff({ ...newPatientHandoff, priority: e.target.value as Priority })}
                            className="w-full p-2 border border-border-strong rounded"
                          >
                            <option value="routine">{t('docShiftHandoff.priority_routine')}</option>
                            <option value="urgent">{t('docShiftHandoff.priority_urgent')}</option>
                            <option value="critical">{t('docShiftHandoff.priority_critical')}</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="handoff-new-patient-diagnosis" className="block text-sm font-medium text-content-secondary">{t('docShiftHandoff.diagnosisLabel')}</label>
                        <input
                          id="handoff-new-patient-diagnosis"
                          type="text"
                          value={newPatientHandoff.diagnosis}
                          onChange={(e) => setNewPatientHandoff({ ...newPatientHandoff, diagnosis: e.target.value })}
                          placeholder={t('docShiftHandoff.diagnosisPlaceholder')}
                          className="w-full p-2 border border-border-strong rounded"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const patient = patients.find(p => p.patient_id === selectedPatientId);
                          if (patient) addPatientToHandoff(patient);
                        }}
                        className="w-full bg-purple-600 text-white py-2 rounded hover:bg-purple-700"
                      >
                        {t('docShiftHandoff.addToHandoffButton')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Patient Handoff Cards */}
              <div className="space-y-4">
                {patientHandoffs.map(patient => (
                  <div key={patient.patientId} className="bg-surface rounded-lg shadow overflow-hidden">
                    {/* Patient Header */}
                    <div
                      className={`p-4 cursor-pointer ${
                        patient.priority === 'critical' ? 'bg-critical-subtle border-l-4 border-red-500' :
                        patient.priority === 'urgent' ? 'bg-caution-subtle border-l-4 border-yellow-500' :
                        'bg-ok-subtle border-l-4 border-green-500'
                      }`}
                      onClick={() => setExpandedPatient(expandedPatient === patient.patientId ? null : patient.patientId)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center space-x-3">
                            <h3 className="font-bold text-content">{patient.patientName}</h3>
                            <span className="text-sm text-content-muted">{t('docShiftHandoff.roomPrefix', { room: patient.room || t('docShiftHandoff.roomTBD') })}</span>
                            <span className={`px-2 py-0.5 rounded text-xs ${getPriorityColor(patient.priority)}`}>
                              {t(`docShiftHandoff.priorityBadge_${patient.priority}`)}
                            </span>
                          </div>
                          <p className="text-sm text-content-muted">{patient.diagnosis || t('docShiftHandoff.diagnosisPending')}</p>
                          <div className="flex items-center space-x-3 mt-1 text-xs text-content-muted">
                            <span>{t('docShiftHandoff.codePrefix', { status: t(`docShiftHandoff.codeStatus_${CODE_STATUS_KEYS[patient.codeStatus]}`) })}</span>
                            {patient.isolation && <span className="inline-flex items-center gap-1 text-content-secondary"><AlertTriangle size={12} aria-hidden="true" /> {patient.isolation}</span>}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-content-muted">
                            {expandedPatient === patient.patientId ? '▼' : '▶'}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removePatientFromHandoff(patient.patientId); }}
                            className="text-red-500 hover:text-critical-subtle-fg p-1"
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
                        <div className="bg-surface-sunken rounded-lg p-4">
                          <h4 className="font-bold text-content-secondary mb-3 flex items-center">
                            <MessageSquare className="h-4 w-4 mr-2" />
                            {t('docShiftHandoff.sbarTitle')}
                          </h4>
                          <div className="space-y-3">
                            <div>
                              <label htmlFor={`handoff-sbar-situation-${patient.patientId}`} className="block text-sm font-bold text-content-secondary mb-1">{t('docShiftHandoff.situationLabel')}</label>
                              <textarea
                                id={`handoff-sbar-situation-${patient.patientId}`}
                                value={patient.sbar.situation}
                                onChange={(e) => updatePatientSbar(patient.patientId, 'situation', e.target.value)}
                                placeholder={t('docShiftHandoff.situationPlaceholder')}
                                rows={2}
                                className="w-full p-2 border border-purple-200 rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-sbar-background-${patient.patientId}`} className="block text-sm font-bold text-content-secondary mb-1">{t('docShiftHandoff.backgroundLabel')}</label>
                              <textarea
                                id={`handoff-sbar-background-${patient.patientId}`}
                                value={patient.sbar.background}
                                onChange={(e) => updatePatientSbar(patient.patientId, 'background', e.target.value)}
                                placeholder={t('docShiftHandoff.backgroundPlaceholder')}
                                rows={2}
                                className="w-full p-2 border border-purple-200 rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-sbar-assessment-${patient.patientId}`} className="block text-sm font-bold text-content-secondary mb-1">{t('docShiftHandoff.assessmentLabel')}</label>
                              <textarea
                                id={`handoff-sbar-assessment-${patient.patientId}`}
                                value={patient.sbar.assessment}
                                onChange={(e) => updatePatientSbar(patient.patientId, 'assessment', e.target.value)}
                                placeholder={t('docShiftHandoff.assessmentPlaceholder')}
                                rows={2}
                                className="w-full p-2 border border-purple-200 rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-sbar-recommendation-${patient.patientId}`} className="block text-sm font-bold text-content-secondary mb-1">{t('docShiftHandoff.recommendationLabel')}</label>
                              <textarea
                                id={`handoff-sbar-recommendation-${patient.patientId}`}
                                value={patient.sbar.recommendation}
                                onChange={(e) => updatePatientSbar(patient.patientId, 'recommendation', e.target.value)}
                                placeholder={t('docShiftHandoff.recommendationPlaceholder')}
                                rows={2}
                                className="w-full p-2 border border-purple-200 rounded"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Quick Info Grid */}
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label htmlFor={`handoff-code-status-${patient.patientId}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.codeStatusLabel')}</label>
                            <select
                              id={`handoff-code-status-${patient.patientId}`}
                              value={patient.codeStatus}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { codeStatus: e.target.value })}
                              className="w-full p-2 border border-border-strong rounded text-sm"
                            >
                              {codeStatuses.map(s => (
                                <option key={s} value={s}>{t(`docShiftHandoff.codeStatus_${CODE_STATUS_KEYS[s]}`)}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`handoff-iv-access-${patient.patientId}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.ivAccessLabel')}</label>
                            <input
                              id={`handoff-iv-access-${patient.patientId}`}
                              type="text"
                              value={patient.ivAccess}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { ivAccess: e.target.value })}
                              placeholder={t('docShiftHandoff.ivAccessPlaceholder')}
                              className="w-full p-2 border border-border-strong rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-diet-${patient.patientId}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.dietLabel')}</label>
                            <input
                              id={`handoff-diet-${patient.patientId}`}
                              type="text"
                              value={patient.diet}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { diet: e.target.value })}
                              placeholder={t('docShiftHandoff.dietPlaceholder')}
                              className="w-full p-2 border border-border-strong rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-activity-${patient.patientId}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.activityLabel')}</label>
                            <input
                              id={`handoff-activity-${patient.patientId}`}
                              type="text"
                              value={patient.activity}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { activity: e.target.value })}
                              placeholder={t('docShiftHandoff.activityPlaceholder')}
                              className="w-full p-2 border border-border-strong rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-pending-labs-${patient.patientId}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.pendingLabsLabel')}</label>
                            <input
                              id={`handoff-pending-labs-${patient.patientId}`}
                              type="text"
                              value={patient.pendingLabs}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { pendingLabs: e.target.value })}
                              placeholder={t('docShiftHandoff.pendingLabsPlaceholder')}
                              className="w-full p-2 border border-border-strong rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-pending-tests-${patient.patientId}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.pendingTestsLabel')}</label>
                            <input
                              id={`handoff-pending-tests-${patient.patientId}`}
                              type="text"
                              value={patient.pendingTests}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { pendingTests: e.target.value })}
                              placeholder={t('docShiftHandoff.pendingTestsPlaceholder')}
                              className="w-full p-2 border border-border-strong rounded text-sm"
                            />
                          </div>
                        </div>

                        {/* Medications */}
                        <div className="bg-notice-subtle rounded-lg p-3">
                          <h5 className="font-medium text-notice-subtle-fg mb-2 flex items-center">
                            <Pill className="h-4 w-4 mr-2" />
                            {t('docShiftHandoff.medicationsTitle')}
                          </h5>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <label htmlFor={`handoff-meds-scheduled-${patient.patientId}`} className="block text-xs text-notice-subtle-fg">{t('docShiftHandoff.scheduledLabel')}</label>
                              <input
                                id={`handoff-meds-scheduled-${patient.patientId}`}
                                type="text"
                                value={patient.medications.scheduled}
                                onChange={(e) => updatePatientMeds(patient.patientId, 'scheduled', e.target.value)}
                                placeholder={t('docShiftHandoff.scheduledPlaceholder')}
                                className="w-full p-1 border border-notice rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-meds-prn-${patient.patientId}`} className="block text-xs text-notice-subtle-fg">{t('docShiftHandoff.prnLabel')}</label>
                              <input
                                id={`handoff-meds-prn-${patient.patientId}`}
                                type="text"
                                value={patient.medications.prn}
                                onChange={(e) => updatePatientMeds(patient.patientId, 'prn', e.target.value)}
                                placeholder={t('docShiftHandoff.prnPlaceholder')}
                                className="w-full p-1 border border-notice rounded"
                              />
                            </div>
                            <div>
                              <label htmlFor={`handoff-meds-drips-${patient.patientId}`} className="block text-xs text-notice-subtle-fg">{t('docShiftHandoff.dripsLabel')}</label>
                              <input
                                id={`handoff-meds-drips-${patient.patientId}`}
                                type="text"
                                value={patient.medications.drips}
                                onChange={(e) => updatePatientMeds(patient.patientId, 'drips', e.target.value)}
                                placeholder={t('docShiftHandoff.dripsPlaceholder')}
                                className="w-full p-1 border border-notice rounded"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Safety Risks */}
                        <div className="bg-surface-sunken rounded-lg p-3">
                          <h5 className="font-medium text-content-secondary mb-2 flex items-center">
                            <AlertTriangle className="h-4 w-4 mr-2" />
                            {t('docShiftHandoff.safetyRisksTitle')}
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
                                    : 'bg-surface-sunken text-content-secondary hover:bg-orange-200'
                                }`}
                              >
                                {t(`docShiftHandoff.risk_${SAFETY_RISK_KEYS[risk]}`)}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Additional Notes */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label htmlFor={`handoff-pending-orders-${patient.patientId}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.pendingOrdersLabel')}</label>
                            <input
                              id={`handoff-pending-orders-${patient.patientId}`}
                              type="text"
                              value={patient.pendingOrders}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { pendingOrders: e.target.value })}
                              placeholder={t('docShiftHandoff.pendingOrdersPlaceholder')}
                              className="w-full p-2 border border-border-strong rounded text-sm"
                            />
                          </div>
                          <div>
                            <label htmlFor={`handoff-family-updates-${patient.patientId}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.familyUpdatesLabel')}</label>
                            <input
                              id={`handoff-family-updates-${patient.patientId}`}
                              type="text"
                              value={patient.familyUpdates}
                              onChange={(e) => updatePatientHandoff(patient.patientId, { familyUpdates: e.target.value })}
                              placeholder={t('docShiftHandoff.familyUpdatesPlaceholder')}
                              className="w-full p-2 border border-border-strong rounded text-sm"
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor={`handoff-additional-notes-${patient.patientId}`} className="block text-xs font-medium text-content-muted">{t('docShiftHandoff.additionalNotesLabel')}</label>
                          <textarea
                            id={`handoff-additional-notes-${patient.patientId}`}
                            value={patient.additionalNotes}
                            onChange={(e) => updatePatientHandoff(patient.patientId, { additionalNotes: e.target.value })}
                            placeholder={t('docShiftHandoff.additionalNotesPlaceholder')}
                            rows={2}
                            className="w-full p-2 border border-border-strong rounded text-sm"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {patientHandoffs.length === 0 && !showAddPatient && (
                  <div className="bg-surface rounded-lg shadow p-12 text-center">
                    <ArrowRightLeft className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                    <h2 className="text-xl font-bold text-content-secondary mb-2">{t('docShiftHandoff.noPatientsTitle')}</h2>
                    <p className="text-content-muted mb-4">{t('docShiftHandoff.noPatientsDesc')}</p>
                    <button
                      onClick={() => setShowAddPatient(true)}
                      className="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
                    >
                      {t('docShiftHandoff.addFirstPatientButton')}
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
                        {t('docShiftHandoff.submitting')}
                      </>
                    ) : (
                      <>
                        <Send className="h-5 w-5 mr-2" />
                        {t('docShiftHandoff.submitHandoff')}
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-content mb-6 flex items-center">
              <History className="h-6 w-6 mr-2 text-purple-500" />
              {t('docShiftHandoff.handoffHistoryTitle')}
            </h2>
            {historyLoading ? (
              <div className="text-center py-8 text-content-muted">{t('docShiftHandoff.loadingHistory')}</div>
            ) : handoffHistory.length === 0 ? (
              <div className="text-center py-12 text-content-muted">
                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>{t('docShiftHandoff.noHistoryAvailable')}</p>
                <p className="text-sm mt-1">{t('docShiftHandoff.noHistoryHint')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {handoffHistory.map(h => (
                  <div key={h.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold">{shiftTypes[h.shiftType].label}</p>
                        <p className="text-sm text-content-muted">
                          {t('docShiftHandoff.dateTimeUnit', { date: h.handoffDate, time: h.handoffTime, unit: h.unit })}
                        </p>
                        <p className="text-sm">
                          {t('docShiftHandoff.nurseArrow', { outgoing: h.outgoingNurse, incoming: h.incomingNurse })}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded text-sm ${
                        h.status === 'acknowledged' ? 'bg-ok-subtle text-ok-subtle-fg' :
                        h.status === 'accepted' ? 'bg-notice-subtle text-notice-subtle-fg' :
                        h.status === 'pending' ? 'bg-caution-subtle text-caution-subtle-fg' :
                        'bg-surface-sunken text-content-secondary'
                      }`}>
                        {t(`docShiftHandoff.status_${h.status}`)}
                      </span>
                    </div>
                    <p className="text-sm text-content-muted mt-2">{t('docShiftHandoff.patientsCount', { count: h.patients.length })}</p>
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
