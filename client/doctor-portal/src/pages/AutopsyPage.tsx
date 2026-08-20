import React, { useState, useEffect, useCallback } from 'react';
import { getPatients, listAutopsy, createAutopsyReport, useTranslation } from '@medichain/shared';
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
  const { t } = useTranslation();
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
      setError(t('docAutopsy.errorLoadFailed'));
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
      alert(t('docAutopsy.errorRequiredFields'));
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
      const response = await createAutopsyReport(autopsy) as { success?: boolean; error?: string };
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
        alert(t('docAutopsy.successCreated'));
      } else {
        setError(response.error || t('docAutopsy.errorCreateFailed'));
      }
    } catch (err) {
      console.error('Error creating autopsy report:', err);
      setError(t('docAutopsy.errorGeneric'));
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = (status: AutopsyStatus) => {
    const badges = {
      pending: 'bg-caution-subtle text-caution-subtle-fg',
      'in-progress': 'bg-notice-subtle text-notice-subtle-fg',
      completed: 'bg-ok-subtle text-ok-subtle-fg',
      reviewed: 'bg-purple-100 text-purple-800',
    };
    return badges[status];
  };

  const getMannerBadge = (manner: MannerOfDeath) => {
    const badges = {
      natural: 'bg-ok-subtle text-ok-subtle-fg',
      accident: 'bg-caution-subtle text-caution-subtle-fg',
      suicide: 'bg-orange-100 text-orange-800',
      homicide: 'bg-critical-subtle text-critical-subtle-fg',
      undetermined: 'bg-surface-sunken text-content-secondary',
      pending: 'bg-notice-subtle text-notice-subtle-fg',
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
        <h1 className="text-3xl font-bold mb-2">{t('docAutopsy.title')}</h1>
        <p className="text-orange-100">{t('docAutopsy.subtitle')}</p>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'reports' ? 'text-orange-700 border-b-2 border-orange-700' : 'text-content-muted hover:text-orange-700'
          }`}
        >
          {t('docAutopsy.tabAllReports', { count: autopsies.length })}
        </button>
        <button
          onClick={() => setActiveTab('new-report')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new-report' ? 'text-orange-700 border-b-2 border-orange-700' : 'text-content-muted hover:text-orange-700'
          }`}
        >
          {t('docAutopsy.tabNewReport')}
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'pending' ? 'text-orange-700 border-b-2 border-orange-700' : 'text-content-muted hover:text-orange-700'
          }`}
        >
          {t('docAutopsy.tabPending', { count: pendingAutopsies.length })}
        </button>
      </div>

      {(activeTab === 'reports' || activeTab === 'pending') && (
        <div className="space-y-4">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.searchLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docAutopsy.searchPh')}
                    className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.statusLabel')}</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as AutopsyStatus | 'all')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docAutopsy.filterAllStatuses')}</option>
                  <option value="pending">{t('docAutopsy.status_pending')}</option>
                  <option value="in-progress">{t('docAutopsy.status_in-progress')}</option>
                  <option value="completed">{t('docAutopsy.status_completed')}</option>
                  <option value="reviewed">{t('docAutopsy.status_reviewed')}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {(activeTab === 'pending' ? pendingAutopsies : filteredAutopsies).map((autopsy) => (
              <div key={autopsy.autopsyId} className="border border-border-strong rounded-lg shadow-sm bg-surface p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-content">{autopsy.autopsyId}</h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(autopsy.status)}`}>
                        {t(`docAutopsy.status_${autopsy.status}`).toUpperCase()}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getMannerBadge(autopsy.mannerOfDeath)}`}>
                        {t(`docAutopsy.manner_${autopsy.mannerOfDeath}`).toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-content-muted">{t('docAutopsy.caseLabel', { value: autopsy.caseNumber || t('docAutopsy.caseNotAssigned') })}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 bg-orange-50 rounded-lg p-4">
                  <div>
                    <p className="text-sm text-orange-900 font-semibold mb-1">{t('docAutopsy.lblDeceased')}</p>
                    <p className="font-semibold text-content">{autopsy.patientName}</p>
                    <p className="text-sm text-content-muted">{autopsy.patientId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-orange-900 font-semibold mb-1">{t('docAutopsy.lblDateOfDeath')}</p>
                    <p className="text-sm text-content">{autopsy.dateOfDeath}</p>
                  </div>
                  <div>
                    <p className="text-sm text-orange-900 font-semibold mb-1">{t('docAutopsy.lblAutopsyDate')}</p>
                    <p className="text-sm text-content">{t('docAutopsy.autopsyDateTime', { date: autopsy.dateOfAutopsy, time: autopsy.timeOfAutopsy })}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="bg-critical-subtle border border-critical rounded-lg p-3">
                    <p className="text-sm font-semibold text-critical-subtle-fg mb-1">{t('docAutopsy.lblCauseOfDeath')}</p>
                    <p className="text-sm text-critical-subtle-fg font-semibold">{autopsy.causeOfDeath}</p>
                    {autopsy.contributingFactors && (
                      <p className="text-sm text-critical-subtle-fg mt-2">{t('docAutopsy.contributingPrefix', { value: autopsy.contributingFactors })}</p>
                    )}
                  </div>

                  <div className="bg-caution-subtle border border-caution rounded-lg p-3">
                    <p className="text-sm font-semibold text-caution-subtle-fg mb-1">{t('docAutopsy.lblCircumstances')}</p>
                    <p className="text-sm text-caution-subtle-fg">{autopsy.circumstances}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-surface-sunken border border-border rounded p-3">
                      <p className="text-sm font-semibold text-content-secondary mb-1">{t('docAutopsy.lblClinicalHistory')}</p>
                      <p className="text-sm text-content">{autopsy.clinicalHistory}</p>
                    </div>
                    <div className="bg-surface-sunken border border-border rounded p-3">
                      <p className="text-sm font-semibold text-content-secondary mb-1">{t('docAutopsy.lblLocation')}</p>
                      <p className="text-sm text-content">{autopsy.location}</p>
                      <p className="text-sm text-content-muted mt-1">{t('docAutopsy.prosectorPrefix', { value: autopsy.prosector })}</p>
                      {autopsy.assistant && <p className="text-sm text-content-muted">{t('docAutopsy.assistantPrefix', { value: autopsy.assistant })}</p>}
                    </div>
                  </div>

                  <div className="bg-notice-subtle border border-notice rounded-lg p-4">
                    <p className="text-sm font-semibold text-notice-subtle-fg mb-3">{t('docAutopsy.externalExamTitle')}</p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-notice-subtle-fg font-semibold">{t('docAutopsy.lblLength')}</span> {t('docAutopsy.cmSuffix', { value: autopsy.externalExam.bodyLength })}
                      </div>
                      <div>
                        <span className="text-notice-subtle-fg font-semibold">{t('docAutopsy.lblWeight')}</span> {t('docAutopsy.kgSuffix', { value: autopsy.externalExam.bodyWeight })}
                      </div>
                      <div className="col-span-2">
                        <span className="text-notice-subtle-fg font-semibold">{t('docAutopsy.lblHabitus')}</span> {autopsy.externalExam.bodyHabitus}
                      </div>
                      <div className="col-span-2">
                        <span className="text-notice-subtle-fg font-semibold">{t('docAutopsy.lblRigorMortis')}</span> {autopsy.externalExam.rigorMortis}
                      </div>
                      <div className="col-span-2">
                        <span className="text-notice-subtle-fg font-semibold">{t('docAutopsy.lblLivorMortis')}</span> {autopsy.externalExam.livorMortis}
                      </div>
                      {autopsy.externalExam.externalInjuries && (
                        <div className="col-span-2">
                          <span className="text-notice-subtle-fg font-semibold">{t('docAutopsy.lblExternalInjuries')}</span> {autopsy.externalExam.externalInjuries}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-purple-900 mb-3">{t('docAutopsy.internalExamTitle')}</p>
                    <div className="space-y-2 text-sm">
                      {autopsy.internalExam.cardiovascular && (
                        <div>
                          <span className="text-purple-800 font-semibold flex items-center gap-1">
                            <Heart className="w-4 h-4" /> {t('docAutopsy.lblCardiovascular')}
                          </span>
                          <p className="text-purple-900 ml-5">{autopsy.internalExam.cardiovascular}</p>
                        </div>
                      )}
                      {autopsy.internalExam.respiratory && (
                        <div>
                          <span className="text-purple-800 font-semibold flex items-center gap-1">
                            <Activity className="w-4 h-4" /> {t('docAutopsy.lblRespiratory')}
                          </span>
                          <p className="text-purple-900 ml-5">{autopsy.internalExam.respiratory}</p>
                        </div>
                      )}
                      {autopsy.internalExam.gastrointestinal && (
                        <div>
                          <span className="text-purple-800 font-semibold">{t('docAutopsy.lblGastrointestinal')}</span>
                          <p className="text-purple-900 ml-5">{autopsy.internalExam.gastrointestinal}</p>
                        </div>
                      )}
                      {autopsy.internalExam.nervous && (
                        <div>
                          <span className="text-purple-800 font-semibold flex items-center gap-1">
                            <Brain className="w-4 h-4" /> {t('docAutopsy.lblNervousSystemColon')}
                          </span>
                          <p className="text-purple-900 ml-5">{autopsy.internalExam.nervous}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {autopsy.histology && autopsy.histology.length > 0 && (
                    <div className="bg-ok-subtle border border-ok rounded-lg p-4">
                      <p className="text-sm font-semibold text-ok-subtle-fg mb-3">{t('docAutopsy.histologyResultsTitle')}</p>
                      <div className="space-y-2">
                        {autopsy.histology.map((h, idx) => (
                          <div key={idx} className="text-sm bg-surface rounded p-2">
                            <p className="font-semibold text-ok-subtle-fg">{h.organ}</p>
                            <p className="text-ok-subtle-fg">{t('docAutopsy.findingsPrefix', { value: h.findings })}</p>
                            <p className="text-ok-subtle-fg">{t('docAutopsy.diagnosisPrefix', { value: h.diagnosis })}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-surface-sunken border border-border rounded-lg p-4">
                    <p className="text-sm font-semibold text-content mb-2">{t('docAutopsy.conclusionsTitle')}</p>
                    <p className="text-sm text-content-secondary whitespace-pre-line">{autopsy.conclusions}</p>
                    {autopsy.recommendations && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-sm font-semibold text-content mb-1">{t('docAutopsy.recommendationsTitle')}</p>
                        <p className="text-sm text-content-secondary">{autopsy.recommendations}</p>
                      </div>
                    )}
                  </div>
                </div>

                {autopsy.reviewedBy && (
                  <div className="mt-4 bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-purple-900">
                      {t('docAutopsy.reviewedByLine', { name: autopsy.reviewedBy, date: formatDate(autopsy.reviewDate!) })}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {(activeTab === 'pending' ? pendingAutopsies : filteredAutopsies).length === 0 && (
              <div className="bg-surface-sunken border border-border rounded-lg p-8 text-center">
                <FileText className="w-12 h-12 text-content-muted mx-auto mb-3" />
                <p className="text-content-muted">{t('docAutopsy.noReports')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'new-report' && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold text-content mb-6">{t('docAutopsy.createTitle')}</h2>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docAutopsy.patientLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  value={newAutopsy.patientId}
                  onChange={(e) => setNewAutopsy({ ...newAutopsy, patientId: e.target.value })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                  required
                >
                  <option value="">{t('docAutopsy.selectPatient')}</option>
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.full_name} ({p.patient_id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.autopsyTypeLabel')}</label>
                <select
                  value={newAutopsy.autopsyType}
                  onChange={(e) => setNewAutopsy({ ...newAutopsy, autopsyType: e.target.value as AutopsyType })}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="hospital">{t('docAutopsy.type_hospital')}</option>
                  <option value="forensic">{t('docAutopsy.type_forensic')}</option>
                  <option value="clinical">{t('docAutopsy.type_clinical')}</option>
                </select>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.deathInfoTitle')}</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">
                    {t('docAutopsy.dateOfDeathLabel')} <span className="text-critical-subtle-fg">*</span>
                  </label>
                  <input
                    type="date"
                    value={newAutopsy.dateOfDeath}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, dateOfDeath: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.dateOfAutopsyLabel')}</label>
                  <input
                    type="date"
                    value={newAutopsy.dateOfAutopsy}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, dateOfAutopsy: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.timeOfAutopsyLabel')}</label>
                  <input
                    type="time"
                    value={newAutopsy.timeOfAutopsy}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, timeOfAutopsy: e.target.value })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.locationLabel')}</label>
                  <input
                    type="text"
                    value={newAutopsy.location}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, location: e.target.value })}
                    placeholder={t('docAutopsy.locationPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.assistantLabel')}</label>
                  <input
                    type="text"
                    value={newAutopsy.assistant}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, assistant: e.target.value })}
                    placeholder={t('docAutopsy.assistantPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.backgroundTitle')}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.circumstancesLabel')}</label>
                  <textarea
                    value={newAutopsy.circumstances}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, circumstances: e.target.value })}
                    placeholder={t('docAutopsy.circumstancesPh')}
                    rows={3}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.clinicalHistoryLabel')}</label>
                  <textarea
                    value={newAutopsy.clinicalHistory}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, clinicalHistory: e.target.value })}
                    placeholder={t('docAutopsy.clinicalHistoryPh')}
                    rows={3}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.externalExamTitle')}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.bodyLengthLabel')}</label>
                  <input
                    type="number"
                    value={newAutopsy.bodyLength}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, bodyLength: e.target.value })}
                    placeholder={t('docAutopsy.bodyLengthPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.bodyWeightLabel')}</label>
                  <input
                    type="number"
                    value={newAutopsy.bodyWeight}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, bodyWeight: e.target.value })}
                    placeholder={t('docAutopsy.bodyWeightPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.bodyHabitusLabel')}</label>
                  <input
                    type="text"
                    value={newAutopsy.bodyHabitus}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, bodyHabitus: e.target.value })}
                    placeholder={t('docAutopsy.bodyHabitusPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.rigorMortisLabel')}</label>
                  <input
                    type="text"
                    value={newAutopsy.rigorMortis}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, rigorMortis: e.target.value })}
                    placeholder={t('docAutopsy.rigorMortisPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.livorMortisLabel')}</label>
                  <input
                    type="text"
                    value={newAutopsy.livorMortis}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, livorMortis: e.target.value })}
                    placeholder={t('docAutopsy.livorMortisPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.decompositionLabel')}</label>
                  <input
                    type="text"
                    value={newAutopsy.decomposition}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, decomposition: e.target.value })}
                    placeholder={t('docAutopsy.decompositionPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.externalInjuriesLabel')}</label>
                  <textarea
                    value={newAutopsy.externalInjuries}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, externalInjuries: e.target.value })}
                    placeholder={t('docAutopsy.externalInjuriesPh')}
                    rows={3}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.identifyingMarksLabel')}</label>
                  <textarea
                    value={newAutopsy.identifyingMarks}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, identifyingMarks: e.target.value })}
                    placeholder={t('docAutopsy.identifyingMarksPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.internalExamTitle')}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.cardioSystemLabel')}</label>
                  <textarea
                    value={newAutopsy.cardiovascular}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, cardiovascular: e.target.value })}
                    placeholder={t('docAutopsy.cardioPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.respSystemLabel')}</label>
                  <textarea
                    value={newAutopsy.respiratory}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, respiratory: e.target.value })}
                    placeholder={t('docAutopsy.respPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.giSystemLabel')}</label>
                  <textarea
                    value={newAutopsy.gastrointestinal}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, gastrointestinal: e.target.value })}
                    placeholder={t('docAutopsy.giPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.hepatoSystemLabel')}</label>
                  <textarea
                    value={newAutopsy.hepatobiliary}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, hepatobiliary: e.target.value })}
                    placeholder={t('docAutopsy.hepatoPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.guSystemLabel')}</label>
                  <textarea
                    value={newAutopsy.genitourinary}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, genitourinary: e.target.value })}
                    placeholder={t('docAutopsy.guPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.endoSystemLabel')}</label>
                  <textarea
                    value={newAutopsy.endocrine}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, endocrine: e.target.value })}
                    placeholder={t('docAutopsy.endoPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.mskSystemLabel')}</label>
                  <textarea
                    value={newAutopsy.musculoskeletal}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, musculoskeletal: e.target.value })}
                    placeholder={t('docAutopsy.mskPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.nervousSystemLabel')}</label>
                  <textarea
                    value={newAutopsy.nervous}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, nervous: e.target.value })}
                    placeholder={t('docAutopsy.nervousPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.additionalFindingsTitle')}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.microFindingsLabel')}</label>
                  <textarea
                    value={newAutopsy.microbiologyFindings}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, microbiologyFindings: e.target.value })}
                    placeholder={t('docAutopsy.microFindingsPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.radFindingsLabel')}</label>
                  <textarea
                    value={newAutopsy.radiologyFindings}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, radiologyFindings: e.target.value })}
                    placeholder={t('docAutopsy.radFindingsPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.conclusionsTitle')}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">
                    {t('docAutopsy.lblCauseOfDeath')} <span className="text-critical-subtle-fg">*</span>
                  </label>
                  <textarea
                    value={newAutopsy.causeOfDeath}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, causeOfDeath: e.target.value })}
                    placeholder={t('docAutopsy.causeOfDeathPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.mannerOfDeathLabel')}</label>
                  <select
                    value={newAutopsy.mannerOfDeath}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, mannerOfDeath: e.target.value as MannerOfDeath })}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  >
                    <option value="natural">{t('docAutopsy.manner_natural')}</option>
                    <option value="accident">{t('docAutopsy.manner_accident')}</option>
                    <option value="suicide">{t('docAutopsy.manner_suicide')}</option>
                    <option value="homicide">{t('docAutopsy.manner_homicide')}</option>
                    <option value="undetermined">{t('docAutopsy.manner_undetermined')}</option>
                    <option value="pending">{t('docAutopsy.mannerOption_pending')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.contributingFactorsLabel')}</label>
                  <textarea
                    value={newAutopsy.contributingFactors}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, contributingFactors: e.target.value })}
                    placeholder={t('docAutopsy.contributingFactorsPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.conclusionsTitle')}</label>
                  <textarea
                    value={newAutopsy.conclusions}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, conclusions: e.target.value })}
                    placeholder={t('docAutopsy.conclusionsPh')}
                    rows={4}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.recommendationsTitle')}</label>
                  <textarea
                    value={newAutopsy.recommendations}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, recommendations: e.target.value })}
                    placeholder={t('docAutopsy.recommendationsPh')}
                    rows={2}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.administrativeTitle')}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.caseNumberLabel')}</label>
                  <input
                    type="text"
                    value={newAutopsy.caseNumber}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, caseNumber: e.target.value })}
                    placeholder={t('docAutopsy.caseNumberPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.legalNotificationLabel')}</label>
                  <input
                    type="text"
                    value={newAutopsy.legalNotification}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, legalNotification: e.target.value })}
                    placeholder={t('docAutopsy.legalNotificationPh')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.notesLabel')}</label>
                <textarea
                  value={newAutopsy.notes}
                  onChange={(e) => setNewAutopsy({ ...newAutopsy, notes: e.target.value })}
                  placeholder={t('docAutopsy.notesPh')}
                  rows={3}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <button
              onClick={handleCreateAutopsy}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              {t('docAutopsy.createBtn')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AutopsyPage;
