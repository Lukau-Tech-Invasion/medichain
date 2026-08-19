import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  debugLog,
  getUserSettings,
  saveUserSettings,
  updateMedicalIdPreferences,
  useTranslation,
} from '@medichain/shared';
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

  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS);
  const [privacy, setPrivacy] = useState(DEFAULT_PRIVACY);
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);

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
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <div
        className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
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
        <div className="w-10 h-10 bg-neutral-100 rounded-xl flex items-center justify-center">
          <Icon className="w-5 h-5 text-neutral-600" />
        </div>
        <div>
          <div className="font-medium text-neutral-900">{label}</div>
          {description && (
            <div className="text-sm text-neutral-500">{description}</div>
          )}
        </div>
      </div>
      {children || (onClick && <ChevronRight className="w-5 h-5 text-neutral-400" />)}
    </>;
    return onClick ? (
      <button type="button" className="flex w-full items-center justify-between py-4 text-left" onClick={onClick}>
        {content}
      </button>
    ) : (
      <div className="flex items-center justify-between py-4">{content}</div>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{t('settings.title')}</h1>
          <p className="text-neutral-600">{t('settings.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || isLoading}
          className="flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saveSucceeded ? <CheckCircle className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {isSaving ? t('settings.saving') : saveSucceeded ? t('settings.saved') : t('settings.save')}
        </button>
      </div>

      {settingsError && <div role="alert" className="rounded-xl border border-emergency-200 bg-emergency-50 p-3 text-emergency-700">{settingsError}</div>}
      {supportNotice && <div role="status" className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-warning-700">{supportNotice}</div>}

      {/* Account Section */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <User className="w-5 h-5 text-primary-600" />
          {t('settings.account')}
        </h2>

        <div className="divide-y divide-neutral-100">
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

          <SettingRow
            icon={Key}
            label={t('settings.twoFactor')}
            description={t('settings.twoFactorDesc')}
          />

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
        <h2 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary-600" />
          {t('settings.notifications')}
        </h2>

        <div className="divide-y divide-neutral-100">
          <SettingRow
            icon={Mail}
            label={t('settings.emailNotif')}
            description={t('settings.emailNotifDesc')}
          >
            <ToggleSwitch
              label={t('settings.emailNotif')}
              enabled={notifications.emailNotifications}
              onChange={() => setNotifications(n => ({ ...n, emailNotifications: !n.emailNotifications }))}
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
        <h2 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary-600" />
          {t('settings.privacy')}
        </h2>

        <div className="divide-y divide-neutral-100">
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
            <div className="py-3 px-4 bg-warning-50 border border-warning-200 rounded-xl my-2">
              <div className="flex items-start gap-2 text-warning-700 text-sm">
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

      {/* App Preferences */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary-600" />
          {t('settings.appPreferences')}
        </h2>

        <div className="divide-y divide-neutral-100">
          <SettingRow
            icon={Moon}
            label={t('settings.darkMode')}
            description={t('settings.darkModeDesc')}
          >
            <ToggleSwitch
              label={t('settings.darkMode')}
              enabled={appSettings.darkMode}
              onChange={() => setAppSettings(s => ({ ...s, darkMode: !s.darkMode }))}
            />
          </SettingRow>

          <div className="py-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-neutral-100 rounded-xl flex items-center justify-center">
                <Globe className="w-5 h-5 text-neutral-600" />
              </div>
              <div>
                <div className="font-medium text-neutral-900">{t('settings.language')}</div>
                <div className="text-sm text-neutral-500">{t('settings.languageDesc')}</div>
              </div>
            </div>
            <select
              value={appSettings.language}
              onChange={(e) => setAppSettings(s => ({ ...s, language: e.target.value }))}
              className="w-full px-4 py-3 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
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
              <div className="w-10 h-10 bg-neutral-100 rounded-xl flex items-center justify-center">
                <span className="text-neutral-600 font-bold">Aa</span>
              </div>
              <div>
                <div className="font-medium text-neutral-900">{t('settings.fontSize')}</div>
                <div className="text-sm text-neutral-500">{t('settings.fontSizeDesc')}</div>
              </div>
            </div>
            <div className="flex gap-2">
              {(['small', 'medium', 'large'] as const).map(size => (
                <button
                  key={size}
                  onClick={() => setAppSettings(s => ({ ...s, fontSize: size }))}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                    appSettings.fontSize === size
                      ? 'bg-primary-500 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
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
        <h2 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-primary-600" />
          {t('settings.support')}
        </h2>

        <div className="divide-y divide-neutral-100">
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
        className="w-full flex items-center justify-center gap-2 py-4 text-emergency-600 hover:bg-emergency-50 rounded-xl transition-colors"
      >
        <LogOut className="w-5 h-5" />
        <span className="font-medium">{t('settings.signOut')}</span>
      </button>

      {/* App Version */}
      <div className="text-center text-xs text-neutral-400 space-y-1">
        <p>MediChain Patient App v1.0.0</p>
        <p>© 2025 Lukau Invasion (Pty) Ltd. All rights reserved.</p>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-emergency-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <LogOut className="w-8 h-8 text-emergency-600" />
              </div>
              <h3 className="text-xl font-semibold text-neutral-900 mb-2">
                {t('settings.signOutConfirm')}
              </h3>
              <p className="text-neutral-600">
                {t('settings.signOutConfirmBody')}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3 border border-neutral-200 rounded-xl font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 py-3 bg-emergency-500 text-white rounded-xl font-medium hover:bg-emergency-600 transition-colors"
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
