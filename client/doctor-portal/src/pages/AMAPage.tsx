import RecordPrintPreview from '../components/RecordPrintPreview';
import React, { useState, useEffect, useReducer } from 'react';
import {
  amaFormReducer, emptyAmaForm,
  readyForSignatures as signaturesMayBeCollected, signaturesComplete as signaturesAreComplete,
  toAmaDischargeRequest, type AmaFlag, type AmaForm, type AmaFormAction, type RiskLevel,
} from './AMAPage.form';
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
import PatientSelect from '../components/PatientSelect';
import {
  listAMADischarges,
  createAMADischarge,
  getPatients,
  useTranslation,
  clickable,
  Textarea,
  useValidatedForm,
  Input,
  amaDetailsSchema,
  collectAmaSignatures,
  getApiErrorMessage, ModalPanel, ChoiceChips
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

interface AMARecord {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  dateCreated: Date;
  status: AMAStatus;
  /** Absent on a record filed before the level was stored. */
  riskLevel?: RiskLevel;
  provider: string;
  diagnosis: string;
  recommendedTreatment: string;
  patientStatement: string;
  patientSigned: boolean;
  witnessSigned: boolean;
  witnessName?: string;
  providerSigned: boolean;
}

const RISK_LEVELS: readonly RiskLevel[] = ['low', 'moderate', 'high', 'critical'];

/** The risk level a register row carries, or nothing: never a guessed one. */
function storedRiskLevel(row: unknown): RiskLevel | undefined {
  const stored = (row as { risk_level?: unknown }).risk_level;
  return RISK_LEVELS.find((level) => level === stored);
}

const AMAPage: React.FC = () => {
  const [printRecord, setPrintRecord] = useState<unknown>(null);
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'list' | 'new' | 'view'>('list');
  const [records, setRecords] = useState<AMARecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<AMARecord | null>(null);
  // Signatures are taken at the bedside after the form is written, which is
  // why they are a separate step rather than a field on the create payload.
  const [signingRecord, setSigningRecord] = useState<AMARecord | null>(null);
  const [signatureText, setSignatureText] = useState('');
  const [signatureRefusedReason, setSignatureRefusedReason] = useState('');
  const [signatureWitness, setSignatureWitness] = useState('');
  const [signatureBusy, setSignatureBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AMAStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();
  // The roster this held existed only to fill a patient dropdown;
  // `PatientSelect` queries the server as the clinician types.

  // Everything the clinician enters is one object; AMAPage.form.ts owns its rules.
  const [form, dispatch] = useReducer(amaFormReducer, undefined, emptyAmaForm);
  const {
    formStep, patientId, patientName, mrn, diagnosis, recommendedTreatment,
    patientStatement, riskLevel, riskDisclosures, witnessName, hasCapacity, capacityBasis,
    patientRefusedAlternatives, amaFormSigned, witnessAttested, providerAttested, followUpOffered, patientContactInfoVerified,
  } = form;
  const setField = <K extends keyof AmaForm>(field: K, value: AmaForm[K]) =>
    dispatch({ type: 'set', field, value } as AmaFormAction);
  const toggleField = (field: AmaFlag) => dispatch({ type: 'toggle', field });

  useEffect(() => {
    const fetchAMARecords = async () => {
      if (!user?.userId) {
        setError(t('docAMA.errorAuth'));
        setLoading(false);
        return;
      }

      try {
        const data = await listAMADischarges();
        // Convert date strings to Date objects
        const amaRecords = (data as unknown[]).map((r) => ({
          ...(r as AMARecord),
          riskLevel: storedRiskLevel(r),
          dateCreated: new Date((r as { dateCreated?: string }).dateCreated || Date.now()),
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
        await getPatients();
      } catch (err) {
        // ux-allow(console-catch): a warm-up whose result is discarded; nothing on screen depends on it (debt register).
        console.error('Error fetching patients:', err);
      }
    };

    fetchAMARecords();
    fetchPatients();
  }, [user, t]);

  // One hook, because one form. Two would mean two `errors` objects and a
  // field could only ever be bound to one of them.
  const { errors, validate, validateField, clearField } = useValidatedForm(amaDetailsSchema);

  const amaDetails = () => ({
    patientName,
    diagnosis,
    recommendedTreatment,
    riskLevel,
    hasCapacity,
    capacityBasis,
  });

  const handleCreateAMA = async () => {
    if (isSubmitting) return;
    // The recommended treatment is the thing being refused. An AMA that does
    // not say what was advised records a refusal of nothing in particular,
    // which is what a later dispute turns on. Selecting the patient stays a
    // toast; the rest are field errors.
    if (!patientId) {
      showError(t('docAMA.errorRequiredFields'));
      return;
    }
    if (!validate(amaDetails())) {
      return;
    }
    // Said in words; the button used to be greyed out until all were present.
    if (!signaturesComplete) {
      showError(t('docAMA.errorSignaturesIncomplete'));
      return;
    }

    // Capacity is the precondition, not a later step.
    //
    // A patient who lacks decision-making capacity cannot validly refuse
    // treatment, so an AMA discharge filed without a capacity determination is
    // not a lawful AMA. `readyForSignatures` already gated the SIGNATURES on
    // capacity, but the record itself could be created without it — and the
    // server now refuses that with CAPACITY_DETERMINATION_REQUIRED. Asking here
    // means the clinician is told what is missing before they lose the form.
    // The capacity checkbox keeps its toast -- it sits in its own card, away
    // from the submit button. The basis is a field error and now says so on the
    // field: "capacity confirmed" with nothing written behind it is an
    // assertion, not a determination, and the basis is what a review reads.
    if (!validate(amaDetails())) {
      if (!hasCapacity) {
        showError(t('docAMA.errorCapacityRequired'));
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const newRecord = toAmaDischargeRequest(form, {
        attendingPhysicianId: user?.userId || '',
        dischargeDatetime: new Date().toISOString(),
      });

      await createAMADischarge(newRecord);
      showSuccess(t('docAMA.successCreated'));
      
      // Refresh list
      const updatedData = await listAMADischarges();
      const amaRecords = (updatedData as unknown[]).map((r) => ({
        ...(r as AMARecord),
        riskLevel: storedRiskLevel(r),
        dateCreated: new Date((r as { dateCreated?: string }).dateCreated || Date.now()),
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
    dispatch({ type: 'reset' });
  };

  const getStatusBadge = (status: AMAStatus) => {
    const styles = {
      'draft': 'bg-surface-sunken text-content-secondary',
      'pending-signatures': 'bg-caution-subtle text-caution-subtle-fg',
      'completed': 'bg-ok-subtle text-ok-subtle-fg',
      'voided': 'bg-critical-subtle text-critical-subtle-fg'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {t(`docAMA.status_${status}`)}
      </span>
    );
  };

  const getRiskBadge = (level: RiskLevel | undefined) => {
    // No badge for a record with no stored level: a blank one read as a level.
    if (!level) return null;
    const styles = {
      'low': 'bg-ok-subtle text-ok-subtle-fg',
      'moderate': 'bg-caution-subtle text-caution-subtle-fg',
      'high': 'bg-surface-sunken text-content-secondary',
      'critical': 'bg-critical-subtle text-critical-subtle-fg'
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
    dispatch({ type: 'acknowledgeRisk', id });
  };

  const readyForSignatures = signaturesMayBeCollected(form);
  const signaturesComplete = signaturesAreComplete(form);

  return (
    <div className="min-h-screen bg-surface-sunken">
      <RecordPrintPreview title="AMA record" record={printRecord} onClose={() => setPrintRecord(null)} />
      {/* Header */}
      <div className="bg-gradient-to-r from-red-700 to-orange-800 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <FileWarning className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('docAMA.title')}</h1>
        </div>
        <p className="text-white">{t('docAMA.subtitle')}</p>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-critical-subtle-fg animate-spin mb-2" />
          <p className="text-content-muted">{t('docAMA.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="m-4 bg-critical-subtle border border-critical rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-critical flex-shrink-0" />
          <div>
            <p className="text-sm text-critical-subtle-fg">{error}</p>
            <p className="text-xs text-critical mt-1">{t('docAMA.errorHint')}</p>
          </div>
        </div>
      )}

      {/* Content (only show when loaded) */}
      {!loading && !error && (
        <>
          {/* Tabs */}
          <div className="bg-surface border-b sticky top-0 z-10">
            <div className="flex">
              {(['list', 'new'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    if (tab === 'new') {
                      dispatch({ type: 'startNew' });
                    }
                  }}
                  className={`flex-1 py-3 text-sm font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? 'text-critical-subtle-fg border-b-2 border-red-600'
                      : 'text-content-muted hover:text-content-secondary'
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
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
                    <input aria-label={t('docAMA.searchPh')}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('docAMA.searchPh')}
                      className="w-full pl-10 pr-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                  <ChoiceChips
                    label={t('common.filterByStatus')}
                    value={statusFilter}
                    onChange={(next) => { if (next === undefined) return; setStatusFilter(next as AMAStatus | 'all'); }}
                    options={[
                      { value: 'all', label: t('docAMA.filterAll') },
                      { value: 'draft', label: t('docAMA.status_draft') },
                      { value: 'pending-signatures', label: t('docAMA.status_pending-signatures') },
                      { value: 'completed', label: t('docAMA.status_completed') },
                      { value: 'voided', label: t('docAMA.status_voided') },
                    ]}
                  />
            </div>

            {/* Records List */}
            <div className="bg-surface rounded-lg shadow divide-y">
              {filteredRecords.length === 0 ? (
                <div className="p-8 text-center text-content-muted">
                  <FileWarning className="w-12 h-12 mx-auto mb-3 text-content-muted" />
                  <p>{t('docAMA.noRecords')}</p>
                </div>
              ) : (
                filteredRecords.map(record => (
                  <div
                    key={record.id}
                    className="p-4 hover:bg-surface-sunken cursor-pointer"
                    {...clickable(() => {
                      setSelectedRecord(record);
                      setActiveTab('view');
                    })}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-full ${
                          record.riskLevel === 'critical' ? 'bg-critical-subtle' :
                          record.riskLevel === 'high' ? 'bg-surface-sunken' :
                          'bg-caution-subtle'
                        }`}>
                          <AlertTriangle className={`w-5 h-5 ${
                            record.riskLevel === 'critical' ? 'text-critical-subtle-fg' :
                            record.riskLevel === 'high' ? 'text-content-secondary' :
                            'text-caution-subtle-fg'
                          }`} />
                        </div>
                        <div>
                          <h3 className="font-medium text-content">{record.patientName}</h3>
                          <p className="text-sm text-content-muted">{t('docAMA.mrnLine', { mrn: record.mrn, id: record.id })}</p>
                          <p className="text-sm text-content-muted mt-1">{record.diagnosis}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {getStatusBadge(record.status)}
                        {getRiskBadge(record.riskLevel)}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-xs text-content-muted">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {record.dateCreated.toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {record.provider}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center gap-1 ${record.patientSigned ? 'text-ok-subtle-fg' : 'text-content-muted'}`}>
                          <UserCheck className="w-3 h-3" /> {t('docAMA.sigPatient')}
                        </span>
                        <span className={`flex items-center gap-1 ${record.witnessSigned ? 'text-ok-subtle-fg' : 'text-content-muted'}`}>
                          <Users className="w-3 h-3" /> {t('docAMA.sigWitness')}
                        </span>
                        <span className={`flex items-center gap-1 ${record.providerSigned ? 'text-ok-subtle-fg' : 'text-content-muted'}`}>
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
              className="text-critical-subtle-fg hover:text-critical-subtle-fg text-sm font-medium"
            >
              {t('docAMA.backToRecords')}
            </button>

            {/* Header Card */}
            <div className="bg-surface rounded-lg shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-xl font-bold text-content">{selectedRecord.patientName}</h2>
                    {getStatusBadge(selectedRecord.status)}
                  </div>
                  <p className="text-content-muted">{t('docAMA.mrnLine', { mrn: selectedRecord.mrn, id: selectedRecord.id })}</p>
                </div>
                {getRiskBadge(selectedRecord.riskLevel)}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-content-muted">{t('docAMA.lblDateCreated')}</p>
                  <p className="font-medium">{selectedRecord.dateCreated.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-content-muted">{t('docAMA.lblProvider')}</p>
                  <p className="font-medium">{selectedRecord.provider}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-content-muted">{t('docAMA.lblDiagnosis')}</p>
                  <p className="font-medium">{selectedRecord.diagnosis}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-content-muted">{t('docAMA.lblRecommendedTreatment')}</p>
                  <p className="font-medium">{selectedRecord.recommendedTreatment}</p>
                </div>
              </div>
            </div>

            {/* Signature Status */}
            <div className="bg-surface rounded-lg shadow p-6">
              <h3 className="font-semibold text-content mb-4">{t('docAMA.signatureStatusTitle')}</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
                  <div className="flex items-center gap-3">
                    <UserCheck className="w-5 h-5 text-content-muted" />
                    <span>{t('docAMA.lblPatientSignature')}</span>
                  </div>
                  {selectedRecord.patientSigned ? (
                    <CheckCircle className="w-6 h-6 text-ok" />
                  ) : (
                    <XCircle className="w-6 h-6 text-content-muted" />
                  )}
                </div>
                <div className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
                  <div className="flex items-center gap-3">
                    <Users className="w-5 h-5 text-content-muted" />
                    <span>{t('docAMA.lblWitnessSignature')} {selectedRecord.witnessName && `(${selectedRecord.witnessName})`}</span>
                  </div>
                  {selectedRecord.witnessSigned ? (
                    <CheckCircle className="w-6 h-6 text-ok" />
                  ) : (
                    <XCircle className="w-6 h-6 text-content-muted" />
                  )}
                </div>
                <div className="flex items-center justify-between p-3 bg-surface-sunken rounded-lg">
                  <div className="flex items-center gap-3">
                    <Pen className="w-5 h-5 text-content-muted" />
                    <span>{t('docAMA.lblProviderSignature')}</span>
                  </div>
                  {selectedRecord.providerSigned ? (
                    <CheckCircle className="w-6 h-6 text-ok" />
                  ) : (
                    <XCircle className="w-6 h-6 text-content-muted" />
                  )}
                </div>
              </div>
            </div>

            {/* Patient Statement */}
            {selectedRecord.patientStatement && (
              <div className="bg-surface rounded-lg shadow p-6">
                <h3 className="font-semibold text-content mb-2">{t('docAMA.patientStatementTitle')}</h3>
                <p className="text-content-secondary italic">"{selectedRecord.patientStatement}"</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button type="button" onClick={() => setPrintRecord(selectedRecord)} className="flex-1 py-3 bg-critical text-critical-fg rounded-lg font-semibold flex items-center justify-center gap-2">
                <Printer className="w-5 h-5" />
                {t('docAMA.printDocument')}
              </button>
              {selectedRecord.status === 'pending-signatures' && (
                <button
                  type="button"
                  onClick={() => {
                    setSigningRecord(selectedRecord);
                    setSignatureText('');
                    setSignatureRefusedReason('');
                    setSignatureWitness('');
                  }}
                  className="flex-1 py-3 border border-critical text-critical-subtle-fg rounded-lg font-semibold"
                >
                  {t('docAMA.collectSignatures')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* New AMA Form */}
        {activeTab === 'new' && (
          <form onSubmit={(event) => { event.preventDefault(); void handleCreateAMA(); }} noValidate>
          <div className="space-y-4">
            {/* Progress Steps */}
            <div className="bg-surface rounded-lg shadow p-4">
              <div className="flex items-center justify-between">
                {[1, 2, 3, 4].map(step => (
                  <div key={step} className="flex items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
                      formStep >= step
                        ? 'bg-critical text-critical-fg'
                        : 'bg-surface-sunken text-content-muted'
                    }`}>
                      {step}
                    </div>
                    {step < 4 && (
                      <div className={`w-12 sm:w-20 h-1 ${
                        formStep > step ? 'bg-critical' : 'bg-surface-sunken'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-content-muted">
                <span>{t('docAMA.stepPatientInfo')}</span>
                <span>{t('docAMA.stepMedicalDetails')}</span>
                <span>{t('docAMA.stepRiskDisclosure')}</span>
                <span>{t('docAMA.stepSignatures')}</span>
              </div>
            </div>

            {/* Step 1: Patient Info */}
            {formStep === 1 && (
              <div className="bg-surface rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-content mb-4">{t('docAMA.patientInfoTitle')}</h3>
                <div className="space-y-4">
                  {/* One control, not three. This was a dropdown of whoever
                      the page had fetched, plus a free-text patient id and a
                      free-text name that could disagree with it -- an AMA
                      record filed against a typed id belongs to nobody. The
                      picker searches the server by name or id and fills both. */}
                  <PatientSelect
                    id="ama-patient-select"
                    label={t('docAMA.selectPatientLabel')}
                    value={patientId}
                    onChange={(selectedPatientId, selectedPatient) => {
                      setField('patientId', selectedPatientId);
                      if (selectedPatient) setField('patientName', selectedPatient.full_name);
                    }}
                    required
                  />
                  {patientName && (
                    <p className="text-sm text-content-muted px-1">
                      {t('docAMA.patientNameLabel')}: <span className="text-content font-medium">{patientName}</span>
                    </p>
                  )}
                  <div>
                    <label htmlFor="ama-mrn" className="block text-sm font-medium text-content-secondary mb-1">
                      {t('docAMA.mrnLabel')} <span className="text-critical">*</span>
                    </label>
                    <input
                      id="ama-mrn"
                      type="text"
                      value={mrn}
                      onChange={(e) => setField('mrn', e.target.value)}
                      placeholder={t('docAMA.mrnPh')}
                      className="w-full border border-border-interactive rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
                <button type="button"
                  onClick={() => setField('formStep', 2)}
                  disabled={!patientId || !patientName || !mrn}
                  className={`w-full mt-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                    patientId && patientName && mrn
                      ? 'bg-critical text-critical-fg hover:bg-critical'
                      : 'bg-surface-sunken text-content-muted cursor-not-allowed'
                  }`}
                >
                  {t('docAMA.continueBtn')}
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Step 2: Medical Details */}
            {formStep === 2 && (
              <div className="bg-surface rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-content mb-4">{t('docAMA.medicalDetailsTitle')}</h3>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="ama-diagnosis" className="block text-sm font-medium text-content-secondary mb-1">
                      {t('docAMA.diagnosisLabel')} <span className="text-critical">*</span>
                    </label>
                    <Input
                      type="text"
                      placeholder={t('docAMA.diagnosisPh')}
                      id="ama-diagnosis"
                      value={diagnosis}
                      onChange={(e) => { clearField('diagnosis'); setField('diagnosis', e.target.value); }}
                      onBlur={() => validateField('diagnosis', amaDetails())}
                      error={errors.diagnosis}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="ama-recommended-treatment" className="block text-sm font-medium text-content-secondary mb-1">
                      {t('docAMA.recommendedTreatmentLabel')} <span className="text-critical">*</span>
                    </label>
                    <textarea
                      id="ama-recommended-treatment"
                      value={recommendedTreatment}
                      onChange={(e) => setField('recommendedTreatment', e.target.value)}
                      rows={3}
                      placeholder={t('docAMA.recommendedTreatmentPh')}
                      className="w-full border border-border-interactive rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-content-secondary mb-1">
                      {t('docAMA.riskLevelLabel')} <span className="text-critical">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {RISK_LEVELS.map(level => (
                        <button type="button"
                          key={level}
                          aria-pressed={riskLevel === level}
                          onClick={() => { clearField('riskLevel'); setField('riskLevel', level); }}
                          className={`py-2 px-4 rounded-lg border-2 capitalize font-medium ${
                            riskLevel === level
                              ? level === 'critical' ? 'border-red-500 bg-critical-subtle text-critical-subtle-fg' :
                                level === 'high' ? 'border-orange-500 bg-surface-sunken text-content-secondary' :
                                level === 'moderate' ? 'border-yellow-500 bg-caution-subtle text-caution-subtle-fg' :
                                'border-green-500 bg-ok-subtle text-ok-subtle-fg'
                              : 'border-border hover:border-border-strong'
                          }`}
                        >
                          {t(`docAMA.level_${level}`)}
                        </button>
                      ))}
                    </div>
                    {errors.riskLevel && (
                      <p role="alert" className="mt-1 text-sm text-critical-subtle-fg">{errors.riskLevel}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button type="button"
                    onClick={() => setField('formStep', 1)}
                    className="flex-1 py-3 border border-border-strong rounded-lg font-semibold"
                  >
                    {t('docAMA.backBtn')}
                  </button>
                  <button type="button"
                    onClick={() => setField('formStep', 3)}
                    disabled={!diagnosis || !recommendedTreatment}
                    className={`flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                      diagnosis && recommendedTreatment
                        ? 'bg-critical text-critical-fg hover:bg-critical'
                        : 'bg-surface-sunken text-content-muted cursor-not-allowed'
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
              <div className="bg-surface rounded-lg shadow p-6">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-6 h-6 text-critical-subtle-fg" />
                  <h3 className="text-lg font-semibold text-content">{t('docAMA.riskDisclosureTitle')}</h3>
                </div>
                <p className="text-sm text-content-muted mb-4">
                  {t('docAMA.riskDisclosureIntro')}
                </p>

                {/* Capacity assessment — precedes the risk disclosures because
                    acknowledging risks means nothing if the patient could not
                    weigh them. */}
                <fieldset className="mb-4 p-4 border border-caution bg-caution-subtle rounded-lg">
                  <legend className="px-1 text-sm font-semibold text-caution-subtle-fg">
                    {t('docAMA.capacityHeading')}
                  </legend>
                  <label htmlFor="ama-has-capacity" className="flex items-start gap-2 cursor-pointer">
                    <input
                      id="ama-has-capacity"
                      type="checkbox"
                      checked={hasCapacity}
                      onChange={() => setField('hasCapacity', !hasCapacity)}
                      className="mt-1 rounded border-border-interactive text-critical-subtle-fg"
                    />
                    <span className="text-sm font-medium text-content">
                      {t('docAMA.capacityLabel')}
                    </span>
                  </label>
                  <label htmlFor="ama-capacity-basis" className="sr-only">
                    {t('docAMA.capacityBasisLabel')}
                  </label>
                  <Textarea
                    id="ama-capacity-basis"
                    value={capacityBasis}
                    onChange={(e) => { clearField('capacityBasis'); setField('capacityBasis', e.target.value); }}
                    onBlur={() => validateField('capacityBasis', amaDetails())}
                    error={errors.capacityBasis}
                    rows={3}
                    placeholder={t('docAMA.capacityBasisPh')}
                    required
                  />
                </fieldset>

                <div className="space-y-3">
                  {riskDisclosures.map(risk => (
                    <div
                      key={risk.id}
                      {...clickable(() => handleRiskAcknowledge(risk.id))}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        risk.acknowledged
                          ? 'border-green-500 bg-ok-subtle'
                          : 'border-border hover:border-border-strong'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                          risk.acknowledged ? 'bg-green-500' : 'bg-surface-sunken'
                        }`}>
                          {risk.acknowledged && <CheckCircle className="w-4 h-4 text-white" />}
                        </div>
                        <div className="flex-1">
                          <span className="text-xs text-content-muted">{risk.category}</span>
                          <p className="text-content">{risk.risk}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <label htmlFor="ama-patient-statement" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('docAMA.patientStatementLabel')}
                  </label>
                  <textarea
                    id="ama-patient-statement"
                    value={patientStatement}
                    onChange={(e) => setField('patientStatement', e.target.value)}
                    rows={3}
                    placeholder={t('docAMA.patientStatementPh')}
                    className="w-full border border-border-interactive rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <label htmlFor="ama-refused-alternatives" className="mt-4 flex items-start gap-2 cursor-pointer">
                  <input
                    id="ama-refused-alternatives"
                    type="checkbox"
                    checked={patientRefusedAlternatives}
                    onChange={() => toggleField('patientRefusedAlternatives')}
                    className="mt-1 rounded border-border-interactive text-critical-subtle-fg"
                  />
                  <span className="text-sm font-medium text-content">
                    {t('docAMA.patientRefusedAlternativesLabel')}
                  </span>
                </label>
                <div className="flex gap-3 mt-6">
                  <button type="button"
                    onClick={() => setField('formStep', 2)}
                    className="flex-1 py-3 border border-border-strong rounded-lg font-semibold"
                  >
                    {t('docAMA.backBtn')}
                  </button>
                  <button type="button"
                    onClick={() => setField('formStep', 4)}
                    disabled={!readyForSignatures}
                    className={`flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                      readyForSignatures
                        ? 'bg-critical text-critical-fg hover:bg-critical'
                        : 'bg-surface-sunken text-content-muted cursor-not-allowed'
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
              <div className="bg-surface rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-content mb-4">{t('docAMA.collectSignaturesTitle')}</h3>

                <div className="space-y-4">
                  {/* Patient Signature */}
                  <div className="p-4 border-2 border-dashed border-border-strong rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-5 h-5 text-content-muted" />
                        <span className="font-medium">{t('docAMA.lblPatientSignature')}</span>
                      </div>
                      <span className="text-critical text-sm">{t('docAMA.requiredLabel')}</span>
                    </div>
                    <label htmlFor="ama-form-signed" className="flex items-center gap-2 rounded border border-border bg-surface-sunken p-4 cursor-pointer">
                      <input
                        id="ama-form-signed"
                        type="checkbox"
                        checked={amaFormSigned}
                        onChange={() => toggleField('amaFormSigned')}
                      />
                      <span className="text-sm text-content">{t('docAMA.patientSignedLabel')}</span>
                    </label>
                  </div>

                  {/* Witness */}
                  <div className="p-4 border-2 border-dashed border-border-strong rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-content-muted" />
                        <span className="font-medium">{t('docAMA.lblWitnessSignature')}</span>
                      </div>
                      <span className="text-critical text-sm">{t('docAMA.requiredLabel')}</span>
                    </div>
                    <label htmlFor="ama-witness-name" className="sr-only">{t('docAMA.witnessNamePh')}</label>
                    <input
                      id="ama-witness-name"
                      type="text"
                      value={witnessName}
                      onChange={(e) => setField('witnessName', e.target.value)}
                      placeholder={t('docAMA.witnessNamePh')}
                      className="w-full border border-border-interactive rounded-lg p-2 mb-2 focus:ring-2 focus:ring-red-500"
                    />
                    <label htmlFor="ama-witness-attested" className="flex items-center gap-2 rounded border border-border bg-surface-sunken p-4 cursor-pointer">
                      <input
                        id="ama-witness-attested"
                        type="checkbox"
                        checked={witnessAttested}
                        onChange={() => toggleField('witnessAttested')}
                        disabled={!witnessName.trim()}
                      />
                      <span className="text-sm text-content">{t('docAMA.witnessAttestedLabel')}</span>
                    </label>
                  </div>

                  {/* Provider */}
                  <div className="p-4 border-2 border-dashed border-border-strong rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Pen className="w-5 h-5 text-content-muted" />
                        <span className="font-medium">{t('docAMA.lblProviderSignature')}</span>
                      </div>
                      <span className="text-critical text-sm">{t('docAMA.requiredLabel')}</span>
                    </div>
                    <label htmlFor="ama-provider-attested" className="flex items-center gap-2 rounded border border-border bg-surface-sunken p-4 cursor-pointer">
                      <input
                        id="ama-provider-attested"
                        type="checkbox"
                        checked={providerAttested}
                        onChange={() => toggleField('providerAttested')}
                      />
                      <span className="text-sm text-content">{t('docAMA.providerAttestedLabel')}</span>
                    </label>
                  </div>
                </div>

                <fieldset className="mt-4 space-y-3 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-semibold text-content">{t('docAMA.dischargeChecksTitle')}</legend>
                  <label htmlFor="ama-follow-up-offered" className="flex items-center gap-2 cursor-pointer">
                    <input
                      id="ama-follow-up-offered"
                      type="checkbox"
                      checked={followUpOffered}
                      onChange={() => toggleField('followUpOffered')}
                    />
                    <span className="text-sm text-content">{t('docAMA.followUpOfferedLabel')}</span>
                  </label>
                  <label htmlFor="ama-contact-verified" className="flex items-center gap-2 cursor-pointer">
                    <input
                      id="ama-contact-verified"
                      type="checkbox"
                      checked={patientContactInfoVerified}
                      onChange={() => toggleField('patientContactInfoVerified')}
                    />
                    <span className="text-sm text-content">{t('docAMA.contactVerifiedLabel')}</span>
                  </label>
                </fieldset>

                {/* Legal Notice */}
                <div className="mt-4 p-4 bg-caution-subtle rounded-lg">
                  <div className="flex items-start gap-2">
                    <Shield className="w-5 h-5 text-caution-subtle-fg mt-0.5" />
                    <div>
                      <p className="font-medium text-caution-subtle-fg">{t('docAMA.legalNoticeTitle')}</p>
                      <p className="text-sm text-caution-subtle-fg mt-1">
                        {t('docAMA.legalNoticeText')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button type="button"
                    onClick={() => setField('formStep', 3)}
                    className="flex-1 py-3 border border-border-strong rounded-lg font-semibold"
                  >
                    {t('docAMA.backBtn')}
                  </button>
                  <button type="submit"
                    aria-disabled={isSubmitting || undefined}
                    className="aria-disabled:cursor-wait flex-1 py-3 bg-critical text-critical-fg rounded-lg font-semibold flex items-center justify-center gap-2"
                  >
                    {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                    {t('docAMA.completeFormBtn')}
                  </button>
                </div>
              </div>
            )}

            {/* Warning Banner */}
            <div className="bg-critical-subtle border border-critical rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-critical-subtle-fg mt-0.5" />
                <div>
                  <p className="font-medium text-critical-subtle-fg">{t('docAMA.importantDocTitle')}</p>
                  <p className="text-sm text-critical-subtle-fg mt-1">
                    {t('docAMA.importantDocText')}
                  </p>
                </div>
              </div>
            </div>
          </div>
          </form>
        )}
          </div>
        </>
      )}

      {/* Either a signature or a stated reason there is none -- never neither.
          A form marked handled with nothing behind it leaves the record as
          unevidenced as before, which is what this button used to do. */}
      {signingRecord && (
        <ModalPanel labelledBy="ama-dialog-title" closeOnBackdrop={false} onClose={() => setSigningRecord(null)} overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" className="bg-surface rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 id="ama-dialog-title" className="text-lg font-semibold text-content">
              {t('docAMA.collectSignaturesTitle')}
            </h2>
            <div>
              <label htmlFor="ama-sig-patient" className="block text-sm font-medium text-content-secondary mb-1">
                {t('docAMA.lblPatientSignature')}
              </label>
              <input
                id="ama-sig-patient"
                type="text"
                value={signatureText}
                onChange={(e) => setSignatureText(e.target.value)}
                placeholder={t('docAMA.sigTypedPlaceholder')}
                className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content"
              />
            </div>
            <div>
              <label htmlFor="ama-sig-refused" className="block text-sm font-medium text-content-secondary mb-1">
                {t('docAMA.sigRefusedLabel')}
              </label>
              <input
                id="ama-sig-refused"
                type="text"
                value={signatureRefusedReason}
                onChange={(e) => setSignatureRefusedReason(e.target.value)}
                className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content"
              />
              <p className="mt-1 text-xs text-content-muted">{t('docAMA.sigRefusedHint')}</p>
            </div>
            <div>
              <label htmlFor="ama-sig-witness" className="block text-sm font-medium text-content-secondary mb-1">
                {t('docAMA.lblWitnessSignature')}
              </label>
              <input
                id="ama-sig-witness"
                type="text"
                value={signatureWitness}
                onChange={(e) => setSignatureWitness(e.target.value)}
                className="w-full px-3 py-2 border border-border-interactive rounded-lg bg-surface text-content"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSigningRecord(null)}
                className="flex-1 px-4 py-2 border border-border rounded-lg text-content"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={signatureBusy}
                onClick={async () => {
                  if (!signatureText.trim() && !signatureRefusedReason.trim()) {
                    showError(t('docAMA.sigNeedOne'));
                    return;
                  }
                  setSignatureBusy(true);
                  try {
                    await collectAmaSignatures(signingRecord.id, {
                      patientSignature: signatureText.trim() || null,
                      refusedReason: signatureRefusedReason.trim() || null,
                      witnessName: signatureWitness.trim() || null,
                      witnessSignature: signatureWitness.trim() || null,
                    });
                    showSuccess(t('docAMA.sigRecorded'));
                    setSigningRecord(null);
                    setSelectedRecord(null);
                  } catch (err) {
                    showError(getApiErrorMessage(err, t('docAMA.sigFailed')));
                  } finally {
                    setSignatureBusy(false);
                  }
                }}
                className="flex-1 px-4 py-2 bg-brand text-brand-fg rounded-lg disabled:bg-disabled disabled:text-disabled-fg"
              >
                {t('docAMA.sigSubmit')}
              </button>
            </div>
          </ModalPanel>
      )}
    </div>
  );
};

export default AMAPage;
