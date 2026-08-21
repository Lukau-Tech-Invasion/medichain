import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useThemeStore } from '../store';
import {
  debugLog,
  getUserSettings,
  saveUserSettings,
  useTranslation,
} from '@medichain/shared';
import { 
  Settings, 
  User, 
  Bell, 
  Shield, 
  Palette,
  Save,
  CheckCircle,
  Key,
  Smartphone,
  Globe,
  Sun,
  Moon,
  Monitor
} from 'lucide-react';

interface UserSettings {
  notifications: {
    emergencyAlerts: boolean;
    patientUpdates: boolean;
    systemAnnouncements: boolean;
    emailDigest: boolean;
  };
  security: {
    twoFactorEnabled: boolean;
    sessionTimeout: number;
    requirePinForEmergency: boolean;
  };
  display: {
    theme: 'light' | 'dark' | 'system';
    language: string;
    dateFormat: string;
    compactView: boolean;
  };
}

const initialSettings: UserSettings = {
  notifications: {
    emergencyAlerts: true,
    patientUpdates: true,
    systemAnnouncements: true,
    emailDigest: false,
  },
  security: {
    twoFactorEnabled: false,
    sessionTimeout: 30,
    requirePinForEmergency: false,
  },
  display: {
    theme: 'light',
    language: 'en',
    dateFormat: 'MM/DD/YYYY',
    compactView: false,
  },
};

