import React, { useState, useEffect, useCallback } from 'react';
import { getPatients, listAutopsy, createAutopsyReport } from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import {
  FileText,
  Search,
  Plus,
  Activity,
  Heart,
  Brain,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

type AutopsyType = 'medico-legal' | 'hospital' | 'forensic' | 'clinical';
type MannerOfDeath = 'natural' | 'accident' | 'suicide' | 'homicide' | 'undetermined' | 'pending';
type AutopsyStatus = 'pending' | 'in-progress' | 'completed' | 'reviewed';

interface ExternalExamination {
  bodyLength: number;
  bodyWeight: number;
  bodyHabitus: string;
  rigorMortis: string;
  livorMortis: string;
  decomposition: string;
  externalInjuries: string;
  identifyingMarks: string;
}

interface InternalExamination {
  cardiovascular: string;
  respiratory: string;
  gastrointestinal: string;
  hepatobiliary: string;
  genitourinary: string;
  endocrine: string;
  musculoskeletal: string;
  nervous: string;
}

interface ToxicologyResult {
  substance: string;
  level: string;
  unit: string;
  interpretation: string;
}

interface HistologyResult {
  organ: string;
  findings: string;
  diagnosis: string;
}

interface AutopsyReport {
  autopsyId: string;
  patientId: string;
  patientName: string;
  autopsyType: AutopsyType;
  dateOfDeath: string;
  dateOfAutopsy: string;
  timeOfAutopsy: string;
  location: string;
  prosector: string;
  assistant?: string;
  status: AutopsyStatus;
  circumstances: string;
  clinicalHistory: string;
  externalExam: ExternalExamination;
  internalExam: InternalExamination;
  causeOfDeath: string;
  mannerOfDeath: MannerOfDeath;
  contributingFactors?: string;
  toxicology?: ToxicologyResult[];
  histology?: HistologyResult[];
  microbiologyFindings?: string;
  radiologyFindings?: string;
  photographs?: string[];
  diagrams?: string[];
  conclusions: string;
  recommendations?: string;
  reportDate: string;
  reviewedBy?: string;
  reviewDate?: string;
  caseNumber?: string;
  legalNotification?: string;
  notes?: string;
}

const AutopsyPage: React.FC = () => {
  const { user } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [autopsies, setAutopsies] = useState<AutopsyReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'reports' | 'new-report' | 'pending'>('reports');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<AutopsyStatus | 'all'>('all');

  const [newAutopsy, setNewAutopsy] = useState({
    patientId: '',
    autopsyType: 'hospital' as AutopsyType,
    dateOfDeath: '',
    dateOfAutopsy: '',
    timeOfAutopsy: '',
    location: '',
    assistant: '',
    circumstances: '',
    clinicalHistory: '',
    bodyLength: '',
    bodyWeight: '',
    bodyHabitus: '',
    rigorMortis: '',
    livorMortis: '',
    decomposition: '',
    externalInjuries: '',
    identifyingMarks: '',
    cardiovascular: '',
    respiratory: '',
    gastrointestinal: '',
    hepatobiliary: '',
    genitourinary: '',
    endocrine: '',
    musculoskeletal: '',
    nervous: '',
    causeOfDeath: '',
    mannerOfDeath: 'natural' as MannerOfDeath,
    contributingFactors: '',
    microbiologyFindings: '',
    radiologyFindings: '',
    conclusions: '',
    recommendations: '',
    caseNumber: '',
    legalNotification: '',
    notes: '',
  });

  const fetchAutopsies = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await listAutopsy();
      if (response.success && response.reports?.items) {
        setAutopsies(response.reports.items as AutopsyReport[]);
      }
    } catch (err) {
      console.error('Error fetching autopsy reports:', err);
      setError('Failed to load autopsy reports');
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
    fetchAutopsies();
  }, [fetchAutopsies]);

  const handleCreateAutopsy = async () => {
    if (!newAutopsy.patientId || !newAutopsy.dateOfDeath || !newAutopsy.causeOfDeath) {
      alert('Please fill in required fields');
      return;
    }

    const patient = patients.find((p) => p.patient_id === newAutopsy.patientId);
    if (!patient) return;

    const autopsy: AutopsyReport = {
      autopsyId: `AUT-${String(autopsies.length + 1).padStart(3, '0')}`,
      patientId: patient.patient_id,
      patientName: patient.full_name,
      autopsyType: newAutopsy.autopsyType,
      dateOfDeath: newAutopsy.dateOfDeath,
      dateOfAutopsy: newAutopsy.dateOfAutopsy,
      timeOfAutopsy: newAutopsy.timeOfAutopsy,
      location: newAutopsy.location,
      prosector: user?.userId || 'USER-001',
      assistant: newAutopsy.assistant || undefined,
      status: 'in-progress',
      circumstances: newAutopsy.circumstances,
      clinicalHistory: newAutopsy.clinicalHistory,
      externalExam: {
        bodyLength: parseFloat(newAutopsy.bodyLength) || 0,
        bodyWeight: parseFloat(newAutopsy.bodyWeight) || 0,
        bodyHabitus: newAutopsy.bodyHabitus,
        rigorMortis: newAutopsy.rigorMortis,
        livorMortis: newAutopsy.livorMortis,
        decomposition: newAutopsy.decomposition,
        externalInjuries: newAutopsy.externalInjuries,
        identifyingMarks: newAutopsy.identifyingMarks,
      },
      internalExam: {
        cardiovascular: newAutopsy.cardiovascular,
        respiratory: newAutopsy.respiratory,
        gastrointestinal: newAutopsy.gastrointestinal,
        hepatobiliary: newAutopsy.hepatobiliary,
        genitourinary: newAutopsy.genitourinary,
        endocrine: newAutopsy.endocrine,
        musculoskeletal: newAutopsy.musculoskeletal,
        nervous: newAutopsy.nervous,
      },
      causeOfDeath: newAutopsy.causeOfDeath,
      mannerOfDeath: newAutopsy.mannerOfDeath,
      contributingFactors: newAutopsy.contributingFactors || undefined,
      microbiologyFindings: newAutopsy.microbiologyFindings || undefined,
      radiologyFindings: newAutopsy.radiologyFindings || undefined,
      conclusions: newAutopsy.conclusions,
      recommendations: newAutopsy.recommendations || undefined,
      reportDate: new Date().toISOString(),
      caseNumber: newAutopsy.caseNumber || undefined,
      legalNotification: newAutopsy.legalNotification || undefined,
      notes: newAutopsy.notes || undefined,
    };

    try {
      setIsLoading(true);
      const response = await createAutopsyReport(autopsy);
      // @ts-ignore - Assuming shared library response type
      if (response.success) {
        setAutopsies([autopsy, ...autopsies]);
        setNewAutopsy({
          patientId: '',
          autopsyType: 'hospital',
          dateOfDeath: '',
          dateOfAutopsy: '',
          timeOfAutopsy: '',
          location: '',
          assistant: '',
          circumstances: '',
          clinicalHistory: '',
          bodyLength: '',
          bodyWeight: '',
          bodyHabitus: '',
          rigorMortis: '',
          livorMortis: '',
          decomposition: '',
          externalInjuries: '',
          identifyingMarks: '',
          cardiovascular: '',
          respiratory: '',
          gastrointestinal: '',
          hepatobiliary: '',
          genitourinary: '',
          endocrine: '',
          musculoskeletal: '',
          nervous: '',
          causeOfDeath: '',
          mannerOfDeath: 'natural',
          contributingFactors: '',
          microbiologyFindings: '',
          radiologyFindings: '',
          conclusions: '',
          recommendations: '',
          caseNumber: '',
          legalNotification: '',
          notes: '',
        });
        setActiveTab('reports');
        alert('Autopsy report created successfully');
      } else {
        // @ts-ignore
        setError(response.error || 'Failed to create autopsy report');
      }
    } catch (err) {
      console.error('Error creating autopsy report:', err);
      setError('An error occurred while creating the autopsy report');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = (status: AutopsyStatus) => {
    const badges = {
      pending: 'bg-yellow-100 text-yellow-800',
      'in-progress': 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      reviewed: 'bg-purple-100 text-purple-800',
    };
    return badges[status];
  };

  const getMannerBadge = (manner: MannerOfDeath) => {
    const badges = {
      natural: 'bg-green-100 text-green-800',
      accident: 'bg-yellow-100 text-yellow-800',
      suicide: 'bg-orange-100 text-orange-800',
      homicide: 'bg-red-100 text-red-800',
      undetermined: 'bg-gray-100 text-gray-800',
      pending: 'bg-blue-100 text-blue-800',
    };
    return badges[manner];
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString();
  };

  const filteredAutopsies = autopsies.filter((a) => {
    const matchesSearch =
      a.autopsyId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.causeOfDeath.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingAutopsies = autopsies.filter((a) => a.status === 'pending' || a.status === 'in-progress');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-orange-600 to-red-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">Autopsy Reports</h1>
        <p className="text-orange-100">Post-mortem examination documentation and findings</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'reports' ? 'text-orange-700 border-b-2 border-orange-700' : 'text-gray-600 hover:text-orange-700'
          }`}
        >
          All Reports ({autopsies.length})
        </button>
        <button
          onClick={() => setActiveTab('new-report')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new-report' ? 'text-orange-700 border-b-2 border-orange-700' : 'text-gray-600 hover:text-orange-700'
          }`}
        >
          New Report
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'pending' ? 'text-orange-700 border-b-2 border-orange-700' : 'text-gray-600 hover:text-orange-700'
          }`}
        >
          Pending ({pendingAutopsies.length})
        </button>
      </div>

      {(activeTab === 'reports' || activeTab === 'pending') && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search reports..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as AutopsyStatus | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="in-progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="reviewed">Reviewed</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {(activeTab === 'pending' ? pendingAutopsies : filteredAutopsies).map((autopsy) => (
              <div key={autopsy.autopsyId} className="border border-gray-300 rounded-lg shadow-sm bg-white p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-gray-900">{autopsy.autopsyId}</h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(autopsy.status)}`}>
                        {autopsy.status.toUpperCase()}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getMannerBadge(autopsy.mannerOfDeath)}`}>
                        {autopsy.mannerOfDeath.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">Case: {autopsy.caseNumber || 'Not assigned'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 bg-orange-50 rounded-lg p-4">
                  <div>
                    <p className="text-sm text-orange-900 font-semibold mb-1">Deceased</p>
                    <p className="font-semibold text-gray-900">{autopsy.patientName}</p>
                    <p className="text-sm text-gray-600">{autopsy.patientId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-orange-900 font-semibold mb-1">Date of Death</p>
                    <p className="text-sm text-gray-900">{autopsy.dateOfDeath}</p>
                  </div>
                  <div>
                    <p className="text-sm text-orange-900 font-semibold mb-1">Autopsy Date</p>
                    <p className="text-sm text-gray-900">{autopsy.dateOfAutopsy} at {autopsy.timeOfAutopsy}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-red-900 mb-1">Cause of Death</p>
                    <p className="text-sm text-red-800 font-semibold">{autopsy.causeOfDeath}</p>
                    {autopsy.contributingFactors && (
                      <p className="text-sm text-red-700 mt-2">Contributing: {autopsy.contributingFactors}</p>
                    )}
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-yellow-900 mb-1">Circumstances</p>
                    <p className="text-sm text-yellow-800">{autopsy.circumstances}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 border border-gray-200 rounded p-3">
                      <p className="text-sm font-semibold text-gray-700 mb-1">Clinical History</p>
                      <p className="text-sm text-gray-900">{autopsy.clinicalHistory}</p>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded p-3">
                      <p className="text-sm font-semibold text-gray-700 mb-1">Location</p>
                      <p className="text-sm text-gray-900">{autopsy.location}</p>
                      <p className="text-sm text-gray-600 mt-1">Prosector: {autopsy.prosector}</p>
                      {autopsy.assistant && <p className="text-sm text-gray-600">Assistant: {autopsy.assistant}</p>}
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-blue-900 mb-3">External Examination</p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-blue-800 font-semibold">Length:</span> {autopsy.externalExam.bodyLength} cm
                      </div>
                      <div>
                        <span className="text-blue-800 font-semibold">Weight:</span> {autopsy.externalExam.bodyWeight} kg
                      </div>
                      <div className="col-span-2">
                        <span className="text-blue-800 font-semibold">Habitus:</span> {autopsy.externalExam.bodyHabitus}
                      </div>
                      <div className="col-span-2">
                        <span className="text-blue-800 font-semibold">Rigor Mortis:</span> {autopsy.externalExam.rigorMortis}
                      </div>
                      <div className="col-span-2">
                        <span className="text-blue-800 font-semibold">Livor Mortis:</span> {autopsy.externalExam.livorMortis}
                      </div>
                      {autopsy.externalExam.externalInjuries && (
                        <div className="col-span-2">
                          <span className="text-blue-800 font-semibold">External Injuries:</span> {autopsy.externalExam.externalInjuries}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-purple-900 mb-3">Internal Examination</p>
                    <div className="space-y-2 text-sm">
                      {autopsy.internalExam.cardiovascular && (
                        <div>
                          <span className="text-purple-800 font-semibold flex items-center gap-1">
                            <Heart className="w-4 h-4" /> Cardiovascular:
                          </span>
                          <p className="text-purple-900 ml-5">{autopsy.internalExam.cardiovascular}</p>
                        </div>
                      )}
                      {autopsy.internalExam.respiratory && (
                        <div>
                          <span className="text-purple-800 font-semibold flex items-center gap-1">
                            <Activity className="w-4 h-4" /> Respiratory:
                          </span>
                          <p className="text-purple-900 ml-5">{autopsy.internalExam.respiratory}</p>
                        </div>
                      )}
                      {autopsy.internalExam.gastrointestinal && (
                        <div>
                          <span className="text-purple-800 font-semibold">Gastrointestinal:</span>
                          <p className="text-purple-900 ml-5">{autopsy.internalExam.gastrointestinal}</p>
                        </div>
                      )}
                      {autopsy.internalExam.nervous && (
                        <div>
                          <span className="text-purple-800 font-semibold flex items-center gap-1">
                            <Brain className="w-4 h-4" /> Nervous System:
                          </span>
                          <p className="text-purple-900 ml-5">{autopsy.internalExam.nervous}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {autopsy.histology && autopsy.histology.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <p className="text-sm font-semibold text-green-900 mb-3">Histology Results</p>
                      <div className="space-y-2">
                        {autopsy.histology.map((h, idx) => (
                          <div key={idx} className="text-sm bg-white rounded p-2">
                            <p className="font-semibold text-green-900">{h.organ}</p>
                            <p className="text-green-800">Findings: {h.findings}</p>
                            <p className="text-green-700">Diagnosis: {h.diagnosis}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-gray-900 mb-2">Conclusions</p>
                    <p className="text-sm text-gray-800 whitespace-pre-line">{autopsy.conclusions}</p>
                    {autopsy.recommendations && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-sm font-semibold text-gray-900 mb-1">Recommendations</p>
                        <p className="text-sm text-gray-700">{autopsy.recommendations}</p>
                      </div>
                    )}
                  </div>
                </div>

                {autopsy.reviewedBy && (
                  <div className="mt-4 bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-purple-900">
                      Reviewed by {autopsy.reviewedBy} on {formatDate(autopsy.reviewDate!)}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {(activeTab === 'pending' ? pendingAutopsies : filteredAutopsies).length === 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No autopsy reports found</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'new-report' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Create New Autopsy Report</h2>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Patient <span className="text-red-600">*</span>
                </label>
                <select
                  value={newAutopsy.patientId}
                  onChange={(e) => setNewAutopsy({ ...newAutopsy, patientId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                >
                  <option value="">Select Patient</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Autopsy Type</label>
                <select
                  value={newAutopsy.autopsyType}
                  onChange={(e) => setNewAutopsy({ ...newAutopsy, autopsyType: e.target.value as AutopsyType })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="hospital">Hospital</option>
                  <option value="forensic">Forensic</option>
                  <option value="clinical">Clinical</option>
                </select>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Death Information</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Date of Death <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    value={newAutopsy.dateOfDeath}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, dateOfDeath: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Date of Autopsy</label>
                  <input
                    type="date"
                    value={newAutopsy.dateOfAutopsy}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, dateOfAutopsy: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Time of Autopsy</label>
                  <input
                    type="time"
                    value={newAutopsy.timeOfAutopsy}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, timeOfAutopsy: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Location</label>
                  <input
                    type="text"
                    value={newAutopsy.location}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, location: e.target.value })}
                    placeholder="e.g., Forensic Pathology Unit"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Assistant</label>
                  <input
                    type="text"
                    value={newAutopsy.assistant}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, assistant: e.target.value })}
                    placeholder="Assistant name"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Background</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Circumstances of Death</label>
                  <textarea
                    value={newAutopsy.circumstances}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, circumstances: e.target.value })}
                    placeholder="Describe the circumstances..."
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Clinical History</label>
                  <textarea
                    value={newAutopsy.clinicalHistory}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, clinicalHistory: e.target.value })}
                    placeholder="Relevant medical history..."
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">External Examination</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Body Length (cm)</label>
                  <input
                    type="number"
                    value={newAutopsy.bodyLength}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, bodyLength: e.target.value })}
                    placeholder="e.g., 170"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Body Weight (kg)</label>
                  <input
                    type="number"
                    value={newAutopsy.bodyWeight}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, bodyWeight: e.target.value })}
                    placeholder="e.g., 70"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Body Habitus</label>
                  <input
                    type="text"
                    value={newAutopsy.bodyHabitus}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, bodyHabitus: e.target.value })}
                    placeholder="e.g., Well-developed, well-nourished"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Rigor Mortis</label>
                  <input
                    type="text"
                    value={newAutopsy.rigorMortis}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, rigorMortis: e.target.value })}
                    placeholder="e.g., Present in all extremities"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Livor Mortis</label>
                  <input
                    type="text"
                    value={newAutopsy.livorMortis}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, livorMortis: e.target.value })}
                    placeholder="e.g., Posterior and fixed"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Decomposition</label>
                  <input
                    type="text"
                    value={newAutopsy.decomposition}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, decomposition: e.target.value })}
                    placeholder="e.g., None, early, moderate, advanced"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">External Injuries</label>
                  <textarea
                    value={newAutopsy.externalInjuries}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, externalInjuries: e.target.value })}
                    placeholder="Describe any external injuries..."
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Identifying Marks</label>
                  <textarea
                    value={newAutopsy.identifyingMarks}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, identifyingMarks: e.target.value })}
                    placeholder="Scars, tattoos, birthmarks..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Internal Examination</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Cardiovascular System</label>
                  <textarea
                    value={newAutopsy.cardiovascular}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, cardiovascular: e.target.value })}
                    placeholder="Heart, great vessels findings..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Respiratory System</label>
                  <textarea
                    value={newAutopsy.respiratory}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, respiratory: e.target.value })}
                    placeholder="Lungs, airways findings..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Gastrointestinal System</label>
                  <textarea
                    value={newAutopsy.gastrointestinal}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, gastrointestinal: e.target.value })}
                    placeholder="Stomach, intestines findings..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Hepatobiliary System</label>
                  <textarea
                    value={newAutopsy.hepatobiliary}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, hepatobiliary: e.target.value })}
                    placeholder="Liver, gallbladder, pancreas findings..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Genitourinary System</label>
                  <textarea
                    value={newAutopsy.genitourinary}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, genitourinary: e.target.value })}
                    placeholder="Kidneys, bladder findings..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Endocrine System</label>
                  <textarea
                    value={newAutopsy.endocrine}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, endocrine: e.target.value })}
                    placeholder="Thyroid, adrenals findings..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Musculoskeletal System</label>
                  <textarea
                    value={newAutopsy.musculoskeletal}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, musculoskeletal: e.target.value })}
                    placeholder="Bones, muscles, joints findings..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Nervous System</label>
                  <textarea
                    value={newAutopsy.nervous}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, nervous: e.target.value })}
                    placeholder="Brain, spinal cord findings..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Additional Findings</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Microbiology Findings</label>
                  <textarea
                    value={newAutopsy.microbiologyFindings}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, microbiologyFindings: e.target.value })}
                    placeholder="Culture results, organism identification..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Radiology Findings</label>
                  <textarea
                    value={newAutopsy.radiologyFindings}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, radiologyFindings: e.target.value })}
                    placeholder="X-ray, CT findings..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Conclusions</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Cause of Death <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    value={newAutopsy.causeOfDeath}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, causeOfDeath: e.target.value })}
                    placeholder="Primary cause of death..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Manner of Death</label>
                  <select
                    value={newAutopsy.mannerOfDeath}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, mannerOfDeath: e.target.value as MannerOfDeath })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="natural">Natural</option>
                    <option value="accident">Accident</option>
                    <option value="suicide">Suicide</option>
                    <option value="homicide">Homicide</option>
                    <option value="undetermined">Undetermined</option>
                    <option value="pending">Pending Investigation</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Contributing Factors</label>
                  <textarea
                    value={newAutopsy.contributingFactors}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, contributingFactors: e.target.value })}
                    placeholder="Other significant conditions..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Conclusions</label>
                  <textarea
                    value={newAutopsy.conclusions}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, conclusions: e.target.value })}
                    placeholder="Summary conclusions..."
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Recommendations</label>
                  <textarea
                    value={newAutopsy.recommendations}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, recommendations: e.target.value })}
                    placeholder="Further actions, notifications..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Administrative</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Case Number</label>
                  <input
                    type="text"
                    value={newAutopsy.caseNumber}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, caseNumber: e.target.value })}
                    placeholder="e.g., 2024-FOR-001"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Legal Notification</label>
                  <input
                    type="text"
                    value={newAutopsy.legalNotification}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, legalNotification: e.target.value })}
                    placeholder="Police reference, coroner..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                <textarea
                  value={newAutopsy.notes}
                  onChange={(e) => setNewAutopsy({ ...newAutopsy, notes: e.target.value })}
                  placeholder="Additional notes..."
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <button
              onClick={handleCreateAutopsy}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create Autopsy Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AutopsyPage;
