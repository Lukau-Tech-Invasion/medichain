import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { PatientNavigation } from './PatientNavigation';
import { NavigationGuard } from '../forms/unsavedChanges';
import { confirmSignOutWithUnsent } from '../forms/signOutGuard';
import { useTranslation } from '../i18n/react';
import { ErrorBoundary } from './ErrorBoundary';
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
  ClipboardList,
  WifiOff,
  FlaskConical,
  BookOpen,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { refreshNotificationBadges, useUnreadNotifications } from '../hooks/useUnreadNotifications';
import { useSSE } from '../hooks/useSSE';
import { useApiStatus } from '../hooks/useApiStatus';
import { useToastActions } from './Toast';

interface LayoutProps {
  variant?: 'doctor' | 'patient';
  onLogout?: () => void | Promise<void>;
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
const PATIENT_TABS = [
  { path: '/dashboard', label: 'patientTabs.home', icon: LayoutDashboard, match: ['/dashboard'] },
  { path: '/records', label: 'patientTabs.health', icon: FileText, match: ['/records', '/medications', '/vitals', '/lab-results', '/medical-history', '/symptoms'] },
  { path: '/appointments', label: 'patientTabs.visits', icon: Calendar, match: ['/appointments', '/survey'] },
  { path: '/messages', label: 'patientTabs.messages', icon: MessageSquare, match: ['/messages'] },
  { path: '/me', label: 'patientTabs.me', icon: User, match: ['/me', '/profile', '/settings', '/emergency-card', '/privacy', '/cards'] },
] as const;

export function Layout({ variant = 'doctor', onLogout }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [patientDesktopMenuOpen, setPatientDesktopMenuOpen] = useState(false);

  // Connection status
  const { isOnline, queueSize, checkConnection } = useApiStatus();

  // Real-time events
  const { events, isConnected: isSSEConnected } = useSSE();
  const { showInfo, showWarning, showSuccess } = useToastActions();
  // The bell's number. Its dot used to be the live-connection light, which
  // read as "a new notification" and never went away.
  const unreadNotifications = useUnreadNotifications(variant === 'patient');
  const lastProcessedEventRef = useRef<number>(0);

  // Handle incoming real-time events
  useEffect(() => {
    if (events.length > 0) {
      const latestEvent = events[0];
      if (latestEvent.timestamp > lastProcessedEventRef.current) {
        lastProcessedEventRef.current = latestEvent.timestamp;
        refreshNotificationBadges();
        
        // Customize notifications based on portal variant
        if (variant === 'patient') {
          switch (latestEvent.event_type) {
            case 'message':
              // A message for this account arrived: say so, and tell an open
              // Messages page to reload. It used to appear only on a reload.
              showInfo(
                latestEvent.payload.sender_name
                  ? `From ${latestEvent.payload.sender_name}`
                  : 'You have a new message',
                'New message'
              );
              window.dispatchEvent(new Event('medichain:messages-refresh'));
              break;
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
              // Every sibling case here had a fallback and this one did not, so
              // a `notification` event carrying no `message` rendered a toast
              // with an empty body. Typing `payload` is what surfaced it.
              showInfo(
                latestEvent.payload.message || 'You have a new notification',
                'New Notification'
              );
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
                // An absent severity used to interpolate as the literal string
                // "undefined severity" into a clinical alert. Say nothing about
                // the severity rather than say that.
                latestEvent.payload.severity
                  ? `Patient ${latestEvent.patient_id}: ${latestEvent.payload.severity} severity`
                  : `Patient ${latestEvent.patient_id}`
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
      label: 'My essentials',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/me', label: 'Me', icon: User },
        { path: '/profile', label: 'My details', icon: User },
        { path: '/records', label: 'My Records', icon: FileText },
        { path: '/emergency-card', label: 'My emergency card', icon: CreditCard },
      ],
    },
    {
      label: 'My health',
      items: [
        { path: '/medications', label: 'Medicines and reminders', icon: Pill },
        { path: '/lab-results', label: 'Test results and trends', icon: FlaskConical },
        { path: '/vitals', label: 'Vital signs and devices', icon: Activity },
        { path: '/symptoms', label: 'Track and check symptoms', icon: Activity },
        { path: '/medical-history', label: 'Medical History', icon: BookOpen },
      ],
    },
    {
      label: 'My care team',
      items: [
        { path: '/appointments', label: 'Appointments and video visits', icon: Calendar },
        { path: '/messages', label: 'Messages and notifications', icon: MessageSquare },
      ],
    },
    {
      // Patient-app plan, approved 2026-11-04: the survey is offered after a
      // visit, and offline sync is a section of Settings, not a menu item.
      label: 'Privacy and account',
      items: [
        { path: '/privacy', label: 'Who sees my records', icon: Shield },
        { path: '/cards', label: 'My cards and family', icon: ClipboardList },
        { path: '/settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  // Primary actions stay in the desktop header. The remaining routes are in a
  // labelled desktop menu below; hiding them in the mobile-only drawer made
  // implemented patient workflows undiscoverable on laptops and desktops.
  const patientMainNav: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/records', label: 'Records', icon: FileText },
    { path: '/medications', label: 'Medications', icon: Pill },
    { path: '/appointments', label: 'Appointments', icon: Calendar },
    { path: '/messages', label: 'Messages', icon: MessageSquare },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  const navItems = variant === 'doctor' ? doctorNavItems : patientMainNav;

  const { t } = useTranslation();
  const handleLogout = async () => {
    const proceed = await confirmSignOutWithUnsent({
      title: t('forms.unsentTitle'),
      message: (n) => t('forms.unsentMessage', { n: String(n) }),
      confirm: t('forms.unsentConfirm'),
      cancel: t('forms.unsentCancel'),
    });
    if (!proceed) return;
    if (onLogout) await onLogout();
    else localStorage.clear();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      <NavigationGuard />
      {/*
        First focusable element in the document, deliberately. The patient app
        had no skip link at all: a keyboard or switch user reached the page
        content only after tabbing the entire header and navigation, on every
        single route.

        `min-h`/`min-w` because it becomes a real target once focused — WCAG 2.2
        SC 2.5.8 asks for 24x24 CSS px, and padding around a 14px line box does
        not get there on its own.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 inline-flex items-center min-h-[24px] min-w-[24px] px-3 py-1.5 bg-surface text-content border border-border-interactive rounded shadow"
      >
        Skip to main content
      </a>
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-caution text-caution-fg px-4 py-2 text-center text-sm font-medium animate-pulse flex items-center justify-center gap-2 sticky top-0 z-50">
          <WifiOff className="w-4 h-4" />
          <span>You are currently offline. Changes will be synced when connection is restored.</span>
          {queueSize > 0 && (
            <span className="bg-surface/20 px-2 py-0.5 rounded-lg ml-2 border border-white/30 text-xs">
              {queueSize} pending
            </span>
          )}
          <button 
            onClick={() => checkConnection()} 
            className="ml-4 px-3 py-1 bg-surface/20 hover:bg-surface/30 rounded-lg transition-colors border border-white/30 text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Navigation */}
      <nav className="bg-surface border-b border-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/dashboard" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center">
                <Heart className="w-6 h-6 text-white" />
              </div>
              <div className="hidden sm:block">
                <span className="text-xl font-semibold text-content">MediChain</span>
                <span className="text-sm text-content-muted ml-2">
                  {variant === 'doctor' ? 'Provider' : 'Patient'}
                </span>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-colors ${
                      isActive
                        ? 'bg-selected text-selected-fg font-semibold'
                        : 'text-content-muted hover:bg-surface-sunken'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-sm">{item.label}</span>
                  </Link>
                );
              })}
              {variant === 'patient' && (
                <button type="button" onClick={() => setPatientDesktopMenuOpen(true)}
                  aria-haspopup="dialog" aria-expanded={patientDesktopMenuOpen}
                  className="flex min-h-[44px] items-center gap-2 px-3 rounded-xl text-content hover:bg-surface-sunken">
                  <Menu className="w-5 h-5" /><span>All pages</span>
                </button>
              )}
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-3">
              <button 
                aria-label={unreadNotifications ? `Notifications, ${unreadNotifications} unread` : 'Notifications'}
                // The patient's notifications are a section of the one inbox.
                onClick={() => navigate(variant === 'patient' ? '/messages?view=notifications' : '/notifications')}
                className="relative p-2 text-content-muted hover:bg-surface-sunken rounded-xl transition-colors"
                title={isSSEConnected ? 'Live Connection Active' : 'Connecting to Live Events...'}
              >
                <Bell className={`w-6 h-6 ${isSSEConnected ? 'text-notice-subtle-fg' : 'text-content-muted'}`} />
                {unreadNotifications !== null && unreadNotifications > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[1.25rem] h-5 px-1 bg-critical text-critical-fg text-xs font-semibold rounded-full flex items-center justify-center">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </button>

              {variant !== 'patient' && <button
                aria-label="Sign out"
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-2 px-4 py-2 text-content-muted hover:bg-surface-sunken rounded-xl transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>}

              {/* Mobile Menu Button */}
              <button
                aria-label="Open navigation"
                aria-haspopup={variant === 'patient' ? 'dialog' : undefined}
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden min-h-[44px] flex items-center gap-2 p-2 text-content-muted hover:bg-surface-sunken rounded-xl"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                {variant === 'patient' && <span>Menu</span>}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && variant === 'doctor' && (
          <div className="lg:hidden border-t border-border bg-surface max-h-[80vh] overflow-y-auto">
            <div className="px-4 py-2">
              {(
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
                            ? 'bg-selected text-selected-fg font-semibold'
                            : 'text-content-muted hover:bg-surface-sunken'
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
                aria-label="Sign out"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 text-critical-subtle-fg hover:bg-critical-subtle rounded-xl transition-colors mt-4"
              >
                <LogOut className="w-5 h-5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}
      </nav>

      {variant === 'patient' && (mobileMenuOpen || patientDesktopMenuOpen) && (
        <PatientNavigation sections={patientNavSections} onClose={() => {
          setMobileMenuOpen(false);
          setPatientDesktopMenuOpen(false);
        }} onLogout={handleLogout} />
      )}

      {/* Main Content
          The boundary sits inside the layout, not around it, so a page that
          throws leaves the navigation usable instead of blanking the whole app
          — which is what happened when a single malformed record crashed the
          patient portal and took the emergency medical ID down with it.
          Keying it on the path resets the boundary when the user navigates
          away; without that, one crash would latch for the rest of the session. */}
      <main id="main-content" className={`max-w-7xl mx-auto ${variant === 'patient' ? 'pb-20 lg:pb-0' : ''}`}>
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Five tabs on a phone (UX plan Phase 8, mockup p1): the places a patient
          returns to, always one thumb-tap away. Everything else stays under the
          menu. Active is shown by colour, weight AND aria-current. */}
      {variant === 'patient' && (
        <nav aria-label={t('patientTabs.label')}
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
          {PATIENT_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.match.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));
            return (
              <Link key={tab.path} to={tab.path} aria-current={active ? 'page' : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs ${active ? 'font-bold text-selected-fg bg-selected' : 'text-content-muted'}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
                {t(tab.label)}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
