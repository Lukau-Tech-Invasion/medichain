import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getMedicalId,
  useTranslation,
  useToastActions,
  updateMedicalIdPreferences,
  formatDate,
  normalizePhone,
  EmptyState,
} from '@medichain/shared';
import type { MedicalIdCard } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  AlertTriangle,
  Heart,
  Droplet,
  Pill,
  Phone,
  Shield,
  User,
  Calendar,
  MapPin,
  Stethoscope,
  FileText,
  Download,
  Share2,
  Lock,
  CheckCircle,
} from 'lucide-react';

interface DnrStatusObject {
  status?: boolean;
  verified?: boolean;
  verified_by?: string | null;
  verified_at?: string | null;
  document_ref?: string | null;
}

interface ResolvedDnr {
  /** Whether a DNR is on file at all. */
  onFile: boolean;
  /** Whether the DNR is verified (has a verifier + timestamp). */
  verified: boolean;
}

/**
 * Normalize the polymorphic `dnr_status` into a simple on-file/verified pair.
 * A bare boolean is treated as "on file but unverified" — responders must see
 * the unverified notice rather than an authoritative order without metadata.
 */
function resolveDnr(dnr: boolean | DnrStatusObject | null | undefined): ResolvedDnr {
  if (typeof dnr === 'boolean') {
    return { onFile: dnr, verified: false };
  }
  if (dnr && typeof dnr === 'object') {
    const onFile = dnr.status ?? true;
    const verified = Boolean(dnr.verified && dnr.verified_by && dnr.verified_at);
    return { onFile, verified };
  }
  return { onFile: false, verified: false };
}

interface MedicalIdData {
  patient_id: string;
  /** Null when the encrypted profile could not be decrypted. */
  name: string | null;
  /** Null when the encrypted profile could not be decrypted. */
  date_of_birth: string | null;
  /**
   * True when the profile could not be read. The criticals below are empty in
   * that case for the same reason they would be empty for a patient with none
   * recorded, so this flag is the only thing that tells the two apart — and on
   * an emergency card that difference decides whether a responder trusts the
   * blanks.
   */
  profile_unavailable?: boolean;
  blood_type: string | { value?: string; display_color?: string };
  allergies: Array<{
    name: string;
    severity: string;
    reaction?: string;
  }>;
  medications: string[];
  conditions: string[];
  emergency_contacts: Array<{
    name: string;
    phone: string;
    relationship: string;
    can_make_medical_decisions: boolean;
  }>;
  organ_donor: boolean;
  /**
   * DNR may arrive as a bare boolean (legacy / emergency + lockscreen shapes)
   * or as a verification object (full medical-id payload). Handled defensively
   * via {@link resolveDnr} so a DNR is only treated as authoritative when the
   * backend supplies a verifier + timestamp.
   */
  dnr_status: boolean | DnrStatusObject;
  languages: string[];
  insurance?: {
    provider: string;
    policy_number: string;
  };
  primary_doctor?: {
    name: string;
    phone: string;
    facility?: string;
  };
  preferences: {
    show_when_locked: boolean;
    enable_location_sharing: boolean;
    auto_notify_family: boolean;
  };
}

function toMedicalIdData(card: MedicalIdCard): MedicalIdData {
  return {
    patient_id: card.patient_id,
    name: card.name,
    date_of_birth: card.date_of_birth,
    profile_unavailable: card.profile_unavailable,
    blood_type: card.blood_type,
    allergies: card.allergies,
    medications: card.medications,
    conditions: card.chronic_conditions,
    emergency_contacts: card.emergency_contacts.map((contact) => ({
      name: contact.name ?? '',
      phone: contact.phone ?? '',
      relationship: contact.relationship ?? '',
      can_make_medical_decisions: contact.verified === true,
    })),
    organ_donor: card.organ_donor.status,
    dnr_status: card.dnr_status,
    languages: card.languages,
    insurance: undefined,
    primary_doctor: card.primary_doctor
      ? { name: card.primary_doctor.name, phone: card.primary_doctor.phone ?? '' }
      : undefined,
    preferences: card.preferences,
  };
}

