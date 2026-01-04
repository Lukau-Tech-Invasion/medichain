import { useState } from 'react';
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
  Check,
  AlertTriangle,
  Info,
  HelpCircle,
  FileText,
  Mail,
  MessageSquare,
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

/**
 * Settings Page
 * 
 * Account settings, notifications, privacy, and app preferences.
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const [notifications, setNotifications] = useState<NotificationSettings>({
    emailNotifications: true,
    smsNotifications: true,
    pushNotifications: true,
    accessAlerts: true,
    appointmentReminders: true,
    recordUpdates: false,
    emergencyAlerts: true,
  });

  const [privacy, setPrivacy] = useState<PrivacySettings>({
    shareWithResearchers: false,
    anonymousAnalytics: true,
    showProfileToProviders: true,
    allowEmergencyAccess: true,
  });

  const [appSettings, setAppSettings] = useState<AppSettings>({
    darkMode: false,
    language: 'en',
    fontSize: 'medium',
    biometricLogin: true,
  });

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSaving(false);
    setActiveSection(null);
  };

  const handleLogout = () => {
    // In production: clear auth state, redirect to login
    window.location.href = '/login';
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
    onChange 
  }: { 
    enabled: boolean; 
    onChange: () => void 
  }) => (
    <button
      onClick={onChange}
      className={`relative w-12 h-7 rounded-full transition-colors ${
        enabled ? 'bg-primary-500' : 'bg-neutral-300'
      }`}
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
  }) => (
    <div
      className={`flex items-center justify-between py-4 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
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
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Settings</h1>
        <p className="text-neutral-600">Manage your account and preferences</p>
      </div>

      {/* Account Section */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <User className="w-5 h-5 text-primary-600" />
          Account
        </h2>

        <div className="divide-y divide-neutral-100">
          <SettingRow
            icon={User}
            label="Personal Information"
            description="Update your name, email, phone"
            onClick={() => window.location.href = '/profile'}
          />
          
          <SettingRow
            icon={Lock}
            label="Change Password"
            description="Update your account password"
            onClick={() => setActiveSection('password')}
          />
          
          <SettingRow
            icon={Key}
            label="Two-Factor Authentication"
            description="Add extra security to your account"
            onClick={() => setActiveSection('2fa')}
          />
          
          <SettingRow
            icon={Smartphone}
            label="Biometric Login"
            description="Use fingerprint or face ID"
          >
            <ToggleSwitch
              enabled={appSettings.biometricLogin}
              onChange={() => setAppSettings(s => ({ ...s, biometricLogin: !s.biometricLogin }))}
            />
          </SettingRow>
        </div>
      </div>

      {/* Notifications Section */}
      <div className="patient-card">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary-600" />
          Notifications
        </h2>

        <div className="divide-y divide-neutral-100">
          <SettingRow
            icon={Mail}
            label="Email Notifications"
            description="Receive updates via email"
          >
            <ToggleSwitch
              enabled={notifications.emailNotifications}
              onChange={() => setNotifications(n => ({ ...n, emailNotifications: !n.emailNotifications }))}
            />
          </SettingRow>

          <SettingRow
            icon={MessageSquare}
            label="SMS Notifications"
            description="Receive text messages"
          >
            <ToggleSwitch
              enabled={notifications.smsNotifications}
              onChange={() => setNotifications(n => ({ ...n, smsNotifications: !n.smsNotifications }))}
            />
          </SettingRow>

          <SettingRow
            icon={Smartphone}
            label="Push Notifications"
            description="Receive app notifications"
          >
            <ToggleSwitch
              enabled={notifications.pushNotifications}
              onChange={() => setNotifications(n => ({ ...n, pushNotifications: !n.pushNotifications }))}
            />
          </SettingRow>

          <SettingRow
            icon={Shield}
            label="Access Alerts"
            description="When someone views your records"
          >
            <ToggleSwitch
              enabled={notifications.accessAlerts}
              onChange={() => setNotifications(n => ({ ...n, accessAlerts: !n.accessAlerts }))}
            />
          </SettingRow>

          <SettingRow
            icon={Bell}
            label="Appointment Reminders"
            description="Upcoming appointment alerts"
          >
            <ToggleSwitch
              enabled={notifications.appointmentReminders}
              onChange={() => setNotifications(n => ({ ...n, appointmentReminders: !n.appointmentReminders }))}
            />
          </SettingRow>

          <SettingRow
            icon={AlertTriangle}
            label="Emergency Alerts"
            description="Critical health notifications"
          >
            <ToggleSwitch
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
          Privacy
        </h2>

        <div className="divide-y divide-neutral-100">
          <SettingRow
            icon={Shield}
            label="Emergency Access"
            description="Allow first responders to access your data"
          >
            <ToggleSwitch
              enabled={privacy.allowEmergencyAccess}
              onChange={() => setPrivacy(p => ({ ...p, allowEmergencyAccess: !p.allowEmergencyAccess }))}
            />
          </SettingRow>

          {!privacy.allowEmergencyAccess && (
            <div className="py-3 px-4 bg-warning-50 border border-warning-200 rounded-xl my-2">
              <div className="flex items-start gap-2 text-warning-700 text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  Disabling emergency access may delay critical care in emergencies. 
                  First responders won't be able to view your allergies or medications.
                </span>
              </div>
            </div>
          )}

          <SettingRow
            icon={User}
            label="Profile Visibility"
            description="Show your profile to healthcare providers"
          >
            <ToggleSwitch
              enabled={privacy.showProfileToProviders}
              onChange={() => setPrivacy(p => ({ ...p, showProfileToProviders: !p.showProfileToProviders }))}
            />
          </SettingRow>

          <SettingRow
            icon={Info}
            label="Anonymous Analytics"
            description="Help improve MediChain with usage data"
          >
            <ToggleSwitch
              enabled={privacy.anonymousAnalytics}
              onChange={() => setPrivacy(p => ({ ...p, anonymousAnalytics: !p.anonymousAnalytics }))}
            />
          </SettingRow>

          <SettingRow
            icon={FileText}
            label="Research Participation"
            description="Share anonymized data with researchers"
          >
            <ToggleSwitch
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
          App Preferences
        </h2>

        <div className="divide-y divide-neutral-100">
          <SettingRow
            icon={Moon}
            label="Dark Mode"
            description="Use dark color scheme"
          >
            <ToggleSwitch
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
                <div className="font-medium text-neutral-900">Language</div>
                <div className="text-sm text-neutral-500">Choose your preferred language</div>
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
                <div className="font-medium text-neutral-900">Font Size</div>
                <div className="text-sm text-neutral-500">Adjust text size</div>
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
                  {size.charAt(0).toUpperCase() + size.slice(1)}
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
          Support
        </h2>

        <div className="divide-y divide-neutral-100">
          <SettingRow
            icon={HelpCircle}
            label="Help Center"
            description="FAQs and guides"
            onClick={() => {}}
          />
          
          <SettingRow
            icon={MessageSquare}
            label="Contact Support"
            description="Get help from our team"
            onClick={() => {}}
          />
          
          <SettingRow
            icon={FileText}
            label="Terms of Service"
            onClick={() => {}}
          />
          
          <SettingRow
            icon={Shield}
            label="Privacy Policy"
            onClick={() => {}}
          />
        </div>
      </div>

      {/* Logout Button */}
      <button
        onClick={() => setShowLogoutConfirm(true)}
        className="w-full flex items-center justify-center gap-2 py-4 text-emergency-600 hover:bg-emergency-50 rounded-xl transition-colors"
      >
        <LogOut className="w-5 h-5" />
        <span className="font-medium">Sign Out</span>
      </button>

      {/* App Version */}
      <div className="text-center text-xs text-neutral-400 space-y-1">
        <p>MediChain Patient App v1.0.0</p>
        <p>© 2025 Trustware. All rights reserved.</p>
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
                Sign Out?
              </h3>
              <p className="text-neutral-600">
                Are you sure you want to sign out of your account?
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3 border border-neutral-200 rounded-xl font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 py-3 bg-emergency-500 text-white rounded-xl font-medium hover:bg-emergency-600 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
