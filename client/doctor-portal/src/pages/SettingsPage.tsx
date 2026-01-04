import { useState } from 'react';
import { useAuthStore } from '../store';
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
  Globe
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
  const { user } = useAuthStore();
  const [settings, setSettings] = useState<UserSettings>(initialSettings);
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security' | 'display'>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
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
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'display', label: 'Display', icon: Palette },
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
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          </div>
          <p className="text-gray-500">
            Manage your account settings and preferences
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
              Saved!
            </>
          ) : (
            <>
              <Save size={18} />
              {isSaving ? 'Saving...' : 'Save Changes'}
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
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Profile Information</h2>
              
              <div className="flex items-start gap-6 mb-8">
                <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center">
                  <User className="text-primary-600" size={32} />
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">{user?.username || 'User'}</h3>
                  <p className="text-sm text-gray-500">{user?.role || 'Role'}</p>
                  <button className="mt-2 text-sm text-primary-600 hover:text-primary-700">
                    Change Avatar
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">User ID</label>
                  <input
                    type="text"
                    value={user?.userId || ''}
                    disabled
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <input
                    type="text"
                    value={user?.role || ''}
                    disabled
                    className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    defaultValue={`${user?.username || 'user'}@medichain.health`}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    defaultValue="+234-800-000-0000"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="font-medium text-gray-900 mb-3">Account Status</h4>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-3 py-1 bg-success-100 text-success-700 text-sm font-medium rounded-full">
                    Active
                  </span>
                  <span className="text-sm text-gray-500">
                    Member since January 2026
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Notification Preferences</h2>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div>
                    <h4 className="font-medium text-gray-900">Emergency Alerts</h4>
                    <p className="text-sm text-gray-500">Get notified when emergency access is requested</p>
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
                    <h4 className="font-medium text-gray-900">Patient Updates</h4>
                    <p className="text-sm text-gray-500">Notifications when patient records are updated</p>
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
                    <h4 className="font-medium text-gray-900">System Announcements</h4>
                    <p className="text-sm text-gray-500">Important updates about MediChain</p>
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
                    <h4 className="font-medium text-gray-900">Email Digest</h4>
                    <p className="text-sm text-gray-500">Weekly summary of all activity</p>
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
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Security Settings</h2>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3">
                    <Smartphone className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">Two-Factor Authentication</h4>
                      <p className="text-sm text-gray-500">Add an extra layer of security to your account</p>
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
                      <h4 className="font-medium text-gray-900">Session Timeout</h4>
                      <p className="text-sm text-gray-500">Automatically log out after inactivity</p>
                    </div>
                  </div>
                  <select
                    value={settings.security.sessionTimeout}
                    onChange={(e) => updateSecurity('sessionTimeout', Number(e.target.value))}
                    className="w-full max-w-xs px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                  </select>
                </div>

                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3">
                    <Shield className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">PIN for Emergency Access</h4>
                      <p className="text-sm text-gray-500">Require PIN confirmation for emergency patient access</p>
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
                    Change Password
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Display Tab */}
          {activeTab === 'display' && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Display Preferences</h2>
              
              <div className="space-y-6">
                <div className="py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3 mb-3">
                    <Palette className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">Theme</h4>
                      <p className="text-sm text-gray-500">Choose your preferred color scheme</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {['light', 'dark', 'system'].map((theme) => (
                      <button
                        key={theme}
                        onClick={() => updateDisplay('theme', theme as UserSettings['display']['theme'])}
                        className={`px-4 py-2 rounded-lg capitalize transition-colors ${
                          settings.display.theme === theme
                            ? 'bg-primary-100 text-primary-700 border-2 border-primary-500'
                            : 'bg-gray-100 text-gray-700 border-2 border-transparent hover:bg-gray-200'
                        }`}
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3 mb-3">
                    <Globe className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">Language</h4>
                      <p className="text-sm text-gray-500">Select your preferred language</p>
                    </div>
                  </div>
                  <select
                    value={settings.display.language}
                    onChange={(e) => updateDisplay('language', e.target.value)}
                    className="w-full max-w-xs px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  >
                    <option value="en">English</option>
                    <option value="fr">French</option>
                    <option value="sw">Swahili</option>
                    <option value="ha">Hausa</option>
                    <option value="yo">Yoruba</option>
                    <option value="am">Amharic</option>
                  </select>
                </div>

                <div className="py-3 border-b border-gray-100">
                  <div className="flex items-start gap-3 mb-3">
                    <Settings className="text-gray-400 mt-1" size={20} />
                    <div>
                      <h4 className="font-medium text-gray-900">Date Format</h4>
                      <p className="text-sm text-gray-500">How dates are displayed</p>
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
                    <h4 className="font-medium text-gray-900">Compact View</h4>
                    <p className="text-sm text-gray-500">Display more information with less spacing</p>
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
