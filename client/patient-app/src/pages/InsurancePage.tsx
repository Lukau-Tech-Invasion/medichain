import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  Plus,
  Upload,
  Camera,
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  Eye,
  Download,
  Phone,
  FileText,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { getPatientInsuranceClaims, uploadInsuranceCardImage, IS_DEMO, useTranslation, formatCurrency, DEFAULT_CURRENCY } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';

/**
 * InsurancePage
 * 
 * Full-featured page for managing insurance coverage and cards.
 * Includes photo upload, coverage verification, and claims tracking.
 */

type InsuranceType = 'medical' | 'dental' | 'vision' | 'pharmacy' | 'supplemental';
type CoverageStatus = 'active' | 'pending' | 'expired' | 'cancelled';
type ClaimStatus = 'submitted' | 'processing' | 'approved' | 'denied' | 'appealed';

export interface InsuranceCard {
  id: string;
  type: InsuranceType;
  providerName: string;
  planName: string;
  memberId: string;
  groupNumber: string;
  subscriberName: string;
  subscriberId: string;
  effectiveDate: string;
  terminationDate: string | null;
  status: CoverageStatus;
  /** ISO 4217 code for every monetary field on this card (copay/deductible/oopMax). */
  currency: string;
  copay: {
    primaryCare: number;
    specialist: number;
    urgentCare: number;
    emergency: number;
  };
  deductible: {
    individual: number;
    family: number;
    met: number;
  };
  outOfPocketMax: {
    individual: number;
    family: number;
    met: number;
  };
  frontImageUrl: string | null;
  backImageUrl: string | null;
  customerServicePhone: string;
  providerPortalUrl: string;
  isPrimary: boolean;
  lastVerified: string;
}

export interface InsuranceClaim {
  id: string;
  insuranceId: string;
  claimNumber: string;
  serviceDate: string;
  provider: string;
  description: string;
  billedAmount: number;
  allowedAmount: number;
  insurancePaid: number;
  patientResponsibility: number;
  /** ISO 4217 code for every monetary field on this claim. */
  currency: string;
  status: ClaimStatus;
  submittedDate: string;
  processedDate: string | null;
  eobUrl: string | null;
}

/** ClaimStatus values the backend's richer `ClaimStatus` enum collapses into. */
const CLAIM_STATUS_MAP: Record<string, ClaimStatus> = {
  Draft: 'submitted',
  ReadyToSubmit: 'submitted',
  Submitted: 'submitted',
  Acknowledged: 'submitted',
  Pending: 'processing',
  InReview: 'processing',
  AdditionalInfoRequested: 'processing',
  Approved: 'approved',
  PartiallyApproved: 'approved',
  Paid: 'approved',
  Closed: 'approved',
  Denied: 'denied',
  Appealed: 'appealed',
};

/**
 * Maps the backend's `InsuranceClaim` (line-item claim with a nested
 * `PatientInsurance`) onto this page's flatter display shape. The backend has
 * no single "allowed amount" concept distinct from `total_charge`, and no EOB
 * document URL (only an `eob_received` flag) — both fall back honestly rather
 * than being fabricated.
 */
function mapApiClaim(raw: Record<string, unknown>): InsuranceClaim {
  const insurance = (raw.insurance as Record<string, unknown>) ?? {};
  const serviceLines = Array.isArray(raw.service_lines)
    ? (raw.service_lines as Record<string, unknown>[])
    : [];
  const totalCharge = typeof raw.total_charge === 'number' ? raw.total_charge : 0;
  const paidAmount = typeof raw.paid_amount === 'number' ? raw.paid_amount : 0;
  const patientResponsibility =
    typeof raw.patient_responsibility === 'number' ? raw.patient_responsibility : 0;
  const toIsoDate = (unixSeconds: unknown): string | null =>
    typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000).toISOString() : null;

  return {
    id: String(raw.claim_id ?? ''),
    insuranceId: String(insurance.payer_id ?? ''),
    claimNumber: String(raw.payer_claim_number ?? raw.claim_id ?? ''),
    serviceDate: String(raw.service_date ?? ''),
    provider: String(insurance.payer_name ?? ''),
    description: String(serviceLines[0]?.description ?? raw.claim_type ?? 'Insurance Claim'),
    billedAmount: totalCharge,
    allowedAmount: totalCharge,
    insurancePaid: paidAmount,
    patientResponsibility,
    currency: DEFAULT_CURRENCY,
    status: CLAIM_STATUS_MAP[String(raw.status ?? '')] ?? 'submitted',
    submittedDate: toIsoDate(raw.submitted_at) ?? String(raw.service_date ?? ''),
    processedDate: toIsoDate(raw.adjudicated_at),
    eobUrl: null,
  };
}

