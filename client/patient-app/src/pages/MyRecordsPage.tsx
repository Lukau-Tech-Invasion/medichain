import { useState, useEffect } from 'react';
import { apiUrl, getApiClient, useTranslation } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import {
  FileText,
  Download,
  Eye,
  Calendar,
  User,
  Search,
  ChevronRight,
  X,
  FlaskConical,
  Image,
  Pill,
  Stethoscope,
  FileCheck,
  Syringe,
  Clock,
  Shield,
  CheckCircle,
} from 'lucide-react';
import type { LabResultSubmission } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

interface MedicalRecord {
  id: string;
  type: 'lab_result' | 'imaging' | 'prescription' | 'consultation' | 'discharge_summary' | 'vaccination' | 'other';
  title: string;
  description: string;
  provider: string;
  date: string;
  contentHash: string;
  metadataHash: string;
  verified: boolean;
  // Lab result specific fields (optional)
  labResults?: Array<{
    parameter: string;
    value: string;
    unit: string;
    reference_range: string;
    flag?: string;
  }>;
  reviewedBy?: string;
}

interface SoapNoteResponse {
  notes?: Array<{
    note_id: string;
    author_id?: string;
    created_at?: number;
    assessment?: {
      /**
       * A structured diagnosis, NOT a bare string: the API returns
       * `{ description, icd10_code, status }`. Typing it as a string here is
       * what let an object reach `title.toLowerCase()` and blank the whole app.
       */
      primary_diagnosis?: { description?: string; icd10_code?: string | null; status?: string };
      clinical_summary?: string;
    };
  }>;
}

interface PrescriptionResponse {
  prescriptions?: Array<{
    prescription_id: string;
    medication_name?: string;
    prescriber_id?: string;
    created_at?: number | string;
    dosage?: string;
    directions?: string;
  }>;
}

interface TriageResponse {
  assessments?: Array<{
    assessment_id: string;
    chief_complaint?: string;
    performed_by?: string;
    performed_at?: number;
    esi_level?: string;
  }>;
}

function timestampDate(value?: number | string): string {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0];
}

function medicalRecordType(value: string): MedicalRecord['type'] {
  const supported: MedicalRecord['type'][] = [
    'lab_result', 'imaging', 'prescription', 'consultation',
    'discharge_summary', 'vaccination', 'other',
  ];
  return supported.includes(value as MedicalRecord['type'])
    ? value as MedicalRecord['type']
    : 'other';
}

async function fetchJson(url: string, headers: HeadersInit): Promise<Record<string, unknown>> {
  const response = await fetch(apiUrl(url), { headers });
  return response.ok ? response.json() : {};
}

