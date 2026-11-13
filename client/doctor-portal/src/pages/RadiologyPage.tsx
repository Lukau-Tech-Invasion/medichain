import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Scan, Search, FileText, AlertCircle, Eye, MessageSquare, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import { listRadiology, createRadiologyReport, getApiErrorMessage, useTranslation, Alert, LoadingSpinner, ChoiceChips } from '@medichain/shared';
import { StoredValue } from '../components/StoredSoapDetails';
import { PatientName } from '../components/PatientName';

type ReportStatus = 'pending' | 'in-progress' | 'preliminary' | 'final' | 'addendum';

interface RadiologyStudy {
  id: string;
  accessionNumber: string;
  patientId: string;
  patientName: string;
  mrn: string;
  dob: string;
  modality: string;
  studyDescription: string;
  bodyPart?: string;
  studyDate: string;
  orderCreatedAt: string;
  referringPhysician: string;
  status: ReportStatus;
  priority: 'stat' | 'urgent' | 'routine';
  numImages: number;
  radiologist?: string;
  reportedAt?: string;
  technique?: string;
  comparison?: string;
  findings?: string;
  impression?: string;
  criticalFindings: boolean;
  communicatedTo?: string;
  communicatedAt?: string;
}

/**
 * A finalized or preliminary report as returned by the reports registry. Prior
 * studies are searched over these rather than over the order worklist, because
 * a prior study is only useful for comparison once it has been reported.
 */
interface RadiologyReportRow {
  storedRecord: Record<string, unknown>;
  id: string;
  patientId: string;
  accessionNumber: string;
  bodyPart: string;
  findings: string;
  impression: string;
  status: string;
  criticalFinding: boolean;
  radiologist: string;
  reportedAt: string;
}

/**
 * A study date, or an honest admission that there is not one.
 *
 * `new Date(undefined).toLocaleString()` renders the literal string
 * "Invalid Date" -- which is what the study table showed. That is a JavaScript
 * artefact, not a finding, and a radiologist reading it learns nothing except
 * that the screen is broken.
 */
function formatStudyDate(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '\u2014';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '\u2014' : parsed.toLocaleString();
}

/** Group equivalent recorded modality names for filtering without changing clinical data. */
function modalityFilterValue(value: string): string {
  const modality = value.trim().toUpperCase();
  const aliases: Record<string, string> = {
    XRAY: 'XR', 'X-RAY': 'XR', CR: 'XR', DX: 'XR',
    MR: 'MRI', ULTRASOUND: 'US',
  };
  return aliases[modality] ?? modality;
}

/** Convert the durable order registry fields to the radiology worklist view. */
export function toRadiologyStudy(item: unknown): RadiologyStudy {
  const record = item as Record<string, unknown>;
  return {
    id: (record.order_id || record.orderId || record.id || '') as string,
    accessionNumber: (record.accession_number || record.accessionNumber || '') as string,
    patientId: (record.patient_id || record.patientId || '') as string,
    patientName: (record.patient_name || record.patientName || record.patient_id || record.patientId || '') as string,
    mrn: (record.mrn || '') as string,
    dob: (record.dob || '') as string,
    modality: (record.modality || '') as string,
    studyDescription: (record.study_description || record.studyDescription || record.special_instructions || record.body_part || '') as string,
    bodyPart: String(record.body_part || ''),
    studyDate: (record.study_date || record.studyDate || '') as string,
    orderCreatedAt: String(record.created_at || ''),
    referringPhysician: (record.referring_physician || record.referringPhysician || record.ordering_provider_id || record.ordering_provider || '') as string,
    status: ({ ordered: 'pending', scheduled: 'pending', completed: 'pending', inprogress: 'in-progress' } as Record<string, ReportStatus>)[String(record.status || '').toLowerCase()] || String(record.status || 'pending').toLowerCase() as ReportStatus,
    priority: String(record.priority || 'routine').toLowerCase() as 'stat' | 'urgent' | 'routine',
    numImages: (record.num_images || record.numImages || 0) as number,
    radiologist: record.radiologist as string | undefined,
    reportedAt: record.reported_at || record.reportedAt,
    technique: record.technique,
    comparison: record.comparison,
    findings: record.findings,
    impression: record.impression,
    criticalFindings: (record.critical_findings ?? record.criticalFindings ?? false) as boolean,
    communicatedTo: record.communicated_to || record.communicatedTo,
    communicatedAt: record.communicated_at || record.communicatedAt,
} as RadiologyStudy;
}

const RadiologyPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();
  const [studies, setStudies] = useState<RadiologyStudy[]>([]);
  const [reports, setReports] = useState<RadiologyReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savePending = useRef(false);
  const draftReportId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'worklist' | 'report' | 'search'>('worklist');
  const [selectedStudy, setSelectedStudy] = useState<RadiologyStudy | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [reportSearchTerm, setReportSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterModality, setFilterModality] = useState<string>('all');

  // Report form
  const [technique, setTechnique] = useState('');
  const [studyDateTime, setStudyDateTime] = useState('');
  const [comparison, setComparison] = useState('');
  const [findings, setFindings] = useState('');
  const [impression, setImpression] = useState('');
  const [criticalFindings, setCriticalFindings] = useState(false);
  const [communicatedTo, setCommunicatedTo] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // The patient roster was fetched here, stored in state and never read.
      // Dropping the call is not only tidier: `GET /api/patients` decrypts and
      // returns PHI, and every such read is logged against the caller. This
      // page shows radiology orders, which carry their own patient ids.
      const radiologyData = await listRadiology();
      
      // Map API response (orders.items) to RadiologyStudy interface
      const orderItems = radiologyData.orders?.items || [];
      const mappedStudies = orderItems.map(toRadiologyStudy);
      
      setStudies(mappedStudies);

      const reportItems = radiologyData.reports?.items || [];
      setReports(reportItems.map((item) => {
        const r = item as Record<string, unknown>;
        const impression = r.impression;
        return {
          storedRecord: r,
          id: (r.id || r.report_id || '') as string,
          patientId: (r.patient_id || '') as string,
          accessionNumber: (r.accession_number || '') as string,
          bodyPart: (r.body_part || '') as string,
          findings: (r.findings || '') as string,
          // The backend stores the impression as discrete statements; join them
          // back for display and for the free-text search below.
          impression: Array.isArray(impression)
            ? impression.join('\n')
            : ((impression || '') as string),
          status: (r.status || '') as string,
          criticalFinding: Boolean(r.critical_finding),
          radiologist: (r.radiologist_id || r.radiologist || '') as string,
          reportedAt: (r.created_at || r.final_time || '') as string,
        };
      }));
    } catch (err) {
      console.warn('Radiology registry read failed');
      setError(getApiErrorMessage(err, t('docRadiology.failFetch')));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const selectStudyForReading = (study: RadiologyStudy) => {
    if (savePending.current) return;
    draftReportId.current = null;
    setSaveError(null);
    setStudyDateTime('');
    setSelectedStudy(study);
    setTechnique(study.technique || '');
    setComparison(study.comparison || '');
    setFindings(study.findings || '');
    setImpression(study.impression || '');
    setCriticalFindings(study.criticalFindings);
    setCommunicatedTo(study.communicatedTo || '');
    setActiveTab('report');
  };

  /**
   * Maps a worklist modality string onto the backend's `RadiologyStudyType`
   * variant. Unrecognized values remain unsupported rather than being recategorized.
   */
  type StudyType = Parameters<typeof createRadiologyReport>[0]['study_type'];
  const studyTypeFor = (modality: string): StudyType | undefined => {
    const m = modality.trim().toUpperCase();
    const map: Record<string, StudyType> = {
      'XR': 'XRay', 'X-RAY': 'XRay', 'XRAY': 'XRay', 'CR': 'XRay', 'DX': 'XRay',
      'CT': 'CT', 'MR': 'MRI', 'MRI': 'MRI',
      'US': 'Ultrasound', 'ULTRASOUND': 'Ultrasound',
      'NM': 'Nuclear', 'NUCLEAR': 'Nuclear',
      'PT': 'PET', 'PET': 'PET',
      'RF': 'Fluoroscopy', 'FLUOROSCOPY': 'Fluoroscopy',
      'MG': 'Mammography', 'MAMMOGRAPHY': 'Mammography',
      'XA': 'Angiography', 'ANGIOGRAPHY': 'Angiography',
    };
    return map[m];
  };

  /** Keep report errors beside the retained draft and in the notification stream. */
  const showReportError = (message: string) => { setSaveError(message); showError(message); };

  const saveReport = async (asFinal: boolean) => {
    if (isSaving) return;
    if (savePending.current || !selectedStudy) return;
    const studyType = studyTypeFor(selectedStudy.modality);
    if (!studyType) { showReportError(t('docRadiology.unsupportedModality')); return; }
    const acquisitionTime = studyDateTime ? Math.floor(new Date(studyDateTime).getTime() / 1000) : null;
    if (acquisitionTime !== null && !Number.isFinite(acquisitionTime)) {
      showReportError(t('docRadiology.invalidStudyTime')); return;
    }
    if (criticalFindings && !communicatedTo) {
      showReportError(t('docRadiology.criticalCommunicate'));
      return;
    }

    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const radiologist = user?.userId || '';
    // Retain the identifier after an uncertain response so retry cannot create a second record.
    draftReportId.current ??= `RAD-RPT-${now.getTime()}`;

    // This used to mutate local state and announce success without calling the
    // API at all: a radiologist could dictate findings, finalize the report,
    // see "Saved as FINAL", and lose every word of it on reload. The report is
    // now persisted first, and the worklist only advances once the server has
    // accepted it.
    savePending.current = true;
    setSaveError(null);
    setIsSaving(true);
    try {
      await createRadiologyReport({
        report_id: draftReportId.current,
        patient_id: selectedStudy.patientId,
        order_id: selectedStudy.id,
        accession_number: selectedStudy.accessionNumber,
        study_type: studyType,
        body_part: selectedStudy.bodyPart || selectedStudy.studyDescription || '',
        study_datetime: acquisitionTime,
        technique,
        contrast: null,
        comparison: comparison || null,
        clinical_history: '',
        findings,
        // The backend models the impression as discrete statements; split on
        // lines so a multi-point impression is stored as multiple points
        // rather than one blob.
        impression: impression
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean),
        recommendations: null,
        critical_finding: criticalFindings,
        critical_communicated: criticalFindings
          ? {
              communicated_to: communicatedTo,
              communicated_by: radiologist,
              communication_time: nowSeconds,
              method: 'verbal',
              read_back: false,
            }
          : null,
        radiologist,
        status: asFinal ? 'Final' : 'Preliminary',
        preliminary_time: asFinal ? null : nowSeconds,
        final_time: asFinal ? nowSeconds : null,
        dicom_study_uid: null,
        image_ipfs_hash: null,
      });

      const updatedStudy: RadiologyStudy = {
        ...selectedStudy,
        technique, comparison, findings, impression, criticalFindings,
        communicatedTo: criticalFindings ? communicatedTo : undefined,
        communicatedAt: criticalFindings ? now.toISOString() : undefined,
        status: asFinal ? 'final' : 'preliminary',
        radiologist,
        reportedAt: now.toISOString()
      };
      setStudies(studies.map(s => s.id === selectedStudy.id ? updatedStudy : s));
      showSuccess(t('docRadiology.savedAs', { status: asFinal ? t('docRadiology.statusFinalUpper') : t('docRadiology.statusPrelimUpper') }));
      setSelectedStudy(null);
      draftReportId.current = null;
      setActiveTab('worklist');
      // Re-read so the worklist reflects what the server actually stored.
      fetchData();
    } catch (err) {
      console.warn('Radiology report write failed');
      showReportError(getApiErrorMessage(err, t('docRadiology.failSaveReport')));
    } finally {
      savePending.current = false;
      setIsSaving(false);
    }
  };

  const getStatusBadge = (status: ReportStatus) => {
    const styles: Record<ReportStatus, string> = {
      pending: 'bg-critical-subtle text-critical-subtle-fg',
      'in-progress': 'bg-caution-subtle text-caution-subtle-fg',
      preliminary: 'bg-surface-sunken text-content-secondary',
      final: 'bg-ok-subtle text-ok-subtle-fg',
      addendum: 'bg-notice-subtle text-notice-subtle-fg'
    };
    return styles[status];
  };

  const statusLabel = (status: ReportStatus): string => {
    switch (status) {
      case 'pending': return t('docRadiology.statusPending');
      case 'in-progress': return t('docRadiology.statusInProgress');
      case 'preliminary': return t('docRadiology.statusPreliminary');
      case 'final': return t('docRadiology.statusFinal');
      case 'addendum': return t('docRadiology.statusAddendum');
    }
  };

  const priorityLabel = (priority: 'stat' | 'urgent' | 'routine'): string => {
    switch (priority) {
      case 'stat': return t('docRadiology.priorityStat');
      case 'urgent': return t('docRadiology.priorityUrgent');
      case 'routine': return t('docRadiology.priorityRoutine');
    }
  };

  const filteredStudies = studies.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false;
    if (filterModality !== 'all' && modalityFilterValue(s.modality) !== filterModality) return false;
    if (searchTerm && !s.patientName.toLowerCase().includes(searchTerm.toLowerCase())
        && !s.accessionNumber.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // Prior-studies search. An empty term lists the most recent reports rather
  // than nothing, so the tab is useful before the radiologist types anything.
  const matchingReports = (() => {
    const term = reportSearchTerm.trim().toLowerCase();
    if (!term) return reports.slice(0, 25);
    return reports.filter(r =>
      r.patientId.toLowerCase().includes(term)
      || r.accessionNumber.toLowerCase().includes(term)
      || r.bodyPart.toLowerCase().includes(term)
      || r.impression.toLowerCase().includes(term)
      || r.findings.toLowerCase().includes(term)
    );
  })();

  return (
    // `dark`: the reading room is dark in either theme, so the shared controls
    // inside it take their dark-theme tokens rather than light text on near-black.
    <div className="dark min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scan className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold">{t('docRadiology.title')}</h1>
              <p className="text-gray-300 text-sm">{t('docRadiology.subtitle')}</p>
            </div>
          </div>
          <div className="text-sm text-gray-300">
            {t('docRadiology.radiologistLabel', { name: user?.userId || t('docRadiology.notLoggedIn') })}
          </div>
        </div>
      </div>

      {/* Registry read failures must remain distinguishable from an empty worklist. */}
      {error && (
        <Alert variant="error" className="mb-6" onClose={() => setError(null)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void fetchData()}
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
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-gray-300">
          <LoadingSpinner size="sm" />
          {t('common.loading')}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="flex">
          {[{ id: 'worklist', label: t('docRadiology.tabWorklist'), icon: FileText },
            { id: 'report', label: t('docRadiology.tabReport'), icon: MessageSquare },
            { id: 'search', label: t('docRadiology.tabSearch'), icon: Search }].map(tab => (
            <button
              key={tab.id}
              disabled={isSaving}
              onClick={() => { if (!savePending.current) setActiveTab(tab.id as 'worklist' | 'report' | 'search'); }}
              className={`px-6 py-3 font-medium flex items-center gap-2 ${activeTab === tab.id
                ? 'text-blue-400 border-b-2 border-notice'
                : 'text-gray-300 hover:text-gray-200'}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {activeTab === 'worklist' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-4 items-center flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-64">
                <Search className="w-5 h-5 text-gray-300" />
                <input aria-label={t('docRadiology.searchPlaceholder')}
                  type="text"
                  placeholder={t('docRadiology.searchPlaceholder')}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded p-2 text-white placeholder:text-gray-400"
                />
              </div>
              <ChoiceChips
                label={t('docRadiology.orderStatus')}
                value={filterStatus}
                onChange={(next) => { if (next === undefined) return; setFilterStatus(next); }}
                options={[
                  { value: 'all', label: t('docRadiology.allStatus') },
                  { value: 'pending', label: t('docRadiology.filterPending') },
                  { value: 'in-progress', label: t('docRadiology.filterInProgress') },
                  { value: 'preliminary', label: t('docRadiology.filterPreliminary') },
                  { value: 'final', label: t('docRadiology.filterFinal') },
                ]}
              />
              <ChoiceChips
                label={t('docRadiology.modality')}
                value={filterModality}
                onChange={(next) => { if (next === undefined) return; setFilterModality(next); }}
                options={[
                  { value: 'all', label: t('docRadiology.allModalities') },
                  { value: 'CT', label: 'CT' },
                  { value: 'MRI', label: 'MRI' },
                  { value: 'XR', label: t('docRadiology.modalityXray') },
                  { value: 'US', label: t('docRadiology.modalityUltrasound') },
                ]}
              />
            </div>

            {/* Studies Table */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="p-3 text-left">{t('docRadiology.colPriority')}</th>
                    <th className="p-3 text-left">{t('docRadiology.colPatient')}</th>
                    <th className="p-3 text-left">{t('docRadiology.colStudy')}</th>
                    <th className="p-3 text-center">{t('docRadiology.colImages')}</th>
                    <th className="p-3 text-left">{t('docRadiology.orderCreated')}</th>
                    <th className="p-3 text-left">{t('docRadiology.orderStatus')}</th>
                    <th className="p-3 text-center">{t('docRadiology.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudies.map(s => (
                    <tr key={s.id} className={`border-b border-gray-700 hover:bg-gray-700 ${s.priority === 'stat' ? 'bg-red-900/20' : ''}`}>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          // Each background carries its own paired foreground.
                          // The badge used to inherit the page's `text-white`,
                          // and `--danger` is red-400 in dark mode, so the STAT
                          // badge -- the one that matters most -- was 2.77:1.
                          // `bg-orange-500` is raw Tailwind and would have been
                          // 2.8:1 the first time an urgent study existed.
                          s.priority === 'stat' ? 'bg-critical text-critical-fg' :
                          s.priority === 'urgent' ? 'bg-caution text-caution-fg' : 'bg-gray-600 text-white'
                        }`}>
                          {priorityLabel(s.priority)}
                        </span>
                      </td>
                      <td className="p-3">
                        <div>{s.patientName}</div>
                        <div className="text-xs text-gray-300">{t('docRadiology.mrnDob', {
                          mrn: s.mrn || t('docRadiology.notRecorded'), dob: s.dob || t('docRadiology.notRecorded'),
                        })}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="bg-blue-600 px-2 py-0.5 rounded text-xs">{s.modality}</span>
                          {s.studyDescription}
                        </div>
                      </td>
                      <td className="p-3 text-center">{s.numImages}</td>
                      <td className="p-3 text-gray-300">{formatStudyDate(s.orderCreatedAt)}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs ${getStatusBadge(s.status)}`}>
                          {statusLabel(s.status)}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex gap-2 justify-center">
                          {/* No image store exists: a study row carries a count of
                              images and no reference to any of them. The control
                              says so instead of answering a click with nothing. */}
                          <button
                            type="button"
                            disabled
                            className="p-2 bg-gray-700 rounded opacity-60 cursor-not-allowed"
                            title={t('docRadiology.imagesNotStored')}
                            aria-label={t('docRadiology.imagesNotStored')}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => selectStudyForReading(s)}
                            className="p-2 bg-blue-600 rounded hover:bg-blue-500"
                            title={t('docRadiology.readStudy')}
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'report' && selectedStudy && (
          <form onSubmit={(event) => { event.preventDefault(); void saveReport(false); }} noValidate>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Study Info */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h2 className="font-semibold mb-3 text-blue-400">{t('docRadiology.studyInfo')}</h2>
              <div className="space-y-2 text-sm">
                <p><strong>{t('docRadiology.lblPatient')}</strong> {selectedStudy.patientName}</p>
                <p><strong>{t('docRadiology.lblMrn')}</strong> {selectedStudy.mrn || t('docRadiology.notRecorded')} | <strong>{t('docRadiology.lblDob')}</strong> {selectedStudy.dob || t('docRadiology.notRecorded')}</p>
                <p><strong>{t('docRadiology.lblStudy')}</strong> {selectedStudy.studyDescription}</p>
                <p><strong>{t('docRadiology.lblAccession')}</strong> {selectedStudy.accessionNumber}</p>
                <p><strong>{t('docRadiology.lblDate')}</strong> {formatStudyDate(selectedStudy.studyDate)}</p>
                <p><strong>{t('docRadiology.orderCreated')}</strong> {formatStudyDate(selectedStudy.orderCreatedAt)}</p>
                <p><strong>{t('docRadiology.lblReferring')}</strong> {selectedStudy.referringPhysician}</p>
                <p><strong>{t('docRadiology.lblImages')}</strong> {selectedStudy.numImages}</p>
              </div>
              <div className="mt-4 p-3 bg-gray-900 rounded text-center text-gray-300">
                {t('docRadiology.dicomPlaceholder')}<br />
                {t('docRadiology.dicomHint')}
              </div>
            </div>

            {/* Report Form */}
            <fieldset disabled={isSaving} aria-label={t('docRadiology.reportTitle')} className="min-w-0 bg-gray-800 rounded-lg p-4 space-y-4">
              <h2 className="font-semibold text-blue-400">{t('docRadiology.reportTitle')}</h2>
              {saveError && <p role="alert" className="text-critical whitespace-pre-wrap">{saveError}</p>}
              <div>
                <label htmlFor="rad-study-datetime" className="text-sm text-gray-300">{t('docRadiology.acquisitionTime')}</label>
                <input id="rad-study-datetime" type="datetime-local" value={studyDateTime}
                  onChange={event => setStudyDateTime(event.target.value)}
                  aria-describedby="rad-study-time-hint" className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white" />
                <p id="rad-study-time-hint" className="text-sm text-gray-300">{t('docRadiology.acquisitionTimeHint')}</p>
              </div>
              <div>
                <label htmlFor="rad-technique" className="text-sm text-gray-300">{t('docRadiology.technique')}</label>
                <textarea
                  id="rad-technique"
                  value={technique}
                  onChange={e => setTechnique(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded p-2 h-16 text-white placeholder:text-gray-400"
                  placeholder={t('docRadiology.techniquePlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="rad-comparison" className="text-sm text-gray-300">{t('docRadiology.comparison')}</label>
                <input
                  id="rad-comparison"
                  type="text"
                  value={comparison}
                  onChange={e => setComparison(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white placeholder:text-gray-400"
                  placeholder={t('docRadiology.comparisonPlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="rad-findings" className="text-sm text-gray-300">{t('docRadiology.findings')}</label>
                <textarea
                  id="rad-findings"
                  value={findings}
                  onChange={e => setFindings(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded p-2 h-32 text-white placeholder:text-gray-400"
                  placeholder={t('docRadiology.findingsPlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="rad-impression" className="text-sm text-gray-300">{t('docRadiology.impression')}</label>
                <textarea
                  id="rad-impression"
                  value={impression}
                  onChange={e => setImpression(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded p-2 h-20 text-white placeholder:text-gray-400"
                  placeholder={t('docRadiology.impressionPlaceholder')}
                />
              </div>

              {/* Critical Findings */}
              <div className={`p-3 rounded ${criticalFindings ? 'bg-red-900/50 border border-red-500' : 'bg-gray-900'}`}>
                <label htmlFor="rad-critical-finding" className="flex items-center gap-2">
                  <input
                    id="rad-critical-finding"
                    type="checkbox"
                    checked={criticalFindings}
                    onChange={e => setCriticalFindings(e.target.checked)}
                  />
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span className="text-red-400 font-medium">{t('docRadiology.criticalFinding')}</span>
                </label>
                {criticalFindings && (
                  <div className="mt-2">
                    <label htmlFor="rad-communicated-to" className="text-sm text-gray-300">{t('docRadiology.communicatedTo')}</label>
                    <input
                      id="rad-communicated-to"
                      type="text"
                      value={communicatedTo}
                      onChange={e => setCommunicatedTo(e.target.value)}
                      className="w-full bg-gray-800 border border-red-500 rounded p-2 text-white placeholder:text-gray-400"
                      placeholder={t('docRadiology.communicatedPlaceholder')}
                    />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button type="submit"
                  aria-disabled={isSaving || undefined}
                  className="aria-disabled:cursor-wait flex-1 py-2 bg-orange-700 text-white rounded hover:bg-orange-800"
                >
                  {isSaving ? t('docRadiology.saving') : t('docRadiology.savePreliminary')}
                </button>
                <button type="button"
                  onClick={() => saveReport(true)}
                  disabled={isSaving}
                  className="flex-1 py-2 bg-ok text-ok-fg rounded hover:bg-green-500 disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
                >
                  {isSaving ? t('docRadiology.saving') : t('docRadiology.finalizeReport')}
                </button>
              </div>
            </fieldset>
          </div>
          </form>
        )}

        {activeTab === 'report' && !selectedStudy && (
          <div className="text-center py-12 text-gray-300">
            {t('docRadiology.selectStudy')}
          </div>
        )}

        {activeTab === 'search' && (
          <div className="bg-gray-800 rounded-lg p-4 space-y-4">
            <div>
              <label htmlFor="rad-prior-search" className="block text-sm text-gray-300 mb-1">
                {t('docRadiology.searchPriorsLabel')}
              </label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-gray-300" />
                <input
                  id="rad-prior-search"
                  type="search"
                  value={reportSearchTerm}
                  onChange={e => setReportSearchTerm(e.target.value)}
                  placeholder={t('docRadiology.searchPriorsPlaceholder')}
                  className="w-full bg-gray-900 border border-gray-700 rounded pl-9 pr-3 py-2 text-white placeholder:text-gray-400"
                />
              </div>
            </div>

            {!error && !isLoading && matchingReports.length === 0 ? (
              <p className="text-gray-300 py-6 text-center">
                {reportSearchTerm
                  ? t('docRadiology.searchPriorsNoMatch')
                  : t('docRadiology.searchPriorsEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-gray-700">
                {matchingReports.map(r => (
                  <li key={r.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-white truncate">
                          {r.bodyPart || r.accessionNumber || r.id}
                        </p>
                        <p className="text-sm text-gray-300 truncate">
                          <PatientName id={r.patientId} inherit /> · {r.accessionNumber}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {r.criticalFinding && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-critical-subtle text-critical-subtle-fg">
                            <AlertCircle className="w-3 h-3" />
                            {t('docRadiology.criticalBadge')}
                          </span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-200">
                          {r.status}
                        </span>
                      </div>
                    </div>
                    {r.impression && (
                      <p className="mt-1 text-sm text-gray-300 whitespace-pre-line">
                        {r.impression}
                      </p>
                    )}
                    <details className="mt-3 border border-border-interactive rounded-lg p-3 text-sm text-content">
                      <summary className="cursor-pointer font-medium">{t('docRadiology.readSavedReport')}</summary>
                      <div className="mt-3"><StoredValue value={r.storedRecord} /></div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RadiologyPage;
