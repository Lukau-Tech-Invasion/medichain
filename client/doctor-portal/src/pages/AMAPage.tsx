import React, { useState, useEffect } from 'react';
import {
  FileWarning,
  AlertTriangle,
  User,
  Calendar,
  CheckCircle,
  XCircle,
  Search,
  Printer,
  Users,
  Pen,
  Shield,
  ChevronRight,
  AlertCircle,
  UserCheck
} from 'lucide-react';

/**
 * AMAPage
 * 
 * Page for recording Against Medical Advice (AMA) discharges.
 * Captures legal language, witness signatures, and required documentation.
 */

type AMAStatus = 'draft' | 'pending-signatures' | 'completed' | 'voided';
type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';

interface AMARecord {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  dateCreated: Date;
  status: AMAStatus;
  riskLevel: RiskLevel;
  provider: string;
  diagnosis: string;
  recommendedTreatment: string;
  patientStatement: string;
  patientSigned: boolean;
  witnessSigned: boolean;
  witnessName?: string;
  providerSigned: boolean;
}

interface RiskDisclosure {
  id: string;
  category: string;
  risk: string;
  acknowledged: boolean;
}

const AMAPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'list' | 'new' | 'view'>('list');
  const [records, setRecords] = useState<AMARecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<AMARecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AMAStatus | 'all'>('all');

  // Form state
  const [formStep, setFormStep] = useState(1);
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [mrn, setMrn] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [recommendedTreatment, setRecommendedTreatment] = useState('');
  const [patientStatement, setPatientStatement] = useState('');
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('moderate');
  const [riskDisclosures, setRiskDisclosures] = useState<RiskDisclosure[]>([]);
  const [witnessName, setWitnessName] = useState('');

  useEffect(() => {
    // Sample AMA records
    setRecords([
      {
        id: 'AMA-001',
        patientId: 'PAT-1234',
        patientName: 'John Smith',
        mrn: 'MRN-789012',
        dateCreated: new Date('2024-01-15T10:30:00'),
        status: 'completed',
        riskLevel: 'high',
        provider: 'Dr. Sarah Chen',
        diagnosis: 'Acute Appendicitis',
        recommendedTreatment: 'Emergency appendectomy',
        patientStatement: 'I understand the risks but choose to leave.',
        patientSigned: true,
        witnessSigned: true,
        witnessName: 'Nurse Mary Johnson',
        providerSigned: true
      },
      {
        id: 'AMA-002',
        patientId: 'PAT-5678',
        patientName: 'Jane Doe',
        mrn: 'MRN-345678',
        dateCreated: new Date('2024-01-14T14:15:00'),
        status: 'pending-signatures',
        riskLevel: 'moderate',
        provider: 'Dr. Michael Brown',
        diagnosis: 'Pneumonia',
        recommendedTreatment: 'IV antibiotics and observation',
        patientStatement: 'I will follow up with my primary care doctor.',
        patientSigned: true,
        witnessSigned: false,
        providerSigned: false
      },
      {
        id: 'AMA-003',
        patientId: 'PAT-9012',
        patientName: 'Robert Wilson',
        mrn: 'MRN-901234',
        dateCreated: new Date('2024-01-13T08:45:00'),
        status: 'draft',
        riskLevel: 'low',
        provider: 'Dr. Sarah Chen',
        diagnosis: 'Minor laceration',
        recommendedTreatment: 'Wound care and tetanus update',
        patientStatement: '',
        patientSigned: false,
        witnessSigned: false,
        providerSigned: false
      }
    ]);

    // Default risk disclosures
    setRiskDisclosures([
      { id: 'r1', category: 'General', risk: 'Condition may worsen without treatment', acknowledged: false },
      { id: 'r2', category: 'General', risk: 'Complications may become life-threatening', acknowledged: false },
      { id: 'r3', category: 'General', risk: 'Delayed treatment may reduce effectiveness of future care', acknowledged: false },
      { id: 'r4', category: 'Medical', risk: 'Risk of permanent disability or death', acknowledged: false },
      { id: 'r5', category: 'Medical', risk: 'May require emergency care in the future', acknowledged: false },
      { id: 'r6', category: 'Legal', risk: 'Insurance may not cover future related treatments', acknowledged: false }
    ]);
  }, []);

  const getStatusBadge = (status: AMAStatus) => {
    const styles = {
      'draft': 'bg-gray-100 text-gray-700',
      'pending-signatures': 'bg-yellow-100 text-yellow-700',
      'completed': 'bg-green-100 text-green-700',
      'voided': 'bg-red-100 text-red-700'
    };
    const labels = {
      'draft': 'Draft',
      'pending-signatures': 'Pending Signatures',
      'completed': 'Completed',
      'voided': 'Voided'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const getRiskBadge = (level: RiskLevel) => {
    const styles = {
      'low': 'bg-green-100 text-green-700',
      'moderate': 'bg-yellow-100 text-yellow-700',
      'high': 'bg-orange-100 text-orange-700',
      'critical': 'bg-red-100 text-red-700'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${styles[level]}`}>
        {level} Risk
      </span>
    );
  };

  const filteredRecords = records.filter(r => {
    const matchesSearch = r.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.mrn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleRiskAcknowledge = (id: string) => {
    setRiskDisclosures(prev => prev.map(r =>
      r.id === id ? { ...r, acknowledged: !r.acknowledged } : r
    ));
  };

  const allRisksAcknowledged = riskDisclosures.every(r => r.acknowledged);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-orange-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <FileWarning className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Against Medical Advice (AMA)</h1>
        </div>
        <p className="text-red-100">Document patient refusal of care and AMA discharges</p>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="flex">
          {(['list', 'new'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab === 'new') {
                  setFormStep(1);
                  setPatientId('');
                  setPatientName('');
                  setDiagnosis('');
                  setRecommendedTreatment('');
                  setPatientStatement('');
                }
              }}
              className={`flex-1 py-3 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'text-red-600 border-b-2 border-red-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'list' ? 'AMA Records' : 'New AMA Form'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {/* List Tab */}
        {activeTab === 'list' && !selectedRecord && (
          <div className="space-y-4">
            {/* Search and Filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by patient name, MRN, or ID..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as AMAStatus | 'all')}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              >
                <option value="all">All Status</option>
                <option value="draft">Draft</option>
                <option value="pending-signatures">Pending Signatures</option>
                <option value="completed">Completed</option>
                <option value="voided">Voided</option>
              </select>
            </div>

            {/* Records List */}
            <div className="bg-white rounded-lg shadow divide-y">
              {filteredRecords.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <FileWarning className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No AMA records found</p>
                </div>
              ) : (
                filteredRecords.map(record => (
                  <div
                    key={record.id}
                    className="p-4 hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      setSelectedRecord(record);
                      setActiveTab('view');
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-full ${
                          record.riskLevel === 'critical' ? 'bg-red-100' :
                          record.riskLevel === 'high' ? 'bg-orange-100' :
                          'bg-yellow-100'
                        }`}>
                          <AlertTriangle className={`w-5 h-5 ${
                            record.riskLevel === 'critical' ? 'text-red-600' :
                            record.riskLevel === 'high' ? 'text-orange-600' :
                            'text-yellow-600'
                          }`} />
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-900">{record.patientName}</h3>
                          <p className="text-sm text-gray-500">MRN: {record.mrn} • {record.id}</p>
                          <p className="text-sm text-gray-600 mt-1">{record.diagnosis}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {getStatusBadge(record.status)}
                        {getRiskBadge(record.riskLevel)}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {record.dateCreated.toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {record.provider}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center gap-1 ${record.patientSigned ? 'text-green-600' : 'text-gray-400'}`}>
                          <UserCheck className="w-3 h-3" /> Patient
                        </span>
                        <span className={`flex items-center gap-1 ${record.witnessSigned ? 'text-green-600' : 'text-gray-400'}`}>
                          <Users className="w-3 h-3" /> Witness
                        </span>
                        <span className={`flex items-center gap-1 ${record.providerSigned ? 'text-green-600' : 'text-gray-400'}`}>
                          <Pen className="w-3 h-3" /> Provider
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* View Record */}
        {activeTab === 'view' && selectedRecord && (
          <div className="space-y-4">
            <button
              onClick={() => {
                setSelectedRecord(null);
                setActiveTab('list');
              }}
              className="text-red-600 hover:text-red-700 text-sm font-medium"
            >
              ← Back to Records
            </button>

            {/* Header Card */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-xl font-bold text-gray-900">{selectedRecord.patientName}</h2>
                    {getStatusBadge(selectedRecord.status)}
                  </div>
                  <p className="text-gray-500">MRN: {selectedRecord.mrn} • {selectedRecord.id}</p>
                </div>
                {getRiskBadge(selectedRecord.riskLevel)}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Date Created</p>
                  <p className="font-medium">{selectedRecord.dateCreated.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500">Provider</p>
                  <p className="font-medium">{selectedRecord.provider}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-gray-500">Diagnosis</p>
                  <p className="font-medium">{selectedRecord.diagnosis}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-gray-500">Recommended Treatment</p>
                  <p className="font-medium">{selectedRecord.recommendedTreatment}</p>
                </div>
              </div>
            </div>

            {/* Signature Status */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Signature Status</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <UserCheck className="w-5 h-5 text-gray-600" />
                    <span>Patient Signature</span>
                  </div>
                  {selectedRecord.patientSigned ? (
                    <CheckCircle className="w-6 h-6 text-green-500" />
                  ) : (
                    <XCircle className="w-6 h-6 text-gray-300" />
                  )}
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Users className="w-5 h-5 text-gray-600" />
                    <span>Witness Signature {selectedRecord.witnessName && `(${selectedRecord.witnessName})`}</span>
                  </div>
                  {selectedRecord.witnessSigned ? (
                    <CheckCircle className="w-6 h-6 text-green-500" />
                  ) : (
                    <XCircle className="w-6 h-6 text-gray-300" />
                  )}
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Pen className="w-5 h-5 text-gray-600" />
                    <span>Provider Signature</span>
                  </div>
                  {selectedRecord.providerSigned ? (
                    <CheckCircle className="w-6 h-6 text-green-500" />
                  ) : (
                    <XCircle className="w-6 h-6 text-gray-300" />
                  )}
                </div>
              </div>
            </div>

            {/* Patient Statement */}
            {selectedRecord.patientStatement && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-semibold text-gray-900 mb-2">Patient Statement</h3>
                <p className="text-gray-700 italic">"{selectedRecord.patientStatement}"</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button className="flex-1 py-3 bg-red-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2">
                <Printer className="w-5 h-5" />
                Print Document
              </button>
              {selectedRecord.status === 'pending-signatures' && (
                <button className="flex-1 py-3 border border-red-600 text-red-600 rounded-lg font-semibold">
                  Collect Signatures
                </button>
              )}
            </div>
          </div>
        )}

        {/* New AMA Form */}
        {activeTab === 'new' && (
          <div className="space-y-4">
            {/* Progress Steps */}
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center justify-between">
                {[1, 2, 3, 4].map(step => (
                  <div key={step} className="flex items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
                      formStep >= step
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                    }`}>
                      {step}
                    </div>
                    {step < 4 && (
                      <div className={`w-12 sm:w-20 h-1 ${
                        formStep > step ? 'bg-red-600' : 'bg-gray-200'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span>Patient Info</span>
                <span>Medical Details</span>
                <span>Risk Disclosure</span>
                <span>Signatures</span>
              </div>
            </div>

            {/* Step 1: Patient Info */}
            {formStep === 1 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Patient Information</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Patient ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={patientId}
                      onChange={(e) => setPatientId(e.target.value)}
                      placeholder="Enter patient ID"
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Patient Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="Full legal name"
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      MRN <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={mrn}
                      onChange={(e) => setMrn(e.target.value)}
                      placeholder="Medical Record Number"
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
                <button
                  onClick={() => setFormStep(2)}
                  disabled={!patientId || !patientName || !mrn}
                  className={`w-full mt-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                    patientId && patientName && mrn
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Continue
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Step 2: Medical Details */}
            {formStep === 2 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Medical Details</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Diagnosis <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={diagnosis}
                      onChange={(e) => setDiagnosis(e.target.value)}
                      placeholder="Primary diagnosis"
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Recommended Treatment <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={recommendedTreatment}
                      onChange={(e) => setRecommendedTreatment(e.target.value)}
                      rows={3}
                      placeholder="Describe the recommended treatment the patient is refusing"
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Risk Level <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {(['low', 'moderate', 'high', 'critical'] as RiskLevel[]).map(level => (
                        <button
                          key={level}
                          onClick={() => setRiskLevel(level)}
                          className={`py-2 px-4 rounded-lg border-2 capitalize font-medium ${
                            riskLevel === level
                              ? level === 'critical' ? 'border-red-500 bg-red-50 text-red-700' :
                                level === 'high' ? 'border-orange-500 bg-orange-50 text-orange-700' :
                                level === 'moderate' ? 'border-yellow-500 bg-yellow-50 text-yellow-700' :
                                'border-green-500 bg-green-50 text-green-700'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setFormStep(1)}
                    className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setFormStep(3)}
                    disabled={!diagnosis || !recommendedTreatment}
                    className={`flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                      diagnosis && recommendedTreatment
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    Continue
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Risk Disclosure */}
            {formStep === 3 && (
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Risk Disclosure</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  Each risk must be verbally explained to the patient and acknowledged.
                </p>
                <div className="space-y-3">
                  {riskDisclosures.map(risk => (
                    <div
                      key={risk.id}
                      onClick={() => handleRiskAcknowledge(risk.id)}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        risk.acknowledged
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                          risk.acknowledged ? 'bg-green-500' : 'bg-gray-200'
                        }`}>
                          {risk.acknowledged && <CheckCircle className="w-4 h-4 text-white" />}
                        </div>
                        <div className="flex-1">
                          <span className="text-xs text-gray-500">{risk.category}</span>
                          <p className="text-gray-900">{risk.risk}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Patient Statement (optional)
                  </label>
                  <textarea
                    value={patientStatement}
                    onChange={(e) => setPatientStatement(e.target.value)}
                    rows={3}
                    placeholder="Document any statement made by the patient"
                    className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setFormStep(2)}
                    className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setFormStep(4)}
                    disabled={!allRisksAcknowledged}
                    className={`flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                      allRisksAcknowledged
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    Continue to Signatures
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Signatures */}
            {formStep === 4 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Collect Signatures</h3>
                
                <div className="space-y-4">
                  {/* Patient Signature */}
                  <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-5 h-5 text-gray-600" />
                        <span className="font-medium">Patient Signature</span>
                      </div>
                      <span className="text-red-500 text-sm">Required</span>
                    </div>
                    <div className="h-24 bg-gray-50 rounded border border-gray-200 flex items-center justify-center">
                      <p className="text-gray-400">Tap to capture signature</p>
                    </div>
                  </div>

                  {/* Witness */}
                  <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-gray-600" />
                        <span className="font-medium">Witness Signature</span>
                      </div>
                      <span className="text-red-500 text-sm">Required</span>
                    </div>
                    <input
                      type="text"
                      value={witnessName}
                      onChange={(e) => setWitnessName(e.target.value)}
                      placeholder="Witness name"
                      className="w-full border border-gray-300 rounded-lg p-2 mb-2 focus:ring-2 focus:ring-red-500"
                    />
                    <div className="h-24 bg-gray-50 rounded border border-gray-200 flex items-center justify-center">
                      <p className="text-gray-400">Tap to capture signature</p>
                    </div>
                  </div>

                  {/* Provider */}
                  <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Pen className="w-5 h-5 text-gray-600" />
                        <span className="font-medium">Provider Signature</span>
                      </div>
                      <span className="text-red-500 text-sm">Required</span>
                    </div>
                    <div className="h-24 bg-gray-50 rounded border border-gray-200 flex items-center justify-center">
                      <p className="text-gray-400">Tap to capture signature</p>
                    </div>
                  </div>
                </div>

                {/* Legal Notice */}
                <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Shield className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-yellow-900">Legal Notice</p>
                      <p className="text-sm text-yellow-700 mt-1">
                        By signing, all parties acknowledge that the patient has been informed of the risks
                        of leaving against medical advice and chooses to do so of their own free will.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setFormStep(3)}
                    className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold"
                  >
                    Back
                  </button>
                  <button
                    className="flex-1 py-3 bg-red-600 text-white rounded-lg font-semibold"
                  >
                    Complete AMA Form
                  </button>
                </div>
              </div>
            )}

            {/* Warning Banner */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <p className="font-medium text-red-900">Important Documentation</p>
                  <p className="text-sm text-red-700 mt-1">
                    AMA documentation is a legal record. Ensure all information is accurate and complete.
                    Patient must demonstrate capacity to make informed decisions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AMAPage;
