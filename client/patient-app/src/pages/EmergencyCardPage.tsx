import { useState, useCallback, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  apiUrl,
  useOfflineCache,
  useTranslation,
  useToastActions,
  formatDate,
  normalizePhone,
  EmptyState,
} from '@medichain/shared';
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
  organDonor: boolean;
  dnrStatus: boolean;
  dnrVerifiedBy: string | null;
  dnrVerifiedAt: string | null;
  dnrDocumentRef: string | null;
  cardHash: string;
  lastUpdated: string;
}

/**
 * Emergency Card Page
 * 
 * Display QR code and NFC card information for emergency access.
 * First responders can scan to access critical medical data.
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function EmergencyCardPage() {
  const { t, locale } = useTranslation();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [showMedicalInfo, setShowMedicalInfo] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  // Patient ID from stored auth (used as the cache key + request identity).
  const patientId = (() => {
    try {
      const authData = localStorage.getItem('patient-auth');
      return authData ? JSON.parse(authData).patientId : null;
    } catch {
      return null;
    }
  })();

  // Fetch + map the emergency card. Throws on failure so useOfflineCache can fall
  // back to the cached copy (critical: emergency data must be viewable offline).
  const fetchEmergencyData = useCallback(async (): Promise<EmergencyData> => {
    if (!patientId) {
      throw new Error('Not signed in');
    }
    const response = await fetch(apiUrl(`/api/patients/${patientId}`), {
      headers: {
        'X-User-Id': patientId,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to load emergency data (${response.status})`);
    }
    const data = await response.json();
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
      organDonor: emergencyInfo.organ_donor || false,
      dnrStatus: emergencyInfo.dnr_status || false,
      dnrVerifiedBy: emergencyInfo.dnr_verified_by ?? null,
      dnrVerifiedAt: emergencyInfo.dnr_verified_at ?? null,
      dnrDocumentRef: emergencyInfo.dnr_document_ref ?? null,
      cardHash: String(data.patient_id || '').replace(/-/g, '').toLowerCase(),
      lastUpdated: data.last_updated || new Date().toISOString(),
    };
  }, [patientId]);

  // Cache-through: caches on every successful load, serves cached card offline.
  const {
    data: emergencyData,
    loading: isLoading,
    fromCache,
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
  }, [
    emergencyData?.nationalHealthId,
    emergencyData?.fullName,
    emergencyData?.bloodType,
    emergencyUrl,
  ]);

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

  if (isLoading || !emergencyData) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-8 bg-neutral-200 rounded w-48" />
        <div className="aspect-square max-w-xs mx-auto bg-neutral-200 rounded-3xl" />
        <div className="h-24 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{t('emergency.cardTitle')}</h1>
        <p className="text-neutral-600">{t('emergency.cardSubtitle')}</p>
      </div>

      {/* Offline indicator — emergency data is cached for no-network viewing */}
      {fromCache && (
        <div className="flex items-center justify-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl py-2 px-3">
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
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
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
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
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
            <div className="w-full h-full bg-white border-4 border-neutral-900 rounded-2xl p-3 relative overflow-hidden">
              {qrError ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-center text-neutral-500">
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
                  <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg">
                    <Heart className="w-7 h-7 text-emergency-500" />
                  </div>
                </div>
              )}
            </div>

            {/* Refresh Overlay */}
            {isRefreshing && (
              <div className="absolute inset-0 bg-white/90 rounded-2xl flex items-center justify-center">
                <RefreshCw className="w-10 h-10 text-primary-500 animate-spin" />
              </div>
            )}
          </div>

          {/* QR Actions */}
          <div className="flex justify-center gap-4 mt-4">
            <button
              onClick={handleRefreshQR}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              <Share2 className="w-4 h-4" />
              {t('emergency.share')}
            </button>
          </div>
        </div>

        {/* Patient Info */}
        <div className="border-t border-neutral-100 pt-4 -mx-5 px-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-neutral-900">{emergencyData.fullName}</div>
              <div className="text-sm text-neutral-500">{t('emergency.dob')}: {formatDate(emergencyData.dateOfBirth, locale)}</div>
            </div>
            <div className="flex items-center gap-2">
              <Droplet className="w-5 h-5 text-emergency-500" />
              <span className="text-xl font-bold text-emergency-600">{emergencyData.bloodType}</span>
            </div>
          </div>
        </div>
      </div>

      {/* NFC Card Info */}
      <div className="patient-card">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
            <Wifi className="w-6 h-6 text-primary-600 rotate-90" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-neutral-900">{t('emergency.nfcReady')}</h3>
            <p className="text-sm text-neutral-500">{t('emergency.nfcTapHint')}</p>
          </div>
          <div className="w-3 h-3 bg-success-500 rounded-full animate-pulse" />
        </div>
        
        <div className="mt-4 p-3 bg-neutral-50 rounded-xl text-sm text-neutral-600">
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
            <span className="font-medium text-neutral-900">{t('emergency.criticalInfo')}</span>
          </div>
          {showMedicalInfo ? (
            <ChevronUp className="w-5 h-5 text-neutral-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-neutral-400" />
          )}
        </button>

        {showMedicalInfo && (
          <div className="mt-4 space-y-4">
            {/* Allergies */}
            {emergencyData.allergies.length > 0 ? (
              <div className="p-3 bg-emergency-50 border border-emergency-200 rounded-xl">
                <div className="flex items-center gap-2 text-emergency-700 font-medium mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  {t('emergency.allergies')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {emergencyData.allergies.map((allergy, i) => (
                    <span key={i} className="px-3 py-1 bg-emergency-100 text-emergency-700 rounded-full text-sm">
                      {allergy}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl">
                <div className="flex items-center gap-2 text-neutral-700 font-medium mb-1">
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
              <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl">
                <div className="flex items-center gap-2 text-neutral-700 font-medium mb-1">
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
                    <li key={i} className="text-sm text-neutral-700">• {med}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl">
                <div className="flex items-center gap-2 text-neutral-700 font-medium mb-1">
                  <Pill className="w-4 h-4" />
                  {t('emergency.currentMedications')}
                </div>
                <EmptyState compact title={t('emergency.noneRecorded')} />
              </div>
            )}

            {/* Status Badges */}
            <div className="flex gap-3">
              <div className={`flex-1 p-3 rounded-xl text-center ${
                emergencyData.organDonor 
                  ? 'bg-success-100 text-success-700' 
                  : 'bg-neutral-100 text-neutral-500'
              }`}>
                <Heart className="w-5 h-5 mx-auto mb-1" />
                <div className="text-xs font-medium">
                  {emergencyData.organDonor ? t('emergency.organDonor') : t('emergency.notDonor')}
                </div>
              </div>
              <div className={`flex-1 p-3 rounded-xl text-center ${
                dnrVerified
                  ? 'bg-emergency-100 text-emergency-700'
                  : emergencyData.dnrStatus
                  ? 'bg-warning-100 text-warning-800'
                  : 'bg-success-100 text-success-700'
              }`}>
                <Shield className="w-5 h-5 mx-auto mb-1" />
                <div className="text-xs font-medium">
                  {dnrVerified
                    ? t('emergency.dnrOrder')
                    : emergencyData.dnrStatus
                    ? t('emergency.dnrUnverified')
                    : t('emergency.fullResuscitation')}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Emergency Contact */}
      <div className="patient-card">
        <h3 className="font-medium text-neutral-900 mb-4 flex items-center gap-2">
          <Phone className="w-5 h-5 text-primary-600" />
          {t('emergency.emergencyContact')}
        </h3>
        
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-neutral-900">{emergencyData.emergencyContact.name}</div>
            <div className="text-sm text-neutral-500">{emergencyData.emergencyContact.relationship}</div>
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
                <div className="text-sm font-medium text-neutral-700">
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

      {/* Card Security Info */}
      <div className="text-center text-xs text-neutral-400 space-y-1">
        <p>{t('emergency.cardHash')}: {emergencyData.cardHash.slice(0, 16)}...</p>
        <p>{t('emergency.lastUpdated')}: {formatDate(emergencyData.lastUpdated, locale)}</p>
        <p className="flex items-center justify-center gap-1">
          <Shield className="w-3 h-3" />
          {t('emergency.securedBy')}
        </p>
      </div>
    </div>
  );
}
