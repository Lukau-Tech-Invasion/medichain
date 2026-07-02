import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useThemeStore } from '../store';
import { apiUrl, useTranslation } from '@medichain/shared';
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
  const [settings, setSettings] = useState<UserSettings>(initialSettings);
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security' | 'display'>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

  const handleSave = async () => {
    if (!user) return;
    
    setIsSaving(true);
    try {
      const response = await fetch(apiUrl('/api/settings'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': user.walletAddress,
          'X-Provider-Role': user.role,
        },
        body: JSON.stringify(settings),
      });
      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        console.error('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
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
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <Settings className="text-primary-600" size={24} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{t('docSettings.title')}</h1>
          </div>
          <p className="text-gray-500">
            {t('docSettings.subtitle')}
          </p>
        </div>
        
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
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

      <div className="flex gap-8">
        {/* Tabs */}
        <div className="w-64 bg-white rounded-xl shadow p-4">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <tab.icon size={20} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 bg-white rounded-xl shadow p-6">
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('docSettings.profileInfo')}</h2>

              <div className="flex items-start gap-6 mb-8">
                <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center">
                  <User className="text-primary-600" size={32} />
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">{user?.username || t('docSettings.userFallback')}</h3>
                  <p className="text-sm text-gray-500">{user?.role || t('docSettings.roleFallback')}</p>
                  <button className="mt-2 text-sm text-primary-600 hover:text-primary-700">
                    {t('docSettings.changeAvatar')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('docSettings.userId')}</label>
                  <input
                    type="text"
                    value={user?.userId || ''}
                    disabled
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('docSettings.role')}</label>
                  <input
                    type="text"
                    value={user?.role || ''}
                    disabled
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('docSettings.email')}</label>
                  <input
                    type="email"
                    defaultValue={`${user?.username || 'user'}@medichain.health`}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('docSettings.phone')}</label>
                  <input
                    type="tel"
                    defaultValue="+234-800-000-0000"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="font-medium text-gray-900 mb-3">{t('docSettings.accountStatus')}</h4>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-3 py-1 bg-success-100 text-success-700 text-sm font-medium rounded-full">
                    {t('docSettings.active')}
                  </span>
                  <span className="text-sm text-gray-500">
                    {t('docSettings.memberSince')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('docSettings.notifPrefs')}</h2>

              <div className="space-y-6">
                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div>
                    <h4 className="font-medium text-gray-900">{t('docSettings.emergencyAlerts')}</h4>
                    <p className="text-sm text-gray-500">{t('docSettings.emergencyAlertsDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifications.emergencyAlerts}
                      onChange={(e) => updateNotification('emergencyAlerts', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div>
                    <h4 className="font-medium text-gray-900">{t('docSettings.patientUpdates')}</h4>
                    <p className="text-sm text-gray-500">{t('docSettings.patientUpdatesDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifications.patientUpdates}
                      onChange={(e) => updateNotification('patientUpdates', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div>
                    <h4 className="font-medium text-gray-900">{t('docSettings.systemAnnouncements')}</h4>
                    <p className="text-sm text-gray-500">{t('docSettings.systemAnnouncementsDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifications.systemAnnouncements}
                      onChange={(e) => updateNotification('systemAnnouncements', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <h4 className="font-medium text-gray-900">{t('docSettings.emailDigest')}</h4>
                    <p className="text-sm text-gray-500">{t('docSettings.emailDigestDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notifications.emailDigest}
                      onChange={(e) => updateNotification('emailDigest', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('docSettings.securitySettings')}</h2>

              <div className="space-y-6">
                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3">
                    <Smartphone className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">{t('docSettings.twoFactor')}</h4>
                      <p className="text-sm text-gray-500">{t('docSettings.twoFactorDesc')}</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.security.twoFactorEnabled}
                      onChange={(e) => updateSecurity('twoFactorEnabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                <div className="py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3 mb-3">
                    <Key className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">{t('docSettings.sessionTimeout')}</h4>
                      <p className="text-sm text-gray-500">{t('docSettings.sessionTimeoutDesc')}</p>
                    </div>
                  </div>
                  <select
                    value={settings.security.sessionTimeout}
                    onChange={(e) => updateSecurity('sessionTimeout', Number(e.target.value))}
                    className="w-full max-w-xs px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  >
                    <option value={15}>{t('docSettings.min15')}</option>
                    <option value={30}>{t('docSettings.min30')}</option>
                    <option value={60}>{t('docSettings.hour1')}</option>
                    <option value={120}>{t('docSettings.hour2')}</option>
                  </select>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3">
                    <Shield className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">{t('docSettings.pinEmergency')}</h4>
                      <p className="text-sm text-gray-500">{t('docSettings.pinEmergencyDesc')}</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.security.requirePinForEmergency}
                      onChange={(e) => updateSecurity('requirePinForEmergency', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                <div className="pt-4">
                  <button className="px-4 py-2 text-emergency-600 border border-emergency-300 rounded-lg hover:bg-emergency-50 transition-colors">
                    {t('docSettings.changePassword')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Display Tab */}
          {activeTab === 'display' && (
            <div className="dark:text-white">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">{t('docSettings.displayPrefs')}</h2>

              <div className="space-y-6">
                <div className="py-3 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-start gap-3 mb-3">
                    <Palette className="text-gray-400 dark:text-gray-300 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900 dark:text-white">{t('docSettings.theme')}</h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t('docSettings.themeDesc')}</p>
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
                            ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 border-2 border-primary-500'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-2 border-transparent hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        <Icon size={18} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3 mb-3">
                    <Globe className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">{t('docSettings.language')}</h4>
                      <p className="text-sm text-gray-500">{t('docSettings.languageDesc')}</p>
                    </div>
                  </div>
                  <select
                    value={settings.display.language}
                    onChange={(e) => updateDisplay('language', e.target.value)}
                    className="w-full max-w-xs px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  >
                    <option value="en">{t('docSettings.langEnglish')}</option>
                    <option value="fr">{t('docSettings.langFrench')}</option>
                    <option value="sw">{t('docSettings.langSwahili')}</option>
                    <option value="ha">{t('docSettings.langHausa')}</option>
                    <option value="yo">{t('docSettings.langYoruba')}</option>
                    <option value="am">{t('docSettings.langAmharic')}</option>
                  </select>
                </div>

                <div className="py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3 mb-3">
                    <Settings className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">{t('docSettings.dateFormat')}</h4>
                      <p className="text-sm text-gray-500">{t('docSettings.dateFormatDesc')}</p>
                    </div>
                  </div>
                  <select
                    value={settings.display.dateFormat}
                    onChange={(e) => updateDisplay('dateFormat', e.target.value)}
                    className="w-full max-w-xs px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  >
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <h4 className="font-medium text-gray-900">{t('docSettings.compactView')}</h4>
                    <p className="text-sm text-gray-500">{t('docSettings.compactViewDesc')}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.display.compactView}
                      onChange={(e) => updateDisplay('compactView', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
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
