import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  debugLog,
  getApiErrorMessage,
  listMyMobileDevices,
  mfaDisable,
  mfaEnroll,
  mfaStatus,
  mfaVerify,
  revokeMobileDevice,
  getUserSettings,
  saveUserSettings,
  updateMedicalIdPreferences,
  useTranslation,
  setThemePreference,
  readThemePreference,
  formatDateOnly,
} from '@medichain/shared';
import type { PatientMobileDevice } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Settings,
  User,
  Bell,
  Shield,
  Globe,
  Moon,
  Smartphone,
  Lock,
  Key,
  LogOut,
  ChevronRight,
  AlertTriangle,
  Info,
  HelpCircle,
  FileText,
  Mail,
  MessageSquare,
  Save,
  CheckCircle,
} from 'lucide-react';

interface NotificationSettings {
  emailNotifications: boolean;
  smsNotifications: boolean;
  pushNotifications: boolean;
  accessAlerts: boolean;
  appointmentReminders: boolean;
  recordUpdates: boolean;
  emergencyAlerts: boolean;
}

interface PrivacySettings {
  shareWithResearchers: boolean;
  anonymousAnalytics: boolean;
  showProfileToProviders: boolean;
  allowEmergencyAccess: boolean;
}

interface AppSettings {
  darkMode: boolean;
  language: string;
  fontSize: 'small' | 'medium' | 'large';
  biometricLogin: boolean;
}

interface PatientSettingsPreferences {
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  appSettings: AppSettings;
}

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  emailNotifications: true,
  smsNotifications: true,
  pushNotifications: true,
  accessAlerts: true,
  appointmentReminders: true,
  recordUpdates: false,
  emergencyAlerts: true,
};

const DEFAULT_PRIVACY: PrivacySettings = {
  shareWithResearchers: false,
  anonymousAnalytics: true,
  showProfileToProviders: true,
  allowEmergencyAccess: true,
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  darkMode: false,
  language: 'en',
  fontSize: 'medium',
  biometricLogin: false,
};

