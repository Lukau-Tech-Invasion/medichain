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
import {
  apiUrl,
  getPatients,
  createHistoryPhysical,
  listHistoryPhysicals,
  useTranslation,
  type PatientProfile
} from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';

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
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'list' | 'new' | 'templates'>('list');
  const [hpRecords, setHpRecords] = useState<HistoryAndPhysical[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<HPStatus | 'all'>('all');
  const [selectedRecord, setSelectedRecord] = useState<HistoryAndPhysical | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['chief-complaint', 'vitals']));
  const [currentSection, setCurrentSection] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [availablePatients, setAvailablePatients] = useState<PatientProfile[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    patientId: '',
    patientName: '',
    mrn: '',
    examType: 'admission' as HistoryAndPhysical['examType'],
    chiefComplaint: '',
    hpi: '',
    // Free text in the form, split into one entry per line on submit.
    pmh: '',
    psh: '',
    medications: '',
    allergies: '',
    socialHistory: {
      smoking: 'never',
      alcohol: 'none',
      drugs: 'none',
      occupation: '',
      exercise: 'moderate'
    },
    familyHistory: '',
    // Metric throughout, matching triage and the vitals flowsheet. This form
    // previously asked for Fahrenheit and pounds, which in the same record as
    // kilogram-based vitals is a dosing hazard rather than a cosmetic quirk.
    vitalSigns: {
      bloodPressure: '',
      heartRate: '',
      respiratoryRate: '',
      temperature: '',
      oxygenSaturation: '',
      heightCm: '',
      weightKg: '',
      bmi: ''
    },
    reviewOfSystems: {} as Record<string, string>,
    physicalExam: {} as Record<string, { status: string; findings: string }>,
    assessment: '',
    plan: ''
  });

  const systemsList = [
    'General', 'HEENT', 'Cardiovascular', 'Respiratory', 'Gastrointestinal',
    'Genitourinary', 'Musculoskeletal', 'Neurological', 'Psychiatric', 'Skin',
    'Endocrine', 'Hematologic/Lymphatic'
  ];

  useEffect(() => {
    const loadData = async () => {
      if (!user?.walletAddress) {
        setLoading(false);
        return;
      }
      
      try {
        const [hpData, pts] = await Promise.all([
          listHistoryPhysicals(),
          getPatients()
        ]);
        
        setAvailablePatients(pts);
        
        const records = Array.isArray(hpData) ? hpData : ((hpData as { records?: unknown[]; hp_records?: unknown[] }).records || (hpData as { records?: unknown[]; hp_records?: unknown[] }).hp_records || []);
        if (Array.isArray(records)) {
          setHpRecords(records.map((record: any) => ({
            ...record,
            dateOfExam: new Date(record.dateOfExam || record.date_of_exam || Date.now()),
            signedAt: record.signedAt || record.signed_at ? new Date(record.signedAt || record.signed_at) : undefined
          })));
        }
      } catch (err) {
        console.error('Failed to load data:', err);
        setError(t('docHistoryPhysical.errorLoadRecords'));
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [user]);

  /** One history entry per line; blank lines are dropped. */
  const toLines = (text: string) =>
    text.split('\n').map(line => line.trim()).filter(Boolean);

  /** Update one vital and keep the derived BMI in step with height and weight. */
  const updateVital = (field: string, value: string) => {
    const vitalSigns = { ...formData.vitalSigns, [field]: value };
    const heightM = parseFloat(vitalSigns.heightCm) / 100;
    const weightKg = parseFloat(vitalSigns.weightKg);
    vitalSigns.bmi =
      heightM > 0 && weightKg > 0 ? (weightKg / (heightM * heightM)).toFixed(1) : '';
    setFormData({ ...formData, vitalSigns });
  };

  const handleSaveHp = async (status: 'in-progress' | 'signed') => {
    if (!formData.patientId || !formData.chiefComplaint) {
      showError(t('docHistoryPhysical.warningRequiredFields'));
      return;
    }
    
    setIsSubmitting(true);
    try {
      const payload = {
        hp_id: `HP-${Date.now()}`,
        patient_id: formData.patientId,
        patient_name: formData.patientName,
        mrn: formData.mrn,
        dateOfExam: new Date().toISOString(),
        exam_type: formData.examType,
        chief_complaint: formData.chiefComplaint,
        history_of_present_illness: formData.hpi,
        past_medical_history: toLines(formData.pmh),
        past_surgical_history: toLines(formData.psh),
        medications: toLines(formData.medications),
        allergies: toLines(formData.allergies),
        social_history: formData.socialHistory,
        family_history: toLines(formData.familyHistory),
        vital_signs: formData.vitalSigns,
        review_of_systems: formData.reviewOfSystems,
        physical_exam: formData.physicalExam,
        assessment: formData.assessment,
        plan: formData.plan,
        provider: user?.username || 'Healthcare Provider',
        status,
      };

      await createHistoryPhysical(payload);
      showSuccess(status === 'signed' ? t('docHistoryPhysical.successSigned') : t('docHistoryPhysical.successDraft'));
      setActiveTab('list');
      
      // Refresh list
      const hpData = await listHistoryPhysicals();
      const records = Array.isArray(hpData) ? hpData : ((hpData as { records?: unknown[]; hp_records?: unknown[] }).records || (hpData as { records?: unknown[]; hp_records?: unknown[] }).hp_records || []);
      setHpRecords(records.map((record: any) => ({
        ...record,
        dateOfExam: new Date(record.dateOfExam || record.date_of_exam || Date.now()),
        signedAt: record.signedAt || record.signed_at ? new Date(record.signedAt || record.signed_at) : undefined
      })));
    } catch (err) {
      console.error('Failed to save H&P:', err);
      showError(t('docHistoryPhysical.errorSave'));
    } finally {
      setIsSubmitting(false);
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
      'in-progress': 'bg-caution-subtle text-caution-subtle-fg',
      'complete': 'bg-notice-subtle text-notice-subtle-fg',
      'signed': 'bg-ok-subtle text-ok-subtle-fg',
      'addendum': 'bg-surface-sunken text-content-secondary'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {t(`docHistoryPhysical.status_${status}`)}
      </span>
    );
  };

  const getExamTypeBadge = (type: HistoryAndPhysical['examType']) => {
    const styles: Record<string, string> = {
      'admission': 'bg-critical-subtle text-critical-subtle-fg',
      'annual': 'bg-ok-subtle text-ok-subtle-fg',
      'pre-operative': 'bg-surface-sunken text-content-secondary',
      'follow-up': 'bg-notice-subtle text-notice-subtle-fg',
      'consultation': 'bg-surface-sunken text-content-secondary'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[type]}`}>
        {t(`docHistoryPhysical.examType_${type}`)}
      </span>
    );
  };

  const translateSystem = (system: string) => t(`docHistoryPhysical.system_${system.toLowerCase().replace(/\//g, '-')}`);

  const filteredRecords = hpRecords.filter(record => {
    const matchesSearch = record.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          record.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          record.mrn.includes(searchQuery);
    const matchesStatus = statusFilter === 'all' || record.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const formSections = [
    'navPatientInfo',
    'navChiefComplaint',
    'navHistory',
    'navReviewOfSystems',
    'navVitalSigns',
    'navPhysicalExam',
    'navAssessmentPlan'
  ];

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-700 to-violet-600 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <ClipboardList className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docHistoryPhysical.title')}</h1>
        </div>
        <p className="text-indigo-200">{t('docHistoryPhysical.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-content-secondary animate-spin mb-2" />
          <p className="text-content-muted">{t('docHistoryPhysical.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <p className="text-xs text-red-500 mt-1">{t('docHistoryPhysical.apiCheckMessage')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Tabs */}
          <div className="bg-surface border-b">
            <div className="flex">
              {(['list', 'new', 'templates'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-4 text-sm font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? 'text-content-secondary border-b-2 border-indigo-700'
                      : 'text-content-muted hover:text-content-secondary'
                  }`}
                >
                  {tab === 'new' ? t('docHistoryPhysical.tabNewHp') : tab === 'list' ? t('docHistoryPhysical.tabRecords') : t('docHistoryPhysical.tabTemplates')}
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
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
                  <input
                    id="hp-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('docHistoryPhysical.searchPlaceholder')}
                    aria-label={t('docHistoryPhysical.searchPlaceholder')}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <label htmlFor="hp-status-filter" className="sr-only">{t('docHistoryPhysical.filterByStatus')}</label>
                <select
                  id="hp-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as HPStatus | 'all')}
                  className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">{t('docHistoryPhysical.allStatuses')}</option>
                  <option value="in-progress">{t('docHistoryPhysical.status_in-progress')}</option>
                  <option value="complete">{t('docHistoryPhysical.status_complete')}</option>
                  <option value="signed">{t('docHistoryPhysical.status_signed')}</option>
                  <option value="addendum">{t('docHistoryPhysical.addendumFilterOption')}</option>
                </select>
                <button
                  onClick={() => setActiveTab('new')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {t('docHistoryPhysical.newHp')}
                </button>
          </div>

          {/* Records List */}
          <div className="space-y-4">
            {filteredRecords.map(record => (
              <div key={record.id} className="bg-surface rounded-lg shadow border overflow-hidden">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-content">{record.patientName}</h3>
                        {getStatusBadge(record.status)}
                        {getExamTypeBadge(record.examType)}
                      </div>
                      <p className="text-sm text-content-muted mt-1">
                        MRN: {record.mrn} • ID: {record.id}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedRecord(record)}
                        className="p-2 hover:bg-surface-sunken rounded-lg"
                        title="View"
                      >
                        <Eye className="w-5 h-5 text-content-muted" />
                      </button>
                      {record.status !== 'signed' && (
                        <button className="p-2 hover:bg-surface-sunken rounded-lg" title="Edit">
                          <Edit className="w-5 h-5 text-content-muted" />
                        </button>
                      )}
                      <button className="p-2 hover:bg-surface-sunken rounded-lg" title="Print">
                        <Printer className="w-5 h-5 text-content-muted" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                    <div>
                      <p className="text-content-muted">{t('docHistoryPhysical.dateOfExamLabel')}</p>
                      <p className="font-medium">{record.dateOfExam.toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-content-muted">{t('docHistoryPhysical.providerLabel')}</p>
                      <p className="font-medium">{record.provider}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-content-muted">{t('docHistoryPhysical.chiefComplaintLabel')}</p>
                      <p className="font-medium">{record.chiefComplaint}</p>
                    </div>
                  </div>

                  {/* Vitals Summary */}
                  <div className="flex gap-4 flex-wrap text-sm bg-surface-sunken rounded-lg p-3">
                    <div className="flex items-center gap-1">
                      <Heart className="w-4 h-4 text-red-500" />
                      <span className="text-content-muted">{t('docHistoryPhysical.bpAbbrev')}</span>
                      <span className="font-medium">{record.vitalSigns.bloodPressure}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Activity className="w-4 h-4 text-blue-500" />
                      <span className="text-content-muted">{t('docHistoryPhysical.hrAbbrev')}</span>
                      <span className="font-medium">{record.vitalSigns.heartRate}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Thermometer className="w-4 h-4 text-orange-500" />
                      <span className="text-content-muted">{t('docHistoryPhysical.tempAbbrev')}</span>
                      <span className="font-medium">{record.vitalSigns.temperature}°C</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Scale className="w-4 h-4 text-green-500" />
                      <span className="text-content-muted">{t('docHistoryPhysical.bmiAbbrev')}</span>
                      <span className="font-medium">{record.vitalSigns.bmi}</span>
                    </div>
                  </div>

                  {record.status === 'signed' && record.signedAt && (
                    <div className="mt-4 pt-4 border-t flex items-center text-sm text-ok-subtle-fg">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      {t('docHistoryPhysical.signedByLine', { provider: record.provider, credentials: record.providerCredentials, date: record.signedAt.toLocaleString() })}
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
              <div className="bg-surface rounded-lg shadow p-4 sticky top-6">
                <h3 className="font-semibold text-content mb-3">Sections</h3>
                <nav className="space-y-1">
                  {formSections.map((section, idx) => (
                    <button
                      key={section}
                      onClick={() => setCurrentSection(idx)}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${
                        currentSection === idx
                          ? 'bg-surface-sunken text-content-secondary font-medium'
                          : 'text-content-muted hover:bg-surface-sunken'
                      }`}
                    >
                      {t(`docHistoryPhysical.${section}`)}
                    </button>
                  ))}
                </nav>
              </div>
            </div>

            {/* Form Content */}
            <div className="flex-1 space-y-6">
              {/* Patient Info */}
              <div className="bg-surface rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('patient-info')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <User className="w-5 h-5 text-content-secondary" />
                    {t('docHistoryPhysical.patientInformationHeading')}
                  </h2>
                  {expandedSections.has('patient-info') ? (
                    <ChevronDown className="w-5 h-5 text-content-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-content-muted" />
                  )}
                </button>
                {expandedSections.has('patient-info') && (
                  <div className="mt-4 space-y-4">
                    <div className="bg-surface-sunken p-4 rounded-lg border border-indigo-100">
                      <label htmlFor="hp-patient-select" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.selectExistingPatient')}</label>
                      <select
                        id="hp-patient-select"
                        onChange={(e) => {
                          const p = availablePatients.find(p => p.patient_id === e.target.value);
                          if (p) {
                            setFormData({
                              ...formData,
                              patientId: p.patient_id,
                              patientName: p.full_name,
                              mrn: p.national_id || ''
                            });
                          }
                        }}
                        className="w-full border-indigo-200 rounded-lg px-3 py-2 bg-surface"
                      >
                        <option value="">{t('docHistoryPhysical.selectPatientPlaceholder')}</option>
                        {availablePatients.map(p => (
                          <option key={p.patient_id} value={p.patient_id}>{p.full_name} ({p.patient_id})</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="hp-patient-id" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.patientIdLabel')}</label>
                        <input
                          id="hp-patient-id"
                          type="text"
                          value={formData.patientId}
                          onChange={(e) => setFormData({ ...formData, patientId: e.target.value })}
                          className="w-full border rounded-lg px-3 py-2"
                          placeholder={t('docHistoryPhysical.patientIdPh')}
                        />
                      </div>
                      <div>
                        <label htmlFor="hp-patient-name" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.patientNameLabel')}</label>
                        <input
                          id="hp-patient-name"
                          type="text"
                          value={formData.patientName}
                          onChange={(e) => setFormData({ ...formData, patientName: e.target.value })}
                          className="w-full border rounded-lg px-3 py-2 bg-surface-sunken"
                        />
                      </div>
                      <div>
                        <label htmlFor="hp-mrn" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.mrnLabel')}</label>
                        <input
                          id="hp-mrn"
                          type="text"
                          value={formData.mrn}
                          onChange={(e) => setFormData({ ...formData, mrn: e.target.value })}
                          className="w-full border rounded-lg px-3 py-2 bg-surface-sunken"
                        />
                      </div>
                      <div className="md:col-span-3">
                        <fieldset>
                          <legend className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.examTypeLabel')}</legend>
                          <div className="flex gap-3 flex-wrap">
                            {['admission', 'annual', 'pre-operative', 'follow-up', 'consultation'].map(type => (
                              <label key={type} htmlFor={`hp-exam-type-${type}`} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  id={`hp-exam-type-${type}`}
                                  type="radio"
                                  name="examType"
                                  value={type}
                                  checked={formData.examType === type}
                                  onChange={() => setFormData({ ...formData, examType: type as HistoryAndPhysical['examType'] })}
                                  className="text-content-secondary"
                                />
                                <span className="text-sm">{t(`docHistoryPhysical.examType_${type}`)}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Chief Complaint */}
              <div className="bg-surface rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('chief-complaint')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-content-secondary" />
                    {t('docHistoryPhysical.chiefComplaintHpiHeading')}
                  </h2>
                  {expandedSections.has('chief-complaint') ? (
                    <ChevronDown className="w-5 h-5 text-content-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-content-muted" />
                  )}
                </button>
                {expandedSections.has('chief-complaint') && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="hp-chief-complaint" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.chiefComplaintRequiredLabel')}</label>
                      <input
                        id="hp-chief-complaint"
                        type="text"
                        value={formData.chiefComplaint}
                        onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2"
                        placeholder={t('docHistoryPhysical.chiefComplaintPh')}
                      />
                    </div>
                    <div>
                      <label htmlFor="hp-hpi" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.hpiLabel')}</label>
                      <textarea
                        id="hp-hpi"
                        value={formData.hpi}
                        onChange={(e) => setFormData({ ...formData, hpi: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 h-32"
                        placeholder={t('docHistoryPhysical.hpiPh')}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Past Medical History */}
              <div className="bg-surface rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('history')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <History className="w-5 h-5 text-content-secondary" />
                    {t('docHistoryPhysical.medicalHistoryHeading')}
                  </h2>
                  {expandedSections.has('history') ? (
                    <ChevronDown className="w-5 h-5 text-content-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-content-muted" />
                  )}
                </button>
                {expandedSections.has('history') && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="hp-pmh" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.pmhLabel')}</label>
                      <textarea
                        id="hp-pmh"
                        value={formData.pmh}
                        onChange={(e) => setFormData({ ...formData, pmh: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 h-24"
                        placeholder={t('docHistoryPhysical.pmhPh')}
                      />
                    </div>
                    <div>
                      <label htmlFor="hp-psh" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.pshLabel')}</label>
                      <textarea
                        id="hp-psh"
                        value={formData.psh}
                        onChange={(e) => setFormData({ ...formData, psh: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 h-20"
                        placeholder={t('docHistoryPhysical.pshPh')}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="hp-medications" className="block text-sm font-medium text-content-secondary mb-1">
                          <Pill className="w-4 h-4 inline mr-1" />
                          {t('docHistoryPhysical.currentMedicationsLabel')}
                        </label>
                        <textarea
                          id="hp-medications"
                        value={formData.medications}
                        onChange={(e) => setFormData({ ...formData, medications: e.target.value })}
                          className="w-full border rounded-lg px-3 py-2 h-24"
                          placeholder={t('docHistoryPhysical.medicationsPh')}
                        />
                      </div>
                      <div>
                        <label htmlFor="hp-allergies" className="block text-sm font-medium text-content-secondary mb-1">
                          <AlertTriangle className="w-4 h-4 inline mr-1 text-red-500" />
                          {t('docHistoryPhysical.allergiesLabel')}
                        </label>
                        <textarea
                          id="hp-allergies"
                        value={formData.allergies}
                        onChange={(e) => setFormData({ ...formData, allergies: e.target.value })}
                          className="w-full border rounded-lg px-3 py-2 h-24"
                          placeholder={t('docHistoryPhysical.allergiesPh')}
                        />
                      </div>
                    </div>
                    <div>
                      <span id="hp-social-history-heading" className="block text-sm font-medium text-content-secondary mb-2">{t('docHistoryPhysical.socialHistoryLabel')}</span>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="group" aria-labelledby="hp-social-history-heading">
                        <div>
                          <label htmlFor="hp-tobacco" className="block text-xs text-content-muted mb-1">{t('docHistoryPhysical.tobaccoUseLabel')}</label>
                          <select id="hp-tobacco" className="w-full border rounded-lg px-3 py-2 text-sm"
                            value={formData.socialHistory.smoking}
                            onChange={(e) => setFormData({ ...formData, socialHistory: { ...formData.socialHistory, smoking: e.target.value } })}>
                            <option value="never">{t('docHistoryPhysical.smoking_never')}</option>
                            <option value="former">{t('docHistoryPhysical.smoking_former')}</option>
                            <option value="current">{t('docHistoryPhysical.smoking_current')}</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="hp-alcohol" className="block text-xs text-content-muted mb-1">{t('docHistoryPhysical.alcoholUseLabel')}</label>
                          <select id="hp-alcohol" className="w-full border rounded-lg px-3 py-2 text-sm"
                            value={formData.socialHistory.alcohol}
                            onChange={(e) => setFormData({ ...formData, socialHistory: { ...formData.socialHistory, alcohol: e.target.value } })}>
                            <option value="none">{t('docHistoryPhysical.alcohol_none')}</option>
                            <option value="social">{t('docHistoryPhysical.alcohol_social')}</option>
                            <option value="moderate">{t('docHistoryPhysical.alcohol_moderate')}</option>
                            <option value="heavy">{t('docHistoryPhysical.alcohol_heavy')}</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="hp-drugs" className="block text-xs text-content-muted mb-1">{t('docHistoryPhysical.illicitDrugsLabel')}</label>
                          <select id="hp-drugs" className="w-full border rounded-lg px-3 py-2 text-sm"
                            value={formData.socialHistory.drugs}
                            onChange={(e) => setFormData({ ...formData, socialHistory: { ...formData.socialHistory, drugs: e.target.value } })}>
                            <option value="none">{t('docHistoryPhysical.drugs_none')}</option>
                            <option value="former">{t('docHistoryPhysical.drugs_former')}</option>
                            <option value="current">{t('docHistoryPhysical.drugs_current')}</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="hp-family-history" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.familyHistoryLabel')}</label>
                      <textarea
                        id="hp-family-history"
                        value={formData.familyHistory}
                        onChange={(e) => setFormData({ ...formData, familyHistory: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 h-20"
                        placeholder={t('docHistoryPhysical.familyHistoryPh')}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Vital Signs */}
              <div className="bg-surface rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('vitals')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Activity className="w-5 h-5 text-content-secondary" />
                    {t('docHistoryPhysical.vitalSignsHeading')}
                  </h2>
                  {expandedSections.has('vitals') ? (
                    <ChevronDown className="w-5 h-5 text-content-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-content-muted" />
                  )}
                </button>
                {expandedSections.has('vitals') && (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label htmlFor="hp-blood-pressure" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.bloodPressureLabel')}</label>
                      <input id="hp-blood-pressure" type="text" className="w-full border rounded-lg px-3 py-2" placeholder="120/80"
                        value={formData.vitalSigns.bloodPressure}
                        onChange={(e) => updateVital('bloodPressure', e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="hp-heart-rate" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.heartRateLabel')}</label>
                      <input id="hp-heart-rate" type="number" className="w-full border rounded-lg px-3 py-2" placeholder="72"
                        value={formData.vitalSigns.heartRate}
                        onChange={(e) => updateVital('heartRate', e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="hp-respiratory-rate" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.respiratoryRateLabel')}</label>
                      <input id="hp-respiratory-rate" type="number" className="w-full border rounded-lg px-3 py-2" placeholder="16"
                        value={formData.vitalSigns.respiratoryRate}
                        onChange={(e) => updateVital('respiratoryRate', e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="hp-temperature" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.temperatureLabel')}</label>
                      <input id="hp-temperature" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="36.8"
                        value={formData.vitalSigns.temperature}
                        onChange={(e) => updateVital('temperature', e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="hp-spo2" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.spo2Label')}</label>
                      <input id="hp-spo2" type="number" className="w-full border rounded-lg px-3 py-2" placeholder="98"
                        value={formData.vitalSigns.oxygenSaturation}
                        onChange={(e) => updateVital('oxygenSaturation', e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="hp-height" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.heightLabel')}</label>
                      <input id="hp-height" type="number" className="w-full border rounded-lg px-3 py-2" placeholder="170"
                        value={formData.vitalSigns.heightCm}
                        onChange={(e) => updateVital('heightCm', e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="hp-weight" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.weightLabel')}</label>
                      <input id="hp-weight" type="number" step="0.1" className="w-full border rounded-lg px-3 py-2" placeholder="70"
                        value={formData.vitalSigns.weightKg}
                        onChange={(e) => updateVital('weightKg', e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="hp-bmi" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.bmiCalcLabel')}</label>
                      <input id="hp-bmi" type="text" className="w-full border rounded-lg px-3 py-2 bg-surface-sunken" readOnly placeholder="24.5"
                        value={formData.vitalSigns.bmi} />
                    </div>
                  </div>
                )}
              </div>

              {/* Review of Systems */}
              <div className="bg-surface rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('ros')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Brain className="w-5 h-5 text-content-secondary" />
                    {t('docHistoryPhysical.reviewOfSystemsHeading')}
                  </h2>
                  {expandedSections.has('ros') ? (
                    <ChevronDown className="w-5 h-5 text-content-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-content-muted" />
                  )}
                </button>
                {expandedSections.has('ros') && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {systemsList.map(system => (
                      <div key={system} className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
                        <span id={`hp-ros-${system.toLowerCase().replace(/\//g, '-')}-label`} className="text-sm font-medium text-gray-700">{translateSystem(system)}</span>
                        <div className="flex gap-2" role="radiogroup" aria-labelledby={`hp-ros-${system.toLowerCase().replace(/\//g, '-')}-label`}>
                          {['normal', 'abnormal'].map(status => (
                            <label key={status} htmlFor={`hp-ros-${system.toLowerCase().replace(/\//g, '-')}-${status}`} className="flex items-center gap-1 cursor-pointer">
                              <input id={`hp-ros-${system.toLowerCase().replace(/\//g, '-')}-${status}`} type="radio" name={`ros-${system}`} className="text-indigo-600"
                                checked={formData.reviewOfSystems[system] === status}
                                onChange={() => setFormData({ ...formData, reviewOfSystems: { ...formData.reviewOfSystems, [system]: status } })} />
                              <span className="text-xs">{status === 'normal' ? t('docHistoryPhysical.negLabel') : t('docHistoryPhysical.posLabel')}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Physical Examination */}
              <div className="bg-surface rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('pe')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 text-content-secondary" />
                    {t('docHistoryPhysical.physicalExaminationHeading')}
                  </h2>
                  {expandedSections.has('pe') ? (
                    <ChevronDown className="w-5 h-5 text-content-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-content-muted" />
                  )}
                </button>
                {expandedSections.has('pe') && (
                  <div className="mt-4 space-y-4">
                    {['General', 'HEENT', 'Neck', 'Cardiovascular', 'Respiratory', 'Abdomen', 'Extremities', 'Neurological', 'Skin'].map(system => (
                      <div key={system} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span id={`hp-pe-${system.toLowerCase()}-label`} className="font-medium text-content-secondary">{translateSystem(system)}</span>
                          <div className="flex gap-3" role="radiogroup" aria-labelledby={`hp-pe-${system.toLowerCase()}-label`}>
                            {['normal', 'abnormal'].map(status => (
                              <label key={status} htmlFor={`hp-pe-${system.toLowerCase()}-${status}`} className="flex items-center gap-1 cursor-pointer">
                                <input id={`hp-pe-${system.toLowerCase()}-${status}`} type="radio" name={`pe-${system}`} className="text-content-secondary"
                                  checked={formData.physicalExam[system]?.status === status}
                                  onChange={() => setFormData({ ...formData, physicalExam: { ...formData.physicalExam, [system]: { status, findings: formData.physicalExam[system]?.findings || '' } } })} />
                                <span className="text-sm">{status === 'normal' ? t('docHistoryPhysical.normalLabel') : t('docHistoryPhysical.abnormalLabel')}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <label htmlFor={`hp-pe-${system.toLowerCase()}-findings`} className="sr-only">{t('docHistoryPhysical.findingsLabel', { system: translateSystem(system) })}</label>
                        <textarea
                          id={`hp-pe-${system.toLowerCase()}-findings`}
                          className="w-full border rounded px-3 py-2 text-sm"
                          placeholder={t('docHistoryPhysical.findingsPh')}
                          rows={2}
                          value={formData.physicalExam[system]?.findings || ''}
                          onChange={(e) => setFormData({ ...formData, physicalExam: { ...formData.physicalExam, [system]: { status: formData.physicalExam[system]?.status || '', findings: e.target.value } } })}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Assessment & Plan */}
              <div className="bg-surface rounded-lg shadow p-6">
                <button
                  onClick={() => toggleSection('assessment')}
                  className="w-full flex items-center justify-between"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-content-secondary" />
                    {t('docHistoryPhysical.assessmentPlanHeading')}
                  </h2>
                  {expandedSections.has('assessment') ? (
                    <ChevronDown className="w-5 h-5 text-content-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-content-muted" />
                  )}
                </button>
                {expandedSections.has('assessment') && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="hp-assessment" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.assessmentRequiredLabel')}</label>
                      <textarea
                        id="hp-assessment"
                        value={formData.assessment}
                        onChange={(e) => setFormData({ ...formData, assessment: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 h-32"
                        placeholder={t('docHistoryPhysical.assessmentPh')}
                      />
                    </div>
                    <div>
                      <label htmlFor="hp-plan" className="block text-sm font-medium text-content-secondary mb-1">{t('docHistoryPhysical.planRequiredLabel')}</label>
                      <textarea
                        id="hp-plan"
                        value={formData.plan}
                        onChange={(e) => setFormData({ ...formData, plan: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 h-32"
                        placeholder={t('docHistoryPhysical.planPh')}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleSaveHp('in-progress')}
                  className="px-6 py-2 border border-border-strong rounded-lg font-medium"
                >
                  {t('docHistoryPhysical.saveAsDraft')}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleSaveHp('signed')}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                  {t('docHistoryPhysical.completeAndSign')}
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
              { name: t('docHistoryPhysical.templateGeneralAdmissionName'), type: 'admission', description: t('docHistoryPhysical.templateGeneralAdmissionDesc') },
              { name: t('docHistoryPhysical.templateAnnualPhysicalName'), type: 'annual', description: t('docHistoryPhysical.templateAnnualPhysicalDesc') },
              { name: t('docHistoryPhysical.templatePreOpName'), type: 'pre-operative', description: t('docHistoryPhysical.templatePreOpDesc') },
              { name: t('docHistoryPhysical.templateCardiologyName'), type: 'consultation', description: t('docHistoryPhysical.templateCardiologyDesc') },
              { name: t('docHistoryPhysical.templatePulmonaryName'), type: 'consultation', description: t('docHistoryPhysical.templatePulmonaryDesc') },
              { name: t('docHistoryPhysical.templatePediatricName'), type: 'admission', description: t('docHistoryPhysical.templatePediatricDesc') }
            ].map((template, idx) => (
              <div key={idx} className="bg-surface rounded-lg shadow border p-6 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-content">{template.name}</h3>
                    <p className="text-sm text-content-muted mt-1">{template.description}</p>
                  </div>
                  {getExamTypeBadge(template.type as HistoryAndPhysical['examType'])}
                </div>
                <button className="mt-4 text-sm text-content-secondary font-medium flex items-center gap-1">
                  {t('docHistoryPhysical.useTemplate')}
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
          <div className="bg-surface rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-surface border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedRecord.patientName}</h2>
                <p className="text-sm text-content-muted">{selectedRecord.id}</p>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="text-content-muted hover:text-content-muted"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Content would go here */}
              <div className="bg-surface-sunken rounded-lg p-4">
                <h3 className="font-semibold mb-2">{t('docHistoryPhysical.chiefComplaintLabel')}</h3>
                <p>{selectedRecord.chiefComplaint}</p>
              </div>
              <div className="bg-surface-sunken rounded-lg p-4">
                <h3 className="font-semibold mb-2">{t('docHistoryPhysical.historyOfPresentIllnessHeading')}</h3>
                <p>{selectedRecord.historyOfPresentIllness}</p>
              </div>
              <div className="bg-surface-sunken rounded-lg p-4">
                <h3 className="font-semibold mb-2">{t('docHistoryPhysical.assessmentHeading')}</h3>
                <p>{selectedRecord.assessment}</p>
              </div>
              <div className="bg-surface-sunken rounded-lg p-4">
                <h3 className="font-semibold mb-2">{t('docHistoryPhysical.planHeading')}</h3>
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
