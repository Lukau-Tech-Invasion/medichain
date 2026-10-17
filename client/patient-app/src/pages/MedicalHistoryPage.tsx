import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getMyFamilyHistory,
  getMyImmunizations,
  getPatientRecords,
  downloadRecordContent,
  useTranslation,
} from '@medichain/shared';
import type { FamilyHistoryMember, ImmunizationRecord, MedicalRecordReference } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Syringe,
  Users,
  FileText,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
  Calendar,
  Download,
} from 'lucide-react';

interface FamilyHistoryEntry {
  id: string;
  relationship: string;
  condition: string;
  age_of_onset?: number;
  notes?: string;
  deceased: boolean | null;
  relative_name?: string | null;
  relative_notes?: string | null;
  current_age?: number | null;
  age_at_death?: number | null;
  cause_of_death?: string | null;
  consanguineous?: boolean | null;
  category?: string | null;
  severity?: string | null;
}

type Tab = 'immunizations' | 'family-history' | 'documents';

function flattenFamilyHistory(members: FamilyHistoryMember[]): FamilyHistoryEntry[] {
  return members.flatMap((member, memberIndex) =>
    (member.conditions.length ? member.conditions : [null]).map((condition, conditionIndex) => ({
      id: `${member.member_id || memberIndex}-${conditionIndex}`,
      relationship: member.relationship.replace(/([a-z])([A-Z])/g, '$1 $2'),
      condition: condition?.condition || '',
      age_of_onset: condition?.age_at_diagnosis ?? undefined,
      notes: condition?.notes ?? undefined,
      category: condition?.category,
      severity: condition?.severity,
      relative_name: member.name,
      relative_notes: member.notes,
      current_age: member.current_age,
      age_at_death: member.age_at_death,
      cause_of_death: member.cause_of_death,
      consanguineous: member.consanguineous,
      deceased: member.living === true ? false
        : member.living === false && (member.member_id || member.age_at_death != null || member.cause_of_death) ? true : null,
    }))
  );
}