/**
 * My Records Page
 * 
 * View and download medical records stored on IPFS.
 * Records are encrypted and blockchain-verified.
 * 
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function MyRecordsPage() {
  const { t } = useTranslation();
  const { showError } = useToastActions();
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const patient = usePatientAuthStore(state => state.patient);

  useEffect(() => {
    loadRecords();
  }, [patient?.healthId]);

  const loadRecords = async () => {
    setIsLoading(true);
    
    if (!patient) {
      setRecords([]);
      setIsLoading(false);
      return;
    }

    const patientId = patient.healthId;
    const headers = {
      ...getApiClient().getSessionHeaders(patient.walletAddress),
      'X-Health-Id': patientId,
    };
    
    // Fetch records from API
    const allRecords: MedicalRecord[] = [];
    
    try {
      const [
        labData,
        genericData,
        soapData,
        prescriptionData,
        triageData,
        hpData,
        progressData,
        woundData,
        vitalsData,
      ] = await Promise.all([
        fetchJson(`/api/lab/patient/${patientId}`, headers),
        fetchJson(`/api/records/${patientId}`, headers),
        fetchJson(`/api/clinical/patient/${patientId}/soap`, headers),
        fetchJson(`/api/e-prescriptions/patient/${patientId}`, headers),
        fetchJson(`/api/clinical/patient/${patientId}/triage`, headers),
        // A History & Physical, a progress note, a wound assessment and a
        // vitals reading are all written about the patient, and none of them
        // were reachable from this page before.
        fetchJson(`/api/clinical/patient/${patientId}/history-physicals`, headers),
        fetchJson(`/api/clinical/patient/${patientId}/progress-notes`, headers),
        fetchJson(`/api/clinical/patient/${patientId}/wounds`, headers),
        fetchJson(`/api/clinical/patient/${patientId}/vitals`, headers),
      ]);

      const labRecords = ((labData.submissions as LabResultSubmission[] | undefined) || []).map(sub => ({
          id: sub.id,
          type: 'lab_result' as const,
          title: sub.test_name,
          description: `${sub.test_category} - ${sub.results.length} parameter(s)`,
          provider: sub.reviewed_by || sub.submitted_by,
          date: new Date(sub.reviewed_at || sub.submitted_at).toISOString().split('T')[0],
          contentHash: sub.content_hash || `lab-${sub.id}`,
          metadataHash: sub.metadata_hash || `meta-${sub.id}`,
          verified: true,
          labResults: sub.results,
          reviewedBy: sub.reviewed_by,
      }));
      allRecords.push(...labRecords);

      const medRecords = ((genericData.records as Array<{
          content_hash: string;
          metadata_hash: string;
          record_type: string;
          uploaded_at: number;
        }> | undefined) || []).map(rec => ({
          id: rec.content_hash,
          type: medicalRecordType(rec.record_type),
          title: rec.record_type.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          description: t('records.defaultDescription'),
          provider: 'MediChain',
          date: rec.uploaded_at ? new Date(rec.uploaded_at * 1000).toISOString().split('T')[0] : '',
          contentHash: rec.content_hash,
          metadataHash: rec.metadata_hash,
          verified: true,
      }));
      allRecords.push(...medRecords);

      const soapRecords = ((soapData as SoapNoteResponse).notes || []).map(note => ({
        id: note.note_id,
        type: 'consultation' as const,
        title: note.assessment?.primary_diagnosis?.description || 'SOAP Consultation',
        description: note.assessment?.clinical_summary || 'Clinical consultation note',
        provider: note.author_id || 'MediChain provider',
        date: timestampDate(note.created_at),
        contentHash: `soap-${note.note_id}`,
        metadataHash: note.note_id,
        verified: true,
      }));
      allRecords.push(...soapRecords);

      const prescriptionRecords = ((prescriptionData as PrescriptionResponse).prescriptions || []).map(rx => ({
        id: rx.prescription_id,
        type: 'prescription' as const,
        title: rx.medication_name || 'Prescription',
        description: [rx.dosage, rx.directions].filter(Boolean).join(' — ') || 'Electronic prescription',
        provider: rx.prescriber_id || 'MediChain provider',
        date: timestampDate(rx.created_at),
        contentHash: `rx-${rx.prescription_id}`,
        metadataHash: rx.prescription_id,
        verified: true,
      }));
      allRecords.push(...prescriptionRecords);

      const triageRecords = ((triageData as TriageResponse).assessments || []).map(assessment => ({
        id: assessment.assessment_id,
        type: 'consultation' as const,
        title: 'Triage Assessment',
        description: [assessment.chief_complaint, assessment.esi_level].filter(Boolean).join(' — '),
        provider: assessment.performed_by || 'MediChain provider',
        date: timestampDate(assessment.performed_at),
        contentHash: `triage-${assessment.assessment_id}`,
        metadataHash: assessment.assessment_id,
        verified: true,
      }));
      allRecords.push(...triageRecords);

      const hpRecords = (((hpData as { history_physicals?: Array<Record<string, unknown>> })
        .history_physicals) || []).map(hp => ({
        id: String(hp.id),
        type: 'consultation' as const,
        title: `History & Physical${hp.exam_type ? ` (${hp.exam_type})` : ''}`,
        description: String(hp.chief_complaint || 'Comprehensive evaluation'),
        provider: String(hp.performed_by || 'MediChain provider'),
        date: timestampDate(hp.performed_at as string | number | undefined),
        contentHash: `hp-${hp.id}`,
        metadataHash: String(hp.id),
        verified: true,
      }));
      allRecords.push(...hpRecords);

      const progressRecords = (((progressData as { progress_notes?: Array<Record<string, unknown>> })
        .progress_notes) || []).map(note => ({
        id: String(note.id),
        type: 'consultation' as const,
        title: `Progress note${note.note_type ? ` (${note.note_type})` : ''}`,
        description: String(note.assessment || 'Clinical progress note'),
        provider: String(note.created_by || 'MediChain provider'),
        date: timestampDate(note.created_at as string | number | undefined),
        contentHash: `progress-${note.id}`,
        metadataHash: String(note.id),
        verified: true,
      }));
      allRecords.push(...progressRecords);

      const woundRecords = (((woundData as { wounds?: Array<Record<string, unknown>> })
        .wounds) || []).map(wound => ({
        id: String(wound.id),
        type: 'consultation' as const,
        title: `Wound assessment - ${wound.wound_location || 'site not recorded'}`,
        description: String(wound.wound_type || 'Wound assessment'),
        provider: String(wound.assessed_by || 'MediChain provider'),
        date: timestampDate(wound.assessed_at as string | number | undefined),
        contentHash: `wound-${wound.id}`,
        metadataHash: String(wound.id),
        verified: true,
      }));
      allRecords.push(...woundRecords);

      const vitalsRecords = (((vitalsData as { vital_signs?: Array<Record<string, unknown>>; vitals?: Array<Record<string, unknown>> })
        .vital_signs || (vitalsData as { vitals?: Array<Record<string, unknown>> }).vitals) || []).map(v => ({
        id: String(v.id),
        type: 'lab_result' as const,
        title: 'Vital signs',
        description: [
          v.heart_rate ? `HR ${v.heart_rate}` : null,
          v.blood_pressure_systolic && v.blood_pressure_diastolic
            ? `BP ${v.blood_pressure_systolic}/${v.blood_pressure_diastolic}`
            : null,
          v.temperature ? `${Number(v.temperature).toFixed(1)} C` : null,
        ].filter(Boolean).join(' · ') || 'Recorded observations',
        provider: String(v.recorded_by || 'MediChain provider'),
        date: timestampDate(v.recorded_at as string | number | undefined),
        contentHash: `vitals-${v.id}`,
        metadataHash: String(v.id),
        verified: true,
      }));
      allRecords.push(...vitalsRecords);
    } catch (error) {
      console.error('Failed to fetch records:', error);
    }

    // Sort by date descending
    allRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setRecords(allRecords);
    setIsLoading(false);
  };

  const getRecordIcon = (type: string) => {
    switch (type) {
      case 'lab_result':
        return <FlaskConical className="w-5 h-5" />;
      case 'imaging':
        return <Image className="w-5 h-5" />;
      case 'prescription':
        return <Pill className="w-5 h-5" />;
      case 'consultation':
        return <Stethoscope className="w-5 h-5" />;
      case 'discharge_summary':
        return <FileCheck className="w-5 h-5" />;
      case 'vaccination':
        return <Syringe className="w-5 h-5" />;
      default:
        return <FileText className="w-5 h-5" />;
    }
  };

  const getRecordColor = (type: string) => {
    switch (type) {
      case 'lab_result':
        return 'bg-info-light text-info';
      case 'imaging':
        return 'bg-surface-sunken text-content-secondary';
      case 'prescription':
        return 'bg-success-50 text-success-600';
      case 'consultation':
        return 'bg-brand-subtle text-brand';
      case 'discharge_summary':
        return 'bg-warning-50 text-warning-600';
      case 'vaccination':
        return 'bg-emergency-50 text-critical-subtle-fg';
      default:
        return 'bg-surface-sunken text-content-muted';
    }
  };

  const formatRecordType = (type: string) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  // Localized label for a record type code, falling back to the formatted code.
  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      lab_result: t('records.typeLabResult'),
      imaging: t('records.typeImaging'),
      prescription: t('records.typePrescription'),
      consultation: t('records.typeConsultation'),
      discharge_summary: t('records.typeDischarge'),
      vaccination: t('records.typeVaccination'),
      other: t('records.typeOther'),
    };
    return map[type] || formatRecordType(type);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  /**
   * In-app preview of a record's contents.
   *
   * The View button used to have no `onClick` at all - it rendered, took the
   * click and did nothing. Viewing goes through the same authorised download
   * endpoint as the Download button; the difference is only that the bytes are
   * shown here instead of being written to a file.
   */
  const [preview, setPreview] = useState<{
    title: string;
    kind: 'text' | 'image' | 'pdf' | 'unsupported';
    text?: string;
    url?: string;
    contentType: string;
  } | null>(null);
  const [isViewing, setIsViewing] = useState<string | null>(null);

  /** Revoke the object URL when the preview closes, so blobs are not leaked. */
  const closePreview = () => {
    setPreview(current => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const handleView = async (record: MedicalRecord) => {
    setIsViewing(record.id);
    try {
      const response = await fetch(apiUrl(`/api/records/${record.contentHash}/download`), {
        headers: {
          ...getApiClient().getSessionHeaders(patient?.walletAddress),
          'X-Health-Id': patient?.healthId || '',
        },
      });
      if (!response.ok) {
        showError(t('records.viewFailed', { title: record.title }));
        return;
      }
      const contentType = response.headers.get('content-type') || '';
      const blob = await response.blob();

      if (contentType.startsWith('text/') || contentType.includes('json')) {
        setPreview({
          title: record.title,
          kind: 'text',
          text: await blob.text(),
          contentType,
        });
      } else if (contentType.startsWith('image/')) {
        setPreview({
          title: record.title,
          kind: 'image',
          url: URL.createObjectURL(blob),
          contentType,
        });
      } else if (contentType.includes('pdf')) {
        setPreview({
          title: record.title,
          kind: 'pdf',
          url: URL.createObjectURL(blob),
          contentType,
        });
      } else {
        // Say so rather than rendering bytes as mojibake; Download still works.
        setPreview({ title: record.title, kind: 'unsupported', contentType });
      }
    } catch {
      showError(t('records.viewError', { title: record.title }));
    } finally {
      setIsViewing(null);
    }
  };

  const handleDownload = async (record: MedicalRecord) => {
    setIsDownloading(record.id);
    try {
      const response = await fetch(apiUrl(`/api/records/${record.contentHash}/download`), {
        headers: {
          ...getApiClient().getSessionHeaders(patient?.walletAddress),
          'X-Health-Id': patient?.healthId || '',
        },
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = record.title;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        console.error('Failed to download record');
        showError(t('records.downloadFailed', { title: record.title }));
      }
    } catch (error) {
      console.error('Error downloading record:', error);
      showError(t('records.downloadError', { title: record.title }));
    } finally {
      setIsDownloading(null);
    }
  };

  const filteredRecords = records.filter(record => {
    const needle = searchQuery.toLowerCase();
    const hit = (value: unknown) => String(value ?? '').toLowerCase().includes(needle);
    const matchesSearch = hit(record.title) || hit(record.provider);
    const matchesFilter = filterType === 'all' || record.type === filterType;
    return matchesSearch && matchesFilter;
  });

  const recordTypes = ['all', 'lab_result', 'imaging', 'prescription', 'consultation', 'vaccination'];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-12 bg-surface-sunken rounded-xl" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-surface-sunken rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-content">{t('records.pageTitle')}</h1>
        <p className="text-content-muted">{t('records.subtitle')}</p>
      </div>

      {/* Search & Filter */}
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
          <input
            type="text"
            placeholder={t('records.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-surface-sunken border-0 rounded-xl focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
          {recordTypes.map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                filterType === type
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-sunken text-content-muted hover:bg-surface-sunken'
              }`}
            >
              {type === 'all' ? t('records.allRecords') : typeLabel(type)}
            </button>
          ))}
        </div>
      </div>

      {/* Records Count */}
      <div className="flex items-center gap-2 text-sm text-content-muted">
        <FileText className="w-4 h-4" />
        {t('records.found', { count: filteredRecords.length })}
      </div>

      {/* Records List */}
      <div className="space-y-3">
        {filteredRecords.map(record => (
          <div
            key={record.id}
            className="patient-card hover:border-brand border-2 border-transparent cursor-pointer"
            onClick={() => setSelectedRecord(record)}
          >
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${getRecordColor(record.type)}`}>
                {getRecordIcon(record.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium text-content truncate">{record.title}</h3>
                  {record.verified && (
                    <Shield className="w-4 h-4 text-success-500 flex-shrink-0" />
                  )}
                </div>
                <p className="text-sm text-content-muted truncate mb-2">{record.description}</p>
                <div className="flex items-center gap-4 text-xs text-content-muted">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {record.provider}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDate(record.date)}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-content-muted flex-shrink-0" />
            </div>
          </div>
        ))}

        {filteredRecords.length === 0 && (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
            <p className="text-content-muted">{t('records.noRecords')}</p>
          </div>
        )}
      </div>

      {/* Record Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-surface w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="sticky top-0 bg-surface p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold text-content">{t('records.recordDetails')}</h2>
              <button
                onClick={() => setSelectedRecord(null)}
                className="p-2 hover:bg-surface-sunken rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-content-muted" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Record Header */}
              <div className="flex items-start gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${getRecordColor(selectedRecord.type)}`}>
                  {getRecordIcon(selectedRecord.type)}
                </div>
                <div>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mb-1 ${getRecordColor(selectedRecord.type)}`}>
                    {typeLabel(selectedRecord.type)}
                  </span>
                  <h3 className="font-semibold text-lg text-content">{selectedRecord.title}</h3>
                  <p className="text-content-muted">{selectedRecord.description}</p>
                </div>
              </div>

              {/* Record Info */}
              <div className="space-y-4 p-4 bg-surface-sunken rounded-xl">
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-content-muted" />
                  <div>
                    <p className="text-sm text-content-muted">{t('records.provider')}</p>
                    <p className="font-medium text-content">{selectedRecord.provider}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-content-muted" />
                  <div>
                    <p className="text-sm text-content-muted">{t('records.date')}</p>
                    <p className="font-medium text-content">{formatDate(selectedRecord.date)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-content-muted" />
                  <div>
                    <p className="text-sm text-content-muted">{t('records.status')}</p>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${selectedRecord.verified ? 'bg-success-500' : 'bg-warning-500'}`} />
                      <p className="font-medium text-content">
                        {selectedRecord.verified ? t('records.verified') : t('records.pendingVerification')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* IPFS Hash */}
              <div className="p-4 bg-info-light rounded-xl">
                <p className="text-sm text-info-dark mb-1 font-medium flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  {t('records.documentHash')}
                </p>
                <p className="font-mono text-xs text-info break-all">{selectedRecord.contentHash}</p>
              </div>

              {/* Lab Results Details (only for lab_result type) */}
              {selectedRecord.type === 'lab_result' && selectedRecord.labResults && selectedRecord.labResults.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="w-5 h-5 text-info" />
                    <h4 className="font-semibold text-content">{t('records.testResults')}</h4>
                    <span className="text-xs text-success-600 flex items-center gap-1 bg-success-50 px-2 py-0.5 rounded-full">
                      <CheckCircle className="w-3 h-3" />
                      {t('records.doctorApproved')}
                    </span>
                  </div>
                  <div className="bg-surface-sunken rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-sunken">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-content-muted">{t('records.parameter')}</th>
                          <th className="text-right px-4 py-2 font-medium text-content-muted">{t('records.value')}</th>
                          <th className="text-right px-4 py-2 font-medium text-content-muted">{t('records.reference')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRecord.labResults.map((result, idx) => (
                          <tr key={idx} className="border-t border-border">
                            <td className="px-4 py-2 text-content">{result.parameter}</td>
                            <td className="px-4 py-2 text-right">
                              <span className={`font-medium ${
                                result.flag === 'High' ? 'text-critical-subtle-fg' :
                                result.flag === 'Low' ? 'text-warning-600' :
                                'text-content'
                              }`}>
                                {result.value} {result.unit}
                              </span>
                              {result.flag && (
                                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                                  result.flag === 'High' ? 'bg-emergency-50 text-critical-subtle-fg' :
                                  'bg-warning-50 text-warning-600'
                                }`}>
                                  {result.flag}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right text-content-muted">{result.reference_range}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedRecord.reviewedBy && (
                    <p className="text-xs text-content-muted flex items-center gap-1">
                      <Shield className="w-3 h-3 text-success-500" />
                      {t('records.reviewedByName', { name: selectedRecord.reviewedBy })}
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleDownload(selectedRecord)}
                  disabled={isDownloading === selectedRecord.id}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-primary-500 text-brand-fg rounded-xl hover:bg-brand transition-colors disabled:opacity-50"
                >
                  {isDownloading === selectedRecord.id ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                  {t('records.download')}
                </button>
                <button
                  onClick={() => void handleView(selectedRecord)}
                  disabled={isViewing === selectedRecord.id}
                  className="flex items-center justify-center gap-2 px-6 py-3 border-2 border-border rounded-xl hover:bg-surface-sunken transition-colors disabled:opacity-50"
                >
                  {isViewing === selectedRecord.id ? (
                    <div className="w-5 h-5 border-2 border-border-strong border-t-neutral-600 rounded-full animate-spin" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                  {t('records.view')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={preview.title}
        >
          <div className="bg-surface rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="font-semibold text-content truncate">{preview.title}</h2>
              <button
                type="button"
                onClick={closePreview}
                className="px-3 py-1 text-sm text-content-muted hover:text-content"
              >
                {t('records.close')}
              </button>
            </div>
            <div className="p-4 overflow-auto">
              {preview.kind === 'text' && (
                <pre className="text-sm text-content whitespace-pre-wrap break-words font-mono">
                  {preview.text}
                </pre>
              )}
              {preview.kind === 'image' && (
                <img src={preview.url} alt={preview.title} className="max-w-full h-auto mx-auto" />
              )}
              {preview.kind === 'pdf' && (
                <iframe src={preview.url} title={preview.title} className="w-full h-[65vh]" />
              )}
              {preview.kind === 'unsupported' && (
                <p className="text-sm text-content-muted">
                  {t('records.viewUnsupported', { type: preview.contentType })}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
