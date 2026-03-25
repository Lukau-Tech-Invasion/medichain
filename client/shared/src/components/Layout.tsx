import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Users,
  UserPlus,
  History,
  Settings,
  AlertCircle,
  Heart,
  Shield,
  CreditCard,
  LogOut,
  Menu,
  X,
  User,
  Bell,
  Pill,
  Calendar,
  MessageSquare,
  Activity,
  Watch,
  TrendingUp,
  ClipboardList,
  Globe,
  WifiOff,
  Star,
  HelpCircle,
  Video,
  FlaskConical,
  BookOpen,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useSSE } from '../hooks/useSSE';
import { useApiStatus } from '../hooks/useApiStatus';
import { useToastActions } from './Toast';

interface LayoutProps {
  variant?: 'doctor' | 'patient';
}

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Shared Layout Component
 * 
 * Provides navigation and structure for both doctor and patient portals.
 * 
 * @param variant - 'doctor' for healthcare provider portal, 'patient' for patient portal
 */
export function Layout({ variant = 'doctor' }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Connection status
  const { isOnline, queueSize, checkConnection } = useApiStatus();

  // Real-time events
  const { events, isConnected: isSSEConnected } = useSSE();
  const { showInfo, showWarning, showError, showSuccess } = useToastActions();
  const lastProcessedEventRef = useRef<number>(0);

  // Handle incoming real-time events
  useEffect(() => {
    if (events.length > 0) {
      const latestEvent = events[0];
      if (latestEvent.timestamp > lastProcessedEventRef.current) {
        lastProcessedEventRef.current = latestEvent.timestamp;
        
        // Customize notifications based on portal variant
        if (variant === 'patient') {
          switch (latestEvent.event_type) {
            case 'reminder_due':
              showInfo(
                latestEvent.payload.message || 'Time to take your medication',
                'Medication Reminder'
              );
              break;
            case 'lab_result':
              showSuccess(
                'New lab results have been uploaded to your records.',
                'New Lab Result'
              );
              break;
            case 'notification':
              showInfo(latestEvent.payload.message, 'New Notification');
              break;
            default:
              // For patients, maybe show less technical info
              if (latestEvent.payload.message) {
                showInfo(latestEvent.payload.message);
              }
          }
        } else {
          // Doctor portal variant notifications
          switch (latestEvent.event_type) {
            case 'cds_alert':
              showWarning(
                latestEvent.payload.title || 'Clinical Alert',
                `Patient ${latestEvent.patient_id}: ${latestEvent.payload.severity} severity`
              );
              break;
            case 'lab_result':
              showSuccess(
                `New lab results available for patient ${latestEvent.patient_id}`,
                'Lab Result Ready'
              );
              break;
            case 'reminder_due':
              showInfo(
                latestEvent.payload.message || 'Task reminder due',
                'Task Reminder'
              );
              break;
            default:
              if (latestEvent.payload.message) {
                showInfo(latestEvent.payload.message, 'System Notification');
              }
          }
        }
      }
    }
  }, [events, variant, showInfo, showWarning, showSuccess]);

  const doctorNavItems: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/emergency', label: 'Emergency', icon: AlertCircle },
    { path: '/patients', label: 'Patients', icon: Users },
    { path: '/register', label: 'Register', icon: UserPlus },
    { path: '/access-logs', label: 'Access Logs', icon: History },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  // Comprehensive patient navigation organized by sections
  const patientNavSections: NavSection[] = [
    {
      label: 'Main',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/profile', label: 'My Profile', icon: User },
        { path: '/records', label: 'My Records', icon: FileText },
        { path: '/medical-id', label: 'Medical ID', icon: CreditCard },
      ],
    },
    {
      label: 'Health',
      items: [
        { path: '/medications', label: 'Medications', icon: Pill },
        { path: '/reminders', label: 'Med Reminders', icon: Bell },
        { path: '/vitals', label: 'Vital Signs', icon: Activity },
        { path: '/lab-results', label: 'Lab Results', icon: FlaskConical },
        { path: '/symptoms', label: 'Symptom Tracker', icon: Activity },
        { path: '/symptom-checker', label: 'Symptom Checker', icon: HelpCircle },
        { path: '/lab-trends', label: 'Lab Trends', icon: TrendingUp },
        { path: '/wearables', label: 'Wearables', icon: Watch },
        { path: '/medical-history', label: 'Medical History', icon: BookOpen },
      ],
    },
    {
      label: 'Care',
      items: [
        { path: '/appointments', label: 'Appointments', icon: Calendar },
        { path: '/telehealth', label: 'Telehealth', icon: Video },
        { path: '/messages', label: 'Messages', icon: MessageSquare },
        { path: '/family', label: 'Family Group', icon: Users },
      ],
    },
    {
      label: 'Account',
      items: [
        { path: '/consent', label: 'Access Control', icon: Shield },
        { path: '/emergency-card', label: 'Emergency Card', icon: AlertCircle },
        { path: '/insurance', label: 'Insurance', icon: ClipboardList },
        { path: '/notifications', label: 'Notifications', icon: Bell },
        { path: '/survey', label: 'Satisfaction Survey', icon: Star },
      ],
    },
    {
      label: 'Settings',
      items: [
        { path: '/settings', label: 'Settings', icon: Settings },
        { path: '/language', label: 'Language', icon: Globe },
        { path: '/offline-sync', label: 'Offline Sync', icon: WifiOff },
      ],
    },
  ];

  // Flatten patient sections for mobile and simple nav
  const _patientNavItems: NavItem[] = patientNavSections.flatMap(section => section.items);
  
  // Main nav for top bar (subset for cleaner UX)
  const patientMainNav: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/records', label: 'Records', icon: FileText },
    { path: '/medications', label: 'Medications', icon: Pill },
    { path: '/appointments', label: 'Appointments', icon: Calendar },
    { path: '/messages', label: 'Messages', icon: MessageSquare },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  const navItems = variant === 'doctor' ? doctorNavItems : patientMainNav;
  const brandColor = variant === 'doctor' ? 'primary' : 'health';

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-600 text-white px-4 py-2 text-center text-sm font-medium animate-pulse flex items-center justify-center gap-2 sticky top-0 z-50">
          <WifiOff className="w-4 h-4" />
          <span>You are currently offline. Changes will be synced when connection is restored.</span>
          {queueSize > 0 && (
            <span className="bg-white/20 px-2 py-0.5 rounded-lg ml-2 border border-white/30 text-xs">
              {queueSize} pending
            </span>
          )}
          <button 
            onClick={() => checkConnection()} 
            className="ml-4 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg transition-colors border border-white/30 text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Navigation */}
      <nav className="bg-white border-b border-neutral-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/dashboard" className="flex items-center gap-2">
              <div className={`w-10 h-10 bg-${brandColor}-500 rounded-xl flex items-center justify-center`}>
                <Heart className="w-6 h-6 text-white" />
              </div>
              <div className="hidden sm:block">
                <span className="text-xl font-semibold text-neutral-900">MediChain</span>
                <span className="text-sm text-neutral-500 ml-2">
                  {variant === 'doctor' ? 'Provider' : 'Patient'}
                </span>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-colors ${
                      isActive
                        ? `bg-${brandColor}-50 text-${brandColor}-600 font-medium`
                        : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-sm">{item.label}</span>
                  </Link>
                );
              })}
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-3">
              <button 
                onClick={() => navigate('/notifications')}
                className="relative p-2 text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
                title={isSSEConnected ? 'Live Connection Active' : 'Connecting to Live Events...'}
              >
                <Bell className={`w-6 h-6 ${isSSEConnected ? 'text-blue-600' : 'text-neutral-600'}`} />
                {isSSEConnected && <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />}
                {!isSSEConnected && <span className="absolute top-1 right-1 w-2 h-2 bg-red-400 rounded-full" />}
              </button>

              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-2 px-4 py-2 text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-neutral-600 hover:bg-neutral-100 rounded-xl"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-neutral-200 bg-white max-h-[80vh] overflow-y-auto">
            <div className="px-4 py-2">
              {variant === 'patient' ? (
                // Sectioned navigation for patient
                patientNavSections.map((section) => (
                  <div key={section.label} className="mb-4">
                    <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider px-4 py-2">
                      {section.label}
                    </p>
                    <div className="space-y-1">
                      {section.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                              isActive
                                ? `bg-${brandColor}-50 text-${brandColor}-600 font-medium`
                                : 'text-neutral-600 hover:bg-neutral-100'
                            }`}
                          >
                            <Icon className="w-5 h-5" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                // Simple navigation for doctor
                <div className="space-y-1">
                  {doctorNavItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                          isActive
                            ? `bg-${brandColor}-50 text-${brandColor}-600 font-medium`
                            : 'text-neutral-600 hover:bg-neutral-100'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors mt-4"
              >
                <LogOut className="w-5 h-5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
