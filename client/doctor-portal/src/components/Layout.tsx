import { useState } from 'react';
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
  ChevronDown,
  ChevronRight,
  Stethoscope,
  Heart,
  Pill,
  Scissors,
  TestTube,
  Image,
  UserCog,
  Calendar,
  ClipboardList,
  Siren,
  Thermometer,
  Baby,
  Brain,
  Flame,
  Droplets,
  FileCheck,
  BarChart3,
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

interface NavSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
  roles?: string[];
}

/**
 * Navigation sections with organized menu items
 */
const NAV_SECTIONS: NavSection[] = [
  {
    id: 'main',
    label: 'Main',
    icon: <Home size={20} />,
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: <Home size={18} /> },
      { to: '/patients', label: 'Patient Search', icon: <Users size={18} /> },
      { to: '/register', label: 'Register Patient', icon: <UserPlus size={18} />, roles: ['Admin', 'Doctor', 'Nurse', 'LabTechnician', 'Pharmacist'] },
      { to: '/appointments', label: 'Appointments', icon: <Calendar size={18} /> },
    ],
  },
  {
    id: 'clinical',
    label: 'Clinical Documentation',
    icon: <ClipboardList size={20} />,
    items: [
      { to: '/triage', label: 'Triage', icon: <Thermometer size={18} /> },
      { to: '/soap', label: 'SOAP Notes', icon: <FileText size={18} /> },
      { to: '/vitals', label: 'Vital Signs', icon: <Activity size={18} /> },
      { to: '/progress-note', label: 'Progress Notes', icon: <FileText size={18} /> },
      { to: '/history-physical', label: 'H&P', icon: <Stethoscope size={18} /> },
      { to: '/discharge', label: 'Discharge', icon: <FileCheck size={18} /> },
      { to: '/consult', label: 'Consult', icon: <Users size={18} /> },
      { to: '/ama', label: 'AMA', icon: <FileText size={18} /> },
    ],
  },
  {
    id: 'emergency',
    label: 'Emergency Protocols',
    icon: <Siren size={20} />,
    items: [
      { to: '/emergency', label: 'Emergency Access', icon: <AlertTriangle size={18} /> },
      { to: '/emergency-protocols', label: 'Protocols Hub', icon: <Siren size={18} /> },
      { to: '/code-blue', label: 'Code Blue', icon: <Heart size={18} /> },
      { to: '/trauma', label: 'Trauma', icon: <AlertTriangle size={18} /> },
      { to: '/stroke', label: 'Stroke', icon: <Brain size={18} /> },
      { to: '/cardiac', label: 'Cardiac', icon: <Heart size={18} /> },
      { to: '/sepsis', label: 'Sepsis', icon: <Thermometer size={18} /> },
      { to: '/mci', label: 'MCI Triage', icon: <Users size={18} /> },
    ],
  },
  {
    id: 'nursing',
    label: 'Nursing',
    icon: <Stethoscope size={20} />,
    items: [
      { to: '/nursing', label: 'Nursing Hub', icon: <Stethoscope size={18} /> },
      { to: '/mar', label: 'MAR', icon: <Pill size={18} /> },
      { to: '/care-plan', label: 'Care Plan', icon: <ClipboardList size={18} /> },
      { to: '/nursing-care-plan', label: 'Nursing Care Plan', icon: <ClipboardList size={18} /> },
      { to: '/intake-output', label: 'I/O', icon: <Droplets size={18} /> },
      { to: '/wound-care', label: 'Wound Care', icon: <Flame size={18} /> },
      { to: '/iv-site', label: 'IV Site', icon: <Droplets size={18} /> },
      { to: '/shift-handoff', label: 'Shift Handoff', icon: <FileText size={18} /> },
      { to: '/fall-risk', label: 'Fall Risk', icon: <AlertTriangle size={18} /> },
      { to: '/incident-report', label: 'Incident Report', icon: <FileText size={18} /> },
    ],
    roles: ['Admin', 'Doctor', 'Nurse'],
  },
  {
    id: 'medications',
    label: 'Medications & Orders',
    icon: <Pill size={20} />,
    items: [
      { to: '/orders', label: 'Orders', icon: <ClipboardList size={18} /> },
      { to: '/e-prescribe', label: 'E-Prescribe', icon: <Pill size={18} /> },
      { to: '/medication-admin', label: 'Med Admin', icon: <Pill size={18} /> },
      { to: '/drug-interactions', label: 'Drug Interactions', icon: <AlertTriangle size={18} /> },
    ],
    roles: ['Admin', 'Doctor', 'Nurse', 'Pharmacist'],
  },
  {
    id: 'specialty',
    label: 'Specialty',
    icon: <Baby size={20} />,
    items: [
      { to: '/burn', label: 'Burn', icon: <Flame size={18} /> },
      { to: '/psych', label: 'Psych', icon: <Brain size={18} /> },
      { to: '/toxicology', label: 'Toxicology', icon: <FlaskConical size={18} /> },
      { to: '/pediatrics', label: 'Pediatrics', icon: <Baby size={18} /> },
      { to: '/obstetrics', label: 'Obstetrics', icon: <Heart size={18} /> },
    ],
    roles: ['Admin', 'Doctor', 'Nurse'],
  },
  {
    id: 'procedures',
    label: 'Procedures',
    icon: <Scissors size={20} />,
    items: [
      { to: '/intubation', label: 'Intubation', icon: <Activity size={18} /> },
      { to: '/laceration-repair', label: 'Laceration Repair', icon: <Scissors size={18} /> },
      { to: '/splint', label: 'Splint/Cast', icon: <Scissors size={18} /> },
    ],
    roles: ['Admin', 'Doctor'],
  },
  {
    id: 'surgical',
    label: 'Surgical',
    icon: <Scissors size={20} />,
    items: [
      { to: '/pre-op', label: 'Pre-Op', icon: <FileText size={18} /> },
      { to: '/operative-note', label: 'Operative Note', icon: <FileText size={18} /> },
      { to: '/post-op', label: 'Post-Op', icon: <FileText size={18} /> },
      { to: '/anesthesia', label: 'Anesthesia', icon: <Activity size={18} /> },
    ],
    roles: ['Admin', 'Doctor'],
  },
  {
    id: 'lab',
    label: 'Lab & Diagnostics',
    icon: <TestTube size={20} />,
    items: [
      { to: '/lab-results', label: 'Lab Results', icon: <FlaskConical size={18} /> },
      { to: '/specimen', label: 'Specimen', icon: <TestTube size={18} /> },
      { to: '/chain-of-custody', label: 'Chain of Custody', icon: <FileText size={18} /> },
      { to: '/lab-qc', label: 'Lab QC', icon: <FileCheck size={18} /> },
      { to: '/critical-value', label: 'Critical Values', icon: <AlertTriangle size={18} /> },
      { to: '/blood-bank', label: 'Blood Bank', icon: <Droplets size={18} /> },
    ],
    roles: ['Admin', 'Doctor', 'Nurse', 'LabTechnician'],
  },
  {
    id: 'imaging',
    label: 'Imaging & Radiology',
    icon: <Image size={20} />,
    items: [
      { to: '/imaging', label: 'Imaging', icon: <Image size={18} /> },
      { to: '/radiology', label: 'Radiology', icon: <Image size={18} /> },
      { to: '/pathology', label: 'Pathology', icon: <TestTube size={18} /> },
    ],
    roles: ['Admin', 'Doctor', 'Nurse'],
  },
  {
    id: 'health',
    label: 'Health Maintenance',
    icon: <Heart size={20} />,
    items: [
      { to: '/immunization', label: 'Immunizations', icon: <Activity size={18} /> },
      { to: '/family-history', label: 'Family History', icon: <Users size={18} /> },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: <UserCog size={20} />,
    items: [
      { to: '/admin', label: 'Admin Dashboard', icon: <Home size={18} /> },
      { to: '/user-management', label: 'User Management', icon: <UserCog size={18} /> },
      { to: '/order-sets', label: 'Order Sets', icon: <ClipboardList size={18} /> },
      { to: '/note-templates', label: 'Note Templates', icon: <FileText size={18} /> },
      { to: '/barcode', label: 'Barcode Scanner', icon: <FileCheck size={18} /> },
      { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={18} /> },
      { to: '/cds-alerts', label: 'CDS Alerts', icon: <AlertTriangle size={18} /> },
      { to: '/access-logs', label: 'Access Logs', icon: <FileText size={18} /> },
      { to: '/death-certificate', label: 'Death Certificate', icon: <FileText size={18} /> },
      { to: '/autopsy', label: 'Autopsy', icon: <FileText size={18} /> },
    ],
    roles: ['Admin'],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings size={20} />,
    items: [
      { to: '/settings', label: 'Settings', icon: <Settings size={18} /> },
    ],
  },
];

