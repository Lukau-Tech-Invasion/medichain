import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import {
  Home,
  AlertTriangle,
  Users,
  UserPlus,
  FileText,
  Settings,
  LogOut,
  Shield,
  Activity,
  FlaskConical,
} from 'lucide-react';

/**
 * Navigation item definition
 */
interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles?: string[];
}

/**
 * Navigation items
 */
const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: <Home size={20} /> },
  {
    to: '/emergency',
    label: 'Emergency Access',
    icon: <AlertTriangle size={20} />,
  },
  { to: '/patients', label: 'Patients', icon: <Users size={20} /> },
  {
    to: '/register',
    label: 'Register Patient',
    icon: <UserPlus size={20} />,
    roles: ['Admin', 'Doctor', 'Nurse', 'LabTechnician', 'Pharmacist'],
  },
  {
    to: '/access-logs',
    label: 'Access Logs',
    icon: <FileText size={20} />,
    roles: ['Admin'],
  },
  {
    to: '/lab-results',
    label: 'Lab Results',
    icon: <FlaskConical size={20} />,
    roles: ['Admin', 'Doctor', 'Nurse'],
  },
  { to: '/settings', label: 'Settings', icon: <Settings size={20} /> },
];

/**
 * Main layout with sidebar navigation
 */
function Layout() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Filter nav items based on user role
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    return user && item.roles.includes(user.role);
  });

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow-lg flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
              <Shield className="text-white" size={24} />
            </div>
            <div>
              <h1 className="font-bold text-lg gradient-text">MediChain</h1>
              <p className="text-xs text-gray-500">Doctor Portal</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {visibleItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* User info & logout */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
              <Activity className="text-primary-600" size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-gray-900 truncate">
                {user?.username || 'User'}
              </p>
              <p className="text-xs text-gray-500">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
