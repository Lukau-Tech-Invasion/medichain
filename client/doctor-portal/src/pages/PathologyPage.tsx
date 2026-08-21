import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import {
  getPatients,
  listPathology,
  createPathology,
  getPatientRecords,
  uploadMedicalRecord,
  downloadMedicalRecord,
  useTranslation,
} from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { FileText, Microscope, Search, Plus, Eye, Calendar, AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react';

/**
 * PathologyPage
 * 
 * Full pathology specimen tracking and digital pathology viewer
 * - Surgical pathology, cytology, autopsy specimens
 * - Gross and microscopic examination
 * - IHC/special stains tracking
 * - Final diagnosis with SNOMED coding
 * - Digital slide viewer integration ready
 */

interface PathologySpecimen {
  specimenId: string;
  patientId: string;
  patientName: string;
  collectionDate: string;
  collectionTime: string;
  clinician: string;
  specimenType: 'surgical' | 'cytology' | 'biopsy' | 'bone-marrow' | 'autopsy';
  site: string;
  laterality: 'left' | 'right' | 'bilateral' | 'n/a';
  clinicalHistory: string;
  clinicalDiagnosis: string;
  priority: 'routine' | 'urgent' | 'stat';
  status: 'received' | 'grossing' | 'processing' | 'embedding' | 'cutting' | 'staining' | 'prelim' | 'final' | 'addendum';
  receivedDate?: string;
  receivedBy?: string;
  container: string;
  fixative: string;
  grossDescription?: string;
  blocks?: string[];
  slides?: string[];
  specialStains?: string[];
  ihcMarkers?: string[];
  microscopicDescription?: string;
  diagnosis?: string;
  snomedCode?: string;
  reportDate?: string;
  pathologist?: string;
  isCritical?: boolean;
  communicatedTo?: string;
}

/** One decrypted slide image belonging to the specimen on screen. */
interface SlideImage {
  hash: string;
  label: string;
  contentType: string;
  base64: string;
}

/**
 * Filename prefix that ties an uploaded image to its specimen.
 *
 * The record listing (`MedicalRecordReference`) carries only hashes, a type and
 * a timestamp — no filename — so the specimen a slide belongs to has to travel
 * inside the name and be recovered on download. Encoding it here keeps that
 * convention in one place rather than spelled out at both ends.
 */
const slidePrefix = (specimenId: string) => `pathslide__${specimenId}__`;

/**
 * Map one stored row onto the shape this page renders.
 *
 * The registry returns `PathologyReportEntity` — snake_case typed columns plus
 * a `data` blob holding the tracking fields those columns have no home for
 * (priority, container, fixative, laterality, blocks, slides). The list used to
 * be asserted straight across with `as PathologySpecimen[]`, which type-checks
 * and is simply false: `patientName`, `site` and `specimenId` were all
 * `undefined`, and the first search keystroke threw on `.toLowerCase()` —
 * taking the whole page down with it as soon as a specimen existed. An empty
 * worklist hid the bug.
 *
 * Every string field is defaulted, because the crash was not the search box: it
 * was trusting an assertion over data that comes off the wire.
 */
function toSpecimen(raw: unknown): PathologySpecimen {
  const row = raw as Record<string, any>;
  const tracked: Record<string, any> = row.data ?? {};
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = row[key] ?? tracked[key];
      if (typeof value === 'string' && value) return value;
    }
    return '';
  };
  const list = (...keys: string[]): string[] => {
    for (const key of keys) {
      const value = row[key] ?? tracked[key];
      if (Array.isArray(value)) return value.map(String);
    }
    return [];
  };

  return {
    specimenId: pick('id', 'specimenId', 'specimen_id'),
    patientId: pick('patient_id', 'patientId'),
    patientName: pick('patientName', 'patient_name'),
    collectionDate: pick('collection_date', 'collectionDate').slice(0, 10),
    collectionTime: pick('collectionTime', 'collection_time'),
    clinician: pick('ordering_provider_id', 'clinician'),
    specimenType: (pick('specimen_type', 'specimenType') ||
      'surgical') as PathologySpecimen['specimenType'],
    site: pick('specimen_source', 'site'),
    laterality: (pick('laterality') || 'n/a') as PathologySpecimen['laterality'],
    clinicalHistory: pick('clinical_history', 'clinicalHistory'),
    clinicalDiagnosis: pick('clinicalDiagnosis', 'clinical_diagnosis'),
    priority: (pick('priority') || 'routine') as PathologySpecimen['priority'],
    status: (pick('status') || 'received') as PathologySpecimen['status'],
    receivedDate: pick('received_date', 'receivedDate').slice(0, 10),
    receivedBy: pick('receivedBy', 'received_by'),
    container: pick('container'),
    fixative: pick('fixative'),
    grossDescription: pick('gross_description', 'grossDescription'),
    blocks: list('blocks'),
    slides: list('slides'),
    specialStains: list('specialStains', 'special_stains'),
    ihcMarkers: list('ihcMarkers', 'ihc_markers'),
    microscopicDescription: pick('microscopic_description', 'microscopicDescription'),
    diagnosis: pick('diagnosis'),
    snomedCode: pick('snomedCode', 'snomed_code'),
    reportDate: pick('report_date', 'reportDate').slice(0, 10),
    pathologist: pick('pathologist_id', 'pathologist'),
    isCritical: Boolean(row.isCritical ?? tracked.isCritical),
    communicatedTo: pick('communicatedTo', 'communicated_to'),
  };
}

const PathologyPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [specimens, setSpecimens] = useState<PathologySpecimen[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'worklist' | 'newOrder' | 'report'>('worklist');
  const [selectedSpecimen, setSelectedSpecimen] = useState<PathologySpecimen | null>(null);
  const [slideImages, setSlideImages] = useState<SlideImage[]>([]);
  const [slideImagesLoading, setSlideImagesLoading] = useState(false);
  const [slideUploading, setSlideUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // New order form state
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [collectionTime, setCollectionTime] = useState('');
  const [clinician, setClinician] = useState('');
  const [specimenType, setSpecimenType] = useState<'surgical' | 'cytology' | 'biopsy' | 'bone-marrow' | 'autopsy'>('surgical');
  const [site, setSite] = useState('');
  const [laterality, setLaterality] = useState<'left' | 'right' | 'bilateral' | 'n/a'>('n/a');
  const [clinicalHistory, setClinicalHistory] = useState('');
  const [clinicalDiagnosis, setClinicalDiagnosis] = useState('');
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [container, setContainer] = useState('');
  const [fixative, setFixative] = useState('10% formalin');

  // Report form state
  const [grossDescription, setGrossDescription] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [newBlock, setNewBlock] = useState('');
  const [slides, setSlides] = useState<string[]>([]);
  const [newSlide, setNewSlide] = useState('');
  const [specialStains, setSpecialStains] = useState<string[]>([]);
  const [ihcMarkers, setIhcMarkers] = useState<string[]>([]);
  const [microscopicDescription, setMicroscopicDescription] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [snomedCode, setSnomedCode] = useState('');
  const [isCritical, setIsCritical] = useState(false);
  const [communicatedTo, setCommunicatedTo] = useState('');

  const fetchSpecimens = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await listPathology();
      if (response.success && Array.isArray(response.items)) {
        setSpecimens(response.items.map(toSpecimen));
      }
    } catch (err) {
      console.error('Error fetching pathology specimens:', err);
      setError(t('docPathology.errorLoad'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadPatients = async () => {
      const loadedPatients = await getPatients();
      setPatients(loadedPatients);
    };
    loadPatients();
    fetchSpecimens();
  }, [user, fetchSpecimens]);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !collectionDate || !site || !clinician) {
      showWarning(t('docPathology.warningRequiredFields'));
      return;
    }

    const patient = patients.find(p => p.patient_id === selectedPatientId);
    if (!patient) return;

    const newSpecimen: PathologySpecimen = {
      specimenId: `S24-${String(specimens.length + 1).padStart(3, '0')}`,
      patientId: selectedPatientId,
      patientName: patient.full_name,
      collectionDate,
      collectionTime: collectionTime || '00:00',
      clinician,
      specimenType,
      site,
      laterality,
      clinicalHistory,
      clinicalDiagnosis,
      priority,
      status: 'received',
      receivedDate: new Date().toISOString().split('T')[0],
      receivedBy: user?.userId || 'Unknown',
      container,
      fixative
    };

    try {
      await createPathology(newSpecimen);
    } catch (err) {
      console.error('Failed to save pathology specimen:', err);
    }

    setSpecimens([...specimens, newSpecimen]);
    showSuccess(t('docPathology.submittedSuccess', { id: newSpecimen.specimenId }));

    // Reset form
    setSelectedPatientId('');
    setCollectionDate('');
    setCollectionTime('');
    setClinician('');
    setSite('');
    setLaterality('n/a');
    setClinicalHistory('');
    setClinicalDiagnosis('');
    setPriority('routine');
    setContainer('');
    setFixative('10% formalin');
    setActiveTab('worklist');
  };

  /**
   * Load the slide images attached to a specimen.
   *
   * The record index exposes no filename, so each candidate image has to be
   * downloaded to learn which specimen it belongs to. Only `imaging` records
   * are considered, and a download that fails is skipped rather than failing
   * the panel: one unreadable slide must not hide the rest.
   */
  const loadSlideImages = useCallback(async (specimen: PathologySpecimen) => {
    setSlideImagesLoading(true);
    setSlideImages([]);
    try {
      const records = await getPatientRecords(specimen.patientId);
      const prefix = slidePrefix(specimen.specimenId);
      const found: SlideImage[] = [];
      for (const ref of records.filter(r => r.record_type === 'imaging')) {
        try {
          const file = await downloadMedicalRecord({
            content_hash: ref.content_hash,
            metadata_hash: ref.metadata_hash,
          });
          if (!file.filename?.startsWith(prefix)) continue;
          found.push({
            hash: ref.content_hash,
            label: file.filename.slice(prefix.length),
            contentType: file.content_type || 'image/jpeg',
            base64: file.content_base64,
          });
        } catch {
          // Unreadable or not ours; the other slides still render.
        }
      }
      setSlideImages(found);
    } catch (err) {
      console.error('Failed to load slide images:', err);
    } finally {
      setSlideImagesLoading(false);
    }
  }, []);

  /** Encrypt and store one captured slide image against the open specimen. */
  const attachSlideImage = async (file: File) => {
    if (!selectedSpecimen) return;
    setSlideUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        // `result` is a data URL; the API wants the payload only.
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      await uploadMedicalRecord({
        patient_id: selectedSpecimen.patientId,
        content_base64: base64,
        filename: `${slidePrefix(selectedSpecimen.specimenId)}${file.name}`,
        content_type: file.type || 'image/jpeg',
        record_type: 'imaging',
      });
      showSuccess(t('docPathology.slideAttached'));
      await loadSlideImages(selectedSpecimen);
    } catch (err) {
      showError(err instanceof Error ? err.message : t('docPathology.slideAttachFailed'));
    } finally {
      setSlideUploading(false);
    }
  };

  const handleOpenReport = (specimen: PathologySpecimen) => {
    setSelectedSpecimen(specimen);
    void loadSlideImages(specimen);
    setGrossDescription(specimen.grossDescription || '');
    setBlocks(specimen.blocks || []);
    setSlides(specimen.slides || []);
    setSpecialStains(specimen.specialStains || []);
    setIhcMarkers(specimen.ihcMarkers || []);
    setMicroscopicDescription(specimen.microscopicDescription || '');
    setDiagnosis(specimen.diagnosis || '');
    setSnomedCode(specimen.snomedCode || '');
    setIsCritical(specimen.isCritical || false);
    setCommunicatedTo(specimen.communicatedTo || '');
    setActiveTab('report');
  };

  const handleSaveReport = (finalizeReport: boolean) => {
    if (!selectedSpecimen) return;

    if (finalizeReport) {
      if (!diagnosis || !microscopicDescription) {
        showWarning(t('docPathology.warningFinalizeFields'));
        return;
      }
      if (isCritical && !communicatedTo) {
        showWarning(t('docPathology.warningCriticalCommunication'));
        return;
      }
    }

    const updatedSpecimen: PathologySpecimen = {
      ...selectedSpecimen,
      grossDescription,
      blocks,
      slides,
      specialStains,
      ihcMarkers,
      microscopicDescription,
      diagnosis,
      snomedCode,
      isCritical,
      communicatedTo,
      status: finalizeReport ? 'final' : 'prelim',
      reportDate: finalizeReport ? new Date().toISOString().split('T')[0] : undefined,
      pathologist: finalizeReport ? (user?.userId || 'Unknown') : undefined
    };

    setSpecimens(specimens.map(s => s.specimenId === selectedSpecimen.specimenId ? updatedSpecimen : s));
    showSuccess(finalizeReport ? t('docPathology.reportFinalizedSuccess') : t('docPathology.reportSavedPrelimSuccess'));
    setActiveTab('worklist');
    setSelectedSpecimen(null);
  };

  const addBlock = () => {
    if (newBlock.trim()) {
      setBlocks([...blocks, newBlock.trim()]);
      setNewBlock('');
    }
  };

  const addSlide = () => {
    if (newSlide.trim()) {
      setSlides([...slides, newSlide.trim()]);
      setNewSlide('');
    }
  };

  const toggleSpecialStain = (stain: string) => {
    if (specialStains.includes(stain)) {
      setSpecialStains(specialStains.filter(s => s !== stain));
    } else {
      setSpecialStains([...specialStains, stain]);
    }
  };

  const toggleIHCMarker = (marker: string) => {
    if (ihcMarkers.includes(marker)) {
      setIhcMarkers(ihcMarkers.filter(m => m !== marker));
    } else {
      setIhcMarkers([...ihcMarkers, marker]);
    }
  };

  const filteredSpecimens = specimens.filter(specimen => {
    // Belt as well as braces. `toSpecimen` defaults every field, but a search
    // filter is a poor place to discover that an assumption failed: a thrown
    // TypeError here unmounts the entire worklist, so a missing value must
    // simply not match rather than take the page down.
    const term = searchTerm.toLowerCase();
    const has = (value: string | undefined) => (value ?? '').toLowerCase().includes(term);
    const matchesSearch =
      has(specimen.specimenId) || has(specimen.patientName) || has(specimen.site);
    
    const matchesStatus = statusFilter === 'all' || specimen.status === statusFilter;
    const matchesType = typeFilter === 'all' || specimen.specimenType === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      received: 'bg-notice-subtle text-notice-subtle-fg',
      grossing: 'bg-surface-sunken text-content-secondary',
      processing: 'bg-caution-subtle text-caution-subtle-fg',
      embedding: 'bg-surface-sunken text-content-secondary',
      cutting: 'bg-surface-sunken text-content-secondary',
      staining: 'bg-surface-sunken text-content-secondary',
      prelim: 'bg-caution-subtle text-caution-subtle-fg',
      final: 'bg-ok-subtle text-ok-subtle-fg',
      addendum: 'bg-surface-sunken text-content-secondary'
    };
    return styles[status] || 'bg-surface-sunken text-content-secondary';
  };

  const getPriorityBadge = (priority: string) => {
    const styles: Record<string, string> = {
      stat: 'bg-critical text-white',
      urgent: 'bg-orange-500 text-white',
      routine: 'bg-gray-500 text-white'
    };
    return styles[priority] || 'bg-gray-500 text-white';
  };

  return (
    <div className="p-6">
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-amber-600 to-orange-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Microscope className="h-8 w-8" />
            <div>
              <h1 className="text-3xl font-bold">{t('docPathology.title')}</h1>
              <p className="text-amber-100">{t('docPathology.subtitle')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-amber-100">{t('docPathology.pathologistLabel')}</p>
            <p className="font-semibold">{user?.userId || 'Unknown'}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('worklist')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'worklist'
              ? 'text-caution-subtle-fg border-b-2 border-amber-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          <FileText className="inline h-4 w-4 mr-2" />
          {t('docPathology.tabWorklist')}
        </button>
        <button
          onClick={() => setActiveTab('newOrder')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'newOrder'
              ? 'text-caution-subtle-fg border-b-2 border-amber-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          <Plus className="inline h-4 w-4 mr-2" />
          {t('docPathology.tabNewSpecimen')}
        </button>
        {selectedSpecimen && (
          <button
            onClick={() => setActiveTab('report')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'report'
                ? 'text-caution-subtle-fg border-b-2 border-amber-600'
                : 'text-content-muted hover:text-content-secondary'
            }`}
          >
            <Microscope className="inline h-4 w-4 mr-2" />
            {t('docPathology.tabReport', { id: selectedSpecimen.specimenId })}
          </button>
        )}
      </div>

      {/* Worklist Tab */}
      {activeTab === 'worklist' && (
        <div>
          {/* Search and Filters */}
          <div className="bg-surface rounded-lg shadow p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="path-search" className="block text-sm font-medium text-content-secondary mb-1">
                  <Search className="inline h-4 w-4 mr-1" />
                  {t('docPathology.searchLabel')}
                </label>
                <input
                  id="path-search"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('docPathology.searchPh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label htmlFor="path-status-filter" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.statusLabel')}</label>
                <select
                  id="path-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="all">{t('docPathology.allStatuses')}</option>
                  <option value="received">{t('docPathology.status_received')}</option>
                  <option value="grossing">{t('docPathology.status_grossing')}</option>
                  <option value="processing">{t('docPathology.status_processing')}</option>
                  <option value="prelim">{t('docPathology.status_prelim')}</option>
                  <option value="final">{t('docPathology.status_final')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="path-type-filter" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.typeLabel')}</label>
                <select
                  id="path-type-filter"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="all">{t('docPathology.allTypes')}</option>
                  <option value="surgical">{t('docPathology.specimenType_surgical')}</option>
                  <option value="biopsy">{t('docPathology.specimenType_biopsy')}</option>
                  <option value="cytology">{t('docPathology.specimenType_cytology')}</option>
                  <option value="bone-marrow">{t('docPathology.specimenType_bone-marrow')}</option>
                  <option value="autopsy">{t('docPathology.specimenType_autopsy')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Specimens Table */}
          <div className="bg-surface rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-surface-sunken">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docPathology.tablePriority')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docPathology.tableSpecimenId')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docPathology.tablePatient')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docPathology.tableTypeSite')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docPathology.tableCollected')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docPathology.tableStatus')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-content-muted uppercase">{t('docPathology.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-border">
                  {filteredSpecimens.map((specimen) => (
                    <tr
                      key={specimen.specimenId}
                      className={`${specimen.priority === 'stat' ? 'bg-critical-subtle' : ''} hover:bg-surface-sunken`}
                    >
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getPriorityBadge(specimen.priority)}`}>
                          {t(`docPathology.priority_${specimen.priority}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-content">{specimen.specimenId}</div>
                        {specimen.isCritical && (
                          <span className="text-xs text-critical-subtle-fg flex items-center">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            {t('docPathology.criticalBadge')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-content">{specimen.patientName}</div>
                        <div className="text-xs text-content-muted">{specimen.patientId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          <span className="font-medium text-content-secondary">{t(`docPathology.specimenType_${specimen.specimenType}`)}</span>
                        </div>
                        <div className="text-sm text-content-muted">{specimen.site}</div>
                        {specimen.laterality !== 'n/a' && (
                          <span className="text-xs text-content-muted">({specimen.laterality})</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center text-sm text-content-muted">
                          <Calendar className="h-4 w-4 mr-1" />
                          {specimen.collectionDate}
                        </div>
                        <div className="text-xs text-content-muted">{specimen.collectionTime}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(specimen.status)}`}>
                          {t(`docPathology.status_${specimen.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleOpenReport(specimen)}
                          className="text-caution-subtle-fg hover:text-caution-subtle-fg text-sm font-medium flex items-center"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          {t('docPathology.viewReportButton')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* New Specimen Tab */}
      {activeTab === 'newOrder' && (
        <div className="bg-surface rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">{t('docPathology.newSpecimenSubmissionHeading')}</h2>
          <form onSubmit={handleSubmitOrder}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Patient Selection */}
              <div>
                <label htmlFor="path-patient" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docPathology.patientRequired')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="path-patient"
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="">{t('docPathology.selectPatientPh')}</option>
                  {patients.map((patient) => (
                    <option key={patient.patient_id} value={patient.patient_id}>
                      {patient.full_name} ({patient.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Specimen Type */}
              <div>
                <label htmlFor="path-specimen-type" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docPathology.specimenTypeRequired')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="path-specimen-type"
                  value={specimenType}
                  onChange={(e) => setSpecimenType(e.target.value as typeof specimenType)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                >
                  <option value="surgical">{t('docPathology.specimenType_surgical')}</option>
                  <option value="biopsy">{t('docPathology.specimenType_biopsy')}</option>
                  <option value="cytology">{t('docPathology.specimenType_cytology')}</option>
                  <option value="bone-marrow">{t('docPathology.specimenType_bone-marrow')}</option>
                  <option value="autopsy">{t('docPathology.specimenType_autopsy')}</option>
                </select>
              </div>

              {/* Collection Date/Time */}
              <div>
                <label htmlFor="path-collection-date" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docPathology.collectionDateRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="path-collection-date"
                  type="date"
                  value={collectionDate}
                  onChange={(e) => setCollectionDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              <div>
                <label htmlFor="path-collection-time" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.collectionTimeLabel')}</label>
                <input
                  id="path-collection-time"
                  type="time"
                  value={collectionTime}
                  onChange={(e) => setCollectionTime(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              {/* Anatomical Site */}
              <div>
                <label htmlFor="path-site" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docPathology.anatomicalSiteRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="path-site"
                  type="text"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  placeholder={t('docPathology.anatomicalSitePh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Laterality */}
              <div>
                <label htmlFor="path-laterality" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.lateralityLabel')}</label>
                <select
                  id="path-laterality"
                  value={laterality}
                  onChange={(e) => setLaterality(e.target.value as typeof laterality)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="n/a">{t('docPathology.laterality_na')}</option>
                  <option value="left">{t('docPathology.laterality_left')}</option>
                  <option value="right">{t('docPathology.laterality_right')}</option>
                  <option value="bilateral">{t('docPathology.laterality_bilateral')}</option>
                </select>
              </div>

              {/* Clinician */}
              <div>
                <label htmlFor="path-clinician" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docPathology.orderingClinicianRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="path-clinician"
                  type="text"
                  value={clinician}
                  onChange={(e) => setClinician(e.target.value)}
                  placeholder={t('docPathology.orderingClinicianPh')}
                  className="w-full px-3 py-2 border rounded-md"
                  required
                />
              </div>

              {/* Priority */}
              <div>
                <label htmlFor="path-priority" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.priorityLabel')}</label>
                <select
                  id="path-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="routine">{t('docPathology.priority_routine')}</option>
                  <option value="urgent">{t('docPathology.priority_urgent')}</option>
                  <option value="stat">{t('docPathology.priority_stat')}</option>
                </select>
              </div>

              {/* Container */}
              <div>
                <label htmlFor="path-container" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.containerTypeLabel')}</label>
                <input
                  id="path-container"
                  type="text"
                  value={container}
                  onChange={(e) => setContainer(e.target.value)}
                  placeholder={t('docPathology.containerTypePh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              {/* Fixative */}
              <div>
                <label htmlFor="path-fixative" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.fixativeLabel')}</label>
                <select
                  id="path-fixative"
                  value={fixative}
                  onChange={(e) => setFixative(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="10% formalin">{t('docPathology.fixative_formalin')}</option>
                  <option value="95% alcohol">{t('docPathology.fixative_alcohol')}</option>
                  <option value="CytoLyt">{t('docPathology.fixative_cytolyt')}</option>
                  <option value="RPMI">{t('docPathology.fixative_rpmi')}</option>
                  <option value="none">{t('docPathology.fixative_none')}</option>
                </select>
              </div>

              {/* Clinical History */}
              <div className="md:col-span-2">
                <label htmlFor="path-clinical-history" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.clinicalHistoryLabel')}</label>
                <textarea
                  id="path-clinical-history"
                  value={clinicalHistory}
                  onChange={(e) => setClinicalHistory(e.target.value)}
                  rows={3}
                  placeholder={t('docPathology.clinicalHistoryPh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              {/* Clinical Diagnosis */}
              <div className="md:col-span-2">
                <label htmlFor="path-clinical-diagnosis" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.clinicalDiagnosisLabel')}</label>
                <input
                  id="path-clinical-diagnosis"
                  type="text"
                  value={clinicalDiagnosis}
                  onChange={(e) => setClinicalDiagnosis(e.target.value)}
                  placeholder={t('docPathology.clinicalDiagnosisPh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('worklist')}
                className="px-4 py-2 border border-border-strong rounded-md text-content-secondary hover:bg-surface-sunken"
              >
                {t('docPathology.cancelButton')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-caution text-caution-fg rounded-md hover:bg-amber-700 flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('docPathology.submitSpecimenButton')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Report Tab */}
      {activeTab === 'report' && selectedSpecimen && (
        <div className="space-y-6">
          {/* Specimen Information */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">{t('docPathology.specimenInformationHeading')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium text-content-secondary">{t('docPathology.specimenIdColLabel')}</span>
                <p className="text-content">{selectedSpecimen.specimenId}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docPathology.patientColLabel')}</span>
                <p className="text-content">{selectedSpecimen.patientName}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docPathology.typeColLabel')}</span>
                <p className="text-content">{t(`docPathology.specimenType_${selectedSpecimen.specimenType}`)}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docPathology.siteColLabel')}</span>
                <p className="text-content">{selectedSpecimen.site} {selectedSpecimen.laterality !== 'n/a' ? `(${selectedSpecimen.laterality})` : ''}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docPathology.collectedColLabel')}</span>
                <p className="text-content">{selectedSpecimen.collectionDate} {selectedSpecimen.collectionTime}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docPathology.clinicianColLabel')}</span>
                <p className="text-content">{selectedSpecimen.clinician}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docPathology.fixativeColLabel')}</span>
                <p className="text-content">{selectedSpecimen.fixative}</p>
              </div>
              <div>
                <span className="font-medium text-content-secondary">{t('docPathology.statusColLabel')}</span>
                <span className={`px-2 py-1 text-xs font-semibold rounded ${getStatusBadge(selectedSpecimen.status)}`}>
                  {t(`docPathology.status_${selectedSpecimen.status}`)}
                </span>
              </div>
            </div>
            {selectedSpecimen.clinicalHistory && (
              <div className="mt-4">
                <span className="font-medium text-content-secondary">{t('docPathology.clinicalHistoryColLabel')}</span>
                <p className="text-content mt-1">{selectedSpecimen.clinicalHistory}</p>
              </div>
            )}
            {selectedSpecimen.clinicalDiagnosis && (
              <div className="mt-2">
                <span className="font-medium text-content-secondary">{t('docPathology.clinicalDiagnosisColLabel')}</span>
                <p className="text-content mt-1">{selectedSpecimen.clinicalDiagnosis}</p>
              </div>
            )}
          </div>

          {/* Digital slide viewer.
              This was a dashed box reading "whole slide images would display
              here via OpenSeadragon or similar" — a design mockup left in the
              product. Slide images now go through the same encrypted IPFS store
              the rest of the record uses, so a pathologist can attach and read
              them. It is not a WSI pyramid viewer: these are captured field
              images, and the panel says so rather than implying tiled
              whole-slide navigation it does not provide. */}
          <div className="bg-surface rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Microscope className="h-5 w-5 text-content-secondary" />
                {t('docPathology.viewerHeading')}
              </h3>
              <label className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded cursor-pointer hover:bg-purple-500">
                {slideUploading ? t('docPathology.slideUploading') : t('docPathology.slideAttach')}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={slideUploading}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) void attachSlideImage(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {slideImagesLoading ? (
              <p className="text-sm text-gray-500 py-6 text-center">
                {t('docPathology.slidesLoading')}
              </p>
            ) : slideImages.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {slideImages.map(image => (
                  <figure key={image.hash} className="border rounded overflow-hidden">
                    <img
                      src={`data:${image.contentType};base64,${image.base64}`}
                      alt={t('docPathology.slideImageAlt', { label: image.label })}
                      className="w-full h-40 object-cover bg-black"
                    />
                    <figcaption className="px-2 py-1 text-xs text-gray-600 truncate">
                      {image.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-6 text-center">
                {t('docPathology.slidesNoneAttached')}
              </p>
            )}

            {/* The stain/block labels the pathologist recorded, which exist
                whether or not an image was captured for them. */}
            {slides.length > 0 && (
              <div className="mt-4 pt-3 border-t">
                <p className="text-xs font-medium text-content-muted mb-2">
                  {t('docPathology.slidesRecordedLabel')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {slides.map((slide, idx) => (
                    <span key={idx} className="px-3 py-1 bg-surface-sunken border rounded text-sm text-content-secondary">
                      {slide}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Gross Examination */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h3 id="path-gross-examination-heading" className="text-lg font-bold mb-3">{t('docPathology.grossExaminationHeading')}</h3>
            <textarea
              id="path-gross-description"
              aria-labelledby="path-gross-examination-heading"
              value={grossDescription}
              onChange={(e) => setGrossDescription(e.target.value)}
              rows={6}
              placeholder={t('docPathology.grossDescriptionPh')}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          {/* Blocks and Slides */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h3 className="text-lg font-bold mb-3">{t('docPathology.tissueProcessingHeading')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Blocks */}
              <div>
                <label htmlFor="path-new-block" className="block text-sm font-medium text-content-secondary mb-2">{t('docPathology.tissueBlocksLabel')}</label>
                <div className="flex space-x-2 mb-2">
                  <input
                    id="path-new-block"
                    type="text"
                    value={newBlock}
                    onChange={(e) => setNewBlock(e.target.value)}
                    placeholder={t('docPathology.tissueBlockPh')}
                    className="flex-1 px-3 py-2 border rounded-md"
                  />
                  <button
                    type="button"
                    onClick={addBlock}
                    className="px-3 py-2 bg-caution text-caution-fg rounded-md hover:bg-amber-700"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {blocks.map((block, idx) => (
                    <span key={idx} className="px-3 py-1 bg-surface-sunken rounded text-sm">
                      {block}
                    </span>
                  ))}
                </div>
              </div>

              {/* Slides */}
              <div>
                <label htmlFor="path-new-slide" className="block text-sm font-medium text-content-secondary mb-2">{t('docPathology.slidesLabel')}</label>
                <div className="flex space-x-2 mb-2">
                  <input
                    id="path-new-slide"
                    type="text"
                    value={newSlide}
                    onChange={(e) => setNewSlide(e.target.value)}
                    placeholder={t('docPathology.slidePh')}
                    className="flex-1 px-3 py-2 border rounded-md"
                  />
                  <button
                    type="button"
                    onClick={addSlide}
                    className="px-3 py-2 bg-caution text-caution-fg rounded-md hover:bg-amber-700"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {slides.map((slide, idx) => (
                    <span key={idx} className="px-3 py-1 bg-surface-sunken rounded text-sm">
                      {slide}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Special Stains and IHC */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h3 className="text-lg font-bold mb-3">{t('docPathology.specialStudiesHeading')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Special Stains */}
              <div>
                <label id="path-special-stains-label" className="block text-sm font-medium text-content-secondary mb-2">{t('docPathology.specialStainsLabel')}</label>
                <div className="space-y-2" role="group" aria-labelledby="path-special-stains-label">
                  {['PAS', 'PAS-D', 'Mucicarmine', 'Trichrome', 'Reticulin', 'Iron', 'Congo Red', 'AFB', 'GMS'].map((stain) => (
                    <label key={stain} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={specialStains.includes(stain)}
                        onChange={() => toggleSpecialStain(stain)}
                        className="mr-2"
                      />
                      <span className="text-sm">{stain}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* IHC Markers */}
              <div>
                <label id="path-ihc-markers-label" className="block text-sm font-medium text-content-secondary mb-2">{t('docPathology.ihcLabel')}</label>
                <div className="space-y-2" role="group" aria-labelledby="path-ihc-markers-label">
                  {['CK7', 'CK20', 'ER', 'PR', 'HER2', 'Ki-67', 'CD20', 'CD3', 'CD45', 'S100', 'HMB45', 'Desmin'].map((marker) => (
                    <label key={marker} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={ihcMarkers.includes(marker)}
                        onChange={() => toggleIHCMarker(marker)}
                        className="mr-2"
                      />
                      <span className="text-sm">{marker}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Microscopic Examination */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h3 id="path-microscopic-examination-heading" className="text-lg font-bold mb-3">{t('docPathology.microscopicExaminationHeading')}</h3>
            <textarea
              id="path-microscopic-description"
              aria-labelledby="path-microscopic-examination-heading"
              value={microscopicDescription}
              onChange={(e) => setMicroscopicDescription(e.target.value)}
              rows={8}
              placeholder={t('docPathology.microscopicDescriptionPh')}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          {/* Diagnosis */}
          <div className="bg-surface rounded-lg shadow p-6">
            <h3 id="path-diagnosis-heading" className="text-lg font-bold mb-3">{t('docPathology.diagnosisHeading')}</h3>
            <textarea
              id="path-diagnosis"
              aria-labelledby="path-diagnosis-heading"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              rows={4}
              placeholder={t('docPathology.diagnosisPh')}
              className="w-full px-3 py-2 border rounded-md mb-3"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="path-snomed-code" className="block text-sm font-medium text-content-secondary mb-1">{t('docPathology.snomedCodeLabel')}</label>
                <input
                  id="path-snomed-code"
                  type="text"
                  value={snomedCode}
                  onChange={(e) => setSnomedCode(e.target.value)}
                  placeholder={t('docPathology.snomedCodePh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>
          </div>

          {/* Critical Findings */}
          <div className={`bg-surface rounded-lg shadow p-6 ${isCritical ? 'border-2 border-red-500' : ''}`}>
            <div className="flex items-center mb-3">
              <input
                type="checkbox"
                id="critical"
                checked={isCritical}
                onChange={(e) => setIsCritical(e.target.checked)}
                className="mr-2"
              />
              <label htmlFor="critical" className="text-lg font-bold text-critical-subtle-fg">
                <AlertCircle className="inline h-5 w-5 mr-1" />
                {t('docPathology.criticalFindingsLabel')}
              </label>
            </div>
            {isCritical && (
              <div>
                <label htmlFor="path-communicated-to" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('docPathology.communicatedToRequired')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="path-communicated-to"
                  type="text"
                  value={communicatedTo}
                  onChange={(e) => setCommunicatedTo(e.target.value)}
                  placeholder={t('docPathology.communicatedToPh')}
                  className="w-full px-3 py-2 border rounded-md"
                />
                <p className="text-xs text-content-muted mt-1">
                  {t('docPathology.communicatedToHint')}
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setActiveTab('worklist');
                setSelectedSpecimen(null);
              }}
              className="px-4 py-2 border border-border-strong rounded-md text-content-secondary hover:bg-surface-sunken"
            >
              {t('docPathology.cancelButton')}
            </button>
            <button
              type="button"
              onClick={() => handleSaveReport(false)}
              className="px-4 py-2 bg-caution text-caution-fg rounded-md hover:bg-amber-700 flex items-center"
            >
              <Clock className="h-4 w-4 mr-2" />
              {t('docPathology.savePreliminaryButton')}
            </button>
            <button
              type="button"
              onClick={() => handleSaveReport(true)}
              className="px-4 py-2 bg-ok text-ok-fg rounded-md hover:bg-ok flex items-center"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {t('docPathology.finalizeReportButton')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PathologyPage;
