import React, { useState, useEffect, useCallback } from 'react';
import { useToastActions } from '../components/Toast';
import PatientSelect from '../components/PatientSelect';
import {
  listAutopsy,
  createAutopsyReport,
  useTranslation,
  Alert,
  LoadingSpinner,
  Textarea,
  useValidatedForm,
  autopsyReportSchema,
  formatDateOnly, ChoiceChips
} from '@medichain/shared';
import type { PatientDirectoryEntry } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import {
  FileText,
  Search,
  Plus,
  Activity,
  Heart,
  Brain,
  RefreshCw,
} from 'lucide-react';
import { useStaffDirectory } from '../components/StaffName';
import { PatientName } from '../components/PatientName';

type AutopsyType = 'medico-legal' | 'hospital' | 'forensic' | 'clinical';
type MannerOfDeath = 'natural' | 'accident' | 'suicide' | 'homicide' | 'undetermined' | 'pending';
type AutopsyStatus = 'pending' | 'in-progress' | 'completed' | 'reviewed';

interface ExternalExamination {
  /** Absent when nobody measured it -- not 0 cm (CLAUDE.md rule 12). */
  bodyLength?: number;
  bodyWeight?: number;
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

/** A number the clinician typed, or nothing when the box was left empty. */
function measured(value: string): number | undefined {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A stored report, as the registry list returns it.
 *
 * The list serves the stored document flattened onto its row, and the create
 * request stores the id as `report_id` and the patient as `patient_id` -- not
 * the `autopsyId` / `patientId` this page reads. Cast straight to the page's
 * shape, the first real report made `a.autopsyId.toLowerCase()` throw.
 */
function toAutopsy(row: Record<string, unknown>): AutopsyReport {
  const report = row as unknown as AutopsyReport;
  const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : '');
  return {
    ...report,
    autopsyId: text('autopsyId') || text('report_id') || text('id'),
    patientId: text('patientId') || text('patient_id') || text('owner_id'),
    patientName: text('patientName'),
    causeOfDeath: text('causeOfDeath'),
    externalExam: report.externalExam ?? ({} as ExternalExamination),
    internalExam: report.internalExam ?? ({} as InternalExamination),
  };
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
  // Toasts, not `alert()`. A native alert is a blocking modal: it freezes the
  // tab until dismissed, ignores the app's styling and focus handling, and
  // interrupts a clinician mid-form. `Toast.tsx` says in its own header that it
  // exists "to replace browser alert() calls"; these three pages were missed.
  const { showSuccess } = useToastActions();
  const { t } = useTranslation();
  // Who did it, by name: records store the actor's user id.
  const staffName = useStaffDirectory();
  const { user } = useAuthStore();
  // The directory entry the server's search returned for the chosen patient.
  const [selectedPatientEntry, setSelectedPatientEntry] = useState<PatientDirectoryEntry | null>(null);
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
        setAutopsies((response.reports.items as Record<string, unknown>[]).map(toAutopsy));
      }
    } catch (err) {
      console.error('Error fetching autopsy reports:', err);
      setError(t('docAutopsy.errorLoadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAutopsies();
  }, [fetchAutopsies]);


  const { errors, validate, validateField, clearField } = useValidatedForm(autopsyReportSchema);
  const handleCreateAutopsy = async () => {
    if (isLoading) return;
    // One toast for three fields on a long report form.
    if (!validate(newAutopsy)) {
      return;
    }

    const patient = selectedPatientEntry?.patient_id === newAutopsy.patientId ? selectedPatientEntry : null;
    if (!patient) return;

    const autopsy: AutopsyReport = {
      // The server assigns the id; this used to send `AUT-001` numbered from
      // the length of this page's own list, which every session repeated.
      autopsyId: '',
      patientId: patient.patient_id,
      patientName: patient.full_name,
      autopsyType: newAutopsy.autopsyType,
      dateOfDeath: newAutopsy.dateOfDeath,
      dateOfAutopsy: newAutopsy.dateOfAutopsy,
      timeOfAutopsy: newAutopsy.timeOfAutopsy,
      location: newAutopsy.location,
      prosector: user?.userId ?? '',
      assistant: newAutopsy.assistant || undefined,
      status: 'in-progress',
      circumstances: newAutopsy.circumstances,
      clinicalHistory: newAutopsy.clinicalHistory,
      externalExam: {
        bodyLength: measured(newAutopsy.bodyLength),
        bodyWeight: measured(newAutopsy.bodyWeight),
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
      const response = await createAutopsyReport(autopsy) as { success?: boolean; error?: string; id?: string };
      if (response.success) {
        // Read back rather than insert the local copy: the stored report
        // carries the id the server assigned.
        void fetchAutopsies();
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
        showSuccess(t('docAutopsy.successCreated', { id: response.id ?? '' }));
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
      reviewed: 'bg-surface-sunken text-content-secondary',
    };
    return badges[status];
  };

  const getMannerBadge = (manner: MannerOfDeath) => {
    const badges = {
      natural: 'bg-ok-subtle text-ok-subtle-fg',
      accident: 'bg-caution-subtle text-caution-subtle-fg',
      suicide: 'bg-surface-sunken text-content-secondary',
      homicide: 'bg-critical-subtle text-critical-subtle-fg',
      undetermined: 'bg-surface-sunken text-content-secondary',
      pending: 'bg-notice-subtle text-notice-subtle-fg',
    };
    return badges[manner];
  };

  const formatDate = (isoString: string) => {
    return formatDateOnly(isoString);
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
      <div className="bg-gradient-to-r from-orange-700 to-red-800 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">{t('docAutopsy.title')}</h1>
        <p className="text-white">{t('docAutopsy.subtitle')}</p>
      </div>

      {/* The page already tracked this; it just never showed it. A failed
          save left the screen unchanged, which reads as success. */}
      {error && (
        <Alert variant="error" className="mb-6" onClose={() => setError(null)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void fetchAutopsies()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 min-h-[24px] rounded-lg border border-critical text-critical-subtle-fg hover:bg-critical-subtle disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('common.refresh')}
            </button>
          </div>
        </Alert>
      )}
      {isLoading && (
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-content-muted">
          <LoadingSpinner size="sm" />
          {t('common.loading')}
        </div>
      )}

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'reports' ? 'text-content-secondary border-b-2 border-orange-700' : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docAutopsy.tabAllReports', { count: autopsies.length })}
        </button>
        <button
          onClick={() => setActiveTab('new-report')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new-report' ? 'text-content-secondary border-b-2 border-orange-700' : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docAutopsy.tabNewReport')}
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'pending' ? 'text-content-secondary border-b-2 border-orange-700' : 'text-content-muted hover:text-content-secondary'
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
                <label htmlFor="autopsy-search-term" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.searchLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                  <input id="autopsy-search-term"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docAutopsy.searchPh')}
                    className="w-full pl-10 pr-4 py-2 border border-border-interactive rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.statusLabel')}</label>
                <ChoiceChips
                  label={t('common.filterByStatus')}
                  value={statusFilter}
                  onChange={(next) => { if (next === undefined) return; setStatusFilter(next as AutopsyStatus | 'all'); }}
                  options={[
                    { value: 'all', label: t('docAutopsy.filterAllStatuses') },
                    { value: 'pending', label: t('docAutopsy.status_pending') },
                    { value: 'in-progress', label: t('docAutopsy.status_in-progress') },
                    { value: 'completed', label: t('docAutopsy.status_completed') },
                    { value: 'reviewed', label: t('docAutopsy.status_reviewed') },
                  ]}
                />
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

                <div className="grid grid-cols-3 gap-4 mb-4 bg-surface-sunken rounded-lg p-4">
                  <div>
                    <p className="text-sm text-content-secondary font-semibold mb-1">{t('docAutopsy.lblDeceased')}</p>
                    <p className="font-semibold text-content">{autopsy.patientName}</p>
                    <p className="text-sm"><PatientName id={autopsy.patientId} dobOnly /></p>
                  </div>
                  <div>
                    <p className="text-sm text-content-secondary font-semibold mb-1">{t('docAutopsy.lblDateOfDeath')}</p>
                    <p className="text-sm text-content">{autopsy.dateOfDeath}</p>
                  </div>
                  <div>
                    <p className="text-sm text-content-secondary font-semibold mb-1">{t('docAutopsy.lblAutopsyDate')}</p>
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
                        <span className="text-notice-subtle-fg font-semibold">{t('docAutopsy.lblLength')}</span> {autopsy.externalExam.bodyLength != null ? t('docAutopsy.cmSuffix', { value: autopsy.externalExam.bodyLength }) : t('docAutopsy.notMeasured')}
                      </div>
                      <div>
                        <span className="text-notice-subtle-fg font-semibold">{t('docAutopsy.lblWeight')}</span> {autopsy.externalExam.bodyWeight != null ? t('docAutopsy.kgSuffix', { value: autopsy.externalExam.bodyWeight }) : t('docAutopsy.notMeasured')}
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

                  <div className="bg-surface-sunken border border-purple-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-content-secondary mb-3">{t('docAutopsy.internalExamTitle')}</p>
                    <div className="space-y-2 text-sm">
                      {autopsy.internalExam.cardiovascular && (
                        <div>
                          <span className="text-content-secondary font-semibold flex items-center gap-1">
                            <Heart className="w-4 h-4" /> {t('docAutopsy.lblCardiovascular')}
                          </span>
                          <p className="text-content-secondary ml-5">{autopsy.internalExam.cardiovascular}</p>
                        </div>
                      )}
                      {autopsy.internalExam.respiratory && (
                        <div>
                          <span className="text-content-secondary font-semibold flex items-center gap-1">
                            <Activity className="w-4 h-4" /> {t('docAutopsy.lblRespiratory')}
                          </span>
                          <p className="text-content-secondary ml-5">{autopsy.internalExam.respiratory}</p>
                        </div>
                      )}
                      {autopsy.internalExam.gastrointestinal && (
                        <div>
                          <span className="text-content-secondary font-semibold">{t('docAutopsy.lblGastrointestinal')}</span>
                          <p className="text-content-secondary ml-5">{autopsy.internalExam.gastrointestinal}</p>
                        </div>
                      )}
                      {autopsy.internalExam.nervous && (
                        <div>
                          <span className="text-content-secondary font-semibold flex items-center gap-1">
                            <Brain className="w-4 h-4" /> {t('docAutopsy.lblNervousSystemColon')}
                          </span>
                          <p className="text-content-secondary ml-5">{autopsy.internalExam.nervous}</p>
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
                  <div className="mt-4 bg-surface-sunken border border-purple-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-content-secondary">
                      {t('docAutopsy.reviewedByLine', { name: staffName(autopsy.reviewedBy), date: formatDate(autopsy.reviewDate!) })}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {!error && !isLoading && (activeTab === 'pending' ? pendingAutopsies : filteredAutopsies).length === 0 && (
              <div className="bg-surface-sunken border border-border rounded-lg p-8 text-center">
                <FileText className="w-12 h-12 text-content-muted mx-auto mb-3" />
                <p className="text-content-muted">{t('docAutopsy.noReports')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'new-report' && (
        <form onSubmit={(event) => { event.preventDefault(); void handleCreateAutopsy(); }} noValidate>
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold text-content mb-6">{t('docAutopsy.createTitle')}</h2>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                {/* Searched on the server; the select this replaced listed only
                    the first 50 patients. */}
                <PatientSelect
                  id="autopsy-patient"
                  label={t('docAutopsy.patientLabel')}
                  value={newAutopsy.patientId}
                  onChange={(patientId, patient) => {
                    setNewAutopsy({ ...newAutopsy, patientId });
                    setSelectedPatientEntry(patient ?? null);
                  }}
                  required
                />
              </div>
              <div>
                <ChoiceChips
                  id="autopsy-autopsy-type"
                  label={t('docAutopsy.autopsyTypeLabel')}
                  value={newAutopsy.autopsyType}
                  onChange={(next) => { if (next === undefined) return; setNewAutopsy({ ...newAutopsy, autopsyType: next as AutopsyType }); }}
                  options={[
                    { value: 'hospital', label: t('docAutopsy.type_hospital') },
                    { value: 'forensic', label: t('docAutopsy.type_forensic') },
                    { value: 'clinical', label: t('docAutopsy.type_clinical') },
                  ]}
                />
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.deathInfoTitle')}</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="autopsy-date-of-death" className="block text-sm font-semibold text-content-secondary mb-2">
                    {t('docAutopsy.dateOfDeathLabel')} <span className="text-critical-subtle-fg">*</span>
                  </label>
                  <input id="autopsy-date-of-death"
                    type="date"
                    value={newAutopsy.dateOfDeath}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, dateOfDeath: e.target.value })}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-date-of-autopsy" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.dateOfAutopsyLabel')}</label>
                  <input id="autopsy-date-of-autopsy"
                    type="date"
                    value={newAutopsy.dateOfAutopsy}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, dateOfAutopsy: e.target.value })}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-time-of-autopsy" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.timeOfAutopsyLabel')}</label>
                  <input id="autopsy-time-of-autopsy"
                    type="time"
                    value={newAutopsy.timeOfAutopsy}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, timeOfAutopsy: e.target.value })}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label htmlFor="autopsy-location" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.locationLabel')}</label>
                  <input id="autopsy-location"
                    type="text"
                    value={newAutopsy.location}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, location: e.target.value })}
                    placeholder={t('docAutopsy.locationPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-assistant" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.assistantLabel')}</label>
                  <input id="autopsy-assistant"
                    type="text"
                    value={newAutopsy.assistant}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, assistant: e.target.value })}
                    placeholder={t('docAutopsy.assistantPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.backgroundTitle')}</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="autopsy-circumstances" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.circumstancesLabel')}</label>
                  <textarea id="autopsy-circumstances"
                    value={newAutopsy.circumstances}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, circumstances: e.target.value })}
                    placeholder={t('docAutopsy.circumstancesPh')}
                    rows={3}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-clinical-history" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.clinicalHistoryLabel')}</label>
                  <textarea id="autopsy-clinical-history"
                    value={newAutopsy.clinicalHistory}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, clinicalHistory: e.target.value })}
                    placeholder={t('docAutopsy.clinicalHistoryPh')}
                    rows={3}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.externalExamTitle')}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="autopsy-body-length" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.bodyLengthLabel')}</label>
                  <input id="autopsy-body-length"
                    type="number"
                    value={newAutopsy.bodyLength}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, bodyLength: e.target.value })}
                    placeholder={t('docAutopsy.bodyLengthPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-body-weight" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.bodyWeightLabel')}</label>
                  <input id="autopsy-body-weight"
                    type="number"
                    value={newAutopsy.bodyWeight}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, bodyWeight: e.target.value })}
                    placeholder={t('docAutopsy.bodyWeightPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 mt-4">
                <div>
                  <label htmlFor="autopsy-body-habitus" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.bodyHabitusLabel')}</label>
                  <input id="autopsy-body-habitus"
                    type="text"
                    value={newAutopsy.bodyHabitus}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, bodyHabitus: e.target.value })}
                    placeholder={t('docAutopsy.bodyHabitusPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-rigor-mortis" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.rigorMortisLabel')}</label>
                  <input id="autopsy-rigor-mortis"
                    type="text"
                    value={newAutopsy.rigorMortis}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, rigorMortis: e.target.value })}
                    placeholder={t('docAutopsy.rigorMortisPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-livor-mortis" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.livorMortisLabel')}</label>
                  <input id="autopsy-livor-mortis"
                    type="text"
                    value={newAutopsy.livorMortis}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, livorMortis: e.target.value })}
                    placeholder={t('docAutopsy.livorMortisPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-decomposition" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.decompositionLabel')}</label>
                  <input id="autopsy-decomposition"
                    type="text"
                    value={newAutopsy.decomposition}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, decomposition: e.target.value })}
                    placeholder={t('docAutopsy.decompositionPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-external-injuries" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.externalInjuriesLabel')}</label>
                  <textarea id="autopsy-external-injuries"
                    value={newAutopsy.externalInjuries}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, externalInjuries: e.target.value })}
                    placeholder={t('docAutopsy.externalInjuriesPh')}
                    rows={3}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-identifying-marks" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.identifyingMarksLabel')}</label>
                  <textarea id="autopsy-identifying-marks"
                    value={newAutopsy.identifyingMarks}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, identifyingMarks: e.target.value })}
                    placeholder={t('docAutopsy.identifyingMarksPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.internalExamTitle')}</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="autopsy-cardiovascular" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.cardioSystemLabel')}</label>
                  <textarea id="autopsy-cardiovascular"
                    value={newAutopsy.cardiovascular}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, cardiovascular: e.target.value })}
                    placeholder={t('docAutopsy.cardioPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-respiratory" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.respSystemLabel')}</label>
                  <textarea id="autopsy-respiratory"
                    value={newAutopsy.respiratory}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, respiratory: e.target.value })}
                    placeholder={t('docAutopsy.respPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-gastrointestinal" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.giSystemLabel')}</label>
                  <textarea id="autopsy-gastrointestinal"
                    value={newAutopsy.gastrointestinal}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, gastrointestinal: e.target.value })}
                    placeholder={t('docAutopsy.giPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-hepatobiliary" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.hepatoSystemLabel')}</label>
                  <textarea id="autopsy-hepatobiliary"
                    value={newAutopsy.hepatobiliary}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, hepatobiliary: e.target.value })}
                    placeholder={t('docAutopsy.hepatoPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-genitourinary" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.guSystemLabel')}</label>
                  <textarea id="autopsy-genitourinary"
                    value={newAutopsy.genitourinary}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, genitourinary: e.target.value })}
                    placeholder={t('docAutopsy.guPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-endocrine" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.endoSystemLabel')}</label>
                  <textarea id="autopsy-endocrine"
                    value={newAutopsy.endocrine}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, endocrine: e.target.value })}
                    placeholder={t('docAutopsy.endoPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-musculoskeletal" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.mskSystemLabel')}</label>
                  <textarea id="autopsy-musculoskeletal"
                    value={newAutopsy.musculoskeletal}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, musculoskeletal: e.target.value })}
                    placeholder={t('docAutopsy.mskPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-nervous" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.nervousSystemLabel')}</label>
                  <textarea id="autopsy-nervous"
                    value={newAutopsy.nervous}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, nervous: e.target.value })}
                    placeholder={t('docAutopsy.nervousPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.additionalFindingsTitle')}</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="autopsy-microbiology-findings" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.microFindingsLabel')}</label>
                  <textarea id="autopsy-microbiology-findings"
                    value={newAutopsy.microbiologyFindings}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, microbiologyFindings: e.target.value })}
                    placeholder={t('docAutopsy.microFindingsPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-radiology-findings" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.radFindingsLabel')}</label>
                  <textarea id="autopsy-radiology-findings"
                    value={newAutopsy.radiologyFindings}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, radiologyFindings: e.target.value })}
                    placeholder={t('docAutopsy.radFindingsPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.conclusionsTitle')}</h3>
              <div className="space-y-4">
                <div>
                  {/* The label had no `htmlFor` and the control no `id`, so the
                      two were never associated at all -- a screen reader read
                      an unlabelled text box. `Textarea` renders both. */}
                  <Textarea
                    id="autopsy-cause-of-death"
                    label={t('docAutopsy.lblCauseOfDeath')}
                    value={newAutopsy.causeOfDeath}
                    onChange={(e) => { clearField('causeOfDeath'); setNewAutopsy({ ...newAutopsy, causeOfDeath: e.target.value }); }}
                    onBlur={() => validateField('causeOfDeath', newAutopsy)}
                    error={errors.causeOfDeath}
                    placeholder={t('docAutopsy.causeOfDeathPh')}
                    rows={3}
                    required
                  />
                </div>
                <div>
                  <ChoiceChips
                    id="autopsy-manner-of-death"
                    label={t('docAutopsy.mannerOfDeathLabel')}
                    value={newAutopsy.mannerOfDeath}
                    onChange={(next) => { if (next === undefined) return; setNewAutopsy({ ...newAutopsy, mannerOfDeath: next as MannerOfDeath }); }}
                    options={[
                      { value: 'natural', label: t('docAutopsy.manner_natural') },
                      { value: 'accident', label: t('docAutopsy.manner_accident') },
                      { value: 'suicide', label: t('docAutopsy.manner_suicide') },
                      { value: 'homicide', label: t('docAutopsy.manner_homicide') },
                      { value: 'undetermined', label: t('docAutopsy.manner_undetermined') },
                      { value: 'pending', label: t('docAutopsy.mannerOption_pending') },
                    ]}
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-contributing-factors" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.contributingFactorsLabel')}</label>
                  <textarea id="autopsy-contributing-factors"
                    value={newAutopsy.contributingFactors}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, contributingFactors: e.target.value })}
                    placeholder={t('docAutopsy.contributingFactorsPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-conclusions" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.conclusionsTitle')}</label>
                  <textarea id="autopsy-conclusions"
                    value={newAutopsy.conclusions}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, conclusions: e.target.value })}
                    placeholder={t('docAutopsy.conclusionsPh')}
                    rows={4}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-recommendations" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.recommendationsTitle')}</label>
                  <textarea id="autopsy-recommendations"
                    value={newAutopsy.recommendations}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, recommendations: e.target.value })}
                    placeholder={t('docAutopsy.recommendationsPh')}
                    rows={2}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-content mb-4">{t('docAutopsy.administrativeTitle')}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="autopsy-case-number" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.caseNumberLabel')}</label>
                  <input id="autopsy-case-number"
                    type="text"
                    value={newAutopsy.caseNumber}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, caseNumber: e.target.value })}
                    placeholder={t('docAutopsy.caseNumberPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="autopsy-legal-notification" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.legalNotificationLabel')}</label>
                  <input id="autopsy-legal-notification"
                    type="text"
                    value={newAutopsy.legalNotification}
                    onChange={(e) => setNewAutopsy({ ...newAutopsy, legalNotification: e.target.value })}
                    placeholder={t('docAutopsy.legalNotificationPh')}
                    className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="mt-4">
                <label htmlFor="autopsy-notes" className="block text-sm font-semibold text-content-secondary mb-2">{t('docAutopsy.notesLabel')}</label>
                <textarea id="autopsy-notes"
                  value={newAutopsy.notes}
                  onChange={(e) => setNewAutopsy({ ...newAutopsy, notes: e.target.value })}
                  placeholder={t('docAutopsy.notesPh')}
                  rows={3}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <button type="submit"
              className="w-full bg-orange-700 hover:bg-orange-800 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              {t('docAutopsy.createBtn')}
            </button>
          </div>
        </div>
        </form>
      )}
    </div>
  );
}

export default AutopsyPage;