/**
 * Medical ID Page
 * 
 * Apple Health-style Medical ID that can be shown on lock screen.
 * Critical information for first responders.
 * 
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function MedicalIdPage() {
  const navigate = useNavigate();
  const { t, locale } = useTranslation();
  const { showSuccess, showError, showWarning } = useToastActions();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [data, setData] = useState<MedicalIdData | null>(null);
  const [savingPreference, setSavingPreference] = useState(false);

  // The API returns these as strings on some paths and objects (e.g.
  // `{name, ...}`) on others. Rendering an object directly threw
  // "Objects are not valid as a React child" and blanked the whole card.
  // Handles every shape the API has been observed to return for these fields:
  // a plain string, `{name}`, or a display-wrapped `{value, display_color}`
  // (blood type). Rendering the last of those directly threw "Objects are not
  // valid as a React child" and blanked the card; falling through to
  // String(obj) would have printed "[object Object]", which is not better.
  const asText = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const o = v as { name?: string; value?: string };
      return o.name ?? o.value ?? '';
    }
    return v == null ? '' : String(v);
  };

  const [isLoading, setIsLoading] = useState(true);
  const [showLockScreenPreview, setShowLockScreenPreview] = useState(false);
  const [activeView, setActiveView] = useState<'full' | 'emergency' | 'lockscreen'>('full');

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  const loadMedicalId = useCallback(async () => {
    if (!patient) return;
    
    setIsLoading(true);
    
    try {
      // Emergency and lock-screen endpoints require capabilities from a
      // managed device and must never be probed with the patient's browser
      // session. The selector is a local preview mode; its data remains the
      // authenticated patient's full Medical ID card.
      const card = await getMedicalId(patient.healthId);
      setData(toMedicalIdData(card));
    } catch (error) {
      console.error('Error loading Medical ID:', error);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [patient]);

  useEffect(() => {
    if (patient) {
      loadMedicalId();
    }
  }, [patient, activeView, loadMedicalId]);

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'severe': return 'bg-critical-subtle text-critical-subtle-fg border-critical';
      case 'moderate': return 'bg-surface-sunken text-content-secondary border-orange-200';
      case 'mild': return 'bg-caution-subtle text-caution-subtle-fg border-caution';
      default: return 'bg-surface-sunken text-content-secondary border-border';
    }
  };

  // Copy with a clipboard-API guard + hidden-textarea fallback for non-secure
  // contexts where navigator.clipboard is undefined.
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

  const handleShare = async () => {
    if (!data) return;
    const displayName = data.name ?? t('medicalId.nameUnavailable');

    const text = t('medicalId.shareText', {
      name: displayName,
      bloodType: asText(data.blood_type),
      allergies: (data.allergies ?? []).map(a => `${a.name} (${a.severity})`).join(', '),
      conditions: (data.conditions ?? []).join(', '),
      contactName: data.emergency_contacts[0]?.name || '',
      contactPhone: data.emergency_contacts[0]?.phone || '',
    });

    if (!navigator.share) {
      const ok = await copyToClipboard(text);
      if (ok) {
        showWarning(t('medicalId.shareNotSupported'));
      } else {
        showError(t('medicalId.shareFailed'));
      }
      return;
    }

    try {
      await navigator.share({
        title: t('medicalId.shareTitle', { name: displayName }),
        text,
      });
    } catch (err) {
      // A user-cancelled share surfaces as AbortError — stay silent for that.
      if (err instanceof Error && err.name === 'AbortError') return;
      showError(t('medicalId.shareFailed'));
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-10 bg-surface-sunken rounded w-48 mx-auto" />
        <div className="h-64 bg-surface-sunken rounded-3xl" />
        <div className="h-32 bg-surface-sunken rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<AlertTriangle className="w-12 h-12 text-caution" />}
          title={t('medicalId.unableToLoadTitle')}
          description={t('medicalId.unableToLoadDesc')}
          action={
            <button
              onClick={() => loadMedicalId()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-brand-fg rounded-lg text-sm font-medium hover:bg-brand transition-colors"
            >
              {t('medicalId.retryButton')}
            </button>
          }
        />
      </div>
    );
  }

  const dnr = resolveDnr(data.dnr_status);

  /**
   * Whether the medical ID shows on the phone's lock screen.
   *
   * This switch was `onChange={() => {}}` — it moved nothing, saved nothing and
   * called nothing, while `updateMedicalIdPreferences` sat imported nowhere. A
   * privacy control that appears to work and does not is worse than no control:
   * a patient who turns it off believes their allergies and conditions are no
   * longer readable from a locked phone.
   *
   * Optimistic, then reverted on failure — the switch must never rest in a
   * position the server did not agree to.
   */
  const handleShowWhenLocked = async (next: boolean) => {
    if (!data || !patient?.healthId) return;
    const previous = data.preferences.show_when_locked;
    setData({ ...data, preferences: { ...data.preferences, show_when_locked: next } });
    setSavingPreference(true);
    try {
      await updateMedicalIdPreferences(patient.healthId, { show_when_locked: next });
      showSuccess(t('medicalId.preferenceSaved'));
    } catch (error) {
      console.error('Failed to save lock-screen preference:', error);
      setData({ ...data, preferences: { ...data.preferences, show_when_locked: previous } });
      showError(t('medicalId.preferenceSaveFailed'));
    } finally {
      setSavingPreference(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header with settings */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-content">{t('medicalId.title')}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLockScreenPreview(!showLockScreenPreview)}
            className="p-2 text-content-muted hover:bg-surface-sunken rounded-xl transition-colors"
            title={t('medicalId.lockScreenPreviewTooltip')}
          >
            <Lock className="w-5 h-5" />
          </button>
          <button
            onClick={handleShare}
            className="p-2 text-content-muted hover:bg-surface-sunken rounded-xl transition-colors"
            title={t('medicalId.shareTooltip')}
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* View Selector */}
      <div className="flex gap-1 bg-surface-sunken p-1 rounded-xl">
        {(['full', 'emergency', 'lockscreen'] as const).map(view => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${
              activeView === view
                ? 'bg-surface text-content shadow-sm'
                : 'text-content-muted hover:text-content-secondary'
            }`}
          >
            {view === 'full' ? t('medicalId.view_full') : view === 'emergency' ? t('medicalId.view_emergency') : t('medicalId.view_lockscreen')}
          </button>
        ))}
      </div>

      {/* Lock Screen Setting */}
      <div className={`p-4 rounded-xl border-2 ${data.preferences.show_when_locked ? 'bg-ok-subtle border-ok' : 'bg-surface-sunken border-border'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Lock className={data.preferences.show_when_locked ? 'text-ok-subtle-fg' : 'text-content-muted'} />
            <div className={data.preferences.show_when_locked ? 'text-ok-subtle-fg' : 'text-content'}>
              <p className="font-medium">{t('medicalId.showWhenLocked')}</p>
              {/* Muted grey is a colour for a neutral card. On the green
                  `bg-ok-subtle` this panel takes when the setting is on it
                  measured 3.59:1, so the copy follows the panel's own pair. */}
              <p className="text-sm opacity-90">{t('medicalId.showWhenLockedDesc')}</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <span className="sr-only">{t('medicalId.showWhenLocked')}</span>
            <input
              type="checkbox"
              checked={data.preferences.show_when_locked}
              disabled={savingPreference}
              onChange={(event) => void handleShowWhenLocked(event.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-surface-sunken peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-border-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
          </label>
        </div>
      </div>

      {/* Main Medical ID Card */}
      <div className="bg-surface rounded-3xl shadow-lg overflow-hidden">
        {/* Red Emergency Header */}
        <div className="bg-gradient-to-r from-red-700 to-red-800 text-white p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-surface/20 rounded-full flex items-center justify-center">
              <User className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">
                {data.name ?? t('medicalId.nameUnavailable')}
              </h2>
              <div className="flex items-center gap-2 text-white">
                <Calendar className="w-4 h-4" />
                <span>
                  {data.date_of_birth
                    ? formatDate(data.date_of_birth, locale)
                    : t('medicalId.dobUnavailable')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* A card whose profile could not be decrypted shows empty allergy,
            medication and condition lists that are indistinguishable from a
            patient who genuinely has none. Say so explicitly rather than
            letting a responder read the blanks as reassurance. */}
        {data.profile_unavailable && (
          <div
            role="alert"
            className="bg-caution-subtle border-y border-caution px-4 py-3 text-sm text-caution-subtle-fg"
          >
            <p className="font-semibold">{t('medicalId.profileUnavailableTitle')}</p>
            <p>{t('medicalId.profileUnavailableBody')}</p>
          </div>
        )}

        {/* Blood Type & Organ Donor */}
        <div className="grid grid-cols-2 divide-x divide-border">
          <div className="p-4 text-center">
            <Droplet className="w-8 h-8 text-critical mx-auto mb-2" />
            <p className="text-3xl font-bold text-content">{asText(data.blood_type)}</p>
            <p className="text-sm text-content-muted">{t('medicalId.bloodTypeLabel')}</p>
            {asText(data.blood_type) === 'Unknown' && (
              <p role="alert" className="mt-2 text-sm font-medium text-critical-subtle-fg">
                {t('emergency.unknownBloodTypeWarning')}
              </p>
            )}
          </div>
          <div className="p-4 text-center">
            <Heart className={`w-8 h-8 mx-auto mb-2 ${data.organ_donor ? 'text-ok' : 'text-content-muted'}`} />
            <p className="text-lg font-bold text-content">
              {data.organ_donor ? t('medicalId.organDonorYes') : t('medicalId.organDonorNo')}
            </p>
            <p className="text-sm text-content-muted">{t('medicalId.organDonorLabel')}</p>
          </div>
        </div>

        {/* DNR Status — only authoritative when verified (verifier + timestamp). */}
        {dnr.onFile && dnr.verified && (
          <div className="bg-critical-subtle border-t border-b border-critical p-4 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-critical-subtle-fg" />
            <div>
              <p className="font-bold text-critical-subtle-fg">{t('medicalId.dnrTitle')}</p>
              <p className="text-sm text-critical-subtle-fg">{t('medicalId.dnrVerifiedDesc')}</p>
            </div>
          </div>
        )}
        {dnr.onFile && !dnr.verified && (
          <div className="bg-caution-subtle border-t border-b border-caution p-4 flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-caution-subtle-fg" />
            <div>
              <p className="font-bold text-caution-subtle-fg">{t('medicalId.dnrUnverifiedTitle')}</p>
              <p className="text-sm text-caution-subtle-fg">{t('medicalId.dnrUnverifiedDesc')}</p>
            </div>
          </div>
        )}

        {/* Allergies */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-critical" />
            <h3 className="font-bold text-content">{t('medicalId.allergiesTitle')}</h3>
          </div>
          {(data.allergies ?? []).length > 0 ? (
            <div className="space-y-2">
              {(data.allergies ?? []).map((allergy, i) => (
                <div key={i} className={`p-3 rounded-lg border ${getSeverityColor(allergy.severity)}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{asText(allergy.name)}</span>
                    <span className="text-xs font-bold uppercase">{asText(allergy.severity)}</span>
                  </div>
                  {allergy.reaction && (
                    <p className="text-sm mt-1 opacity-80">{asText(allergy.reaction)}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title={t('medicalId.noKnownAllergies')} />
          )}
        </div>

        {/* Medical Conditions */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 mb-3">
            <Stethoscope className="w-5 h-5 text-notice-subtle-fg" />
            <h3 className="font-bold text-content">{t('medicalId.conditionsTitle')}</h3>
          </div>
          {(data.conditions ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {(data.conditions ?? []).map((condition, i) => (
                <span key={i} className="px-3 py-1.5 bg-notice-subtle text-notice-subtle-fg rounded-lg text-sm font-medium">
                  {asText(condition)}
                </span>
              ))}
            </div>
          ) : (
            <EmptyState compact title={t('medicalId.noneListed')} />
          )}
        </div>

        {/* Medications */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 mb-3">
            <Pill className="w-5 h-5 text-purple-500" />
            <h3 className="font-bold text-content">{t('medicalId.medicationsTitle')}</h3>
          </div>
          {(data.medications ?? []).length > 0 ? (
            <ul className="space-y-2">
              {(data.medications ?? []).map((med, i) => (
                <li key={i} className="flex items-center gap-2 text-content-secondary">
                  <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                  {asText(med)}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact title={t('medicalId.noneListed')} />
          )}
        </div>

        {/* Emergency Contacts */}
        <div className="p-4 border-t border-border bg-surface-sunken">
          <div className="flex items-center gap-2 mb-3">
            <Phone className="w-5 h-5 text-ok" />
            <h3 className="font-bold text-content">{t('medicalId.emergencyContactsTitle')}</h3>
          </div>
          {data.emergency_contacts.map((contact, i) => {
            const normalized = normalizePhone(contact.phone);
            return (
              <div key={i} className="bg-surface p-3 rounded-lg border border-border mb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-content">{contact.name}</p>
                    <p className="text-sm text-content-muted">{contact.relationship}</p>
                  </div>
                  {normalized ? (
                    <a
                      href={`tel:${normalized}`}
                      className="bg-ok text-ok-fg px-4 py-2 rounded-lg font-medium flex items-center gap-2"
                    >
                      <Phone className="w-4 h-4" />
                      {t('medicalId.callButton')}
                    </a>
                  ) : (
                    <span className="text-xs text-caution-subtle-fg">{t('medicalId.unverifiedNumber')}</span>
                  )}
                </div>
                <p className="text-sm text-content-muted mt-2">{contact.phone}</p>
                {contact.can_make_medical_decisions && (
                  <div className="flex items-center gap-1 mt-2 text-ok-subtle-fg text-sm">
                    <CheckCircle className="w-4 h-4" />
                    {t('medicalId.legalAuthorityText')}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Primary Doctor */}
        {data.primary_doctor && (
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <Stethoscope className="w-5 h-5 text-notice-subtle-fg" />
              <h3 className="font-bold text-content">{t('medicalId.primaryCareProviderTitle')}</h3>
            </div>
            <div className="bg-notice-subtle p-3 rounded-lg">
              <p className="font-medium text-content">{data.primary_doctor.name}</p>
              {data.primary_doctor.facility && (
                <p className="text-sm text-content-muted flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  {data.primary_doctor.facility}
                </p>
              )}
              {(() => {
                const docPhone = normalizePhone(data.primary_doctor.phone);
                return docPhone ? (
                  <a
                    href={`tel:${docPhone}`}
                    className="text-notice-subtle-fg text-sm mt-1 inline-block"
                  >
                    {data.primary_doctor.phone}
                  </a>
                ) : (
                  <p className="text-sm mt-1 text-content-muted">
                    {data.primary_doctor.phone}{' '}
                    <span className="text-caution-subtle-fg">{t('medicalId.unverifiedNumberParen')}</span>
                  </p>
                );
              })()}
            </div>
          </div>
        )}

        {/* Insurance */}
        {data.insurance && (
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-5 h-5 text-brand" />
              <h3 className="font-bold text-content">{t('medicalId.insuranceTitle')}</h3>
            </div>
            <div className="bg-surface-sunken p-3 rounded-lg">
              <p className="font-medium text-content">{data.insurance.provider}</p>
              <p className="text-sm text-content-muted">{t('medicalId.policyPrefix', { number: data.insurance.policy_number })}</p>
            </div>
          </div>
        )}

        {/* Languages */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-5 h-5 text-content-muted" />
            <h3 className="font-bold text-content">{t('medicalId.languagesTitle')}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.languages.map((lang, i) => (
              <span key={i} className="px-3 py-1 bg-surface-sunken text-content-secondary rounded-full text-sm">
                {lang}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* QR Code Section */}
      <div className="patient-card text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Download className="w-5 h-5 text-content-muted" />
          <h3 className="font-bold text-content">{t('medicalId.qrCodeTitle')}</h3>
        </div>
        <p className="text-sm text-content-muted mb-3">
          {t('medicalId.qrCodeDesc')}
        </p>
        <a
          href={`/api/medical-id/${data.patient_id}/qr`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-brand-fg rounded-lg text-sm font-medium hover:bg-brand transition-colors"
        >
          <Download className="w-4 h-4" />
          {t('medicalId.downloadQrCode')}
        </a>
      </div>

      {/* Emergency Numbers */}
      <div className="bg-critical-subtle border border-critical rounded-xl p-4">
        <h3 className="flex items-center gap-2 font-bold text-critical-subtle-fg mb-3">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" /> {t('medicalId.emergencyServicesTitle')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <a href="tel:10177" className="bg-surface p-3 rounded-lg text-center shadow-sm">
            <p className="text-2xl font-bold text-critical-subtle-fg">10177</p>
            <p className="text-sm text-content-muted">{t('medicalId.ambulanceLabel')}</p>
          </a>
          <a href="tel:10111" className="bg-surface p-3 rounded-lg text-center shadow-sm">
            <p className="text-2xl font-bold text-critical-subtle-fg">10111</p>
            <p className="text-sm text-content-muted">{t('medicalId.policeLabel')}</p>
          </a>
        </div>
      </div>
    </div>
  );
}

export default MedicalIdPage;