/**
 * Settings Page
 * 
 * Account settings, notifications, privacy, and app preferences.
 * 
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const patient = usePatientAuthStore(state => state.patient);
  const logout = usePatientAuthStore(state => state.logout);
  const loadErrorMessage = t('settings.loadError');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [supportNotice, setSupportNotice] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [mfaEnrolled, setMfaEnrolled] = useState<boolean | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaQr, setMfaQr] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaNotice, setMfaNotice] = useState<string | null>(null);

  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS);
  const [privacy, setPrivacy] = useState(DEFAULT_PRIVACY);
  const [appSettings, setAppSettings] = useState(() => ({
    ...DEFAULT_APP_SETTINGS,
    // Seed from the theme actually applied, so the switch shows the truth on
    // first paint. Defaulting to `false` made it read "off" for a patient
    // looking at a dark screen.
    darkMode: readThemePreference() === 'dark',
  }));

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const stored = await getUserSettings<Partial<PatientSettingsPreferences>>();
        if (stored.notifications) {
          setNotifications(current => ({ ...current, ...stored.notifications }));
        }
        if (stored.privacy) setPrivacy(current => ({ ...current, ...stored.privacy }));
        if (stored.appSettings) {
          setAppSettings(current => ({ ...current, ...stored.appSettings }));
        }
      } catch (error) {
        debugLog('PatientSettingsPage', 'Could not load settings:', error);
        setSettingsError(loadErrorMessage);
      } finally {
        setIsLoading(false);
      }
    };
    void loadSettings();
  }, [loadErrorMessage]);

  useEffect(() => {
    mfaStatus()
      .then((status) => setMfaEnrolled(Boolean(status.enabled ?? status.enrolled)))
      .catch(() => setMfaEnrolled(null));
  }, []);

  useEffect(() => {
    if (!isLoading) setSaveSucceeded(false);
  }, [notifications, privacy, appSettings, isLoading]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSucceeded(false);
    setSettingsError(null);
    try {
      await saveUserSettings({ notifications, privacy, appSettings });
      if (patient?.healthId) {
        await updateMedicalIdPreferences(patient.healthId, {
          show_when_locked: privacy.allowEmergencyAccess,
          display_language: appSettings.language,
        });
      }
      setSaveSucceeded(true);
    } catch (error) {
      debugLog('PatientSettingsPage', 'Could not save settings:', error);
      setSettingsError(t('settings.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const beginMfaEnrollment = async () => {
    setMfaError(null);
    setMfaNotice(null);
    setMfaBusy(true);
    try {
      const enrollment = await mfaEnroll();
      setMfaSecret(enrollment.secret);
      setMfaQr(enrollment.qr_code_base64 ?? null);
    } catch (error) {
      setMfaError(getApiErrorMessage(error, t('settings.mfaEnrollFailed')));
    } finally {
      setMfaBusy(false);
    }
  };

  const confirmMfaEnrollment = async () => {
    setMfaError(null);
    setMfaNotice(null);
    setMfaBusy(true);
    try {
      await mfaVerify(mfaCode.trim());
      const status = await mfaStatus();
      setMfaEnrolled(Boolean(status.enabled ?? status.enrolled));
      setMfaSecret(null);
      setMfaQr(null);
      setMfaCode('');
      setMfaNotice(t('settings.mfaEnabledNotice'));
    } catch (error) {
      setMfaError(getApiErrorMessage(error, t('settings.mfaVerifyFailed')));
    } finally {
      setMfaBusy(false);
    }
  };

  const turnOffMfa = async () => {
    setMfaError(null);
    setMfaNotice(null);
    setMfaBusy(true);
    try {
      await mfaDisable(mfaCode.trim());
      const status = await mfaStatus();
      setMfaEnrolled(Boolean(status.enabled ?? status.enrolled));
      setMfaCode('');
      setMfaNotice(t('settings.mfaDisabledNotice'));
    } catch (error) {
      setMfaError(getApiErrorMessage(error, t('settings.mfaDisableFailed')));
    } finally {
      setMfaBusy(false);
    }
  };

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
    { code: 'sw', name: 'Kiswahili' },
    { code: 'ha', name: 'Hausa' },
    { code: 'yo', name: 'Yorùbá' },
    { code: 'am', name: 'አማርኛ' },
  ];

  const ToggleSwitch = ({ 
    enabled, 
    label,
    onChange,
    disabled = false,
  }: { 
    enabled: boolean; 
    label: string;
    onChange: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={enabled}
      onClick={onChange}
      disabled={disabled}
      className={`relative w-12 h-7 rounded-full transition-colors ${
        enabled ? 'bg-primary-500' : 'bg-neutral-300'
      } disabled:cursor-not-allowed disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100`}
    >
      <div
        className={`absolute top-1 w-5 h-5 bg-surface rounded-full shadow transition-transform ${
          enabled ? 'left-6' : 'left-1'
        }`}
      />
    </button>
  );

  const SettingRow = ({
    icon: Icon,
    label,
    description,
    children,
    onClick,
  }: {
    icon: React.ElementType;
    label: string;
    description?: string;
    children?: React.ReactNode;
    onClick?: () => void;
  }) => {
    const content = <>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-surface-sunken rounded-xl flex items-center justify-center">
          <Icon className="w-5 h-5 text-content-muted" />
        </div>
        <div>
          <div className="font-medium text-content">{label}</div>
          {description && (
            <div className="text-sm text-content-muted">{description}</div>
          )}
        </div>
      </div>
      {children || (onClick && <ChevronRight className="w-5 h-5 text-content-muted" />)}
    </>;
    return onClick ? (
      <button type="button" className="flex w-full items-center justify-between py-4 text-left" onClick={onClick}>
        {content}
      </button>
    ) : (
      <div className="flex items-center justify-between py-4">{content}</div>
    );
  };


  // --- Devices that can open my records --------------------------------------
  //
  // Four mobile endpoints existed and every one of them writes. A device id is
  // returned exactly once, in the response to the registration that created it,
  // so a patient who lost a phone had no way to name the device they wanted
  // revoked and the revoke endpoint was unreachable in practice.
  // `GET /api/mobile/devices` is new.
  const [devices, setDevices] = useState<PatientMobileDevice[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  // An empty list and a failed read are opposite answers to "can my lost phone
  // still open my records", and the first is the dangerous one to guess.
  const [devicesUnknown, setDevicesUnknown] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [deviceNotice, setDeviceNotice] = useState('');
  const [deviceBusy, setDeviceBusy] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      const body = await listMyMobileDevices();
      setDevices(body.devices ?? []);
      setDevicesUnknown(false);
    } catch {
      setDevicesUnknown(true);
    } finally {
      setDevicesLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const revokeDevice = async (device: PatientMobileDevice) => {
    setDeviceError('');
    setDeviceNotice('');
    setDeviceBusy(device.id);
    try {
      await revokeMobileDevice(device.id, 'Revoked by the patient from Settings');
      setDeviceNotice(t('settings.deviceRevoked', { label: device.device_label }));
      await loadDevices();
    } catch (err) {
      setDeviceError(getApiErrorMessage(err, t('settings.deviceRevokeFailed')));
    } finally {
      setDeviceBusy(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-content">{t('settings.title')}</h1>
          <p className="text-content-muted">{t('settings.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || isLoading}
          className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 font-medium text-brand-fg hover:bg-brand disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
        >
          {saveSucceeded ? <CheckCircle className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {isSaving ? t('settings.saving') : saveSucceeded ? t('settings.saved') : t('settings.save')}
        </button>
      </div>

      {settingsError && <div role="alert" className="rounded-xl border border-critical-subtle-fg/20 bg-critical-subtle p-3 text-critical-subtle-fg">{settingsError}</div>}
      {supportNotice && <div role="status" className="rounded-xl border border-caution-subtle-fg/20 bg-caution-subtle p-3 text-caution-subtle-fg">{supportNotice}</div>}

      {/* Account Section */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
          <User className="w-5 h-5 text-brand" />
          {t('settings.account')}
        </h2>

        <div className="divide-y divide-border">
          <SettingRow
            icon={User}
            label={t('settings.personalInfo')}
            description={t('settings.personalInfoDesc')}
            onClick={() => window.location.href = '/profile'}
          />

          <SettingRow
            icon={Lock}
            label={t('settings.changePassword')}
            description={t('settings.changePasswordDesc')}
          />

          <div className="py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-surface-sunken rounded-xl flex items-center justify-center">
                  <Key className="w-5 h-5 text-content-muted" />
                </div>
                <div>
                  <div className="font-medium text-content">{t('settings.twoFactor')}</div>
                  <div className="text-sm text-content-muted">{t('settings.twoFactorDesc')}</div>
                </div>
              </div>
              <span
                data-testid="mfa-status"
                className={`rounded-full px-2 py-1 text-xs whitespace-nowrap ${
                  mfaEnrolled === null
                    ? 'bg-surface-sunken text-content-secondary'
                    : mfaEnrolled
                      ? 'bg-ok-subtle text-ok-subtle-fg'
                      : 'bg-caution-subtle text-caution-subtle-fg'
                }`}
              >
                {mfaEnrolled === null
                  ? t('settings.mfaStatusUnknown')
                  : mfaEnrolled
                    ? t('settings.mfaStatusOn')
                    : t('settings.mfaStatusOff')}
              </span>
            </div>

            {mfaError && <div role="alert" className="mt-3 rounded-lg border border-critical bg-critical-subtle p-3 text-sm text-critical-subtle-fg">{mfaError}</div>}
            {mfaNotice && <div role="status" className="mt-3 rounded-lg border border-ok bg-ok-subtle p-3 text-sm text-ok-subtle-fg">{mfaNotice}</div>}

            {mfaEnrolled === false && !mfaSecret && (
              <button type="button" onClick={beginMfaEnrollment} disabled={mfaBusy} className="mt-3 min-h-[36px] rounded-lg bg-brand px-4 py-2 text-brand-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100">
                {mfaBusy ? t('settings.mfaWorking') : t('settings.mfaSetUp')}
              </button>
            )}

            {mfaSecret && (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-content-secondary">{t('settings.mfaScanInstruction')}</p>
                {mfaQr && <img src={`data:image/png;base64,${mfaQr}`} alt={t('settings.mfaQrAlt')} className="h-40 w-40 rounded-lg border border-border bg-surface" />}
                <p className="break-all font-mono text-sm text-content-secondary">{mfaSecret}</p>
                <div>
                  <label htmlFor="mfa-enrollment-code" className="mb-1 block text-sm font-medium text-content">{t('settings.mfaCodeLabel')}</label>
                  <input id="mfa-enrollment-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} className="w-40 rounded-lg border border-border-interactive px-3 py-2" />
                </div>
                <button type="button" onClick={confirmMfaEnrollment} disabled={mfaBusy || !mfaCode.trim()} className="min-h-[36px] rounded-lg bg-brand px-4 py-2 text-brand-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100">
                  {mfaBusy ? t('settings.mfaWorking') : t('settings.mfaConfirm')}
                </button>
              </div>
            )}

            {mfaEnrolled === true && (
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="mfa-disable-code" className="mb-1 block text-sm font-medium text-content">{t('settings.mfaDisableCodeLabel')}</label>
                  <input id="mfa-disable-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} className="w-40 rounded-lg border border-border-interactive px-3 py-2" />
                </div>
                <button type="button" onClick={turnOffMfa} disabled={mfaBusy || !mfaCode.trim()} className="min-h-[36px] rounded-lg border border-critical px-4 py-2 text-critical-subtle-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100">
                  {mfaBusy ? t('settings.mfaWorking') : t('settings.mfaTurnOff')}
                </button>
              </div>
            )}
          </div>

          <SettingRow
            icon={Smartphone}
            label={t('settings.biometricLogin')}
            description={t('settings.biometricDesc')}
          >
            <ToggleSwitch
              label={t('settings.biometricLogin')}
              enabled={appSettings.biometricLogin}
              onChange={() => setAppSettings(s => ({ ...s, biometricLogin: !s.biometricLogin }))}
              disabled
            />
          </SettingRow>
        </div>
      </div>

      {/* Notifications Section */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-brand" />
          {t('settings.notifications')}
        </h2>

        <div className="divide-y divide-border">
          <SettingRow
            icon={Mail}
            label={t('settings.emailNotif')}
            description={t('settings.emailNotifDesc')}
          >
            <ToggleSwitch
              label={t('settings.emailNotif')}
              enabled={notifications.emailNotifications}
              onChange={() => setNotifications(n => ({ ...n, emailNotifications: !n.emailNotifications }))}
              disabled
            />
          </SettingRow>

          <SettingRow
            icon={MessageSquare}
            label={t('settings.smsNotif')}
            description={t('settings.smsNotifDesc')}
          >
            <ToggleSwitch
              label={t('settings.smsNotif')}
              enabled={notifications.smsNotifications}
              onChange={() => setNotifications(n => ({ ...n, smsNotifications: !n.smsNotifications }))}
            />
          </SettingRow>

          <SettingRow
            icon={Smartphone}
            label={t('settings.pushNotif')}
            description={t('settings.pushNotifDesc')}
          >
            <ToggleSwitch
              label={t('settings.pushNotif')}
              enabled={notifications.pushNotifications}
              onChange={() => setNotifications(n => ({ ...n, pushNotifications: !n.pushNotifications }))}
            />
          </SettingRow>

          <SettingRow
            icon={Shield}
            label={t('settings.accessAlerts')}
            description={t('settings.accessAlertsDesc')}
          >
            <ToggleSwitch
              label={t('settings.accessAlerts')}
              enabled={notifications.accessAlerts}
              onChange={() => setNotifications(n => ({ ...n, accessAlerts: !n.accessAlerts }))}
            />
          </SettingRow>

          <SettingRow
            icon={Bell}
            label={t('settings.apptReminders')}
            description={t('settings.apptRemindersDesc')}
          >
            <ToggleSwitch
              label={t('settings.apptReminders')}
              enabled={notifications.appointmentReminders}
              onChange={() => setNotifications(n => ({ ...n, appointmentReminders: !n.appointmentReminders }))}
            />
          </SettingRow>

          <SettingRow
            icon={AlertTriangle}
            label={t('settings.emergencyAlerts')}
            description={t('settings.emergencyAlertsDesc')}
          >
            <ToggleSwitch
              label={t('settings.emergencyAlerts')}
              enabled={notifications.emergencyAlerts}
              onChange={() => setNotifications(n => ({ ...n, emergencyAlerts: !n.emergencyAlerts }))}
            />
          </SettingRow>
        </div>
      </div>

      {/* Privacy Section */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-brand" />
          {t('settings.privacy')}
        </h2>

        <div className="divide-y divide-border">
          <SettingRow
            icon={Shield}
            label={t('settings.emergencyAccess')}
            description={t('settings.emergencyAccessDesc')}
          >
            <ToggleSwitch
              label={t('settings.emergencyAccess')}
              enabled={privacy.allowEmergencyAccess}
              onChange={() => setPrivacy(p => ({ ...p, allowEmergencyAccess: !p.allowEmergencyAccess }))}
            />
          </SettingRow>

          {!privacy.allowEmergencyAccess && (
            <div className="py-3 px-4 bg-caution-subtle border border-caution-subtle-fg/30 rounded-xl my-2">
              <div className="flex items-start gap-2 text-caution-subtle-fg text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  {t('settings.emergencyAccessWarning')}
                </span>
              </div>
            </div>
          )}

          <SettingRow
            icon={User}
            label={t('settings.profileVisibility')}
            description={t('settings.profileVisibilityDesc')}
          >
            <ToggleSwitch
              label={t('settings.profileVisibility')}
              enabled={privacy.showProfileToProviders}
              onChange={() => setPrivacy(p => ({ ...p, showProfileToProviders: !p.showProfileToProviders }))}
            />
          </SettingRow>

          <SettingRow
            icon={Info}
            label={t('settings.anonAnalytics')}
            description={t('settings.anonAnalyticsDesc')}
          >
            <ToggleSwitch
              label={t('settings.anonAnalytics')}
              enabled={privacy.anonymousAnalytics}
              onChange={() => setPrivacy(p => ({ ...p, anonymousAnalytics: !p.anonymousAnalytics }))}
            />
          </SettingRow>

          <SettingRow
            icon={FileText}
            label={t('settings.research')}
            description={t('settings.researchDesc')}
          >
            <ToggleSwitch
              label={t('settings.research')}
              enabled={privacy.shareWithResearchers}
              onChange={() => setPrivacy(p => ({ ...p, shareWithResearchers: !p.shareWithResearchers }))}
            />
          </SettingRow>
        </div>
      </div>

      {/* Devices that can open my records */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-brand" />
          {t('settings.devicesHeading')}
        </h2>
        <p className="text-sm text-content-muted mb-4">{t('settings.devicesSubtitle')}</p>

        {deviceError && (
          <div role="alert" className="mb-4 bg-critical-subtle border border-critical rounded-lg p-3">
            <p className="text-sm text-critical-subtle-fg">{deviceError}</p>
          </div>
        )}
        {deviceNotice && (
          <div role="status" className="mb-4 bg-ok-subtle border border-ok rounded-lg p-3">
            <p className="text-sm text-ok-subtle-fg">{deviceNotice}</p>
          </div>
        )}

        {!devicesLoaded ? (
          <p className="text-sm text-content-muted">{t('settings.devicesLoading')}</p>
        ) : devicesUnknown ? (
          <p className="text-sm text-content-muted">{t('settings.devicesUnknown')}</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-content-muted">{t('settings.devicesNone')}</p>
        ) : (
          <ul className="space-y-2" data-testid="mobile-device-list">
            {devices.map((device) => {
              const revoked = Boolean(device.revoked_at);
              return (
                <li
                  key={device.id}
                  className="flex items-start justify-between gap-3 border border-border rounded-lg p-3"
                >
                  <div>
                    <p className="text-sm text-content">{device.device_label}</p>
                    <p className="text-xs text-content-muted">{device.platform}</p>
                    {/* A revoked device stays listed and says so: seeing that
                        the lost phone can no longer open anything is the whole
                        reason to come here. */}
                    {revoked && (
                      <p className="text-xs text-content-muted mt-1">
                        {t('settings.deviceRevokedOn', {
                          date: formatDateOnly(device.revoked_at as string),
                        })}
                      </p>
                    )}
                  </div>
                  {!revoked && (
                    <button
                      type="button"
                      onClick={() => void revokeDevice(device)}
                      disabled={deviceBusy === device.id}
                      className="px-3 py-1 text-xs rounded-lg border border-critical text-critical-subtle-fg disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 min-h-[28px] whitespace-nowrap"
                    >
                      {deviceBusy === device.id
                        ? t('settings.deviceRevoking')
                        : t('settings.deviceRevoke')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* App Preferences */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-brand" />
          {t('settings.appPreferences')}
        </h2>

        <div className="divide-y divide-border">
          <SettingRow
            icon={Moon}
            label={t('settings.darkMode')}
            description={t('settings.darkModeDesc')}
          >
            <ToggleSwitch
              label={t('settings.darkMode')}
              enabled={appSettings.darkMode}
              onChange={() => {
                const next = !appSettings.darkMode;
                // Apply it, not just record it. `setThemePreference` puts the
                // class on <html> and sets color-scheme, which is what the
                // Tailwind dark palette and the browser's own form controls
                // both read.
                setThemePreference(next ? 'dark' : 'light');
                setAppSettings(s => ({ ...s, darkMode: next }));
              }}
            />
          </SettingRow>

          <div className="py-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-surface-sunken rounded-xl flex items-center justify-center">
                <Globe className="w-5 h-5 text-content-muted" />
              </div>
              <div>
                <div className="font-medium text-content">{t('settings.language')}</div>
                <div className="text-sm text-content-muted">{t('settings.languageDesc')}</div>
              </div>
            </div>
            <select
              value={appSettings.language}
              onChange={(e) => setAppSettings(s => ({ ...s, language: e.target.value }))}
              className="w-full px-4 py-3 border border-border-interactive rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {languages.map(lang => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          <div className="py-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-surface-sunken rounded-xl flex items-center justify-center">
                <span className="text-content-muted font-bold">Aa</span>
              </div>
              <div>
                <div className="font-medium text-content">{t('settings.fontSize')}</div>
                <div className="text-sm text-content-muted">{t('settings.fontSizeDesc')}</div>
              </div>
            </div>
            <div className="flex gap-2">
              {(['small', 'medium', 'large'] as const).map(size => (
                <button
                  key={size}
                  onClick={() => setAppSettings(s => ({ ...s, fontSize: size }))}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                    appSettings.fontSize === size
                      ? 'bg-primary-500 text-brand-fg'
                      : 'bg-surface-sunken text-content-muted hover:bg-surface-sunken'
                  }`}
                >
                  {t(`settings.size${size.charAt(0).toUpperCase() + size.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Support Section */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-content mb-4 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-brand" />
          {t('settings.support')}
        </h2>

        <div className="divide-y divide-border">
          <SettingRow
            icon={HelpCircle}
            label={t('settings.helpCenter')}
            description={t('settings.helpCenterDesc')}
            onClick={() => window.open('https://github.com/Lukau-Tech-Invasion/medichain/tree/main/docs', '_blank', 'noopener,noreferrer')}
          />

          <SettingRow
            icon={MessageSquare}
            label={t('settings.contactSupport')}
            description={t('settings.contactSupportDesc')}
            onClick={() => { window.location.href = 'mailto:kkgawatlh9@gmail.com'; }}
          />

          <SettingRow
            icon={FileText}
            label={t('settings.termsOfService')}
            onClick={() => setSupportNotice(t('settings.legalNotPublished'))}
          />

          <SettingRow
            icon={Shield}
            label={t('settings.privacyPolicy')}
            onClick={() => setSupportNotice(t('settings.legalNotPublished'))}
          />
        </div>
      </div>

      {/* Logout Button */}
      <button
        onClick={() => setShowLogoutConfirm(true)}
        className="w-full flex items-center justify-center gap-2 py-4 text-critical-subtle-fg hover:bg-critical-subtle rounded-xl transition-colors"
      >
        <LogOut className="w-5 h-5" />
        <span className="font-medium">{t('settings.signOut')}</span>
      </button>

      {/* App Version */}
      <div className="text-center text-xs text-content-muted space-y-1">
        <p>MediChain Patient App v1.0.0</p>
        <p>© 2025 Lukau Invasion (Pty) Ltd. All rights reserved.</p>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-critical-subtle rounded-full flex items-center justify-center mx-auto mb-4">
                <LogOut className="w-8 h-8 text-critical-subtle-fg" />
              </div>
              <h3 className="text-xl font-semibold text-content mb-2">
                {t('settings.signOutConfirm')}
              </h3>
              <p className="text-content-muted">
                {t('settings.signOutConfirmBody')}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3 border border-border rounded-xl font-medium text-content-secondary hover:bg-surface-sunken transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 py-3 bg-critical text-critical-fg rounded-xl font-medium hover:bg-critical transition-colors"
              >
                {t('settings.signOut')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