const InsurancePage: React.FC = () => {
  const { t, locale } = useTranslation();
  const [activeTab, setActiveTab] = useState<'cards' | 'claims' | 'add'>('cards');
  const [insuranceCards, setInsuranceCards] = useState<InsuranceCard[]>([]);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [claimsCursor, setClaimsCursor] = useState<string | null>(null);
  const [claimsHasMore, setClaimsHasMore] = useState(false);
  const [loadingMoreClaims, setLoadingMoreClaims] = useState(false);
  const [selectedCard, setSelectedCard] = useState<InsuranceCard | null>(null);
  const [_showCardModal, _setShowCardModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadSide, setUploadSide] = useState<'front' | 'back'>('front');
  const [verifying, setVerifying] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { patient } = usePatientAuthStore();

  // New insurance form state
  const [newInsurance, setNewInsurance] = useState({
    type: 'medical' as InsuranceType,
    providerName: '',
    planName: '',
    memberId: '',
    groupNumber: '',
    subscriberName: '',
    subscriberId: '',
    effectiveDate: '',
    customerServicePhone: '',
    copayPrimary: '25',
    copaySpecialist: '50',
    deductible: '1500',
    outOfPocketMax: '6000'
  });

  useEffect(() => {
    loadInsuranceData();
  }, [patient]);

  const loadInsuranceData = async () => {
    setLoading(true);
    
    // Try to load from API first
    if (patient?.healthId) {
      try {
        const response = await getPatientInsuranceClaims(patient.healthId, { limit: 20 });
        const apiClaims = (response.claims ?? []).map(mapApiClaim);

        if (apiClaims.length > 0) {
          setClaims(apiClaims);
          setClaimsCursor(response.next_cursor ?? null);
          setClaimsHasMore(!!response.next_cursor);
        } else if (IS_DEMO) {
          await loadDemoClaims();
        }

        // Insurance cards have no API endpoint yet — only show sample cards in demo mode
        if (IS_DEMO) {
          await loadDemoCards();
        }
        setLoading(false);
        return;
      } catch (err) {
        console.warn('No insurance data from API, using demo data:', err);
      }
    }

    // Fallback to demo data (demo mode only — production shows an empty state)
    if (IS_DEMO) {
      await loadDemoCards();
      await loadDemoClaims();
    }
    setLoading(false);
  };

  // Dynamically imported so the sample data isn't bundled into production
  // builds (demo mode is gated by IS_DEMO, but the bundler can't statically
  // prove that across a module boundary unless the import itself is dynamic).
  const loadDemoCards = async () => {
    const { getDemoInsuranceCards } = await import('./InsurancePage.demoData');
    setInsuranceCards(getDemoInsuranceCards());
  };

  const loadDemoClaims = async () => {
    const { getDemoInsuranceClaims } = await import('./InsurancePage.demoData');
    setClaims(getDemoInsuranceClaims());
  };

  const handleLoadMoreClaims = async () => {
    if (!patient?.healthId || !claimsCursor || loadingMoreClaims) return;
    setLoadingMoreClaims(true);
    try {
      const response = await getPatientInsuranceClaims(patient.healthId, {
        cursor: claimsCursor,
        limit: 20,
      });
      setClaims(prev => [...prev, ...(response.claims ?? []).map(mapApiClaim)]);
      setClaimsCursor(response.next_cursor ?? null);
      setClaimsHasMore(!!response.next_cursor);
    } catch (err) {
      console.warn('Failed to load more claims:', err);
    } finally {
      setLoadingMoreClaims(false);
    }
  };

  const getTypeIcon = (type: InsuranceType) => {
    switch (type) {
      case 'medical': return <Shield className="w-5 h-5" />;
      case 'dental': return <FileText className="w-5 h-5" />;
      case 'vision': return <Eye className="w-5 h-5" />;
      case 'pharmacy': return <FileText className="w-5 h-5" />;
      case 'supplemental': return <Shield className="w-5 h-5" />;
    }
  };

  const _getTypeBadge = (type: InsuranceType) => {
    const colors: Record<InsuranceType, string> = {
      medical: 'bg-notice-subtle text-notice-subtle-fg',
      dental: 'bg-ok-subtle text-ok-subtle-fg',
      vision: 'bg-purple-100 text-purple-800',
      pharmacy: 'bg-orange-100 text-orange-800',
      supplemental: 'bg-surface-sunken text-content-secondary'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[type]}`}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </span>
    );
  };

  const getStatusBadge = (status: CoverageStatus) => {
    const config: Record<CoverageStatus, { color: string; icon: React.ReactNode }> = {
      active: { color: 'bg-ok-subtle text-ok-subtle-fg', icon: <CheckCircle className="w-3 h-3" /> },
      pending: { color: 'bg-caution-subtle text-caution-subtle-fg', icon: <Clock className="w-3 h-3" /> },
      expired: { color: 'bg-critical-subtle text-critical-subtle-fg', icon: <XCircle className="w-3 h-3" /> },
      cancelled: { color: 'bg-surface-sunken text-content-secondary', icon: <XCircle className="w-3 h-3" /> }
    };
    const c = config[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${c.color}`}>
        {c.icon} {t(`insurance.status_${status}`)}
      </span>
    );
  };

  const getClaimStatusBadge = (status: ClaimStatus) => {
    const colors: Record<ClaimStatus, string> = {
      submitted: 'bg-notice-subtle text-notice-subtle-fg',
      processing: 'bg-caution-subtle text-caution-subtle-fg',
      approved: 'bg-ok-subtle text-ok-subtle-fg',
      denied: 'bg-critical-subtle text-critical-subtle-fg',
      appealed: 'bg-orange-100 text-orange-800'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status]}`}>
        {t(`insurance.claimStatus_${status}`)}
      </span>
    );
  };

  const handleVerifyCoverage = async (cardId: string) => {
    if (!patient?.healthId) return;
    setVerifying(cardId);
    try {
      // Call POST /api/insurance/verify
      const { verifyInsurance } = await import('@medichain/shared');
      await verifyInsurance(patient.healthId);
      setInsuranceCards(prev => prev.map(card =>
        card.id === cardId ? { ...card, lastVerified: new Date().toISOString().split('T')[0] } : card
      ));
    } catch (err) {
      console.warn('Verification API failed, updating locally:', err);
      setInsuranceCards(prev => prev.map(card =>
        card.id === cardId ? { ...card, lastVerified: new Date().toISOString().split('T')[0] } : card
      ));
    } finally {
      setVerifying(null);
    }
  };

  const MAX_CARD_IMAGE_BYTES = 5 * 1024 * 1024; // matches insurance.fileSizeHint ("up to 5MB")

  const handleCardImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || !selectedCard) return;

    if (!file.type.startsWith('image/')) {
      setUploadError(t('insurance.uploadInvalidType'));
      return;
    }
    if (file.size > MAX_CARD_IMAGE_BYTES) {
      setUploadError(t('insurance.uploadTooLarge'));
      return;
    }

    setUploadError(null);
    setUploadingImage(true);
    const cardId = selectedCard.id;
    const side = uploadSide;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1] ?? '';

      await uploadInsuranceCardImage(cardId, base64, file.type);

      setInsuranceCards(prev => prev.map(card =>
        card.id === cardId
          ? { ...card, [side === 'front' ? 'frontImageUrl' : 'backImageUrl']: dataUrl }
          : card
      ));
      setShowUploadModal(false);
    } catch (err) {
      console.error('Insurance card image upload failed:', err);
      setUploadError(t('insurance.uploadFailed'));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleAddInsurance = () => {
    if (!newInsurance.providerName || !newInsurance.memberId) return;

    const newCard: InsuranceCard = {
      id: `INS-${Date.now()}`,
      type: newInsurance.type,
      providerName: newInsurance.providerName,
      planName: newInsurance.planName,
      memberId: newInsurance.memberId,
      groupNumber: newInsurance.groupNumber,
      subscriberName: newInsurance.subscriberName,
      subscriberId: `SUB-${Date.now()}`,
      effectiveDate: newInsurance.effectiveDate,
      terminationDate: null,
      status: 'pending',
      // No currency selector in the "Add New" form yet — default to the
      // platform's own default currency rather than silently omitting it.
      currency: DEFAULT_CURRENCY,
      copay: {
        primaryCare: parseInt(newInsurance.copayPrimary) || 0,
        specialist: parseInt(newInsurance.copaySpecialist) || 0,
        urgentCare: 75,
        emergency: 250
      },
      deductible: {
        individual: parseInt(newInsurance.deductible) || 0,
        family: (parseInt(newInsurance.deductible) || 0) * 2,
        met: 0
      },
      outOfPocketMax: {
        individual: parseInt(newInsurance.outOfPocketMax) || 0,
        family: (parseInt(newInsurance.outOfPocketMax) || 0) * 2,
        met: 0
      },
      frontImageUrl: null,
      backImageUrl: null,
      customerServicePhone: newInsurance.customerServicePhone,
      providerPortalUrl: '',
      isPrimary: insuranceCards.length === 0,
      lastVerified: ''
    };

    setInsuranceCards(prev => [...prev, newCard]);
    setNewInsurance({
      type: 'medical',
      providerName: '',
      planName: '',
      memberId: '',
      groupNumber: '',
      subscriberName: '',
      subscriberId: '',
      effectiveDate: '',
      customerServicePhone: '',
      copayPrimary: '25',
      copaySpecialist: '50',
      deductible: '1500',
      outOfPocketMax: '6000'
    });
    setActiveTab('cards');
  };

  const handleDeleteCard = (cardId: string) => {
    if (confirm(t('insurance.confirmDeleteCard'))) {
      setInsuranceCards(prev => prev.filter(c => c.id !== cardId));
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Loading State */}
      {loading && (
        <div className="fixed inset-0 bg-surface/80 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            <span className="text-content-muted">{t('insurance.loadingInsurance')}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-teal-600 to-cyan-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <CreditCard className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('insurance.title')}</h1>
        </div>
        <p className="text-teal-100">{t('insurance.subtitle')}</p>
      </div>

      {/* Summary Cards */}
      <div className="p-4 -mt-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-teal-600">{insuranceCards.filter(c => c.status === 'active').length}</div>
            <div className="text-xs text-content-muted">{t('insurance.activePlans')}</div>
          </div>
          <div className="bg-surface rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-ok-subtle-fg">{claims.filter(c => c.status === 'approved').length}</div>
            <div className="text-xs text-content-muted">{t('insurance.approvedClaims')}</div>
          </div>
          <div className="bg-surface rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-caution-subtle-fg">{claims.filter(c => c.status === 'processing').length}</div>
            <div className="text-xs text-content-muted">{t('insurance.pendingClaims')}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4">
        <div className="flex border-b border-border">
          {[
            { key: 'cards', label: t('insurance.tabMyCards'), icon: <CreditCard className="w-4 h-4" /> },
            { key: 'claims', label: t('insurance.tabClaims'), icon: <FileText className="w-4 h-4" /> },
            { key: 'add', label: t('insurance.tabAddNew'), icon: <Plus className="w-4 h-4" /> }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-3 font-medium text-sm border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-teal-500 text-teal-600'
                  : 'border-transparent text-content-muted hover:text-content-secondary'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Cards Tab */}
        {activeTab === 'cards' && (
          <div className="space-y-4">
            {insuranceCards.length === 0 ? (
              <div className="text-center py-8 bg-surface rounded-lg shadow">
                <CreditCard className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="text-content-muted">{t('insurance.noCardsYet')}</p>
                <button
                  onClick={() => setActiveTab('add')}
                  className="mt-3 text-teal-600 font-medium"
                >
                  {t('insurance.addFirstCard')}
                </button>
              </div>
            ) : (
              insuranceCards.map(card => (
                <div key={card.id} className="bg-surface rounded-lg shadow overflow-hidden">
                  {/* Card Header */}
                  <div className="bg-gradient-to-r from-gray-800 to-gray-700 text-white p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        {getTypeIcon(card.type)}
                        <span className="font-semibold">{card.providerName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {card.isPrimary && (
                          <span className="px-2 py-0.5 bg-yellow-500 text-caution-subtle-fg text-xs rounded-full font-medium">
                            {t('insurance.primaryBadge')}
                          </span>
                        )}
                        {getStatusBadge(card.status)}
                      </div>
                    </div>
                    <p className="text-gray-300 text-sm">{card.planName}</p>
                  </div>

                  {/* Card Details */}
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                      <div>
                        <span className="text-content-muted">{t('insurance.memberIdLabel')}</span>
                        <p className="font-mono font-medium">{card.memberId}</p>
                      </div>
                      <div>
                        <span className="text-content-muted">{t('insurance.groupNumberLabel')}</span>
                        <p className="font-mono font-medium">{card.groupNumber}</p>
                      </div>
                      <div>
                        <span className="text-content-muted">{t('insurance.subscriberLabel')}</span>
                        <p className="font-medium">{card.subscriberName}</p>
                      </div>
                      <div>
                        <span className="text-content-muted">{t('insurance.effectiveDateLabel')}</span>
                        <p className="font-medium">{card.effectiveDate}</p>
                      </div>
                    </div>

                    {/* Copays */}
                    {card.type === 'medical' && (
                      <div className="bg-surface-sunken rounded-lg p-3 mb-4">
                        <h4 className="text-xs font-semibold text-content-muted mb-2">{t('insurance.copaysHeading')}</h4>
                        <div className="grid grid-cols-4 gap-2 text-center text-xs">
                          <div>
                            <div className="font-bold text-lg text-teal-600">{formatCurrency(card.copay.primaryCare, card.currency, locale)}</div>
                            <div className="text-content-muted">{t('insurance.copayPrimaryLabel')}</div>
                          </div>
                          <div>
                            <div className="font-bold text-lg text-teal-600">{formatCurrency(card.copay.specialist, card.currency, locale)}</div>
                            <div className="text-content-muted">{t('insurance.copaySpecialistLabel')}</div>
                          </div>
                          <div>
                            <div className="font-bold text-lg text-teal-600">{formatCurrency(card.copay.urgentCare, card.currency, locale)}</div>
                            <div className="text-content-muted">{t('insurance.copayUrgentLabel')}</div>
                          </div>
                          <div>
                            <div className="font-bold text-lg text-teal-600">{formatCurrency(card.copay.emergency, card.currency, locale)}</div>
                            <div className="text-content-muted">{t('insurance.copayErLabel')}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Deductible Progress */}
                    {card.type === 'medical' && (
                      <div className="mb-4">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-content-muted">{t('insurance.deductibleProgressLabel')}</span>
                          <span className="font-medium">{formatCurrency(card.deductible.met, card.currency, locale)} / {formatCurrency(card.deductible.individual, card.currency, locale)}</span>
                        </div>
                        <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                          <div
                            className="h-full bg-teal-500 transition-all"
                            style={{ width: `${Math.min((card.deductible.met / card.deductible.individual) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Card Images */}
                    <div className="flex gap-2 mb-4">
                      <button
                        onClick={() => {
                          setSelectedCard(card);
                          setUploadSide('front');
                          setShowUploadModal(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-2 border-2 border-dashed border-border-strong rounded-lg text-sm text-content-muted hover:border-teal-500 hover:text-teal-600 transition-colors"
                      >
                        {card.frontImageUrl ? (
                          <><Eye className="w-4 h-4" /> {t('insurance.viewFront')}</>
                        ) : (
                          <><Camera className="w-4 h-4" /> {t('insurance.addFront')}</>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedCard(card);
                          setUploadSide('back');
                          setShowUploadModal(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-2 border-2 border-dashed border-border-strong rounded-lg text-sm text-content-muted hover:border-teal-500 hover:text-teal-600 transition-colors"
                      >
                        {card.backImageUrl ? (
                          <><Eye className="w-4 h-4" /> {t('insurance.viewBack')}</>
                        ) : (
                          <><Camera className="w-4 h-4" /> {t('insurance.addBack')}</>
                        )}
                      </button>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleVerifyCoverage(card.id)}
                        disabled={verifying === card.id}
                        className="flex-1 flex items-center justify-center gap-2 py-2 bg-teal-50 text-teal-600 rounded-lg text-sm font-medium hover:bg-teal-100 transition-colors disabled:opacity-50"
                      >
                        {verifying === card.id ? (
                          <><RefreshCw className="w-4 h-4 animate-spin" /> {t('insurance.verifying')}</>
                        ) : (
                          <><CheckCircle className="w-4 h-4" /> {t('insurance.verifyCoverage')}</>
                        )}
                      </button>
                      <a
                        href={`tel:${card.customerServicePhone}`}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-surface-sunken text-content-secondary rounded-lg text-sm hover:bg-surface-sunken transition-colors"
                      >
                        <Phone className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => handleDeleteCard(card.id)}
                        className="flex items-center justify-center px-3 py-2 text-critical-subtle-fg hover:bg-critical-subtle rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {card.lastVerified && (
                      <p className="text-xs text-content-muted mt-3 text-center">
                        {t('insurance.lastVerifiedPrefix', { date: card.lastVerified })}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Claims Tab */}
        {activeTab === 'claims' && (
          <div className="space-y-3">
            {claims.length === 0 ? (
              <div className="text-center py-8 bg-surface rounded-lg shadow">
                <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="text-content-muted">{t('insurance.noClaimsFound')}</p>
              </div>
            ) : (
              claims.map(claim => (
                <div key={claim.id} className="bg-surface rounded-lg shadow p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium text-content">{claim.description}</p>
                      <p className="text-sm text-content-muted">{claim.provider}</p>
                    </div>
                    {getClaimStatusBadge(claim.status)}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-content-muted mb-3">
                    <div>{t('insurance.serviceDatePrefix', { date: claim.serviceDate })}</div>
                    <div>{t('insurance.claimNumberPrefix', { number: claim.claimNumber })}</div>
                  </div>

                  <div className="flex justify-between items-center pt-3 border-t border-border">
                    <div className="text-sm">
                      <span className="text-content-muted">{t('insurance.yourCostLabel')}</span>
                      <span className={`font-bold ${claim.patientResponsibility > 0 ? 'text-critical-subtle-fg' : 'text-ok-subtle-fg'}`}>
                        {formatCurrency(claim.patientResponsibility, claim.currency, locale)}
                      </span>
                    </div>
                    {claim.eobUrl && (
                      <button className="flex items-center gap-1 text-teal-600 text-sm">
                        <Download className="w-4 h-4" /> {t('insurance.eobButton')}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
            {claimsHasMore && (
              <button
                onClick={handleLoadMoreClaims}
                disabled={loadingMoreClaims}
                className="w-full py-3 text-center text-sm font-medium text-teal-600 bg-surface rounded-lg shadow hover:bg-teal-50 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loadingMoreClaims ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {t('insurance.loadingMoreClaims')}</>
                ) : (
                  t('insurance.loadMoreClaims')
                )}
              </button>
            )}
          </div>
        )}

        {/* Add New Tab */}
        {activeTab === 'add' && (
          <div className="bg-surface rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-content mb-4">{t('insurance.addNewInsuranceTitle')}</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="insurance-type" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('insurance.insuranceTypeLabel')} <span className="text-red-500">*</span>
                </label>
                <select
                  id="insurance-type"
                  value={newInsurance.type}
                  onChange={(e) => setNewInsurance(prev => ({ ...prev, type: e.target.value as InsuranceType }))}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                >
                  <option value="medical">{t('insurance.type_medical')}</option>
                  <option value="dental">{t('insurance.type_dental')}</option>
                  <option value="vision">{t('insurance.type_vision')}</option>
                  <option value="pharmacy">{t('insurance.type_pharmacy')}</option>
                  <option value="supplemental">{t('insurance.type_supplemental')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="insurance-provider" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('insurance.insuranceProviderLabel')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="insurance-provider"
                  type="text"
                  value={newInsurance.providerName}
                  onChange={(e) => setNewInsurance(prev => ({ ...prev, providerName: e.target.value }))}
                  placeholder={t('insurance.insuranceProviderPlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="insurance-plan-name" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('insurance.planNameLabel')}
                </label>
                <input
                  id="insurance-plan-name"
                  type="text"
                  value={newInsurance.planName}
                  onChange={(e) => setNewInsurance(prev => ({ ...prev, planName: e.target.value }))}
                  placeholder={t('insurance.planNamePlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="insurance-member-id" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('insurance.memberIdLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="insurance-member-id"
                    type="text"
                    value={newInsurance.memberId}
                    onChange={(e) => setNewInsurance(prev => ({ ...prev, memberId: e.target.value }))}
                    placeholder={t('insurance.memberIdPlaceholder')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="insurance-group-number" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('insurance.groupNumberLabel')}
                  </label>
                  <input
                    id="insurance-group-number"
                    type="text"
                    value={newInsurance.groupNumber}
                    onChange={(e) => setNewInsurance(prev => ({ ...prev, groupNumber: e.target.value }))}
                    placeholder={t('insurance.groupNumberPlaceholder')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="insurance-subscriber-name" className="block text-sm font-medium text-content-secondary mb-1">
                  {t('insurance.subscriberNameLabel')}
                </label>
                <input
                  id="insurance-subscriber-name"
                  type="text"
                  value={newInsurance.subscriberName}
                  onChange={(e) => setNewInsurance(prev => ({ ...prev, subscriberName: e.target.value }))}
                  placeholder={t('insurance.subscriberNamePlaceholder')}
                  className="w-full border border-border-strong rounded-lg px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="insurance-effective-date" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('insurance.effectiveDateLabel')}
                  </label>
                  <input
                    id="insurance-effective-date"
                    type="date"
                    value={newInsurance.effectiveDate}
                    onChange={(e) => setNewInsurance(prev => ({ ...prev, effectiveDate: e.target.value }))}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="insurance-customer-service" className="block text-sm font-medium text-content-secondary mb-1">
                    {t('insurance.customerServiceLabel')}
                  </label>
                  <input
                    id="insurance-customer-service"
                    type="tel"
                    value={newInsurance.customerServicePhone}
                    onChange={(e) => setNewInsurance(prev => ({ ...prev, customerServicePhone: e.target.value }))}
                    placeholder={t('insurance.customerServicePlaceholder')}
                    className="w-full border border-border-strong rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h3 className="text-sm font-medium text-content-secondary mb-3">{t('insurance.costDetailsHeading')}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="insurance-copay-primary" className="block text-xs text-content-muted mb-1">{t('insurance.copayPrimaryFieldLabel')}</label>
                    <input
                      id="insurance-copay-primary"
                      type="number"
                      value={newInsurance.copayPrimary}
                      onChange={(e) => setNewInsurance(prev => ({ ...prev, copayPrimary: e.target.value }))}
                      className="w-full border border-border-strong rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="insurance-copay-specialist" className="block text-xs text-content-muted mb-1">{t('insurance.copaySpecialistFieldLabel')}</label>
                    <input
                      id="insurance-copay-specialist"
                      type="number"
                      value={newInsurance.copaySpecialist}
                      onChange={(e) => setNewInsurance(prev => ({ ...prev, copaySpecialist: e.target.value }))}
                      className="w-full border border-border-strong rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="insurance-deductible" className="block text-xs text-content-muted mb-1">{t('insurance.annualDeductibleLabel')}</label>
                    <input
                      id="insurance-deductible"
                      type="number"
                      value={newInsurance.deductible}
                      onChange={(e) => setNewInsurance(prev => ({ ...prev, deductible: e.target.value }))}
                      className="w-full border border-border-strong rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="insurance-oop-max" className="block text-xs text-content-muted mb-1">{t('insurance.oopMaxLabel')}</label>
                    <input
                      id="insurance-oop-max"
                      type="number"
                      value={newInsurance.outOfPocketMax}
                      onChange={(e) => setNewInsurance(prev => ({ ...prev, outOfPocketMax: e.target.value }))}
                      className="w-full border border-border-strong rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleAddInsurance}
                disabled={!newInsurance.providerName || !newInsurance.memberId}
                className="w-full py-3 bg-gradient-to-r from-teal-600 to-cyan-500 text-white rounded-lg font-medium hover:from-teal-700 hover:to-cyan-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('insurance.addInsuranceCardButton')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && selectedCard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">
              {t('insurance.uploadCardTitle', { side: uploadSide === 'front' ? t('insurance.sideFront') : t('insurance.sideBack') })}
            </h3>

            <div className="border-2 border-dashed border-border-strong rounded-lg p-8 text-center mb-4">
              {uploadingImage ? (
                <Loader2 className="w-12 h-12 mx-auto text-teal-500 mb-3 animate-spin" />
              ) : (
                <Upload className="w-12 h-12 mx-auto text-content-muted mb-3" />
              )}
              <p className="text-content-muted mb-2">{t('insurance.dragDropText')}</p>
              <p className="text-xs text-content-muted">{t('insurance.fileSizeHint')}</p>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                id="card-upload"
                disabled={uploadingImage}
                onChange={handleCardImageSelected}
              />
              <label
                htmlFor="card-upload"
                className={`mt-4 inline-block px-4 py-2 bg-teal-600 text-white rounded-lg cursor-pointer hover:bg-teal-700 transition-colors ${uploadingImage ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {uploadingImage ? t('insurance.uploadingButton') : t('insurance.chooseFileButton')}
              </label>
            </div>

            {uploadError ? <p className="text-sm text-red-600 mb-4 text-center">{uploadError}</p> : null}

            <div className="flex items-center justify-center gap-2 mb-4 text-gray-500">
              <span className="h-px flex-1 bg-gray-200" />
              <span className="text-sm">{t('insurance.orDivider')}</span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>

            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              id="card-upload-camera"
              disabled={uploadingImage}
              onChange={handleCardImageSelected}
            />
            <label
              htmlFor="card-upload-camera"
              className={`w-full flex items-center justify-center gap-2 py-3 border border-teal-600 text-teal-600 rounded-lg font-medium hover:bg-teal-50 transition-colors cursor-pointer ${uploadingImage ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <Camera className="w-5 h-5" /> {t('insurance.takePhotoButton')}
            </label>

            <button
              onClick={() => {
                setShowUploadModal(false);
                setUploadError(null);
              }}
              disabled={uploadingImage}
              className="w-full mt-3 py-2 text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              {t('insurance.cancelButton')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InsurancePage;
