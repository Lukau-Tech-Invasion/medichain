import React, { useState, useEffect, useCallback } from 'react';
import {
  getPatients,
  listChainOfCustody,
  createChainOfCustody,
  useTranslation,
  Alert,
  LoadingSpinner,
  Input,
  useValidatedForm,
  chainOfCustodySchema,
  custodyHandoverSchema,
  transferChainOfCustody,
  getApiErrorMessage,
} from '@medichain/shared';
import type { PatientProfile } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import { useToastActions } from '../components/Toast';
import {
  Shield,
  CheckCircle,
  FileText,
  AlertTriangle,
  Search,
  Plus,
  Lock,
  MapPin,
  Truck,
  Package,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { useStaffDirectory } from '../components/StaffName';
import PatientSelect from '../components/PatientSelect';

type SpecimenType = 'blood' | 'urine' | 'other-fluid' | 'tissue' | 'swab' | 'evidence';
type SpecimenStatus = 'collected' | 'in-transit' | 'received' | 'analyzed' | 'stored' | 'released' | 'destroyed';
type CustodyPurpose = 'clinical' | 'legal' | 'toxicology' | 'dna' | 'sexual-assault' | 'criminal' | 'workplace';

interface CustodyTransfer {
  transferredFrom: string;
  transferredTo: string;
  transferredAt: string;
  location: string;
  condition: string;
  sealIntact: boolean;
  /** A witness's name, when one was present. */
  witness?: string;
  /** Who entered the hand-over (the signed-in user), as the server recorded it. */
  recordedBy?: string;
  notes?: string;
}

interface ChainOfCustody {
  custodyId: string;
  patientId: string;
  patientName: string;
  specimenType: SpecimenType;
  specimenDescription: string;
  collectionDate: string;
  collectionTime: string;
  collectedBy: string;
  collectionLocation: string;
  purpose: CustodyPurpose;
  caseNumber?: string;
  investigatingAgency?: string;
  status: SpecimenStatus;
  sealNumber: string;
  containerType: string;
  quantity: string;
  transfers: CustodyTransfer[];
  currentCustodian: string;
  currentLocation: string;
  storageConditions?: string;
  expiryDate?: string;
  disposalDate?: string;
  disposalMethod?: string;
  integrityVerified: boolean;
  notes?: string;
}

const ChainOfCustodyPage: React.FC = () => {
  const { t } = useTranslation();
  // Who did it, by name: records store the actor's wallet address.
  const staffName = useStaffDirectory();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [records, setRecords] = useState<ChainOfCustody[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'new-collection' | 'transfer' | 'history'>('active');
  const [selectedRecord, setSelectedRecord] = useState<ChainOfCustody | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<SpecimenStatus | 'all'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newCollection, setNewCollection] = useState({
    patientId: '',
    specimenType: 'blood' as SpecimenType,
    specimenDescription: '',
    collectionDate: new Date().toISOString().split('T')[0],
    collectionTime: new Date().toTimeString().slice(0, 5),
    collectionLocation: '',
    purpose: 'legal' as CustodyPurpose,
    caseNumber: '',
    investigatingAgency: '',
    sealNumber: '',
    containerType: '',
    quantity: '',
    storageConditions: '',
    // Whether the collector applied and checked the seal. Not defaulted true.
    //
    // The submitted record hardcoded `integrityVerified: true` with no control
    // anywhere. A chain-of-custody record is a legal document, and the transfer
    // path already asks the equivalent question (`transfer.sealIntact`) — only
    // the collection did not.
    integrityVerified: false,
    notes: '',
  });

  const [transfer, setTransfer] = useState({
    transferredTo: '',
    location: '',
    condition: 'intact',
    sealIntact: true,
    witnessSignature: '',
    notes: '',
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [patientData, custodyData] = await Promise.all([
        getPatients(),
        listChainOfCustody()
      ]);
      setPatients(patientData);
      
      // Map API response to interface
      const custodyItems = (custodyData.items || []) as Record<string, unknown>[];
      const mappedRecords: ChainOfCustody[] = custodyItems.map((item) => ({
        // The row's own id first: the stored document may still carry the
        // `COC-001` the page used to invent, which the server never issued.
        custodyId: (item.id || item.custody_id || item.custodyId || '') as string,
        patientId: (item.patient_id || item.patientId || '') as string,
        patientName: (item.patient_name || item.patientName || '') as string,
        specimenType: (item.specimen_type || item.specimenType || 'other-fluid') as SpecimenType,
        specimenDescription: (item.specimen_description || item.specimenDescription || '') as string,
        collectionDate: (item.collection_date || item.collectionDate || String(item.collection_datetime ?? '').slice(0, 10)) as string,
        collectionTime: (item.collection_time || item.collectionTime || String(item.collection_datetime ?? '').slice(11, 16)) as string,
        collectedBy: (item.collected_by || item.collectedBy || '') as string,
        collectionLocation: (item.collection_location || item.collectionLocation || '') as string,
        purpose: (item.purpose || 'legal') as CustodyPurpose,
        caseNumber: item.case_number || item.caseNumber,
        investigatingAgency: item.investigating_agency || item.investigatingAgency,
        // `status` at the top level is the custody column (`in_custody`,
        // `transferred`); the specimen's lifecycle the page tracks is
        // `specimen_status`.
        status: (item.specimen_status || item.status || 'collected') as SpecimenStatus,
        sealNumber: (item.seal_number || item.sealNumber || '') as string,
        containerType: (item.container_type || item.containerType || '') as string,
        quantity: (item.quantity || '') as string,
        transfers: (item.transfers || []) as CustodyTransfer[],
        currentCustodian: (item.current_custodian || item.currentCustodian || item.current_custodian_id || '') as string,
        currentLocation: (item.current_location || item.currentLocation || item.storage_location || '') as string,
        storageConditions: item.storage_conditions || item.storageConditions,
        expiryDate: item.expiry_date || item.expiryDate,
        disposalDate: item.disposal_date || item.disposalDate,
        disposalMethod: item.disposal_method || item.disposalMethod,
        integrityVerified: (item.integrity_verified ?? item.integrityVerified ?? true) as boolean,
        notes: item.notes,
      } as ChainOfCustody));
      
      setRecords(mappedRecords);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('docChainOfCustody.errorFetchFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // `createChainOfCustody` was imported here and never called: the handler was
  // synchronous and only did `setRecords([...])`, so a custody record lived in
  // React state and was gone on reload — while the page toasted success.
  //
  // A chain of custody is the legal evidence trail for a forensic specimen:
  // who held it, when, and whether the seal was intact. A gap in it is what
  // makes the specimen inadmissible, so a record that only exists in a browser
  // tab is worse than no record, because the collector believes it was kept.
  const { errors, validate, validateField, clearField } = useValidatedForm(chainOfCustodySchema);

  const handleCreateCustody = async () => {
    // The seal number is what makes the chain checkable -- it ties this record
    // to the physical container, so a later transfer can prove it handled the
    // same specimen. A toast naming three fields at once cannot say which of
    // them is the one that would break the chain.
    if (!validate(newCollection)) {
      return;
    }

    const patient = patients.find((p) => p.patient_id === newCollection.patientId);
    if (!patient) return;

    const newRecord: ChainOfCustody = {
      // Assigned by the server; see the read-back below.
      custodyId: '',
      patientId: patient.patient_id,
      patientName: patient.full_name,
      specimenType: newCollection.specimenType,
      specimenDescription: newCollection.specimenDescription,
      collectionDate: newCollection.collectionDate,
      collectionTime: newCollection.collectionTime,
      collectedBy: user?.walletAddress || '',
      collectionLocation: newCollection.collectionLocation,
      purpose: newCollection.purpose,
      caseNumber: newCollection.caseNumber,
      investigatingAgency: newCollection.investigatingAgency,
      status: 'collected',
      sealNumber: newCollection.sealNumber,
      containerType: newCollection.containerType,
      quantity: newCollection.quantity,
      currentCustodian: user?.userId ?? '',
      currentLocation: newCollection.collectionLocation,
      storageConditions: newCollection.storageConditions,
      integrityVerified: newCollection.integrityVerified,
      transfers: [],
      notes: newCollection.notes,
    };

    setIsLoading(true);
    setError(null);
    let formId: string;
    try {
      const response = await createChainOfCustody(newRecord);
      if (!response.success) {
        setError(t('common.saveFailed'));
        return;
      }
      formId = response.form_id;
    } catch (err) {
      console.error('Failed to save chain-of-custody record:', err);
      setError(t('common.saveFailed'));
      return;
    } finally {
      setIsLoading(false);
    }

    // Read back rather than insert the local copy. It carried `COC-001`,
    // numbered from this page's list, while the server stored its own id --
    // so a transfer recorded against the new row addressed nothing.
    void fetchData();
    setNewCollection({
      patientId: '',
      specimenType: 'blood',
      specimenDescription: '',
      collectionDate: new Date().toISOString().split('T')[0],
      collectionTime: new Date().toTimeString().slice(0, 5),
      collectionLocation: '',
      purpose: 'legal',
      caseNumber: '',
      investigatingAgency: '',
      sealNumber: '',
      integrityVerified: false,
      containerType: '',
      quantity: '',
      storageConditions: '',
      notes: '',
    });
    setActiveTab('active');
    showSuccess(t('docChainOfCustody.successCreated', { id: formId }));
  };

  const {
    errors: transferErrors,
    validate: validateTransfer,
    validateField: validateTransferField,
    clearField: clearTransferField,
  } = useValidatedForm(custodyHandoverSchema);

  const handleTransfer = async () => {
    // Who took it and where are what make the chain traceable; a transfer
    // missing either leaves the gap a later challenge points at.
    if (!selectedRecord) {
      showError(t('docChainOfCustody.errorRequiredTransferFields'));
      return;
    }
    if (!validateTransfer(transfer)) {
      return;
    }

    try {
      await transferChainOfCustody(selectedRecord.custodyId, {
        transferredTo: transfer.transferredTo,
        location: transfer.location,
        condition: transfer.condition,
        sealIntact: transfer.sealIntact,
        witness: transfer.witnessSignature || undefined,
        notes: transfer.notes || undefined,
      });
    } catch (err) {
      showError(getApiErrorMessage(err, t('docChainOfCustody.errorTransferFailed')));
      return;
    }
    await fetchData();
    setSelectedRecord(null);
    setTransfer({
      transferredTo: '',
      location: '',
      condition: 'intact',
      sealIntact: true,
      witnessSignature: '',
      notes: '',
    });
    showSuccess(t('docChainOfCustody.successTransferDocumented'));
  };

  const filteredRecords = records.filter((r) => {
    const matchesSearch =
      r.custodyId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.sealNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.caseNumber && r.caseNumber.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const activeRecords = records.filter(
    (r) => r.status === 'collected' || r.status === 'in-transit' || r.status === 'received' || r.status === 'analyzed' || r.status === 'stored'
  );

  const getStatusBadge = (status: SpecimenStatus) => {
    const badges = {
      collected: 'bg-notice-subtle text-notice-subtle-fg',
      'in-transit': 'bg-caution-subtle text-caution-subtle-fg',
      received: 'bg-ok-subtle text-ok-subtle-fg',
      analyzed: 'bg-surface-sunken text-content-secondary',
      stored: 'bg-surface-sunken text-content-secondary',
      released: 'bg-surface-sunken text-content-secondary',
      destroyed: 'bg-critical-subtle text-critical-subtle-fg',
    };
    return badges[status];
  };

  const getStatusIcon = (status: SpecimenStatus) => {
    switch (status) {
      case 'collected':
        return <Package className="w-4 h-4" />;
      case 'in-transit':
        return <Truck className="w-4 h-4" />;
      case 'received':
        return <CheckCircle className="w-4 h-4" />;
      case 'analyzed':
        return <FileText className="w-4 h-4" />;
      case 'stored':
        return <Lock className="w-4 h-4" />;
      case 'released':
        return <MapPin className="w-4 h-4" />;
      case 'destroyed':
        return <XCircle className="w-4 h-4" />;
    }
  };

  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="bg-gradient-to-r from-gray-700 to-slate-600 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">{t('docChainOfCustody.title')}</h1>
        <p className="text-gray-100">{t('docChainOfCustody.subtitle')}</p>
      </div>

      {/* The page already tracked this; it just never showed it. A failed
          save left the screen unchanged, which reads as success. */}
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
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-content-muted">
          <LoadingSpinner size="sm" />
          {t('common.loading')}
        </div>
      )}

      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'active' ? 'text-content-secondary border-b-2 border-gray-700' : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docChainOfCustody.tabActiveSpecimens')}
          {activeRecords.length > 0 && (
            <span className="ml-2 bg-gray-700 text-white text-xs rounded-full px-2 py-0.5">{activeRecords.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('new-collection')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'new-collection' ? 'text-content-secondary border-b-2 border-gray-700' : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docChainOfCustody.tabNewCollection')}
        </button>
        <button
          onClick={() => setActiveTab('transfer')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'transfer' ? 'text-content-secondary border-b-2 border-gray-700' : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docChainOfCustody.tabTransferCustody')}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'history' ? 'text-content-secondary border-b-2 border-gray-700' : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docChainOfCustody.tabHistory')}
        </button>
      </div>

      {activeTab === 'active' && (
        <div className="space-y-4">
          {!error && !isLoading && activeRecords.length === 0 ? (
            <div className="bg-surface-sunken border border-border rounded-lg p-8 text-center">
              <Package className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-content mb-2">{t('docChainOfCustody.noActiveTitle')}</h3>
              <p className="text-content-muted">{t('docChainOfCustody.noActiveHint')}</p>
            </div>
          ) : (
            activeRecords.map((record) => (
              <div key={record.custodyId} className="border border-border-strong rounded-lg shadow-sm bg-surface overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-content">{record.custodyId}</h3>
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 ${getStatusBadge(record.status)}`}>
                          {getStatusIcon(record.status)}
                          {t(`docChainOfCustody.status_${record.status}`)}
                        </span>
                        {record.integrityVerified && (
                          <span className="text-ok-subtle-fg flex items-center gap-1 text-sm min-h-[24px] py-1">
                            <Shield className="w-4 h-4" />
                            {t('docChainOfCustody.verifiedBadge')}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-content-muted">
                        {t('docChainOfCustody.sealCaseLine', { seal: record.sealNumber, value: record.caseNumber || t('docChainOfCustody.caseNA') })}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4 bg-surface-sunken rounded-lg p-4">
                    <div>
                      <p className="text-sm text-content-muted mb-1">{t('docChainOfCustody.lblPatient')}</p>
                      <p className="font-semibold text-content">{record.patientName}</p>
                      <p className="text-sm text-content-muted">{record.patientId}</p>
                    </div>
                    <div>
                      <p className="text-sm text-content-muted mb-1">{t('docChainOfCustody.lblSpecimen')}</p>
                      <p className="font-semibold text-content">{record.specimenDescription}</p>
                      <p className="text-sm text-content-muted">{record.containerType} • {record.quantity}</p>
                    </div>
                    <div>
                      <p className="text-sm text-content-muted mb-1">{t('docChainOfCustody.lblPurpose')}</p>
                      <p className="font-semibold text-content capitalize">{t(`docChainOfCustody.purpose_${record.purpose}`)}</p>
                      <p className="text-sm text-content-muted">{record.investigatingAgency}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-notice-subtle border border-notice rounded-lg p-3">
                      <p className="text-sm text-notice-subtle-fg font-semibold mb-1">{t('docChainOfCustody.lblCurrentCustodian')}</p>
                      <p className="text-notice-subtle-fg">{record.currentCustodian}</p>
                    </div>
                    <div className="bg-notice-subtle border border-notice rounded-lg p-3">
                      <p className="text-sm text-notice-subtle-fg font-semibold mb-1">{t('docChainOfCustody.lblCurrentLocation')}</p>
                      <p className="text-notice-subtle-fg">{record.currentLocation}</p>
                    </div>
                  </div>

                  {record.transfers.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.transferHistoryTitle', { count: record.transfers.length })}</h4>
                      <div className="space-y-2">
                        {record.transfers.map((hop, idx) => (
                          <div key={idx} className="bg-surface-sunken rounded p-3 text-sm">
                            <div className="flex items-center gap-2 mb-1">
                              <Truck className="w-4 h-4 text-content-muted" />
                              <span className="font-semibold">{hop.transferredFrom}</span>
                              <span className="text-content-muted">→</span>
                              <span className="font-semibold">{hop.transferredTo}</span>
                              {hop.sealIntact ? (
                                <CheckCircle className="w-4 h-4 text-ok-subtle-fg" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-critical-subtle-fg" />
                              )}
                            </div>
                            <p className="text-content-muted text-xs">{formatTimestamp(hop.transferredAt)} • {hop.location}</p>
                            {(hop.recordedBy || hop.witness) && (
                              <p className="text-content-muted text-xs">
                                {hop.recordedBy && t('docChainOfCustody.recordedBy', { who: staffName(hop.recordedBy) })}
                                {hop.recordedBy && hop.witness && ' • '}
                                {hop.witness && t('docChainOfCustody.witnessedBy', { who: hop.witness })}
                              </p>
                            )}
                            {hop.notes && <p className="text-content-muted italic mt-1">{hop.notes}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setSelectedRecord(record);
                      setActiveTab('transfer');
                    }}
                    className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors font-semibold"
                  >
                    {t('docChainOfCustody.transferCustodyBtn')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'new-collection' && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            {t('docChainOfCustody.newCollectionTitle')}
          </h2>

          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <PatientSelect
                  id="coc-patient"
                  label={t('docChainOfCustody.patientLabel')}
                  value={newCollection.patientId}
                  onChange={(selectedPatientId) => setNewCollection({ ...newCollection, patientId: selectedPatientId })}
                />
              </div>

              <div>
                <label htmlFor="coc-specimen-type" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docChainOfCustody.specimenTypeLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="coc-specimen-type"
                  value={newCollection.specimenType}
                  onChange={(e) => setNewCollection({ ...newCollection, specimenType: e.target.value as SpecimenType })}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                >
                  <option value="blood">{t('docChainOfCustody.type_blood')}</option>
                  <option value="urine">{t('docChainOfCustody.type_urine')}</option>
                  <option value="other-fluid">{t('docChainOfCustody.type_other-fluid')}</option>
                  <option value="tissue">{t('docChainOfCustody.type_tissue')}</option>
                  <option value="swab">{t('docChainOfCustody.type_swab')}</option>
                  <option value="evidence">{t('docChainOfCustody.type_evidence')}</option>
                </select>
              </div>

              <div className="col-span-2">
                <label htmlFor="coc-specimen-description" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docChainOfCustody.specimenDescriptionLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <Input
                  id="coc-specimen-description"
                  type="text"
                  value={newCollection.specimenDescription}
                  onChange={(e) => { clearField('specimenDescription'); setNewCollection({ ...newCollection, specimenDescription: e.target.value }); }}
                  onBlur={() => validateField('specimenDescription', newCollection)}
                  error={errors.specimenDescription}
                  placeholder={t('docChainOfCustody.specimenDescriptionPh')}
                  required
                />
              </div>

              <div>
                <label htmlFor="coc-collection-date" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docChainOfCustody.collectionDateLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="coc-collection-date"
                  type="date"
                  value={newCollection.collectionDate}
                  onChange={(e) => setNewCollection({ ...newCollection, collectionDate: e.target.value })}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="coc-collection-time" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docChainOfCustody.collectionTimeLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="coc-collection-time"
                  type="time"
                  value={newCollection.collectionTime}
                  onChange={(e) => setNewCollection({ ...newCollection, collectionTime: e.target.value })}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="coc-collection-location" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docChainOfCustody.collectionLocationLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="coc-collection-location"
                  type="text"
                  value={newCollection.collectionLocation}
                  onChange={(e) => setNewCollection({ ...newCollection, collectionLocation: e.target.value })}
                  placeholder={t('docChainOfCustody.collectionLocationPh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="coc-purpose" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docChainOfCustody.purposeLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="coc-purpose"
                  value={newCollection.purpose}
                  onChange={(e) => setNewCollection({ ...newCollection, purpose: e.target.value as CustodyPurpose })}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                >
                  <option value="legal">{t('docChainOfCustody.purpose_legal')}</option>
                  <option value="toxicology">{t('docChainOfCustody.purpose_toxicology')}</option>
                  <option value="dna">{t('docChainOfCustody.purpose_dna')}</option>
                  <option value="sexual-assault">{t('docChainOfCustody.purpose_sexual-assault')}</option>
                  <option value="criminal">{t('docChainOfCustody.purpose_criminal')}</option>
                  <option value="workplace">{t('docChainOfCustody.purpose_workplace')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="coc-case-number" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.caseNumberLabel')}</label>
                <input
                  id="coc-case-number"
                  type="text"
                  value={newCollection.caseNumber}
                  onChange={(e) => setNewCollection({ ...newCollection, caseNumber: e.target.value })}
                  placeholder={t('docChainOfCustody.caseNumberPh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="coc-investigating-agency" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.investigatingAgencyLabel')}</label>
                <input
                  id="coc-investigating-agency"
                  type="text"
                  value={newCollection.investigatingAgency}
                  onChange={(e) => setNewCollection({ ...newCollection, investigatingAgency: e.target.value })}
                  placeholder={t('docChainOfCustody.investigatingAgencyPh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="coc-seal-number" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docChainOfCustody.sealNumberLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <Input
                  id="coc-seal-number"
                  type="text"
                  value={newCollection.sealNumber}
                  onChange={(e) => { clearField('sealNumber'); setNewCollection({ ...newCollection, sealNumber: e.target.value }); }}
                  onBlur={() => validateField('sealNumber', newCollection)}
                  error={errors.sealNumber}
                  placeholder={t('docChainOfCustody.sealNumberPh')}
                  required
                />
              </div>

              <div>
                {/* The collector attests to the seal here rather than the form
                    asserting it for them. */}
                <label htmlFor="coc-integrity-verified" className="flex items-start gap-2 text-sm font-semibold text-content-secondary mb-2 cursor-pointer min-h-[24px] py-1">
                  <input
                    id="coc-integrity-verified"
                    type="checkbox"
                    checked={newCollection.integrityVerified}
                    onChange={(e) => setNewCollection({ ...newCollection, integrityVerified: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-border-interactive"
                  />
                  <span>{t('docChainOfCustody.integrityVerifiedLabel')}</span>
                </label>
              </div>

              <div>
                <label htmlFor="coc-container-type" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.containerTypeLabel')}</label>
                <input
                  id="coc-container-type"
                  type="text"
                  value={newCollection.containerType}
                  onChange={(e) => setNewCollection({ ...newCollection, containerType: e.target.value })}
                  placeholder={t('docChainOfCustody.containerTypePh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="coc-quantity" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.quantityLabel')}</label>
                <input
                  id="coc-quantity"
                  type="text"
                  value={newCollection.quantity}
                  onChange={(e) => setNewCollection({ ...newCollection, quantity: e.target.value })}
                  placeholder={t('docChainOfCustody.quantityPh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="coc-storage-conditions" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.storageConditionsLabel')}</label>
                <input
                  id="coc-storage-conditions"
                  type="text"
                  value={newCollection.storageConditions}
                  onChange={(e) => setNewCollection({ ...newCollection, storageConditions: e.target.value })}
                  placeholder={t('docChainOfCustody.storageConditionsPh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div className="col-span-2">
                <label htmlFor="coc-notes" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.notesLabel')}</label>
                <textarea
                  id="coc-notes"
                  value={newCollection.notes}
                  onChange={(e) => setNewCollection({ ...newCollection, notes: e.target.value })}
                  placeholder={t('docChainOfCustody.notesPh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>
            </div>
          </div>

          <div className="bg-caution-subtle border border-caution rounded-lg p-4 mb-6">
            <h3 className="font-bold text-caution-subtle-fg mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              {t('docChainOfCustody.requirementsTitle')}
            </h3>
            <ul className="text-sm text-caution-subtle-fg space-y-1">
              <li>• {t('docChainOfCustody.requirement1')}</li>
              <li>• {t('docChainOfCustody.requirement2')}</li>
              <li>• {t('docChainOfCustody.requirement3')}</li>
              <li>• {t('docChainOfCustody.requirement4')}</li>
              <li>• {t('docChainOfCustody.requirement5')}</li>
            </ul>
          </div>

          <button
            onClick={() => void handleCreateCustody()}
            className="w-full bg-gray-700 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors font-semibold"
          >
            {t('docChainOfCustody.createRecordBtn')}
          </button>
        </div>
      )}

      {activeTab === 'transfer' && (
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold mb-4">{t('docChainOfCustody.transferCustodyTitle')}</h2>

          {!selectedRecord ? (
            <div>
              <p className="text-content-muted mb-4">{t('docChainOfCustody.selectSpecimenPrompt')}</p>
              <div className="space-y-2">
                {activeRecords.map((record) => (
                  <button
                    key={record.custodyId}
                    onClick={() => setSelectedRecord(record)}
                    className="w-full text-left border border-border-strong rounded-lg p-4 hover:bg-surface-sunken transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-content">{record.custodyId}</p>
                        <p className="text-sm text-content-muted">
                          {record.patientName} • {record.specimenDescription}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(record.status)}`}>
                        {t(`docChainOfCustody.status_${record.status}`)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-notice-subtle border border-notice rounded-lg p-4">
                <h3 className="font-bold text-notice-subtle-fg mb-2">{t('docChainOfCustody.specimenInfoTitle')}</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-notice-subtle-fg">{t('docChainOfCustody.custodyIdLabel')}</p>
                    <p className="font-semibold text-notice-subtle-fg">{selectedRecord.custodyId}</p>
                  </div>
                  <div>
                    <p className="text-notice-subtle-fg">{t('docChainOfCustody.sealNumberLabel')}</p>
                    <p className="font-semibold text-notice-subtle-fg">{selectedRecord.sealNumber}</p>
                  </div>
                  <div>
                    <p className="text-notice-subtle-fg">{t('docChainOfCustody.patientLabel')}</p>
                    <p className="font-semibold text-notice-subtle-fg">{selectedRecord.patientName}</p>
                  </div>
                  <div>
                    <p className="text-notice-subtle-fg">{t('docChainOfCustody.lblCurrentCustodian')}</p>
                    <p className="font-semibold text-notice-subtle-fg">{selectedRecord.currentCustodian}</p>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="coc-transfer-to" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docChainOfCustody.transferToLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <Input
                  id="coc-transfer-to"
                  type="text"
                  value={transfer.transferredTo}
                  onChange={(e) => { clearTransferField('transferredTo'); setTransfer({ ...transfer, transferredTo: e.target.value }); }}
                  onBlur={() => validateTransferField('transferredTo', transfer)}
                  error={transferErrors.transferredTo}
                  placeholder={t('docChainOfCustody.transferToPh')}
                  required
                />
              </div>

              <div>
                <label htmlFor="coc-transfer-location" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docChainOfCustody.locationLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <Input
                  id="coc-transfer-location"
                  type="text"
                  value={transfer.location}
                  onChange={(e) => { clearTransferField('location'); setTransfer({ ...transfer, location: e.target.value }); }}
                  onBlur={() => validateTransferField('location', transfer)}
                  error={transferErrors.location}
                  placeholder={t('docChainOfCustody.locationPh')}
                  required
                />
              </div>

              <div>
                <label htmlFor="coc-transfer-condition" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.conditionLabel')}</label>
                <input
                  id="coc-transfer-condition"
                  type="text"
                  value={transfer.condition}
                  onChange={(e) => setTransfer({ ...transfer, condition: e.target.value })}
                  placeholder={t('docChainOfCustody.conditionPh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="coc-seal-intact"
                  type="checkbox"
                  checked={transfer.sealIntact}
                  onChange={(e) => setTransfer({ ...transfer, sealIntact: e.target.checked })}
                  className="w-5 h-5"
                />
                <label htmlFor="coc-seal-intact" className="text-sm font-semibold text-content-secondary">{t('docChainOfCustody.sealIntactLabel')}</label>
              </div>

              <div>
                <label htmlFor="coc-witness-signature" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.witnessSignatureLabel')}</label>
                <input
                  id="coc-witness-signature"
                  type="text"
                  value={transfer.witnessSignature}
                  onChange={(e) => setTransfer({ ...transfer, witnessSignature: e.target.value })}
                  placeholder={t('docChainOfCustody.witnessSignaturePh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="coc-transfer-notes" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.notesLabel')}</label>
                <textarea
                  id="coc-transfer-notes"
                  value={transfer.notes}
                  onChange={(e) => setTransfer({ ...transfer, notes: e.target.value })}
                  placeholder={t('docChainOfCustody.transferNotesPh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  rows={2}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => void handleTransfer()}
                  className="flex-1 bg-gray-700 text-white px-4 py-3 rounded-lg hover:bg-gray-800 transition-colors font-semibold"
                >
                  {t('docChainOfCustody.completeTransferBtn')}
                </button>
                <button
                  onClick={() => setSelectedRecord(null)}
                  className="px-6 py-3 border border-border-strong rounded-lg hover:bg-surface-sunken transition-colors"
                >
                  {t('docChainOfCustody.cancelBtn')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label htmlFor="coc-search" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.searchLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                  <input
                    id="coc-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docChainOfCustody.searchPh')}
                    className="w-full pl-10 pr-4 py-2 border border-border-interactive rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="coc-status-filter" className="block text-sm font-semibold text-content-secondary mb-2">{t('docChainOfCustody.statusLabel')}</label>
                <select
                  id="coc-status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as SpecimenStatus | 'all')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docChainOfCustody.filterAllStatuses')}</option>
                  <option value="collected">{t('docChainOfCustody.filterStatus_collected')}</option>
                  <option value="in-transit">{t('docChainOfCustody.filterStatus_in-transit')}</option>
                  <option value="received">{t('docChainOfCustody.filterStatus_received')}</option>
                  <option value="analyzed">{t('docChainOfCustody.filterStatus_analyzed')}</option>
                  <option value="stored">{t('docChainOfCustody.filterStatus_stored')}</option>
                  <option value="released">{t('docChainOfCustody.filterStatus_released')}</option>
                  <option value="destroyed">{t('docChainOfCustody.filterStatus_destroyed')}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
            <table className="w-full">
              <thead className="bg-surface-sunken border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">{t('docChainOfCustody.colStatus')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">{t('docChainOfCustody.colCustodyId')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">{t('docChainOfCustody.colPatient')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">{t('docChainOfCustody.colSpecimen')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">{t('docChainOfCustody.colCaseInfo')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">{t('docChainOfCustody.colCurrentStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRecords.map((record) => (
                  <tr key={record.custodyId} className="hover:bg-surface-sunken">
                    <td className="px-4 py-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${getStatusBadge(record.status)}`}>
                        {getStatusIcon(record.status)}
                        {t(`docChainOfCustody.status_${record.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-content">{record.custodyId}</p>
                      <p className="text-xs text-content-muted">{t('docChainOfCustody.sealLabel', { seal: record.sealNumber })}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-content">{record.patientName}</p>
                      <p className="text-xs text-content-muted">{record.patientId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-content">{record.specimenDescription}</p>
                      <p className="text-xs text-content-muted">{record.quantity}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-content capitalize">{t(`docChainOfCustody.purpose_${record.purpose}`)}</p>
                      <p className="text-xs text-content-muted">{record.caseNumber || t('docChainOfCustody.caseNA')}</p>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <p className="text-content">{record.currentCustodian}</p>
                      <p className="text-xs text-content-muted">{record.currentLocation}</p>
                      <p className="text-xs text-content-muted mt-1">{t('docChainOfCustody.transfersCountLabel', { count: record.transfers.length })}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChainOfCustodyPage;
