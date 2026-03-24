import React, { useState, useEffect, useCallback } from 'react';
import { getPatients, listConsults, createConsult } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import {
  MessageSquare,
  Clock,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Search,
  Plus,
  Send,
  FileText,
  Activity,
  AlertCircle,
} from 'lucide-react';

type ConsultSpecialty =
  | 'cardiology'
  | 'neurology'
  | 'orthopedics'
  | 'general-surgery'
  | 'psychiatry'
  | 'infectious-disease'
  | 'nephrology'
  | 'pulmonology'
  | 'gastroenterology'
  | 'endocrinology'
  | 'hematology'
  | 'oncology'
  | 'dermatology'
  | 'urology'
  | 'ophthalmology'
  | 'ent'
  | 'obstetrics-gynecology'
  | 'pediatrics'
  | 'radiology'
  | 'pathology'
  | 'anesthesiology'
  | 'plastic-surgery'
  | 'vascular-surgery';

type ConsultUrgency = 'routine' | 'urgent' | 'emergent' | 'stat';

type ConsultStatus = 'requested' | 'acknowledged' | 'in-progress' | 'completed' | 'declined' | 'cancelled';

interface ConsultResponse {
  responseId: string;
  respondedBy: string;
  respondedAt: string;
  assessment: string;
  recommendations: string;
  followUp?: string;
  attachments?: string[];
}

interface Consult {
  consultId: string;
  patientId: string;
  patientName: string;
  specialty: ConsultSpecialty;
  urgency: ConsultUrgency;
  status: ConsultStatus;
  reason: string;
  clinicalQuestion: string;
  relevantHistory: string;
  currentMedications?: string;
  vitalSigns?: string;
  labResults?: string;
  imagingResults?: string;
  requestedBy: string;
  requestedAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  response?: ConsultResponse;
  notes?: string;
}

