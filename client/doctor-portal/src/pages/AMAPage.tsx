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
  UserCheck,
  Loader2
} from 'lucide-react';
import {
  apiUrl,
  listAMADischarges,
  createAMADischarge,
  getPatients,
  useTranslation,
  type PatientProfile
} from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';

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
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'list' | 'new' | 'view'>('list');
  const [records, setRecords] = useState<AMARecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<AMARecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AMAStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [availablePatients, setAvailablePatients] = useState<PatientProfile[]>([]);

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
    const fetchAMARecords = async () => {
      if (!user?.walletAddress) {
        setError(t('docAMA.errorAuth'));
        setLoading(false);
        return;
      }

      try {
        const data = await listAMADischarges();
        // Convert date strings to Date objects
        const amaRecords = (data as unknown[]).map((r: any) => ({
          ...r,
          dateCreated: new Date(r.dateCreated || Date.now())
        }));
        setRecords(amaRecords);
        setError(null);
      } catch (err) {
        console.error('Error fetching AMA records:', err);
        setError(err instanceof Error ? err.message : t('docAMA.errorLoadFailed'));
      } finally {
        setLoading(false);
      }
    };

    const fetchPatients = async () => {
      try {
        const pts = await getPatients();
        setAvailablePatients(pts);
      } catch (err) {
        console.error('Error fetching patients:', err);
      }
    };

    // Default risk disclosures for new records
    setRiskDisclosures([
      { id: 'r1', category: 'General', risk: 'Condition may worsen without treatment', acknowledged: false },
      { id: 'r2', category: 'General', risk: 'Complications may become life-threatening', acknowledged: false },
      { id: 'r3', category: 'General', risk: 'Delayed treatment may reduce effectiveness of future care', acknowledged: false },
      { id: 'r4', category: 'Medical', risk: 'Risk of permanent disability or death', acknowledged: false },
      { id: 'r5', category: 'Medical', risk: 'May require emergency care in the future', acknowledged: false },
      { id: 'r6', category: 'Legal', risk: 'Insurance may not cover future related treatments', acknowledged: false }
    ]);

    fetchAMARecords();
    fetchPatients();
  }, [user]);

  const handleCreateAMA = async () => {
    if (!patientId || !patientName || !diagnosis || !recommendedTreatment) {
      showError(t('docAMA.errorRequiredFields'));
      return;
    }

    setIsSubmitting(true);
    try {
      const newRecord = {
        ama_id: `AMA-${Date.now()}`,
        patient_id: patientId,
        patient_name: patientName,
        mrn,
        dateCreated: new Date().toISOString(),
        status: 'pending-signatures' as AMAStatus,
        riskLevel: riskLevel,
        provider: user?.username || 'Healthcare Provider',
        diagnosis,
        recommendedTreatment: recommendedTreatment,
        patientStatement: patientStatement,
        // An AMA discharge is the legal record that a patient left against
        // medical advice, and its whole evidentiary value is the signatures.
        // These were hardcoded `true` while `status` was 'pending-signatures'
        // — the record simultaneously claimed both parties had signed and that
        // signatures were outstanding. Worse, it asserted a PATIENT's signature
        // that nobody captured.
        //
        // This form has no signature-capture step, so the only truthful value
        // is `false`: the record exists, the signatures do not yet. That is now
        // consistent with the 'pending-signatures' status it is created under.
        patientSigned: false,
        witnessSigned: false,
        witnessName: witnessName,
        providerSigned: false,
      };

      await createAMADischarge(newRecord);
      showSuccess(t('docAMA.successCreated'));
      
      // Refresh list
      const updatedData = await listAMADischarges();
      const amaRecords = (updatedData as unknown[]).map((r: any) => ({
        ...r,
        dateCreated: new Date(r.dateCreated || Date.now())
      }));
      setRecords(amaRecords);
      setActiveTab('list');
      resetForm();
    } catch (err) {
      console.error('Error creating AMA record:', err);
      showError(t('docAMA.errorCreateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormStep(1);
    setPatientId('');
    setPatientName('');
    setMrn('');
    setDiagnosis('');
    setRecommendedTreatment('');
    setPatientStatement('');
    setRiskLevel('moderate');
    setWitnessName('');
    setRiskDisclosures(prev => prev.map(r => ({ ...r, acknowledged: false })));
  };

  const getStatusBadge = (status: AMAStatus) => {
    const styles = {
      'draft': 'bg-gray-100 text-gray-700',
      'pending-signatures': 'bg-yellow-100 text-yellow-700',
      'completed': 'bg-green-100 text-green-700',
      'voided': 'bg-red-100 text-red-700'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {t(`docAMA.status_${status}`)}
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
        {t('docAMA.riskBadge', { level: t(`docAMA.level_${level}`) })}
      </span>
    );
  };

  const filteredRecords = records.filter(r => {
    const matchesSearch = (r.patientName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (r.mrn?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (r.id?.toLowerCase() || '').includes(searchQuery.toLowerCase());
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
          <h1 className="text-2xl font-bold">{t('docAMA.title')}</h1>
        </div>
        <p className="text-red-100">{t('docAMA.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-red-600 animate-spin mb-2" />
          <p className="text-gray-500">{t('docAMA.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-red-700">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docAMA.errorHint')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
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
                  {tab === 'list' ? t('docAMA.tabRecords') : t('docAMA.tabNew')}
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
                      placeholder={t('docAMA.searchPh')}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as AMAStatus | 'all')}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  >
                    <option value="all">{t('docAMA.filterAll')}</option>
                <option value="draft">{t('docAMA.status_draft')}</option>
                <option value="pending-signatures">{t('docAMA.status_pending-signatures')}</option>
                <option value="completed">{t('docAMA.status_completed')}</option>
                <option value="voided">{t('docAMA.status_voided')}</option>
              </select>
            </div>

            {/* Records List */}
            <div className="bg-white rounded-lg shadow divide-y">
              {filteredRecords.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <FileWarning className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>{t('docAMA.noRecords')}</p>
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
                          <p className="text-sm text-gray-500">{t('docAMA.mrnLine', { mrn: record.mrn, id: record.id })}</p>
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
                          <UserCheck className="w-3 h-3" /> {t('docAMA.sigPatient')}
                        </span>
                        <span className={`flex items-center gap-1 ${record.witnessSigned ? 'text-green-600' : 'text-gray-400'}`}>
                          <Users className="w-3 h-3" /> {t('docAMA.sigWitness')}
                        </span>
                        <span className={`flex items-center gap-1 ${record.providerSigned ? 'text-green-600' : 'text-gray-400'}`}>
                          <Pen className="w-3 h-3" /> {t('docAMA.sigProvider')}
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
              {t('docAMA.backToRecords')}
            </button>

            {/* Header Card */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-xl font-bold text-gray-900">{selectedRecord.patientName}</h2>
                    {getStatusBadge(selectedRecord.status)}
                  </div>
                  <p className="text-gray-500">{t('docAMA.mrnLine', { mrn: selectedRecord.mrn, id: selectedRecord.id })}</p>
                </div>
                {getRiskBadge(selectedRecord.riskLevel)}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">{t('docAMA.lblDateCreated')}</p>
                  <p className="font-medium">{selectedRecord.dateCreated.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500">{t('docAMA.lblProvider')}</p>
                  <p className="font-medium">{selectedRecord.provider}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-gray-500">{t('docAMA.lblDiagnosis')}</p>
                  <p className="font-medium">{selectedRecord.diagnosis}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-gray-500">{t('docAMA.lblRecommendedTreatment')}</p>
                  <p className="font-medium">{selectedRecord.recommendedTreatment}</p>
                </div>
              </div>
            </div>

            {/* Signature Status */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-semibold text-gray-900 mb-4">{t('docAMA.signatureStatusTitle')}</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <UserCheck className="w-5 h-5 text-gray-600" />
                    <span>{t('docAMA.lblPatientSignature')}</span>
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
                    <span>{t('docAMA.lblWitnessSignature')} {selectedRecord.witnessName && `(${selectedRecord.witnessName})`}</span>
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
                    <span>{t('docAMA.lblProviderSignature')}</span>
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
                <h3 className="font-semibold text-gray-900 mb-2">{t('docAMA.patientStatementTitle')}</h3>
                <p className="text-gray-700 italic">"{selectedRecord.patientStatement}"</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button className="flex-1 py-3 bg-red-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2">
                <Printer className="w-5 h-5" />
                {t('docAMA.printDocument')}
              </button>
              {selectedRecord.status === 'pending-signatures' && (
                <button className="flex-1 py-3 border border-red-600 text-red-600 rounded-lg font-semibold">
                  {t('docAMA.collectSignatures')}
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
                <span>{t('docAMA.stepPatientInfo')}</span>
                <span>{t('docAMA.stepMedicalDetails')}</span>
                <span>{t('docAMA.stepRiskDisclosure')}</span>
                <span>{t('docAMA.stepSignatures')}</span>
              </div>
            </div>

            {/* Step 1: Patient Info */}
            {formStep === 1 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('docAMA.patientInfoTitle')}</h3>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="ama-patient-select" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('docAMA.selectPatientLabel')}
                    </label>
                    <select
                      id="ama-patient-select"
                      onChange={(e) => {
                        const p = availablePatients.find(p => p.patient_id === e.target.value);
                        if (p) {
                          setPatientId(p.patient_id);
                          setPatientName(p.full_name);
                        }
                      }}
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    >
                      <option value="">{t('docAMA.selectExistingPatient')}</option>
                      {availablePatients.map(p => (
                        <option key={p.patient_id} value={p.patient_id}>{p.full_name} ({p.patient_id})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ama-patient-id" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('docAMA.patientIdLabel')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="ama-patient-id"
                      type="text"
                      value={patientId}
                      onChange={(e) => setPatientId(e.target.value)}
                      placeholder={t('docAMA.patientIdPh')}
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="ama-patient-name" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('docAMA.patientNameLabel')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="ama-patient-name"
                      type="text"
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder={t('docAMA.patientNamePh')}
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="ama-mrn" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('docAMA.mrnLabel')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="ama-mrn"
                      type="text"
                      value={mrn}
                      onChange={(e) => setMrn(e.target.value)}
                      placeholder={t('docAMA.mrnPh')}
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
                  {t('docAMA.continueBtn')}
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Step 2: Medical Details */}
            {formStep === 2 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('docAMA.medicalDetailsTitle')}</h3>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="ama-diagnosis" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('docAMA.diagnosisLabel')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="ama-diagnosis"
                      type="text"
                      value={diagnosis}
                      onChange={(e) => setDiagnosis(e.target.value)}
                      placeholder={t('docAMA.diagnosisPh')}
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="ama-recommended-treatment" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('docAMA.recommendedTreatmentLabel')} <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      id="ama-recommended-treatment"
                      value={recommendedTreatment}
                      onChange={(e) => setRecommendedTreatment(e.target.value)}
                      rows={3}
                      placeholder={t('docAMA.recommendedTreatmentPh')}
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('docAMA.riskLevelLabel')} <span className="text-red-500">*</span>
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
                          {t(`docAMA.level_${level}`)}
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
                    {t('docAMA.backBtn')}
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
                    {t('docAMA.continueBtn')}
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
                  <h3 className="text-lg font-semibold text-gray-900">{t('docAMA.riskDisclosureTitle')}</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  {t('docAMA.riskDisclosureIntro')}
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
                  <label htmlFor="ama-patient-statement" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('docAMA.patientStatementLabel')}
                  </label>
                  <textarea
                    id="ama-patient-statement"
                    value={patientStatement}
                    onChange={(e) => setPatientStatement(e.target.value)}
                    rows={3}
                    placeholder={t('docAMA.patientStatementPh')}
                    className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setFormStep(2)}
                    className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold"
                  >
                    {t('docAMA.backBtn')}
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
                    {t('docAMA.continueToSignatures')}
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Signatures */}
            {formStep === 4 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('docAMA.collectSignaturesTitle')}</h3>

                <div className="space-y-4">
                  {/* Patient Signature */}
                  <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-5 h-5 text-gray-600" />
                        <span className="font-medium">{t('docAMA.lblPatientSignature')}</span>
                      </div>
                      <span className="text-red-500 text-sm">{t('docAMA.requiredLabel')}</span>
                    </div>
                    <div className="h-24 bg-gray-50 rounded border border-gray-200 flex items-center justify-center">
                      <p className="text-gray-400">{t('docAMA.tapToCaptureSignature')}</p>
                    </div>
                  </div>

                  {/* Witness */}
                  <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-gray-600" />
                        <span className="font-medium">{t('docAMA.lblWitnessSignature')}</span>
                      </div>
                      <span className="text-red-500 text-sm">{t('docAMA.requiredLabel')}</span>
                    </div>
                    <label htmlFor="ama-witness-name" className="sr-only">{t('docAMA.witnessNamePh')}</label>
                    <input
                      id="ama-witness-name"
                      type="text"
                      value={witnessName}
                      onChange={(e) => setWitnessName(e.target.value)}
                      placeholder={t('docAMA.witnessNamePh')}
                      className="w-full border border-gray-300 rounded-lg p-2 mb-2 focus:ring-2 focus:ring-red-500"
                    />
                    <div className="h-24 bg-gray-50 rounded border border-gray-200 flex items-center justify-center">
                      <p className="text-gray-400">{t('docAMA.tapToCaptureSignature')}</p>
                    </div>
                  </div>

                  {/* Provider */}
                  <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Pen className="w-5 h-5 text-gray-600" />
                        <span className="font-medium">{t('docAMA.lblProviderSignature')}</span>
                      </div>
                      <span className="text-red-500 text-sm">{t('docAMA.requiredLabel')}</span>
                    </div>
                    <div className="h-24 bg-gray-50 rounded border border-gray-200 flex items-center justify-center">
                      <p className="text-gray-400">{t('docAMA.tapToCaptureSignature')}</p>
                    </div>
                  </div>
                </div>

                {/* Legal Notice */}
                <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Shield className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-yellow-900">{t('docAMA.legalNoticeTitle')}</p>
                      <p className="text-sm text-yellow-700 mt-1">
                        {t('docAMA.legalNoticeText')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setFormStep(3)}
                    className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold"
                  >
                    {t('docAMA.backBtn')}
                  </button>
                  <button
                    onClick={handleCreateAMA}
                    disabled={isSubmitting}
                    className="flex-1 py-3 bg-red-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2"
                  >
                    {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                    {t('docAMA.completeFormBtn')}
                  </button>
                </div>
              </div>
            )}

            {/* Warning Banner */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <p className="font-medium text-red-900">{t('docAMA.importantDocTitle')}</p>
                  <p className="text-sm text-red-700 mt-1">
                    {t('docAMA.importantDocText')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
          </div>
        </>
      )}
    </div>
  );
};

export default AMAPage;
