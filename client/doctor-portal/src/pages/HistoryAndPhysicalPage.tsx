import React, { useState, useEffect } from 'react';
import {
  ClipboardList,
  User,
  Search,
  Plus,
  Eye,
  Edit,
  Printer,
  FileText,
  Heart,
  Activity,
  Stethoscope,
  Brain,
  Pill,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  History,
  Scale,
  Thermometer,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { apiUrl } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

/**
 * HistoryAndPhysicalPage
 * 
 * Page for documenting history and physical (H&P) exams.
 * Implements H&P form, previous exams list, and summary view.
 */

type HPStatus = 'in-progress' | 'complete' | 'signed' | 'addendum';
type SystemReview = 'normal' | 'abnormal' | 'not-examined';

interface VitalSigns {
  bloodPressure: string;
  heartRate: number;
  respiratoryRate: number;
  temperature: number;
  oxygenSaturation: number;
  height: string;
  weight: string;
  bmi: number;
}

interface HistoryAndPhysical {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  dateOfExam: Date;
  examType: 'admission' | 'annual' | 'pre-operative' | 'follow-up' | 'consultation';
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string[];
  pastSurgicalHistory: string[];
  medications: string[];
  allergies: string[];
  socialHistory: {
    smoking: string;
    alcohol: string;
    drugs: string;
    occupation: string;
    exercise: string;
  };
  familyHistory: string[];
  reviewOfSystems: Record<string, SystemReview>;
  vitalSigns: VitalSigns;
  physicalExam: Record<string, { status: SystemReview; notes: string }>;
  assessment: string;
  plan: string;
  provider: string;
  providerCredentials: string;
  status: HPStatus;
  signedAt?: Date;
}

const HistoryAndPhysicalPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'list' | 'new' | 'templates'>('list');
  const [hpRecords, setHpRecords] = useState<HistoryAndPhysical[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<HPStatus | 'all'>('all');
  const [selectedRecord, setSelectedRecord] = useState<HistoryAndPhysical | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['chief-complaint', 'vitals']));
  const [currentSection, setCurrentSection] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();

  // Form state
  const [formData, setFormData] = useState({
    patientId: '',
    patientName: '',
    mrn: '',
    examType: 'admission' as HistoryAndPhysical['examType'],
    chiefComplaint: '',
    hpi: '',
    pmh: [] as string[],
    psh: [] as string[],
    medications: [] as string[],
    allergies: [] as string[],
    socialHistory: {
      smoking: 'never',
      alcohol: 'occasional',
      drugs: 'none',
      occupation: '',
      exercise: 'moderate'
    },
    familyHistory: [] as string[],
    vitalSigns: {
      bloodPressure: '',
      heartRate: 0,
      respiratoryRate: 0,
      temperature: 98.6,
      oxygenSaturation: 0,
      height: '',
      weight: '',
      bmi: 0
    },
    assessment: '',
    plan: ''
  });

  const systemsList = [
    'General', 'HEENT', 'Cardiovascular', 'Respiratory', 'Gastrointestinal',
    'Genitourinary', 'Musculoskeletal', 'Neurological', 'Psychiatric', 'Skin',
    'Endocrine', 'Hematologic/Lymphatic'
  ];

  useEffect(() => {
    const fetchHpRecords = async () => {
      if (!user?.walletAddress) {
        setLoading(false);
        return;
      }
      
      try {
        const response = await fetch(apiUrl('/api/clinical/hp'), {
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role || 'Doctor',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const records = Array.isArray(data) ? data : (data.records || data.hp_records || []);
          if (Array.isArray(records)) {
            setHpRecords(records.map((record: HistoryAndPhysical & { dateOfExam: string; signedAt?: string }) => ({
              ...record,
              dateOfExam: new Date(record.dateOfExam),
              signedAt: record.signedAt ? new Date(record.signedAt) : undefined
            })));
          }
        } else if (response.status === 401) {
          setError('Session expired. Please log in again.');
        } else {
          setError('Failed to load H&P records');
        }
      } catch (err) {
        console.error('Failed to fetch H&P records:', err);
        setError('Unable to connect to server');
      } finally {
        setLoading(false);
      }
    };
    
    fetchHpRecords();
  }, [user]);

  const handleSaveHp = async (status: 'in-progress' | 'signed') => {
    if (!user?.walletAddress) return;
    try {
      const response = await fetch(apiUrl('/api/clinical/hp'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role || 'Doctor',
        },
        body: JSON.stringify({
          patient_id: formData.patientId,
          patient_name: formData.patientName,
          mrn: formData.mrn,
          exam_type: formData.examType,
          chief_complaint: formData.chiefComplaint,
          history_of_present_illness: formData.hpi,
          past_medical_history: formData.pmh,
          past_surgical_history: formData.psh,
          medications: formData.medications,
          allergies: formData.allergies,
          social_history: formData.socialHistory,
          family_history: formData.familyHistory,
          vital_signs: formData.vitalSigns,
          assessment: formData.assessment,
          plan: formData.plan,
          status,
        }),
      });
      if (response.ok) {
        setError(null);
        setActiveTab('list');
        const fetchHpRecords = async () => {
          const r = await fetch(apiUrl('/api/clinical/hp'), {
            headers: { 'X-User-Id': user.walletAddress, 'X-Provider-Role': user.role || 'Doctor' },
          });
          if (r.ok) {
            const data = await r.json();
            const records = Array.isArray(data) ? data : (data.records || data.hp_records || []);
            setHpRecords(records.map((record: HistoryAndPhysical & { dateOfExam: string; signedAt?: string }) => ({
              ...record,
              dateOfExam: new Date(record.dateOfExam),
              signedAt: record.signedAt ? new Date(record.signedAt) : undefined
            })));
          }
        };
        fetchHpRecords();
      } else {
        setError('Failed to save H&P record');
      }
    } catch (err) {
      console.error('Failed to save H&P:', err);
      setError('Unable to connect to server');
    }
  };

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const getStatusBadge = (status: HPStatus) => {
    const styles: Record<HPStatus, string> = {
      'in-progress': 'bg-yellow-100 text-yellow-700',
      'complete': 'bg-blue-100 text-blue-700',
      'signed': 'bg-green-100 text-green-700',
      'addendum': 'bg-purple-100 text-purple-700'
    };
    const labels: Record<HPStatus, string> = {
      'in-progress': 'In Progress',
      'complete': 'Complete',
      'signed': 'Signed',
      'addendum': 'Addendum Added'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const getExamTypeBadge = (type: HistoryAndPhysical['examType']) => {
    const styles: Record<string, string> = {
      'admission': 'bg-red-100 text-red-700',
      'annual': 'bg-green-100 text-green-700',
      'pre-operative': 'bg-orange-100 text-orange-700',
      'follow-up': 'bg-blue-100 text-blue-700',
      'consultation': 'bg-purple-100 text-purple-700'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${styles[type]}`}>
        {type.replace('-', ' ')}
      </span>
    );
  };

  const filteredRecords = hpRecords.filter(record => {
    const matchesSearch = record.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          record.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          record.mrn.includes(searchQuery);
    const matchesStatus = statusFilter === 'all' || record.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const formSections = [
    'Patient Info',
    'Chief Complaint',
    'History',
    'Review of Systems',
    'Vital Signs',
    'Physical Exam',
    'Assessment & Plan'
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-700 to-violet-600 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <ClipboardList className="w-8 h-8" />
          <h1 className="text-2xl font-bold">History & Physical</h1>
        </div>
        <p className="text-indigo-200">Document comprehensive patient evaluations</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
          <p className="text-gray-500">Loading H&P records...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-red-700">{error}</p>
            <p className="text-xs text-red-500 mt-1">Check that the API server is running on port 8080</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Tabs */}
          <div className="bg-white border-b">
            <div className="flex">
              {(['list', 'new', 'templates'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? 'text-indigo-700 border-b-2 border-indigo-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab === 'new' ? 'New H&P' : tab === 'list' ? 'H&P Records' : 'Templates'}
                </button>
              ))}
            </div>
          </div>

          {/* List Tab */}
          {activeTab === 'list' && (
            <div className="p-6">
              {/* Search & Filter */}
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    id="hp-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by patient name, ID, or MRN..."
                    aria-label="Search by patient name, ID, or MRN"
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <label htmlFor="hp-status-filter" className="sr-only">Filter by status</label>
                <select
                  id="hp-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as HPStatus | 'all')}
                  className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="in-progress">In Progress</option>
                  <option value="complete">Complete</option>
                  <option value="signed">Signed</option>
                  <option value="addendum">Addendum</option>
                </select>
                <button
                  onClick={() => setActiveTab('new')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  New H&P
                </button>
          </div>

          {/* Records List */}
          <div className="space-y-4">
            {filteredRecords.map(record => (
              <div key={record.id} className="bg-white rounded-lg shadow border overflow-hidden">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-gray-900">{record.patientName}</h3>
                        {getStatusBadge(record.status)}
                        {getExamTypeBadge(record.examType)}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        MRN: {record.mrn} • ID: {record.id}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedRecord(record)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="View"
                      >
                        <Eye className="w-5 h-5 text-gray-600" />
                      </button>
                      {record.status !== 'signed' && (
                        <button className="p-2 hover:bg-gray-100 rounded-lg" title="Edit">
                          <Edit className="w-5 h-5 text-gray-600" />
                        </button>
                      )}
                      <button className="p-2 hover:bg-gray-100 rounded-lg" title="Print">
                        <Printer className="w-5 h-5 text-gray-600" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                    <div>
                      <p className="text-gray-500">Date of Exam</p>
                      <p className="font-medium">{record.dateOfExam.toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Provider</p>
                      <p className="font-medium">{record.provider}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-gray-500">Chief Complaint</p>
                      <p className="font-medium">{record.chiefComplaint}</p>
                    </div>
                  </div>

                  {/* Vitals Summary */}
                  <div className="flex gap-4 flex-wrap text-sm bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-1">
                      <Heart className="w-4 h-4 text-red-500" />
                      <span className="text-gray-600">BP:</span>
                      <span className="font-medium">{record.vitalSigns.bloodPressure}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Activity className="w-4 h-4 text-blue-500" />
                      <span className="text-gray-600">HR:</span>
                      <span className="font-medium">{record.vitalSigns.heartRate}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Thermometer className="w-4 h-4 text-orange-500" />
                      <span className="text-gray-600">Temp:</span>
                      <span className="font-medium">{record.vitalSigns.temperature}°F</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Scale className="w-4 h-4 text-green-500" />
                      <span className="text-gray-600">BMI:</span>
                      <span className="font-medium">{record.vitalSigns.bmi}</span>
                    </div>
                  </div>

                  {record.status === 'signed' && record.signedAt && (
                    <div className="mt-4 pt-4 border-t flex items-center text-sm text-green-600">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Signed by {record.provider}, {record.providerCredentials} on {record.signedAt.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New H&P Tab */}
      {activeTab === 'new' && (
        <div className="p-6">
          <div className="flex gap-6">
            {/* Section Navigation */}
            <div className="hidden md:block w-48 flex-shrink-0">
              <div className="bg-white rounded-lg shadow p-4 sticky top-6">
                <h3 className="font-semibold text-gray-900 mb-3">Sections</h3>
                <nav className="space-y-1">
                  {formSections.map((section, idx) => (
                    <button
                      key={section}
                      onClick={() => setCurrentSection(idx)}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${
                        currentSection === idx
                          ? 'bg-indigo-100 text-indigo-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {section}
                    </button>
                  ))}
                </nav>
              </div>
            </div>

            {/* Form Content */}
            <div className="flex-1 space-y-6">
              {/* Patient Info */}
              <div className="bg-white rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('patient-info')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <User className="w-5 h-5 text-indigo-600" />
                    Patient Information
                  </h2>
                  {expandedSections.has('patient-info') ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {expandedSections.has('patient-info') && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="hp-patient-id" className="block text-sm font-medium text-gray-700 mb-1">Patient ID *</label>
                      <input
                        id="hp-patient-id"
                        type="text"
                        className="w-full border rounded-lg px-3 py-2"
                        placeholder="Search or enter ID"
                      />
                    </div>
                    <div>
                      <label htmlFor="hp-patient-name" className="block text-sm font-medium text-gray-700 mb-1">Patient Name</label>
                      <input id="hp-patient-name" type="text" className="w-full border rounded-lg px-3 py-2 bg-gray-50" readOnly />
                    </div>
                    <div>
                      <label htmlFor="hp-mrn" className="block text-sm font-medium text-gray-700 mb-1">MRN</label>
                      <input id="hp-mrn" type="text" className="w-full border rounded-lg px-3 py-2 bg-gray-50" readOnly />
                    </div>
                    <div className="md:col-span-3">
                      <fieldset>
                        <legend className="block text-sm font-medium text-gray-700 mb-1">Exam Type *</legend>
                        <div className="flex gap-3 flex-wrap">
                          {['admission', 'annual', 'pre-operative', 'follow-up', 'consultation'].map(type => (
                            <label key={type} htmlFor={`hp-exam-type-${type}`} className="flex items-center gap-2 cursor-pointer">
                              <input
                                id={`hp-exam-type-${type}`}
                                type="radio"
                                name="examType"
                                value={type}
                                checked={formData.examType === type}
                                onChange={() => setFormData({ ...formData, examType: type as any })}
                                className="text-indigo-600"
                              />
                              <span className="text-sm capitalize">{type.replace('-', ' ')}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                  </div>
                )}
              </div>

              {/* Chief Complaint */}
              <div className="bg-white rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('chief-complaint')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-indigo-600" />
                    Chief Complaint & HPI
                  </h2>
                  {expandedSections.has('chief-complaint') ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {expandedSections.has('chief-complaint') && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="hp-chief-complaint" className="block text-sm font-medium text-gray-700 mb-1">Chief Complaint *</label>
                      <input
                        id="hp-chief-complaint"
                        type="text"
                        value={formData.chiefComplaint}
                        onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2"
                        placeholder="Primary reason for visit in patient's words"
                      />
                    </div>
                    <div>
                      <label htmlFor="hp-hpi" className="block text-sm font-medium text-gray-700 mb-1">History of Present Illness *</label>
                      <textarea
                        id="hp-hpi"
                        value={formData.hpi}
                        onChange={(e) => setFormData({ ...formData, hpi: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 h-32"
                        placeholder="Detailed narrative of the present illness including onset, location, duration, character, aggravating/relieving factors, timing, severity, and associated symptoms..."
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Past Medical History */}
              <div className="bg-white rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('history')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <History className="w-5 h-5 text-indigo-600" />
                    Medical History
                  </h2>
                  {expandedSections.has('history') ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {expandedSections.has('history') && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="hp-pmh" className="block text-sm font-medium text-gray-700 mb-1">Past Medical History</label>
                      <textarea
                        id="hp-pmh"
                        className="w-full border rounded-lg px-3 py-2 h-24"
                        placeholder="List chronic conditions, previous illnesses..."
                      />
                    </div>
                    <div>
                      <label htmlFor="hp-psh" className="block text-sm font-medium text-gray-700 mb-1">Past Surgical History</label>
                      <textarea
                        id="hp-psh"
                        className="w-full border rounded-lg px-3 py-2 h-20"
                        placeholder="List previous surgeries with dates..."
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="hp-medications" className="block text-sm font-medium text-gray-700 mb-1">
                          <Pill className="w-4 h-4 inline mr-1" />
                          Current Medications
                        </label>
                        <textarea
                          id="hp-medications"
                          className="w-full border rounded-lg px-3 py-2 h-24"
                          placeholder="List all current medications with dosages..."
                        />
                      </div>
                      <div>
                        <label htmlFor="hp-allergies" className="block text-sm font-medium text-gray-700 mb-1">
                          <AlertTriangle className="w-4 h-4 inline mr-1 text-red-500" />
                          Allergies
                        </label>
                        <textarea
                          id="hp-allergies"
                          className="w-full border rounded-lg px-3 py-2 h-24"
                          placeholder="List allergies and reactions..."
                        />
                      </div>
                    </div>
                    <div>
                      <span id="hp-social-history-heading" className="block text-sm font-medium text-gray-700 mb-2">Social History</span>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="group" aria-labelledby="hp-social-history-heading">
                        <div>
                          <label htmlFor="hp-tobacco" className="block text-xs text-gray-500 mb-1">Tobacco Use</label>
                          <select id="hp-tobacco" className="w-full border rounded-lg px-3 py-2 text-sm">
                            <option value="never">Never</option>
                            <option value="former">Former</option>
                            <option value="current">Current</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="hp-alcohol" className="block text-xs text-gray-500 mb-1">Alcohol Use</label>
                          <select id="hp-alcohol" className="w-full border rounded-lg px-3 py-2 text-sm">
                            <option value="none">None</option>
                            <option value="social">Social</option>
                            <option value="moderate">Moderate</option>
                            <option value="heavy">Heavy</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="hp-drugs" className="block text-xs text-gray-500 mb-1">Illicit Drugs</label>
                          <select id="hp-drugs" className="w-full border rounded-lg px-3 py-2 text-sm">
                            <option value="none">None</option>
                            <option value="former">Former</option>
                            <option value="current">Current</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="hp-family-history" className="block text-sm font-medium text-gray-700 mb-1">Family History</label>
                      <textarea
                        id="hp-family-history"
                        className="w-full border rounded-lg px-3 py-2 h-20"
                        placeholder="Notable family medical history..."
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Vital Signs */}
              <div className="bg-white rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('vitals')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Activity className="w-5 h-5 text-indigo-600" />
                    Vital Signs
                  </h2>
                  {expandedSections.has('vitals') ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {expandedSections.has('vitals') && (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label htmlFor="hp-blood-pressure" className="block text-sm font-medium text-gray-700 mb-1">Blood Pressure</label>
                      <input id="hp-blood-pressure" type="text" className="w-full border rounded-lg px-3 py-2" placeholder="120/80" />
                    </div>
                    <div>
                      <label htmlFor="hp-heart-rate" className="block text-sm font-medium text-gray-700 mb-1">Heart Rate</label>
                      <input id="hp-heart-rate" type="number" className="w-full border rounded-lg px-3 py-2" placeholder="72" />
                    </div>
                    <div>
                      <label htmlFor="hp-respiratory-rate" className="block text-sm font-medium text-gray-700 mb-1">Respiratory Rate</label>
                      <input id="hp-respiratory-rate" type="number" className="w-full border rounded-lg px-3 py-2" placeholder="16" />
                    </div>
                    <div>
                      <label htmlFor="hp-temperature" className="block text-sm font-medium text-gray-700 mb-1">Temperature (°F)</label>
                      <input id="hp-temperature" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="98.6" />
                    </div>
                    <div>
                      <label htmlFor="hp-spo2" className="block text-sm font-medium text-gray-700 mb-1">SpO2 (%)</label>
                      <input id="hp-spo2" type="number" className="w-full border rounded-lg px-3 py-2" placeholder="98" />
                    </div>
                    <div>
                      <label htmlFor="hp-height" className="block text-sm font-medium text-gray-700 mb-1">Height</label>
                      <input id="hp-height" type="text" className="w-full border rounded-lg px-3 py-2" placeholder="5'10&quot;" />
                    </div>
                    <div>
                      <label htmlFor="hp-weight" className="block text-sm font-medium text-gray-700 mb-1">Weight (lbs)</label>
                      <input id="hp-weight" type="number" className="w-full border rounded-lg px-3 py-2" placeholder="175" />
                    </div>
                    <div>
                      <label htmlFor="hp-bmi" className="block text-sm font-medium text-gray-700 mb-1">BMI (calc)</label>
                      <input id="hp-bmi" type="text" className="w-full border rounded-lg px-3 py-2 bg-gray-50" readOnly placeholder="24.5" />
                    </div>
                  </div>
                )}
              </div>

              {/* Review of Systems */}
              <div className="bg-white rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('ros')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Brain className="w-5 h-5 text-indigo-600" />
                    Review of Systems
                  </h2>
                  {expandedSections.has('ros') ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {expandedSections.has('ros') && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {systemsList.map(system => (
                      <div key={system} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <span id={`hp-ros-${system.toLowerCase().replace(/\//g, '-')}-label`} className="text-sm font-medium text-gray-700">{system}</span>
                        <div className="flex gap-2" role="radiogroup" aria-labelledby={`hp-ros-${system.toLowerCase().replace(/\//g, '-')}-label`}>
                          {['normal', 'abnormal'].map(status => (
                            <label key={status} htmlFor={`hp-ros-${system.toLowerCase().replace(/\//g, '-')}-${status}`} className="flex items-center gap-1 cursor-pointer">
                              <input id={`hp-ros-${system.toLowerCase().replace(/\//g, '-')}-${status}`} type="radio" name={`ros-${system}`} className="text-indigo-600" />
                              <span className="text-xs capitalize">{status === 'normal' ? 'Neg' : 'Pos'}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Physical Examination */}
              <div className="bg-white rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('pe')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 text-indigo-600" />
                    Physical Examination
                  </h2>
                  {expandedSections.has('pe') ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {expandedSections.has('pe') && (
                  <div className="mt-4 space-y-4">
                    {['General', 'HEENT', 'Neck', 'Cardiovascular', 'Respiratory', 'Abdomen', 'Extremities', 'Neurological', 'Skin'].map(system => (
                      <div key={system} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span id={`hp-pe-${system.toLowerCase()}-label`} className="font-medium text-gray-700">{system}</span>
                          <div className="flex gap-3" role="radiogroup" aria-labelledby={`hp-pe-${system.toLowerCase()}-label`}>
                            {['normal', 'abnormal'].map(status => (
                              <label key={status} htmlFor={`hp-pe-${system.toLowerCase()}-${status}`} className="flex items-center gap-1 cursor-pointer">
                                <input id={`hp-pe-${system.toLowerCase()}-${status}`} type="radio" name={`pe-${system}`} className="text-indigo-600" />
                                <span className="text-sm capitalize">{status}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <label htmlFor={`hp-pe-${system.toLowerCase()}-findings`} className="sr-only">{system} Findings</label>
                        <textarea
                          id={`hp-pe-${system.toLowerCase()}-findings`}
                          className="w-full border rounded px-3 py-2 text-sm"
                          placeholder="Findings..."
                          rows={2}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Assessment & Plan */}
              <div className="bg-white rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('assessment')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    Assessment & Plan
                  </h2>
                  {expandedSections.has('assessment') ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </button>
                {expandedSections.has('assessment') && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="hp-assessment" className="block text-sm font-medium text-gray-700 mb-1">Assessment *</label>
                      <textarea
                        id="hp-assessment"
                        value={formData.assessment}
                        onChange={(e) => setFormData({ ...formData, assessment: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 h-32"
                        placeholder="Clinical impression and diagnoses..."
                      />
                    </div>
                    <div>
                      <label htmlFor="hp-plan" className="block text-sm font-medium text-gray-700 mb-1">Plan *</label>
                      <textarea
                        id="hp-plan"
                        value={formData.plan}
                        onChange={(e) => setFormData({ ...formData, plan: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 h-32"
                        placeholder="Treatment plan, orders, follow-up instructions..."
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => handleSaveHp('in-progress')} className="px-6 py-2 border border-gray-300 rounded-lg font-medium">
                  Save as Draft
                </button>
                <button type="button" onClick={() => handleSaveHp('signed')} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium">
                  Complete & Sign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { name: 'General Admission H&P', type: 'admission', description: 'Comprehensive template for hospital admissions' },
              { name: 'Annual Physical', type: 'annual', description: 'Wellness exam template with preventive care checklist' },
              { name: 'Pre-Operative Clearance', type: 'pre-operative', description: 'Surgical clearance with risk assessment' },
              { name: 'Cardiology Consult', type: 'consultation', description: 'Focused cardiovascular evaluation' },
              { name: 'Pulmonary Consult', type: 'consultation', description: 'Respiratory-focused evaluation template' },
              { name: 'Pediatric H&P', type: 'admission', description: 'Age-appropriate pediatric assessment' }
            ].map((template, idx) => (
              <div key={idx} className="bg-white rounded-lg shadow border p-6 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{template.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{template.description}</p>
                  </div>
                  {getExamTypeBadge(template.type as any)}
                </div>
                <button className="mt-4 text-sm text-indigo-600 font-medium flex items-center gap-1">
                  Use Template
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      </>)}

      {/* Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedRecord.patientName}</h2>
                <p className="text-sm text-gray-500">{selectedRecord.id}</p>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Content would go here */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2">Chief Complaint</h3>
                <p>{selectedRecord.chiefComplaint}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2">History of Present Illness</h3>
                <p>{selectedRecord.historyOfPresentIllness}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2">Assessment</h3>
                <p>{selectedRecord.assessment}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-2">Plan</h3>
                <pre className="whitespace-pre-wrap font-sans">{selectedRecord.plan}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryAndPhysicalPage;