/**
 * MedicalHistoryPage - Immunizations, family history, and uploaded records
 *
 * Tabs:
 * - Immunizations: caller-scoped GET /api/clinical/immunizations
 * - Family History: caller-scoped GET /api/clinical/family-history
 * - Documents: GET /api/records/{patientId}
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function MedicalHistoryPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('immunizations');
  const [immunizations, setImmunizations] = useState<ImmunizationRecord[]>([]);
  const [familyHistory, setFamilyHistory] = useState<FamilyHistoryEntry[]>([]);
  const [documents, setDocuments] = useState<MedicalRecordReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [downloadingHash, setDownloadingHash] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  const loadAll = useCallback(async () => {
    if (!patient) return;
    setLoading(true);
    try {
      const [immunizationRecords, familyRecord, patientRecords] = await Promise.all([
        getMyImmunizations(),
        getMyFamilyHistory(),
        getPatientRecords(patient.healthId),
      ]);
      setImmunizations(immunizationRecords);
      setFamilyHistory(flattenFamilyHistory(familyRecord.family_members));
      setDocuments(patientRecords);
      setApiConnected(true);
    } catch (err) {
      console.error('Failed to load medical history:', err);
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  }, [patient]);

  useEffect(() => {
    if (patient) {
      loadAll();
    }
  }, [patient, loadAll]);

  const formatDate = (dateValue?: string | number) => {
    if (dateValue === undefined || dateValue === '') return '—';
    const date = typeof dateValue === 'number' ? new Date(dateValue * 1000) : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const downloadDocument = async (record: MedicalRecordReference) => {
    setDownloadingHash(record.content_hash);
    setDownloadError(null);
    try {
      const { blob, contentType } = await downloadRecordContent(record.content_hash);
      const extension = contentType.includes('pdf') ? '.pdf' : contentType.includes('json') ? '.json'
        : contentType.includes('text/plain') ? '.txt' : '';
      const filename = Array.from(`${record.record_type}-${record.content_hash}${extension}`, (character) =>
        character.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(character) ? '_' : character,
      ).join('').slice(0, 180) || 'medical-record';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download medical record:', error);
      setDownloadError(t('medicalHistory.downloadFailed'));
    } finally {
      setDownloadingHash(null);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'immunizations', label: t('medicalHistory.tabImmunizations'), icon: <Syringe className="w-4 h-4" /> },
    { id: 'family-history', label: t('medicalHistory.tabFamily'), icon: <Users className="w-4 h-4" /> },
    { id: 'documents', label: t('medicalHistory.tabDocuments'), icon: <FileText className="w-4 h-4" /> },
  ];

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">{t('medicalHistory.title')}</h1>
          <p className="text-content-muted">{t('medicalHistory.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('common.live') : t('common.dataUnavailable')}
          </span>
          <button
            onClick={loadAll}
            aria-label="Refresh medical history"
            className="p-2 text-content-muted hover:bg-surface-sunken rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-sunken p-1 rounded-xl">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-surface text-content shadow-sm'
                : 'text-content-muted hover:text-content'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Immunizations Tab */}
      {activeTab === 'immunizations' && (
        <div className="space-y-3">
          {immunizations.length === 0 ? (
            <div className="text-center py-12">
              <Syringe className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <p className="text-content-muted">{t('medicalHistory.noImmunizations')}</p>
            </div>
          ) : (
            immunizations.map((imm, idx) => (
              <div key={imm.record_id || idx} className="patient-card">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-ok-subtle rounded-xl flex items-center justify-center flex-shrink-0">
                    <Syringe className="w-5 h-5 text-ok-subtle-fg" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-content">
                      {imm.vaccine_name || t('medicalHistory.vaccine')}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-content-muted mt-1">
                      {imm.administration_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(imm.administration_date)}
                        </span>
                      )}
                      {imm.administered_by && (
                        <span>{t('medicalHistory.administeredBy', { name: imm.administered_by })}</span>
                      )}
                      {imm.lot_number && (
                        <span>{t('medicalHistory.lot', { lot: imm.lot_number })}</span>
                      )}
                    </div>
                    {imm.notes && (
                      <p className="text-xs text-content-muted mt-1 italic">{imm.notes}</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Family History Tab */}
      {activeTab === 'family-history' && (
        <div className="space-y-3">
          {familyHistory.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <p className="text-content-muted">{t('medicalHistory.noFamily')}</p>
            </div>
          ) : (
            familyHistory.map((entry, idx) => (
              <div key={entry.id || idx} className="patient-card">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-surface-sunken rounded-xl flex items-center justify-center flex-shrink-0">
                    <Users className="w-5 h-5 text-content-secondary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-content">{entry.condition || t('medicalHistory.familyMember')}</h3>
                      {entry.deceased === true && (
                        <span className="text-xs text-content-muted">{t('medicalHistory.deceased')}</span>
                      )}
                      {entry.deceased === null && <span className="text-xs text-content-muted">{t('medicalHistory.vitalStatusUnknown')}</span>}
                    </div>
                    <p className="text-sm text-content-muted mt-0.5">{entry.relationship}</p>
                    {entry.relative_name && <p className="text-sm">{entry.relative_name}</p>}
                    {entry.current_age != null && <p className="text-sm">{t('medicalHistory.currentAge', { age: entry.current_age })}</p>}
                    {entry.age_at_death != null && <p className="text-sm">{t('medicalHistory.ageAtDeath', { age: entry.age_at_death })}</p>}
                    {entry.cause_of_death && <p className="text-sm">{t('medicalHistory.causeOfDeath', { cause: entry.cause_of_death })}</p>}
                    {entry.consanguineous != null && <p className="text-sm">{t('medicalHistory.consanguineous', { answer: t(entry.consanguineous ? 'common.yes' : 'common.no') })}</p>}
                    {entry.relative_notes && <p className="text-sm">{t('medicalHistory.relativeNotes', { notes: entry.relative_notes })}</p>}
                    {entry.category && <p className="text-sm">{t('medicalHistory.conditionCategory', { category: entry.category })}</p>}
                    {entry.severity && <p className="text-sm">{t('medicalHistory.conditionSeverity', { severity: entry.severity })}</p>}
                    {entry.age_of_onset != null && (
                      <p className="text-xs text-content-muted mt-0.5">
                        {t('medicalHistory.ageOfOnset', { age: entry.age_of_onset })}
                      </p>
                    )}
                    {entry.notes && (
                      <p className="text-xs text-content-muted mt-1 italic">{entry.notes}</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Documents Tab */}
      {activeTab === 'documents' && (
        <div className="space-y-3">
          {downloadError && <p className="text-sm text-critical" role="alert">{downloadError}</p>}
          {documents.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <p className="text-content-muted">{t('medicalHistory.noDocuments')}</p>
            </div>
          ) : (
            documents.map((doc, idx) => (
              <div key={doc.content_hash || idx} className="patient-card flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-subtle rounded-xl flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-brand" />
                  </div>
                  <div>
                    <h3 className="font-medium text-content">
                      {t('medicalHistory.document')}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-content-muted mt-0.5">
                      {doc.record_type && (
                        <span className="px-1.5 py-0.5 bg-surface-sunken rounded">{doc.record_type}</span>
                      )}
                      {doc.uploaded_at && (
                        <span>{formatDate(doc.uploaded_at)}</span>
                      )}
                    </div>
                  </div>
                </div>
                {doc.content_hash && (
                  <button
                    type="button"
                    onClick={() => downloadDocument(doc)}
                    disabled={downloadingHash === doc.content_hash}
                    className="p-2 text-content-muted hover:text-brand-subtle-fg hover:bg-brand-subtle rounded-lg transition-colors"
                    title={downloadingHash === doc.content_hash ? t('medicalHistory.downloading') : t('medicalHistory.download')}
                  >
                    {downloadingHash === doc.content_hash
                      ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      : <Download className="w-4 h-4" />}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
