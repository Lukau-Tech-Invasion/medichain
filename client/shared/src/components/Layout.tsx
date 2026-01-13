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
} from 'lucide-react';
import { useState } from 'react';

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
        { path: '/symptoms', label: 'Symptom Tracker', icon: Activity },
        { path: '/symptom-checker', label: 'Symptom Checker', icon: HelpCircle },
        { path: '/lab-trends', label: 'Lab Trends', icon: TrendingUp },
        { path: '/wearables', label: 'Wearables', icon: Watch },
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
              <button className="relative p-2 text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors">
                <Bell className="w-6 h-6" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
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
