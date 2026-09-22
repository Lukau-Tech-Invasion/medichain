import { useState, useCallback, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  getEmergencyCapsuleAccessLog,
  getApiClient,
  useOfflineCache,
  useTranslation,
  useToastActions,
  formatDate,
  normalizePhone,
  EmptyState,
} from '@medichain/shared';
import type { EmergencyCapsuleAccess } from '@medichain/shared';
import {
  AlertTriangle,
  Heart,
  Droplet,
  Pill,
  Phone,
  Shield,
  RefreshCw,
  Share2,
  Copy,
  Check,
  Info,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { usePatientAuthStore } from '../store/authStore';

interface EmergencyData {
  patientId: string;
  nationalHealthId: string;
  fullName: string;
  dateOfBirth: string;
  bloodType: string;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  };
  organDonor: boolean | null;
  dnrStatus: boolean | null;
  dnrVerifiedBy: string | null;
  dnrVerifiedAt: string | null;
  dnrDocumentRef: string | null;
  cardHash: string;
  lastUpdated: string | null;
}

/**
 * Emergency Card Page
 * 
 * Display QR code and NFC card information for emergency access.
 * First responders can scan to access critical medical data.
 * 
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function EmergencyCardPage() {
  const { t, locale } = useTranslation();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [showMedicalInfo, setShowMedicalInfo] = useState(true);
  const [copied, setCopied] = useState(false);
  const patient = usePatientAuthStore(state => state.patient);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  // Canonical patient record id; the wallet is the authenticated caller.
  const patientId = patient?.healthId || null;

  // --- Who has opened this card ----------------------------------------------
  //
  // POPIA requires every emergency read to be logged, and
  // `GET /api/patients/{id}/emergency-capsule/access-log` already served it to
  // the patient themself -- it just had no caller anywhere. A log the data
  // subject cannot read does not answer the question it exists for: "who saw my
  // blood type, and why".
  const [accesses, setAccesses] = useState<EmergencyCapsuleAccess[]>([]);
  const [accessLoaded, setAccessLoaded] = useState(false);
  // An empty log and a log that could not be read are opposite answers, and
  // telling a patient "nobody has opened this" when the read failed is the
  // worse of the two mistakes.
  const [accessUnknown, setAccessUnknown] = useState(false);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    getEmergencyCapsuleAccessLog(patientId)
      .then((body) => {
        if (cancelled) return;
        setAccesses(body.accesses ?? []);
        setAccessUnknown(false);
      })
      .catch(() => {
        if (!cancelled) setAccessUnknown(true);
      })
      .finally(() => {
        if (!cancelled) setAccessLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);


  // Fetch + map the emergency card. Throws on failure so useOfflineCache can fall
  // back to the cached copy (critical: emergency data must be viewable offline).
  const fetchEmergencyData = useCallback(async (): Promise<EmergencyData> => {
    if (!patientId) {
      throw new Error('Not signed in');
    }
    const data = await getApiClient().get<{
        patient_id: string;
        national_id?: string;
        full_name: string;
        date_of_birth: string;
        emergency_info?: {
          blood_type?: string;
          allergies?: { name: string }[];
          chronic_conditions?: string[];
          current_medications?: string[];
          emergency_contacts?: { name?: string; phone?: string; relationship?: string }[];
          organ_donor?: boolean;
          dnr_status?: boolean;
          dnr_verified_by?: string;
          dnr_verified_at?: string;
          dnr_document_ref?: string;
        };
        last_updated?: string;
      }>(`/api/patients/${patientId}`);
    const emergencyInfo = data.emergency_info || {};
    const emergencyContact = emergencyInfo.emergency_contacts?.[0] || {};
    return {
      patientId: data.patient_id,
      nationalHealthId: data.national_id || data.patient_id,
      fullName: data.full_name,
      dateOfBirth: data.date_of_birth,
      bloodType: emergencyInfo.blood_type || 'Unknown',
      allergies: emergencyInfo.allergies?.map((a: { name: string }) => a.name) || [],
      chronicConditions: emergencyInfo.chronic_conditions || [],
      currentMedications: emergencyInfo.current_medications || [],
      emergencyContact: {
        name: emergencyContact.name || 'Not set',
        phone: emergencyContact.phone || 'Not set',
        relationship: emergencyContact.relationship || 'Not set',
      },
      organDonor: typeof emergencyInfo.organ_donor === 'boolean'
        ? emergencyInfo.organ_donor
        : null,
      dnrStatus: typeof emergencyInfo.dnr_status === 'boolean'
        ? emergencyInfo.dnr_status
        : null,
      dnrVerifiedBy: emergencyInfo.dnr_verified_by ?? null,
      dnrVerifiedAt: emergencyInfo.dnr_verified_at ?? null,
      dnrDocumentRef: emergencyInfo.dnr_document_ref ?? null,
      cardHash: String(data.patient_id || '').replace(/-/g, '').toLowerCase(),
      lastUpdated: data.last_updated ?? null,
    };
    // `walletAddress` went with the hand-rolled session headers; the typed
    // client reads the session itself.
  }, [patientId]);

  // Cache-through: caches on every successful load, serves cached card offline.
  const {
    data: emergencyData,
    loading: isLoading,
    fromCache,
    error: loadError,
    refresh,
  } = useOfflineCache<EmergencyData>(
    `emergency-card-${patientId || 'none'}`,
    'emergency',
    fetchEmergencyData,
  );

  // DNR is only authoritative when the backend supplies verification metadata.
  // Without a verifier + timestamp, responders must assume full resuscitation.
  const dnrVerified = Boolean(
    emergencyData?.dnrStatus &&
      emergencyData.dnrVerifiedBy &&
      emergencyData.dnrVerifiedAt,
  );

  // Compact emergency-access URL embedded in the QR code. Falls back to the
  // current origin so the QR is still meaningful in offline/preview contexts.
  const emergencyUrl = emergencyData
    ? `${window.location.origin}/emergency/${encodeURIComponent(emergencyData.nationalHealthId)}`
    : '';

  // Generate a REAL scannable QR encoding the critical emergency payload.
  // Memoized on the load-bearing fields so it only regenerates when they change;
  // works fully offline (no network call) for the cached emergency card.
  useEffect(() => {
    if (!emergencyData) return;
    let cancelled = false;
    const payload = JSON.stringify({
      id: emergencyData.nationalHealthId,
      name: emergencyData.fullName,
      bt: emergencyData.bloodType,
      url: emergencyUrl,
    });
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 256 })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
          setQrError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
          setQrError(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // `emergencyData` rather than three of its fields: the QR encodes the card,
    // and listing a subset means a change to anything else in it leaves a code
    // on screen that no longer matches what it claims to represent.
  }, [emergencyData, emergencyUrl]);

  const handleRefreshQR = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } catch {
      showError(t('emergency.refreshFailed'));
    } finally {
      setIsRefreshing(false);
    }
  };

  // Copy with a clipboard-API guard + hidden-textarea fallback for non-secure
  // contexts (e.g. http on a clinic LAN) where navigator.clipboard is undefined.
  const copyToClipboard = async (text: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to the legacy path.
      }
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyId = async () => {
    if (!emergencyData) return;
    const ok = await copyToClipboard(emergencyData.nationalHealthId);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showSuccess(t('emergency.copySuccess'));
    } else {
      showError(t('emergency.copyFailed'));
    }
  };

  const handleShare = async () => {
    if (!emergencyData) return;
    const shareText = `Emergency Medical Info for ${emergencyData.fullName}\nHealth ID: ${emergencyData.nationalHealthId}`;

    if (!navigator.share) {
      const ok = await copyToClipboard(`${shareText}\n${emergencyUrl}`);
      if (ok) {
        showInfoCopiedInstead();
      } else {
        showError(t('emergency.shareFailed'));
      }
      return;
    }

    try {
      await navigator.share({
        title: 'MediChain Emergency Card',
        text: shareText,
        url: emergencyUrl || window.location.href,
      });
    } catch (err) {
      // A user-cancelled share surfaces as AbortError — stay silent for that.
      if (err instanceof Error && err.name === 'AbortError') return;
      showError(t('emergency.shareFailed'));
    }
  };

  const showInfoCopiedInstead = () => {
    showWarning(t('emergency.shareUnsupportedCopied'));
  };

  // Loading, failed and empty are three different states and were collapsed
  // into one skeleton. `isLoading || !emergencyData` meant that a card which
  // failed to load — or a patient who simply has no emergency record yet —
  // sat on a pulsing placeholder forever, with nothing to read and nothing to
  // do. On this screen that is the worst possible outcome: someone checking
  // their card before travelling is told nothing is wrong, and finds out it is
  // empty at the moment it matters.
  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse" role="status" aria-live="polite">
        <span className="sr-only">{t('emergency.loadingCard')}</span>
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="aspect-square max-w-xs mx-auto bg-surface-sunken rounded-3xl" />
        <div className="h-24 bg-surface-sunken rounded-xl" />
      </div>
    );
  }

  if (!emergencyData) {
    return (
      <div className="p-6">
        <div
          role="alert"
          className="bg-caution-subtle border border-caution rounded-xl p-5 max-w-md mx-auto"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-caution-subtle-fg shrink-0" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-caution-subtle-fg mb-1">
                {loadError ? t('emergency.cardUnavailable') : t('emergency.cardNotSetUp')}
              </h2>
              <p className="text-sm text-caution-subtle-fg mb-4">
                {loadError ? t('emergency.cardUnavailableHelp') : t('emergency.cardNotSetUpHelp')}
              </p>
              <button
                onClick={refresh}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-caution text-caution-fg rounded-lg font-medium"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                {t('emergency.retry')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-content">{t('emergency.cardTitle')}</h1>
        <p className="text-content-muted">{t('emergency.cardSubtitle')}</p>
      </div>

      {/* Offline indicator — emergency data is cached for no-network viewing */}
      {fromCache && (
        <div className="flex items-center justify-center gap-2 text-sm text-caution-subtle-fg bg-caution-subtle border border-caution rounded-xl py-2 px-3">
          <WifiOff className="w-4 h-4" />
          {t('emergency.offlineNotice')}
        </div>
      )}

      {/* QR Code Card */}
      <div className="patient-card overflow-hidden">
        {/* Card Header */}
        <div className="bg-gradient-to-r from-emergency-500 to-emergency-600 -mx-5 -mt-5 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-surface/20 rounded-xl flex items-center justify-center">
                <Heart className="w-6 h-6" />
              </div>
              <div>
                <div className="text-xs text-white/80">{t('emergency.nationalHealthId')}</div>
                <div className="font-mono font-semibold tracking-wide">
                  {emergencyData.nationalHealthId}
                </div>
              </div>
            </div>
            <button
              onClick={handleCopyId}
              className="p-2 hover:bg-surface/10 rounded-lg transition-colors"
            >
              {copied ? (
                <Check className="w-5 h-5" />
              ) : (
                <Copy className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* QR Code */}
        <div className="py-6">
          <div className="relative mx-auto w-56 h-56">
            {/* Real, scannable QR code generated client-side (works offline). */}
            <div className="w-full h-full bg-surface border-4 border-neutral-900 rounded-2xl p-3 relative overflow-hidden">
              {qrError ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-center text-content-muted">
                  <AlertTriangle className="w-8 h-8 mb-2 text-warning-500" />
                  <span className="text-xs">{t('emergency.qrError')}</span>
                </div>
              ) : qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={t('emergency.qrAlt')}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <RefreshCw className="w-8 h-8 text-neutral-300 animate-spin" />
                </div>
              )}

              {/* Center Logo */}
              {qrDataUrl && !qrError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 bg-surface rounded-xl flex items-center justify-center shadow-lg">
                    <Heart className="w-7 h-7 text-critical-subtle-fg" />
                  </div>
                </div>
              )}
            </div>

            {/* Refresh Overlay */}
            {isRefreshing && (
              <div className="absolute inset-0 bg-surface/90 rounded-2xl flex items-center justify-center">
                <RefreshCw className="w-10 h-10 text-primary-500 animate-spin" />
              </div>
            )}
          </div>

          {/* QR Actions */}
          <div className="flex justify-center gap-4 mt-4">
            <button
              onClick={handleRefreshQR}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-sm text-content-muted hover:text-content transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-4 py-2 text-sm text-content-muted hover:text-content transition-colors"
            >
              <Share2 className="w-4 h-4" />
              {t('emergency.share')}
            </button>
          </div>
        </div>

        {/* Patient Info */}
        <div className="border-t border-border pt-4 -mx-5 px-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-content">{emergencyData.fullName}</div>
              <div className="text-sm text-content-muted">{t('emergency.dob')}: {formatDate(emergencyData.dateOfBirth, locale)}</div>
            </div>
            <div className="flex items-center gap-2">
              <Droplet className="w-5 h-5 text-critical-subtle-fg" />
              <span className="text-xl font-bold text-critical-subtle-fg">{emergencyData.bloodType}</span>
            </div>
          </div>
        </div>
      </div>

      {/* NFC Card Info */}
      <div className="patient-card">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-brand-subtle rounded-xl flex items-center justify-center">
            <Wifi className="w-6 h-6 text-brand rotate-90" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-content">{t('emergency.nfcReady')}</h3>
            <p className="text-sm text-content-muted">{t('emergency.nfcTapHint')}</p>
          </div>
          <div className="w-3 h-3 bg-success-500 rounded-full animate-pulse" />
        </div>
        
        <div className="mt-4 p-3 bg-surface-sunken rounded-xl text-sm text-content-muted">
          <Info className="w-4 h-4 inline mr-2 text-info" />
          {t('emergency.nfcInfo')}
        </div>
      </div>

      {/* Critical Medical Info */}
      <div className="patient-card">
        <button
          onClick={() => setShowMedicalInfo(!showMedicalInfo)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-warning-600" />
            <span className="font-medium text-content">{t('emergency.criticalInfo')}</span>
          </div>
          {showMedicalInfo ? (
            <ChevronUp className="w-5 h-5 text-content-muted" />
          ) : (
            <ChevronDown className="w-5 h-5 text-content-muted" />
          )}
        </button>

        {showMedicalInfo && (
          <div className="mt-4 space-y-4">
            {/* Allergies */}
            {emergencyData.allergies.length > 0 ? (
              <div className="p-3 bg-emergency-50 border border-emergency-200 rounded-xl">
                <div className="flex items-center gap-2 text-critical-subtle-fg font-medium mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  {t('emergency.allergies')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {emergencyData.allergies.map((allergy, i) => (
                    <span key={i} className="px-3 py-1 bg-emergency-100 text-critical-subtle-fg rounded-full text-sm">
                      {allergy}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-surface-sunken border border-border rounded-xl">
                <div className="flex items-center gap-2 text-content-secondary font-medium mb-1">
                  <AlertTriangle className="w-4 h-4" />
                  {t('emergency.allergies')}
                </div>
                <EmptyState compact title={t('emergency.noneRecorded')} />
              </div>
            )}

            {/* Chronic Conditions */}
            {emergencyData.chronicConditions.length > 0 ? (
              <div className="p-3 bg-warning-50 border border-warning-200 rounded-xl">
                <div className="flex items-center gap-2 text-warning-700 font-medium mb-2">
                  <Heart className="w-4 h-4" />
                  {t('emergency.chronicConditions')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {emergencyData.chronicConditions.map((condition, i) => (
                    <span key={i} className="px-3 py-1 bg-warning-100 text-warning-700 rounded-full text-sm">
                      {condition}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-surface-sunken border border-border rounded-xl">
                <div className="flex items-center gap-2 text-content-secondary font-medium mb-1">
                  <Heart className="w-4 h-4" />
                  {t('emergency.chronicConditions')}
                </div>
                <EmptyState compact title={t('emergency.noneRecorded')} />
              </div>
            )}

            {/* Current Medications */}
            {emergencyData.currentMedications.length > 0 ? (
              <div className="p-3 bg-info-light border border-info/20 rounded-xl">
                <div className="flex items-center gap-2 text-info font-medium mb-2">
                  <Pill className="w-4 h-4" />
                  {t('emergency.currentMedications')}
                </div>
                <ul className="space-y-1">
                  {emergencyData.currentMedications.map((med, i) => (
                    <li key={i} className="text-sm text-content-secondary">• {med}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-3 bg-surface-sunken border border-border rounded-xl">
                <div className="flex items-center gap-2 text-content-secondary font-medium mb-1">
                  <Pill className="w-4 h-4" />
                  {t('emergency.currentMedications')}
                </div>
                <EmptyState compact title={t('emergency.noneRecorded')} />
              </div>
            )}

            {/* Status Badges */}
            <div className="flex gap-3">
              <div className={`flex-1 p-3 rounded-xl text-center ${
                emergencyData.organDonor === true
                  ? 'bg-success-100 text-success-700'
                  : emergencyData.organDonor === false
                  ? 'bg-surface-sunken text-content-muted'
                  : 'bg-warning-100 text-warning-800'
              }`}>
                <Heart className="w-5 h-5 mx-auto mb-1" />
                <div className="text-xs font-medium">
                  {emergencyData.organDonor === true
                    ? t('emergency.organDonor')
                    : emergencyData.organDonor === false
                    ? t('emergency.notDonor')
                    : t('emergency.noneRecorded')}
                </div>
              </div>
              <div className={`flex-1 p-3 rounded-xl text-center ${
                dnrVerified
                  ? 'bg-emergency-100 text-critical-subtle-fg'
                  : emergencyData.dnrStatus === true
                  ? 'bg-warning-100 text-warning-800'
                  : emergencyData.dnrStatus === false
                  ? 'bg-success-100 text-success-700'
                  : 'bg-warning-100 text-warning-800'
              }`}>
                <Shield className="w-5 h-5 mx-auto mb-1" />
                <div className="text-xs font-medium">
                  {dnrVerified
                    ? t('emergency.dnrOrder')
                    : emergencyData.dnrStatus === true
                    ? t('emergency.dnrUnverified')
                    : emergencyData.dnrStatus === false
                    ? t('emergency.fullResuscitation')
                    : t('emergency.noneRecorded')}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Emergency Contact */}
      <div className="patient-card">
        <h3 className="font-medium text-content mb-4 flex items-center gap-2">
          <Phone className="w-5 h-5 text-brand" />
          {t('emergency.emergencyContact')}
        </h3>
        
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-content">{emergencyData.emergencyContact.name}</div>
            <div className="text-sm text-content-muted">{emergencyData.emergencyContact.relationship}</div>
          </div>
          {(() => {
            const normalized = normalizePhone(emergencyData.emergencyContact.phone);
            return normalized ? (
              <a
                href={`tel:${normalized}`}
                className="flex items-center gap-2 px-4 py-2 bg-success-500 text-white rounded-xl hover:bg-success-600 transition-colors"
              >
                <Phone className="w-4 h-4" />
                {t('emergency.call')}
              </a>
            ) : (
              <div className="text-right">
                <div className="text-sm font-medium text-content-secondary">
                  {emergencyData.emergencyContact.phone}
                </div>
                <div className="text-xs text-warning-700">
                  {t('emergency.unverifiedNumber')}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Who has opened this card */}
      <div className="bg-surface rounded-xl shadow p-4 mb-4">
        <h2 className="font-semibold text-content mb-1">{t('emergency.accessHeading')}</h2>
        <p className="text-sm text-content-muted mb-3">{t('emergency.accessSubtitle')}</p>
        {!accessLoaded ? (
          <p className="text-sm text-content-muted">{t('emergency.accessLoading')}</p>
        ) : accessUnknown ? (
          <p className="text-sm text-content-muted">{t('emergency.accessUnknown')}</p>
        ) : accesses.length === 0 ? (
          <p className="text-sm text-content-muted">{t('emergency.accessNone')}</p>
        ) : (
          <ul className="space-y-2" data-testid="emergency-access-list">
            {accesses.map((entry) => (
              <li key={entry.id} className="border border-border rounded-lg p-3">
                <p className="text-sm text-content break-all">{entry.accessed_by}</p>
                <p className="text-xs text-content-muted">
                  {formatDate(entry.accessed_at, locale)} ·{' '}
                  {entry.reason_text || entry.reason_code}
                </p>
                {/* What was actually shown, not what was asked for. */}
                {entry.fields_revealed.length > 0 && (
                  <p className="text-xs text-content-muted mt-1">
                    {t('emergency.accessFields', { fields: entry.fields_revealed.join(', ') })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Card Security Info */}
      <div className="text-center text-xs text-content-muted space-y-1">
        <p>{t('emergency.cardHash')}: {emergencyData.cardHash.slice(0, 16)}...</p>
        <p>
          {t('emergency.lastUpdated')}: {emergencyData.lastUpdated
            ? formatDate(emergencyData.lastUpdated, locale)
            : t('emergency.noneRecorded')}
        </p>
        <p className="flex items-center justify-center gap-1">
          <Shield className="w-3 h-3" />
          {t('emergency.securedBy')}
        </p>
      </div>
    </div>
  );
}