/**
 * Collapsible navigation section component
 */
function NavSectionComponent({ 
  section, 
  isExpanded, 
  onToggle, 
  userRole 
}: { 
  section: NavSection; 
  isExpanded: boolean; 
  onToggle: () => void;
  userRole?: string;
}) {
  // Filter items based on user role
  const visibleItems = section.items.filter((item) => {
    if (!item.roles) return true;
    return userRole && item.roles.includes(userRole);
  });

  if (visibleItems.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors text-sm font-medium"
      >
        <div className="flex items-center gap-2">
          {section.icon}
          <span>{section.label}</span>
        </div>
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {isExpanded && (
        <ul className="ml-4 mt-1 space-y-1">
          {visibleItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm ${
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
      )}
    </div>
  );
}

/**
 * Main layout with collapsible sidebar navigation
 */
function Layout() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['main']));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // Filter sections based on user role
  const visibleSections = NAV_SECTIONS.filter((section) => {
    if (!section.roles) return true;
    return user && section.roles.includes(user.role);
  });

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow-lg flex flex-col overflow-hidden">
        {/* Logo */}
        <div className="p-4 border-b border-gray-200">
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
        <nav className="flex-1 p-3 overflow-y-auto">
          {visibleSections.map((section) => (
            <NavSectionComponent
              key={section.id}
              section={section}
              isExpanded={expandedSections.has(section.id)}
              onToggle={() => toggleSection(section.id)}
              userRole={user?.role}
            />
          ))}
        </nav>

        {/* User info & logout */}
        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-3 px-2">
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