const ConsultPage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [consults, setConsults] = useState<Consult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'new-request' | 'completed' | 'my-consults'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ConsultStatus | 'all'>('all');
  const [specialtyFilter, setSpecialtyFilter] = useState<ConsultSpecialty | 'all'>('all');
  const [selectedConsult, setSelectedConsult] = useState<string>('');

  const [newConsult, setNewConsult] = useState({
    patientId: '',
    specialty: 'cardiology' as ConsultSpecialty,
    urgency: 'routine' as ConsultUrgency,
    reason: '',
    clinicalQuestion: '',
    relevantHistory: '',
    currentMedications: '',
    vitalSigns: '',
    labResults: '',
    imagingResults: '',
    notes: '',
  });

  const [consultResponse, setConsultResponse] = useState({
    assessment: '',
    recommendations: '',
    followUp: '',
  });

  const fetchConsults = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await listConsults();
      if (response.success && Array.isArray(response.items)) {
        setConsults(response.items as Consult[]);
      }
    } catch (err) {
      console.error('Error fetching consults:', err);
      setError('Failed to load consults');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      const patientData = await getPatients();
      setPatients(patientData);
    };
    loadData();
  }, []);

  useEffect(() => {
    fetchConsults();
  }, [fetchConsults]);

  const handleRequestConsult = async () => {
    if (!newConsult.patientId || !newConsult.reason || !newConsult.clinicalQuestion) {
      showWarning('Please fill in required fields');
      return;
    }

    const patient = patients.find((p) => p.patient_id === newConsult.patientId);
    if (!patient) return;

    const consult: Consult = {
      consultId: `CONS-${String(consults.length + 1).padStart(3, '0')}`,
      patientId: patient.patient_id,
      patientName: patient.full_name,
      specialty: newConsult.specialty,
      urgency: newConsult.urgency,
      status: 'requested',
      reason: newConsult.reason,
      clinicalQuestion: newConsult.clinicalQuestion,
      relevantHistory: newConsult.relevantHistory,
      currentMedications: newConsult.currentMedications || undefined,
      vitalSigns: newConsult.vitalSigns || undefined,
      labResults: newConsult.labResults || undefined,
      imagingResults: newConsult.imagingResults || undefined,
      requestedBy: user?.userId || 'USER-001',
      requestedAt: new Date().toISOString(),
      notes: newConsult.notes || undefined,
    };

    try {
      await createConsult(consult);
    } catch (err) {
      console.error('Failed to save consult:', err);
    }

    setConsults([consult, ...consults]);
    setNewConsult({
      patientId: '',
      specialty: 'cardiology',
      urgency: 'routine',
      reason: '',
      clinicalQuestion: '',
      relevantHistory: '',
      currentMedications: '',
      vitalSigns: '',
      labResults: '',
      imagingResults: '',
      notes: '',
    });
    setActiveTab('active');
    showSuccess(`Consult ${consult.consultId} requested successfully`);
  };

  const handleRespondToConsult = () => {
    if (!selectedConsult || !consultResponse.assessment || !consultResponse.recommendations) {
      showWarning('Please fill in required response fields');
      return;
    }

    const updatedConsults = consults.map((c) => {
      if (c.consultId === selectedConsult) {
        return {
          ...c,
          status: 'completed' as ConsultStatus,
          response: {
            responseId: `RESP-${String(consults.length + 1).padStart(3, '0')}`,
            respondedBy: `${user?.userId || 'USER-001'} (${user?.userId || 'Consultant'})`,
            respondedAt: new Date().toISOString(),
            assessment: consultResponse.assessment,
            recommendations: consultResponse.recommendations,
            followUp: consultResponse.followUp || undefined,
          },
        };
      }
      return c;
    });

    setConsults(updatedConsults);
    setConsultResponse({
      assessment: '',
      recommendations: '',
      followUp: '',
    });
    setSelectedConsult('');
    showSuccess('Consult response submitted successfully');
  };

  const getStatusBadge = (status: ConsultStatus) => {
    const badges = {
      requested: 'bg-yellow-100 text-yellow-800',
      acknowledged: 'bg-blue-100 text-blue-800',
      'in-progress': 'bg-purple-100 text-purple-800',
      completed: 'bg-green-100 text-green-800',
      declined: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };
    return badges[status];
  };

  const getStatusIcon = (status: ConsultStatus) => {
    const icons = {
      requested: Clock,
      acknowledged: AlertCircle,
      'in-progress': Activity,
      completed: CheckCircle,
      declined: XCircle,
      cancelled: XCircle,
    };
    return icons[status];
  };

  const getUrgencyBadge = (urgency: ConsultUrgency) => {
    const badges = {
      routine: 'bg-gray-100 text-gray-800',
      urgent: 'bg-orange-100 text-orange-800',
      emergent: 'bg-red-100 text-red-800',
      stat: 'bg-red-200 text-red-900',
    };
    return badges[urgency];
  };

  const formatSpecialty = (specialty: string) => {
    return specialty
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const _formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString();
  };

  const formatDateTime = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const _filteredConsults = consults.filter((c) => {
    const matchesSearch =
      c.consultId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.reason.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchesSpecialty = specialtyFilter === 'all' || c.specialty === specialtyFilter;

    return matchesSearch && matchesStatus && matchesSpecialty;
  });

  const activeConsults = consults.filter((c) => c.status !== 'completed' && c.status !== 'cancelled');
  const completedConsults = consults.filter((c) => c.status === 'completed');
  const myConsults = consults.filter((c) => c.requestedBy === (user?.userId || 'USER-001'));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">Specialty Consultations</h1>
        <p className="text-blue-100">Request and manage inter-specialty consultations</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'active' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-gray-600 hover:text-blue-700'
          }`}
        >
          Active Consults ({activeConsults.length})
        </button>
        <button
          onClick={() => setActiveTab('new-request')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new-request' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-gray-600 hover:text-blue-700'
          }`}
        >
          New Request
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'completed' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-gray-600 hover:text-blue-700'
          }`}
        >
          Completed ({completedConsults.length})
        </button>
        <button
          onClick={() => setActiveTab('my-consults')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'my-consults' ? 'text-blue-700 border-b-2 border-blue-700' : 'text-gray-600 hover:text-blue-700'
          }`}
        >
          My Requests ({myConsults.length})
        </button>
      </div>

      {(activeTab === 'active' || activeTab === 'completed' || activeTab === 'my-consults') && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="consult-search" className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    id="consult-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search consults..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="consult-status-filter" className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select
                  id="consult-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as ConsultStatus | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">All Statuses</option>
                  <option value="requested">Requested</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="in-progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="declined">Declined</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label htmlFor="consult-specialty-filter" className="block text-sm font-semibold text-gray-700 mb-2">Specialty</label>
                <select
                  id="consult-specialty-filter"
                  value={specialtyFilter}
                  onChange={(e) => setSpecialtyFilter(e.target.value as ConsultSpecialty | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">All Specialties</option>
                  <option value="cardiology">Cardiology</option>
                  <option value="neurology">Neurology</option>
                  <option value="orthopedics">Orthopedics</option>
                  <option value="general-surgery">General Surgery</option>
                  <option value="psychiatry">Psychiatry</option>
                  <option value="infectious-disease">Infectious Disease</option>
                  <option value="nephrology">Nephrology</option>
                  <option value="pulmonology">Pulmonology</option>
                  <option value="gastroenterology">Gastroenterology</option>
                  <option value="endocrinology">Endocrinology</option>
                  <option value="hematology">Hematology</option>
                  <option value="oncology">Oncology</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {(activeTab === 'active' ? activeConsults : activeTab === 'completed' ? completedConsults : myConsults)
              .filter((c) => {
                const matchesSearch =
                  c.consultId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  c.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  c.reason.toLowerCase().includes(searchTerm.toLowerCase());
                const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
                const matchesSpecialty = specialtyFilter === 'all' || c.specialty === specialtyFilter;
                return matchesSearch && matchesStatus && matchesSpecialty;
              })
              .map((consult) => {
                const StatusIcon = getStatusIcon(consult.status);
                return (
                  <div key={consult.consultId} className="border border-gray-300 rounded-lg shadow-sm bg-white p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-bold text-gray-900">{consult.consultId}</h3>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${getStatusBadge(consult.status)}`}>
                            <StatusIcon className="w-3 h-3" />
                            {consult.status.toUpperCase()}
                          </span>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getUrgencyBadge(consult.urgency)}`}>
                            {consult.urgency.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">Requested {formatDateTime(consult.requestedAt)}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-4 bg-blue-50 rounded-lg p-4">
                      <div>
                        <p className="text-sm text-blue-900 font-semibold mb-1">Patient</p>
                        <p className="font-semibold text-gray-900">{consult.patientName}</p>
                        <p className="text-sm text-gray-600">{consult.patientId}</p>
                      </div>
                      <div>
                        <p className="text-sm text-blue-900 font-semibold mb-1">Specialty</p>
                        <p className="font-semibold text-gray-900">{formatSpecialty(consult.specialty)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-blue-900 font-semibold mb-1">Requested By</p>
                        <p className="text-sm text-gray-900">{consult.requestedBy}</p>
                      </div>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <p className="text-sm font-semibold text-yellow-900 mb-1">Reason for Consult</p>
                        <p className="text-sm text-yellow-800">{consult.reason}</p>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-sm font-semibold text-blue-900 mb-1">Clinical Question</p>
                        <p className="text-sm text-blue-800">{consult.clinicalQuestion}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-gray-50 border border-gray-200 rounded p-3">
                          <p className="text-sm font-semibold text-gray-700 mb-1">Relevant History</p>
                          <p className="text-sm text-gray-900">{consult.relevantHistory}</p>
                        </div>
                        {consult.currentMedications && (
                          <div className="bg-gray-50 border border-gray-200 rounded p-3">
                            <p className="text-sm font-semibold text-gray-700 mb-1">Current Medications</p>
                            <p className="text-sm text-gray-900">{consult.currentMedications}</p>
                          </div>
                        )}
                      </div>

                      {consult.vitalSigns && (
                        <div className="bg-gray-50 border border-gray-200 rounded p-3">
                          <p className="text-sm font-semibold text-gray-700 mb-1">Vital Signs</p>
                          <p className="text-sm text-gray-900">{consult.vitalSigns}</p>
                        </div>
                      )}

                      {consult.labResults && (
                        <div className="bg-gray-50 border border-gray-200 rounded p-3">
                          <p className="text-sm font-semibold text-gray-700 mb-1">Laboratory Results</p>
                          <p className="text-sm text-gray-900">{consult.labResults}</p>
                        </div>
                      )}

                      {consult.imagingResults && (
                        <div className="bg-gray-50 border border-gray-200 rounded p-3">
                          <p className="text-sm font-semibold text-gray-700 mb-1">Imaging Results</p>
                          <p className="text-sm text-gray-900">{consult.imagingResults}</p>
                        </div>
                      )}
                    </div>

                    {consult.acknowledgedBy && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                        <p className="text-sm font-semibold text-green-900 mb-1">Acknowledged</p>
                        <p className="text-sm text-green-800">
                          By {consult.acknowledgedBy} at {formatDateTime(consult.acknowledgedAt!)}
                        </p>
                      </div>
                    )}

                    {consult.response && (
                      <div className="border-t pt-4">
                        <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                          <MessageSquare className="w-5 h-5 text-blue-600" />
                          Consultation Response
                        </h4>
                        <div className="space-y-3">
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-sm font-semibold text-blue-900 mb-2">Assessment</p>
                            <p className="text-sm text-blue-800 whitespace-pre-line">{consult.response.assessment}</p>
                          </div>

                          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <p className="text-sm font-semibold text-green-900 mb-2">Recommendations</p>
                            <p className="text-sm text-green-800 whitespace-pre-line">{consult.response.recommendations}</p>
                          </div>

                          {consult.response.followUp && (
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                              <p className="text-sm font-semibold text-purple-900 mb-2">Follow-Up Plan</p>
                              <p className="text-sm text-purple-800">{consult.response.followUp}</p>
                            </div>
                          )}

                          <div className="text-sm text-gray-600">
                            Response by {consult.response.respondedBy} on {formatDateTime(consult.response.respondedAt)}
                          </div>
                        </div>
                      </div>
                    )}

                    {consult.notes && (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mt-4">
                        <p className="text-sm font-semibold text-gray-700 mb-1">Additional Notes</p>
                        <p className="text-sm text-gray-600 italic">{consult.notes}</p>
                      </div>
                    )}

                    {!consult.response && consult.status !== 'cancelled' && consult.status !== 'declined' && (
                      <div className="mt-4 pt-4 border-t">
                        <button
                          onClick={() => {
                            setSelectedConsult(consult.consultId);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-semibold flex items-center justify-center gap-2"
                        >
                          <Send className="w-4 h-4" />
                          Respond to Consult
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

            {(activeTab === 'active' ? activeConsults : activeTab === 'completed' ? completedConsults : myConsults).filter((c) => {
              const matchesSearch =
                c.consultId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.reason.toLowerCase().includes(searchTerm.toLowerCase());
              const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
              const matchesSpecialty = specialtyFilter === 'all' || c.specialty === specialtyFilter;
              return matchesSearch && matchesStatus && matchesSpecialty;
            }).length === 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No consults found</p>
              </div>
            )}
          </div>

          {selectedConsult && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Respond to Consult: {selectedConsult}
              </h3>

              <div className="space-y-4">
                <div>
                  <label htmlFor="consult-assessment" className="block text-sm font-semibold text-gray-700 mb-2">
                    Assessment <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="consult-assessment"
                    value={consultResponse.assessment}
                    onChange={(e) => setConsultResponse({ ...consultResponse, assessment: e.target.value })}
                    placeholder="Your clinical assessment of the patient..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    rows={4}
                  />
                </div>

                <div>
                  <label htmlFor="consult-recommendations" className="block text-sm font-semibold text-gray-700 mb-2">
                    Recommendations <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="consult-recommendations"
                    value={consultResponse.recommendations}
                    onChange={(e) => setConsultResponse({ ...consultResponse, recommendations: e.target.value })}
                    placeholder="Numbered recommendations (e.g., 1. Start medication X, 2. Order test Y...)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    rows={6}
                  />
                </div>

                <div>
                  <label htmlFor="consult-follow-up" className="block text-sm font-semibold text-gray-700 mb-2">Follow-Up Plan</label>
                  <textarea
                    id="consult-follow-up"
                    value={consultResponse.followUp}
                    onChange={(e) => setConsultResponse({ ...consultResponse, followUp: e.target.value })}
                    placeholder="Follow-up instructions, when to call back, etc."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    rows={3}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleRespondToConsult}
                    className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    Submit Response
                  </button>
                  <button
                    onClick={() => {
                      setSelectedConsult('');
                      setConsultResponse({ assessment: '', recommendations: '', followUp: '' });
                    }}
                    className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'new-request' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Request Specialty Consultation
          </h2>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="consult-patient" className="block text-sm font-semibold text-gray-700 mb-2">
                  Patient <span className="text-red-600">*</span>
                </label>
                <select
                  id="consult-patient"
                  value={newConsult.patientId}
                  onChange={(e) => setNewConsult({ ...newConsult, patientId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">Select patient...</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="consult-specialty" className="block text-sm font-semibold text-gray-700 mb-2">
                  Specialty <span className="text-red-600">*</span>
                </label>
                <select
                  id="consult-specialty"
                  value={newConsult.specialty}
                  onChange={(e) => setNewConsult({ ...newConsult, specialty: e.target.value as ConsultSpecialty })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="cardiology">Cardiology</option>
                  <option value="neurology">Neurology</option>
                  <option value="orthopedics">Orthopedics</option>
                  <option value="general-surgery">General Surgery</option>
                  <option value="psychiatry">Psychiatry</option>
                  <option value="infectious-disease">Infectious Disease</option>
                  <option value="nephrology">Nephrology</option>
                  <option value="pulmonology">Pulmonology</option>
                  <option value="gastroenterology">Gastroenterology</option>
                  <option value="endocrinology">Endocrinology</option>
                  <option value="hematology">Hematology</option>
                  <option value="oncology">Oncology</option>
                  <option value="dermatology">Dermatology</option>
                  <option value="urology">Urology</option>
                  <option value="ophthalmology">Ophthalmology</option>
                  <option value="ent">ENT</option>
                  <option value="obstetrics-gynecology">Obstetrics & Gynecology</option>
                  <option value="pediatrics">Pediatrics</option>
                  <option value="radiology">Radiology</option>
                  <option value="pathology">Pathology</option>
                  <option value="anesthesiology">Anesthesiology</option>
                  <option value="plastic-surgery">Plastic Surgery</option>
                  <option value="vascular-surgery">Vascular Surgery</option>
                </select>
              </div>

              <div>
                <label htmlFor="consult-urgency" className="block text-sm font-semibold text-gray-700 mb-2">
                  Urgency <span className="text-red-600">*</span>
                </label>
                <select
                  id="consult-urgency"
                  value={newConsult.urgency}
                  onChange={(e) => setNewConsult({ ...newConsult, urgency: e.target.value as ConsultUrgency })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="emergent">Emergent</option>
                  <option value="stat">STAT</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="consult-reason" className="block text-sm font-semibold text-gray-700 mb-2">
                Reason for Consult <span className="text-red-600">*</span>
              </label>
              <input
                id="consult-reason"
                type="text"
                value={newConsult.reason}
                onChange={(e) => setNewConsult({ ...newConsult, reason: e.target.value })}
                placeholder="e.g., Acute chest pain, elevated troponin"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>

            <div>
              <label htmlFor="consult-clinical-question" className="block text-sm font-semibold text-gray-700 mb-2">
                Clinical Question <span className="text-red-600">*</span>
              </label>
              <textarea
                id="consult-clinical-question"
                value={newConsult.clinicalQuestion}
                onChange={(e) => setNewConsult({ ...newConsult, clinicalQuestion: e.target.value })}
                placeholder="Specific question for consultant (e.g., Rule out ACS, need cath recommendation...)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                rows={3}
              />
            </div>

            <div>
              <label htmlFor="consult-relevant-history" className="block text-sm font-semibold text-gray-700 mb-2">Relevant History</label>
              <textarea
                id="consult-relevant-history"
                value={newConsult.relevantHistory}
                onChange={(e) => setNewConsult({ ...newConsult, relevantHistory: e.target.value })}
                placeholder="Pertinent PMH, risk factors, etc."
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="consult-current-medications" className="block text-sm font-semibold text-gray-700 mb-2">Current Medications</label>
                <textarea
                  id="consult-current-medications"
                  value={newConsult.currentMedications}
                  onChange={(e) => setNewConsult({ ...newConsult, currentMedications: e.target.value })}
                  placeholder="List current medications"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>

              <div>
                <label htmlFor="consult-vital-signs" className="block text-sm font-semibold text-gray-700 mb-2">Vital Signs</label>
                <textarea
                  id="consult-vital-signs"
                  value={newConsult.vitalSigns}
                  onChange={(e) => setNewConsult({ ...newConsult, vitalSigns: e.target.value })}
                  placeholder="BP, HR, RR, SpO2, Temp"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>

              <div>
                <label htmlFor="consult-lab-results" className="block text-sm font-semibold text-gray-700 mb-2">Laboratory Results</label>
                <textarea
                  id="consult-lab-results"
                  value={newConsult.labResults}
                  onChange={(e) => setNewConsult({ ...newConsult, labResults: e.target.value })}
                  placeholder="Pertinent lab values"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>

              <div>
                <label htmlFor="consult-imaging-results" className="block text-sm font-semibold text-gray-700 mb-2">Imaging Results</label>
                <textarea
                  id="consult-imaging-results"
                  value={newConsult.imagingResults}
                  onChange={(e) => setNewConsult({ ...newConsult, imagingResults: e.target.value })}
                  placeholder="X-ray, CT, MRI, etc."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>
            </div>

            <div>
              <label htmlFor="consult-additional-notes" className="block text-sm font-semibold text-gray-700 mb-2">Additional Notes</label>
              <textarea
                id="consult-additional-notes"
                value={newConsult.notes}
                onChange={(e) => setNewConsult({ ...newConsult, notes: e.target.value })}
                placeholder="Any other relevant information..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                rows={2}
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Consultation Request Guidelines
              </p>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Provide complete clinical information to expedite consultant evaluation</li>
                <li>• For urgent/emergent consults, consider calling consultant directly</li>
                <li>• STAT consults should be used only for life-threatening situations</li>
                <li>• Include pertinent positive and negative findings</li>
                <li>• Specify what action you are requesting (evaluation, procedure, recommendations)</li>
              </ul>
            </div>
          </div>

          <button
            onClick={handleRequestConsult}
            className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold mt-6 flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            Submit Consult Request
          </button>
        </div>
      )}
    </div>
  );
};

export default ConsultPage;
