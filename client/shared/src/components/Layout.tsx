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
} from 'lucide-react';
import { useState } from 'react';

interface LayoutProps {
  variant?: 'doctor' | 'patient';
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

  const doctorNavItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/emergency', label: 'Emergency', icon: AlertCircle },
    { path: '/patients', label: 'Patients', icon: Users },
    { path: '/register', label: 'Register', icon: UserPlus },
    { path: '/access-logs', label: 'Access Logs', icon: History },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  const patientNavItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/profile', label: 'My Profile', icon: User },
    { path: '/records', label: 'My Records', icon: FileText },
    { path: '/consent', label: 'Access Control', icon: Shield },
    { path: '/emergency-card', label: 'Emergency Card', icon: CreditCard },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  const navItems = variant === 'doctor' ? doctorNavItems : patientNavItems;
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
          <div className="md:hidden border-t border-neutral-200 bg-white">
            <div className="px-4 py-2 space-y-1">
              {navItems.map((item) => {
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
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors"
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