function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const loadErrorMessage = t('docSettings.loadError');
  const [settings, setSettings] = useState<UserSettings>(initialSettings);
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security' | 'display'>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
    // Sync theme from store
    setSettings(prev => ({
      ...prev,
      display: { ...prev.display, theme }
    }));
  }, [isAuthenticated, navigate, theme]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const loadSettings = async () => {
      try {
        const stored = await getUserSettings<Partial<UserSettings>>();
        setSettings(current => ({
          notifications: { ...current.notifications, ...stored.notifications },
          security: { ...current.security, ...stored.security },
          display: { ...current.display, ...stored.display },
        }));
      } catch (error) {
        debugLog('DoctorSettingsPage', 'Could not load settings:', error);
        setSettingsError(loadErrorMessage);
      }
    };
    void loadSettings();
  }, [isAuthenticated, loadErrorMessage, user]);

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);
    setSettingsError(null);
    try {
      await saveUserSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      debugLog('DoctorSettingsPage', 'Could not save settings:', error);
      setSettingsError(t('docSettings.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const updateNotification = (key: keyof UserSettings['notifications'], value: boolean) => {
    setSettings(prev => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value },
    }));
  };

  const updateSecurity = (key: keyof UserSettings['security'], value: boolean | number) => {
    setSettings(prev => ({
      ...prev,
      security: { ...prev.security, [key]: value },
    }));
  };

  const updateDisplay = (key: keyof UserSettings['display'], value: string | boolean) => {
    setSettings(prev => ({
      ...prev,
      display: { ...prev.display, [key]: value },
    }));
  };

  const tabs = [
    { id: 'profile', label: t('docSettings.tabProfile'), icon: User },
    { id: 'notifications', label: t('docSettings.tabNotifications'), icon: Bell },
    { id: 'security', label: t('docSettings.tabSecurity'), icon: Shield },
    { id: 'display', label: t('docSettings.tabDisplay'), icon: Palette },
  ] as const;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-brand-subtle rounded-lg flex items-center justify-center">
              <Settings className="text-brand" size={24} />
            </div>
            <h1 className="text-2xl font-bold text-content">{t('docSettings.title')}</h1>
          </div>
          <p className="text-content-muted">
            {t('docSettings.subtitle')}
          </p>
        </div>
        
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-brand text-brand-fg rounded-lg hover:bg-brand transition-colors disabled:opacity-50"
        >
          {saved ? (
            <>
              <CheckCircle size={18} />
              {t('docSettings.saved')}
            </>
          ) : (
            <>
              <Save size={18} />
              {isSaving ? t('docSettings.saving') : t('docSettings.saveChanges')}
            </>
          )}
        </button>
      </div>

      {settingsError && (
        <div role="alert" className="mb-6 rounded-lg border border-critical bg-critical-subtle p-3 text-sm text-critical-subtle-fg">
          {settingsError}
        </div>
      )}

      <div className="flex gap-8">
        {/* Tabs */}
        <div className="w-64 bg-surface rounded-xl shadow p-4">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-brand-subtle text-brand-subtle-fg'
                    : 'text-content-muted hover:bg-surface-sunken'
                }`}
              >
                <tab.icon size={20} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 bg-surface rounded-xl shadow p-6">
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div>
              <h2 className="text-lg font-semibold text-content mb-6">{t('docSettings.profileInfo')}</h2>

              <div className="flex items-start gap-6 mb-8">
                <div className="w-20 h-20 bg-brand-subtle rounded-full flex items-center justify-center">
                  <User className="text-brand" size={32} />
                </div>
                <div>
                  <h3 className="font-medium text-content">{user?.username || t('docSettings.userFallback')}</h3>
                  <p className="text-sm text-content-muted">{user?.role || t('docSettings.roleFallback')}</p>
                  <button className="mt-2 text-sm text-brand hover:text-brand">
                    {t('docSettings.changeAvatar')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">{t('docSettings.userId')}</label>
                  <input
                    type="text"
                    value={user?.userId || ''}
                    disabled
                    className="w-full px-4 py-2 bg-surface-sunken border border-border-interactive rounded-lg text-content-muted"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">{t('docSettings.role')}</label>
                  <input
                    type="text"
                    value={user?.role || ''}
                    disabled
                    className="w-full px-4 py-2 bg-surface-sunken border border-border-interactive rounded-lg text-content-muted"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">{t('docSettings.email')}</label>
                  <input
                    type="email"
                    defaultValue={`${user?.username || 'user'}@medichain.health`}
                    className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-content-secondary mb-1">{t('docSettings.phone')}</label>
                  <input
                    type="tel"
                    defaultValue="+234-800-000-0000"
                    className="w-full px-4 py-2 border border-border-interactive rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
                  />
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-border">
                <h4 className="font-medium text-content mb-3">{t('docSettings.accountStatus')}</h4>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-3 py-1 bg-success-100 text-success-700 text-sm font-medium rounded-full">
                    {t('docSettings.active')}
                  </span>
                  <span className="text-sm text-content-muted">
                    {t('docSettings.memberSince')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div>
              <h2 className="text-lg font-semibold text-content mb-6">{t('docSettings.notifPrefs')}</h2>

              <div className="space-y-6">
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <h4 className="font-medium text-content">{t('docSettings.emergencyAlerts')}</h4>
                    <p className="text-sm text-content-muted">{t('docSettings.emergencyAlertsDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifications.emergencyAlerts}
                      onChange={(e) => updateNotification('emergencyAlerts', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-border-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <h4 className="font-medium text-content">{t('docSettings.patientUpdates')}</h4>
                    <p className="text-sm text-content-muted">{t('docSettings.patientUpdatesDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifications.patientUpdates}
                      onChange={(e) => updateNotification('patientUpdates', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-border-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <h4 className="font-medium text-content">{t('docSettings.systemAnnouncements')}</h4>
                    <p className="text-sm text-content-muted">{t('docSettings.systemAnnouncementsDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifications.systemAnnouncements}
                      onChange={(e) => updateNotification('systemAnnouncements', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-border-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <h4 className="font-medium text-content">{t('docSettings.emailDigest')}</h4>
                    <p className="text-sm text-content-muted">{t('docSettings.emailDigestDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifications.emailDigest}
                      onChange={(e) => updateNotification('emailDigest', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-border-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div>
              <h2 className="text-lg font-semibold text-content mb-6">{t('docSettings.securitySettings')}</h2>

              <div className="space-y-6">
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div className="flex items-start gap-3">
                    <Smartphone className="text-content-muted mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-content">{t('docSettings.twoFactor')}</h4>
                      <p className="text-sm text-content-muted">{t('docSettings.twoFactorDesc')}</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.security.twoFactorEnabled}
                      onChange={(e) => updateSecurity('twoFactorEnabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-border-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
                </div>

                <div className="py-3 border-b border-border">
                  <div className="flex items-start gap-3 mb-3">
                    <Key className="text-content-muted mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-content">{t('docSettings.sessionTimeout')}</h4>
                      <p className="text-sm text-content-muted">{t('docSettings.sessionTimeoutDesc')}</p>
                    </div>
                  </div>
                  <select
                    value={settings.security.sessionTimeout}
                    onChange={(e) => updateSecurity('sessionTimeout', Number(e.target.value))}
                    className="w-full max-w-xs px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
                  >
                    <option value={15}>{t('docSettings.min15')}</option>
                    <option value={30}>{t('docSettings.min30')}</option>
                    <option value={60}>{t('docSettings.hour1')}</option>
                    <option value={120}>{t('docSettings.hour2')}</option>
                  </select>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div className="flex items-start gap-3">
                    <Shield className="text-content-muted mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-content">{t('docSettings.pinEmergency')}</h4>
                      <p className="text-sm text-content-muted">{t('docSettings.pinEmergencyDesc')}</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.security.requirePinForEmergency}
                      onChange={(e) => updateSecurity('requirePinForEmergency', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-border-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
                </div>

                <div className="pt-4">
                  <button className="px-4 py-2 text-critical-subtle-fg border border-emergency-300 rounded-lg hover:bg-emergency-50 transition-colors">
                    {t('docSettings.changePassword')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Display Tab */}
          {activeTab === 'display' && (
            <div className="dark:text-white">
              <h2 className="text-lg font-semibold text-content dark:text-white mb-6">{t('docSettings.displayPrefs')}</h2>

              <div className="space-y-6">
                <div className="py-3 border-b border-border dark:border-gray-700">
                  <div className="flex items-start gap-3 mb-3">
                    <Palette className="text-content-muted dark:text-gray-300 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-content dark:text-white">{t('docSettings.theme')}</h4>
                      <p className="text-sm text-content-muted dark:text-gray-400">{t('docSettings.themeDesc')}</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {[
                      { value: 'light', label: t('docSettings.themeLight'), icon: Sun },
                      { value: 'dark', label: t('docSettings.themeDark'), icon: Moon },
                      { value: 'system', label: t('docSettings.themeSystem'), icon: Monitor }
                    ].map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => {
                          setTheme(value as 'light' | 'dark' | 'system');
                          updateDisplay('theme', value as UserSettings['display']['theme']);
                        }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                          settings.display.theme === value
                            ? 'bg-brand-subtle dark:bg-primary-900 text-brand-subtle-fg dark:text-primary-300 border-2 border-brand'
                            : 'bg-surface-sunken dark:bg-gray-700 text-content-secondary dark:text-gray-300 border-2 border-transparent hover:bg-surface-sunken dark:hover:bg-gray-600'
                        }`}
                      >
                        <Icon size={18} />
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* Dark and system are honest about their state rather than
                      silently degrading. The dark palette covers only a few
                      screens so far; choosing it should be a decision, not
                      something a dark OS does to a clinician on first load. */}
                  {settings.display.theme !== 'light' && (
                    <p className="mt-3 text-sm text-caution-subtle-fg bg-caution-subtle border border-caution rounded-lg p-3">
                      {t('docSettings.themeDarkIncomplete')}
                    </p>
                  )}
                </div>

                <div className="py-3 border-b border-border">
                  <div className="flex items-start gap-3 mb-3">
                    <Globe className="text-content-muted mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-content">{t('docSettings.language')}</h4>
                      <p className="text-sm text-content-muted">{t('docSettings.languageDesc')}</p>
                    </div>
                  </div>
                  <select
                    value={settings.display.language}
                    onChange={(e) => updateDisplay('language', e.target.value)}
                    className="w-full max-w-xs px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
                  >
                    <option value="en">{t('docSettings.langEnglish')}</option>
                    <option value="fr">{t('docSettings.langFrench')}</option>
                    <option value="sw">{t('docSettings.langSwahili')}</option>
                    <option value="ha">{t('docSettings.langHausa')}</option>
                    <option value="yo">{t('docSettings.langYoruba')}</option>
                    <option value="am">{t('docSettings.langAmharic')}</option>
                  </select>
                </div>

                <div className="py-3 border-b border-border">
                  <div className="flex items-start gap-3 mb-3">
                    <Settings className="text-content-muted mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-content">{t('docSettings.dateFormat')}</h4>
                      <p className="text-sm text-content-muted">{t('docSettings.dateFormatDesc')}</p>
                    </div>
                  </div>
                  <select
                    value={settings.display.dateFormat}
                    onChange={(e) => updateDisplay('dateFormat', e.target.value)}
                    className="w-full max-w-xs px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-brand outline-none"
                  >
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <h4 className="font-medium text-content">{t('docSettings.compactView')}</h4>
                    <p className="text-sm text-content-muted">{t('docSettings.compactViewDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.display.compactView}
                      onChange={(e) => updateDisplay('compactView', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-surface-sunken peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-border-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
