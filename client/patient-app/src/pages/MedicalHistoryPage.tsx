import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '@medichain/shared';
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
  AlertTriangle,
} from 'lucide-react';

interface Immunization {
  record_id?: string;
  id?: string;
  vaccine_name?: string;
  vaccine?: string;
  date_administered?: string;
  administered_date?: string;
  lot_number?: string;
  administered_by?: string;
  site?: string;
  notes?: string;
}

interface FamilyHistoryEntry {
  id?: string;
  relationship: string;
  condition: string;
  age_of_onset?: number;
  notes?: string;
  deceased?: boolean;
}

interface MedicalRecord {
  record_id?: string;
  id?: string;
  file_name?: string;
  title?: string;
  record_type?: string;
  uploaded_at?: string;
  created_at?: string;
  file_size?: number;
  ipfs_hash?: string;
}

type Tab = 'immunizations' | 'family-history' | 'documents';

/**
 * MedicalHistoryPage - Immunizations, family history, and uploaded records
 *
 * Tabs:
 * - Immunizations: GET /api/clinical/immunizations
 * - Family History: GET /api/clinical/family-history/{patientId}
 * - Documents: GET /api/records/{patientId}
 *
 * © 2025 Trustware. All rights reserved.
 */
export function MedicalHistoryPage() {
  const navigate = useNavigate();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('immunizations');
  const [immunizations, setImmunizations] = useState<Immunization[]>([]);
  const [familyHistory, setFamilyHistory] = useState<FamilyHistoryEntry[]>([]);
  const [documents, setDocuments] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadAll();
    }
  }, [patient]);

  const loadAll = async () => {
    if (!patient) return;
    setLoading(true);
    const headers = {
      'X-User-Id': patient.walletAddress,
      'X-Health-Id': patient.healthId,
    };
    try {
      const [immRes, famRes, docsRes] = await Promise.all([
        fetch(apiUrl('/api/clinical/immunizations'), { headers }),
        fetch(apiUrl(`/api/clinical/family-history/${patient.healthId}`), { headers }),
        fetch(apiUrl(`/api/records/${patient.healthId}`), { headers }),
      ]);

      if (immRes.ok) {
        const d = await immRes.json();
        setImmunizations(d.immunizations || d.records || []);
        setApiConnected(true);
      }
      if (famRes.ok) {
        const d = await famRes.json();
        setFamilyHistory(d.family_history || d.entries || []);
        setApiConnected(true);
      }
      if (docsRes.ok) {
        const d = await docsRes.json();
        setDocuments(d.records || d.documents || []);
        setApiConnected(true);
      }
    } catch (err) {
      console.error('Failed to load medical history:', err);
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'immunizations', label: 'Immunizations', icon: <Syringe className="w-4 h-4" /> },
    { id: 'family-history', label: 'Family History', icon: <Users className="w-4 h-4" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="w-4 h-4" /> },
  ];

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Medical History</h1>
          <p className="text-neutral-500">Immunizations, family history, and records</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? 'Live' : 'Demo'}
          </span>
          <button
            onClick={loadAll}
            className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-100 p-1 rounded-xl">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-900'
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
              <Syringe className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-500">No immunization records found</p>
            </div>
          ) : (
            immunizations.map((imm, idx) => (
              <div key={imm.record_id || imm.id || idx} className="patient-card">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Syringe className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-neutral-900">
                      {imm.vaccine_name || imm.vaccine || 'Vaccine'}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-neutral-500 mt-1">
                      {(imm.date_administered || imm.administered_date) && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(imm.date_administered || imm.administered_date)}
                        </span>
                      )}
                      {imm.administered_by && (
                        <span>by {imm.administered_by}</span>
                      )}
                      {imm.lot_number && (
                        <span>Lot: {imm.lot_number}</span>
                      )}
                    </div>
                    {imm.notes && (
                      <p className="text-xs text-neutral-400 mt-1 italic">{imm.notes}</p>
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
              <Users className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-500">No family history recorded</p>
            </div>
          ) : (
            familyHistory.map((entry, idx) => (
              <div key={entry.id || idx} className="patient-card">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Users className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-neutral-900">{entry.condition}</h3>
                      {entry.deceased && (
                        <span className="text-xs text-neutral-400">Deceased</span>
                      )}
                    </div>
                    <p className="text-sm text-neutral-600 mt-0.5">{entry.relationship}</p>
                    {entry.age_of_onset != null && (
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Age of onset: {entry.age_of_onset}
                      </p>
                    )}
                    {entry.notes && (
                      <p className="text-xs text-neutral-400 mt-1 italic">{entry.notes}</p>
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
          {documents.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-500">No documents uploaded</p>
            </div>
          ) : (
            documents.map((doc, idx) => (
              <div key={doc.record_id || doc.id || idx} className="patient-card flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-medium text-neutral-900">
                      {doc.file_name || doc.title || 'Document'}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
                      {doc.record_type && (
                        <span className="px-1.5 py-0.5 bg-neutral-100 rounded">{doc.record_type}</span>
                      )}
                      {(doc.uploaded_at || doc.created_at) && (
                        <span>{formatDate(doc.uploaded_at || doc.created_at)}</span>
                      )}
                      {doc.file_size && (
                        <span>{formatBytes(doc.file_size)}</span>
                      )}
                    </div>
                  </div>
                </div>
                {doc.ipfs_hash && (
                  <button
                    className="p-2 text-neutral-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
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
