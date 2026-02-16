/**
 * Role-Based Navigation Configuration
 * 
 * This file defines role-specific navigation structures for the MediChain sidebar.
 * Each role has a tailored navigation that shows only relevant sections and items.
 * 
 * @module config/navigation
 * @version 2.0.0
 */

import {
  Home,
  AlertTriangle,
  Users,
  UserPlus,
  FileText,
  Settings,
  Shield,
  Activity,
  FlaskConical,
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
  Bell,
  Search,
  Clock,
  Beaker,
  Package,
  ListChecks,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

export type Role = 'Admin' | 'Doctor' | 'Nurse' | 'LabTechnician' | 'Pharmacist' | 'Patient';

export interface NavItem {
  id: string;
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: () => number | null;
  priority?: 'high' | 'normal' | 'low';
  description?: string;
}

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  defaultExpanded?: boolean;
  collapsible?: boolean;
}

export interface QuickAction {
  id: string;
  to: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

export interface RoleTheme {
  primary: string;
  bg: string;
  bgLight: string;
  bgGradient: string;
  text: string;
  textLight: string;
  border: string;
  hoverBg: string;
  activeBg: string;
  activeText: string;
}

// =============================================================================
// Role Themes
// =============================================================================

export const ROLE_THEMES: Record<Role, RoleTheme> = {
  Admin: {
    primary: 'purple',
    bg: 'bg-purple-600',
    bgLight: 'bg-purple-50',
    bgGradient: 'from-purple-600 to-purple-700',
    text: 'text-purple-700',
    textLight: 'text-purple-600',
    border: 'border-purple-200',
    hoverBg: 'hover:bg-purple-50',
    activeBg: 'bg-purple-50',
    activeText: 'text-purple-700',
  },
  Doctor: {
    primary: 'blue',
    bg: 'bg-primary-600',
    bgLight: 'bg-primary-50',
    bgGradient: 'from-primary-600 to-primary-700',
    text: 'text-primary-700',
    textLight: 'text-primary-600',
    border: 'border-primary-200',
    hoverBg: 'hover:bg-primary-50',
    activeBg: 'bg-primary-50',
    activeText: 'text-primary-700',
  },
  Nurse: {
    primary: 'green',
    bg: 'bg-green-600',
    bgLight: 'bg-green-50',
    bgGradient: 'from-green-600 to-green-700',
    text: 'text-green-700',
    textLight: 'text-green-600',
    border: 'border-green-200',
    hoverBg: 'hover:bg-green-50',
    activeBg: 'bg-green-50',
    activeText: 'text-green-700',
  },
  LabTechnician: {
    primary: 'amber',
    bg: 'bg-amber-600',
    bgLight: 'bg-amber-50',
    bgGradient: 'from-amber-600 to-amber-700',
    text: 'text-amber-700',
    textLight: 'text-amber-600',
    border: 'border-amber-200',
    hoverBg: 'hover:bg-amber-50',
    activeBg: 'bg-amber-50',
    activeText: 'text-amber-700',
  },
  Pharmacist: {
    primary: 'pink',
    bg: 'bg-pink-600',
    bgLight: 'bg-pink-50',
    bgGradient: 'from-pink-600 to-pink-700',
    text: 'text-pink-700',
    textLight: 'text-pink-600',
    border: 'border-pink-200',
    hoverBg: 'hover:bg-pink-50',
    activeBg: 'bg-pink-50',
    activeText: 'text-pink-700',
  },
  Patient: {
    primary: 'teal',
    bg: 'bg-teal-600',
    bgLight: 'bg-teal-50',
    bgGradient: 'from-teal-600 to-teal-700',
    text: 'text-teal-700',
    textLight: 'text-teal-600',
    border: 'border-teal-200',
    hoverBg: 'hover:bg-teal-50',
    activeBg: 'bg-teal-50',
    activeText: 'text-teal-700',
  },
};

// =============================================================================
// Admin Navigation
// =============================================================================

export const ADMIN_NAV: NavSection[] = [
  {
    id: 'main',
    label: 'Main',
    icon: Home,
    defaultExpanded: true,
    items: [
      { id: 'dashboard', to: '/admin', label: 'Dashboard', icon: Home, priority: 'high' },
      { id: 'users', to: '/user-management', label: 'User Management', icon: UserCog, priority: 'high' },
      { id: 'patients', to: '/patients', label: 'Patient Search', icon: Search },
    ],
  },
  {
    id: 'security',
    label: 'Security & Audit',
    icon: ShieldAlert,
    items: [
      { id: 'access-logs', to: '/access-logs', label: 'Access Logs', icon: FileText, priority: 'high' },
      { id: 'barcode', to: '/barcode', label: 'NFC/Barcode Registry', icon: FileCheck },
      { id: 'cds-alerts', to: '/cds-alerts', label: 'CDS Alerts', icon: Bell },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    icon: Settings,
    items: [
      { id: 'order-sets', to: '/order-sets', label: 'Order Sets', icon: ClipboardList },
      { id: 'templates', to: '/note-templates', label: 'Note Templates', icon: FileText },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    items: [
      { id: 'analytics', to: '/analytics', label: 'System Analytics', icon: BarChart3 },
    ],
  },
  {
    id: 'emergency-oversight',
    label: 'Emergency Oversight',
    icon: Siren,
    items: [
      { id: 'emergency', to: '/emergency', label: 'Emergency Events', icon: AlertTriangle },
      { id: 'mci', to: '/mci', label: 'MCI Dashboard', icon: Users },
    ],
  },
  {
    id: 'administrative',
    label: 'Administrative',
    icon: FileText,
    items: [
      { id: 'death-cert', to: '/death-certificate', label: 'Death Certificates', icon: FileText },
      { id: 'autopsy', to: '/autopsy', label: 'Autopsy Records', icon: FileText },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    collapsible: false,
    items: [
      { id: 'settings', to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// =============================================================================
// Doctor Navigation
// =============================================================================

export const DOCTOR_NAV: NavSection[] = [
  {
    id: 'main',
    label: 'Main',
    icon: Home,
    defaultExpanded: true,
    items: [
      { id: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: Home, priority: 'high' },
      { id: 'my-patients', to: '/patients', label: 'My Patients', icon: Users, priority: 'high' },
      { id: 'register', to: '/register', label: 'Register Patient', icon: UserPlus },
      { id: 'appointments', to: '/appointments', label: 'Appointments', icon: Calendar },
    ],
  },
  {
    id: 'clinical',
    label: 'Clinical Documentation',
    icon: ClipboardList,
    items: [
      { id: 'soap', to: '/soap', label: 'SOAP Notes', icon: FileText, priority: 'high' },
      { id: 'progress', to: '/progress-note', label: 'Progress Notes', icon: FileText },
      { id: 'hp', to: '/history-physical', label: 'H&P', icon: Stethoscope },
      { id: 'discharge', to: '/discharge', label: 'Discharge', icon: FileCheck },
      { id: 'consult', to: '/consult', label: 'Consult', icon: Users },
      { id: 'ama', to: '/ama', label: 'AMA', icon: FileText },
    ],
  },
  {
    id: 'orders',
    label: 'Orders & Prescriptions',
    icon: Pill,
    items: [
      { id: 'orders', to: '/orders', label: 'Physician Orders', icon: ClipboardList, priority: 'high' },
      { id: 'prescribe', to: '/e-prescribe', label: 'E-Prescribe', icon: Pill, priority: 'high' },
      { id: 'interactions', to: '/drug-interactions', label: 'Drug Interactions', icon: AlertTriangle },
    ],
  },
  {
    id: 'emergency',
    label: 'Emergency',
    icon: Siren,
    items: [
      { id: 'emergency-access', to: '/emergency', label: 'Emergency Access', icon: AlertTriangle, priority: 'high' },
      { id: 'code-blue', to: '/code-blue', label: 'Code Blue', icon: Heart },
      { id: 'trauma', to: '/trauma', label: 'Trauma', icon: AlertTriangle },
      { id: 'stroke', to: '/stroke', label: 'Stroke', icon: Brain },
      { id: 'cardiac', to: '/cardiac', label: 'Cardiac', icon: Heart },
      { id: 'sepsis', to: '/sepsis', label: 'Sepsis', icon: Thermometer },
    ],
  },
  {
    id: 'specialty',
    label: 'Specialty',
    icon: Baby,
    items: [
      { id: 'pediatrics', to: '/pediatrics', label: 'Pediatrics', icon: Baby },
      { id: 'obstetrics', to: '/obstetrics', label: 'Obstetrics', icon: Heart },
      { id: 'psych', to: '/psych', label: 'Psychiatry', icon: Brain },
      { id: 'burn', to: '/burn', label: 'Burn', icon: Flame },
      { id: 'toxicology', to: '/toxicology', label: 'Toxicology', icon: FlaskConical },
    ],
  },
  {
    id: 'procedures',
    label: 'Procedures & Surgery',
    icon: Scissors,
    items: [
      { id: 'intubation', to: '/intubation', label: 'Intubation', icon: Activity },
      { id: 'laceration', to: '/laceration-repair', label: 'Laceration Repair', icon: Scissors },
      { id: 'splint', to: '/splint', label: 'Splint/Cast', icon: Scissors },
      { id: 'preop', to: '/pre-op', label: 'Pre-Op', icon: FileText },
      { id: 'operative', to: '/operative-note', label: 'Operative Note', icon: FileText },
      { id: 'postop', to: '/post-op', label: 'Post-Op', icon: FileText },
      { id: 'anesthesia', to: '/anesthesia', label: 'Anesthesia', icon: Activity },
    ],
  },
  {
    id: 'results',
    label: 'Results & Imaging',
    icon: FlaskConical,
    items: [
      { id: 'lab-results', to: '/lab-results', label: 'Lab Results', icon: FlaskConical },
      { id: 'critical', to: '/critical-value', label: 'Critical Values', icon: AlertTriangle, priority: 'high' },
      { id: 'imaging', to: '/imaging', label: 'Imaging', icon: Image },
      { id: 'radiology', to: '/radiology', label: 'Radiology', icon: Image },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    collapsible: false,
    items: [
      { id: 'settings', to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// =============================================================================
// Nurse Navigation
// =============================================================================

export const NURSE_NAV: NavSection[] = [
  {
    id: 'main',
    label: 'Main',
    icon: Home,
    defaultExpanded: true,
    items: [
      { id: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: Home, priority: 'high' },
      { id: 'my-patients', to: '/patients', label: 'My Patients', icon: Users, priority: 'high' },
      { id: 'register', to: '/register', label: 'Register Patient', icon: UserPlus },
      { id: 'handoff', to: '/shift-handoff', label: 'Shift Handoff', icon: Clock, priority: 'high' },
    ],
  },
  {
    id: 'patient-care',
    label: 'Patient Care',
    icon: Stethoscope,
    defaultExpanded: true,
    items: [
      { id: 'vitals', to: '/vitals', label: 'Vital Signs', icon: Activity, priority: 'high' },
      { id: 'mar', to: '/mar', label: 'MAR', icon: Pill, priority: 'high' },
      { id: 'care-plan', to: '/care-plan', label: 'Care Plan', icon: ClipboardList },
      { id: 'io', to: '/intake-output', label: 'I/O Tracking', icon: Droplets },
      { id: 'triage', to: '/triage', label: 'Triage', icon: Thermometer },
    ],
  },
  {
    id: 'wound-iv',
    label: 'Wound & IV Care',
    icon: Droplets,
    items: [
      { id: 'wound', to: '/wound-care', label: 'Wound Care', icon: Flame },
      { id: 'iv', to: '/iv-site', label: 'IV Site', icon: Droplets },
    ],
  },
  {
    id: 'safety',
    label: 'Safety & Risk',
    icon: AlertTriangle,
    items: [
      { id: 'fall-risk', to: '/fall-risk', label: 'Fall Risk', icon: AlertTriangle },
      { id: 'incident', to: '/incident-report', label: 'Incident Report', icon: FileText },
    ],
  },
  {
    id: 'documentation',
    label: 'Documentation',
    icon: FileText,
    items: [
      { id: 'progress', to: '/progress-note', label: 'Progress Notes', icon: FileText },
      { id: 'nursing-hub', to: '/nursing', label: 'Nursing Hub', icon: Stethoscope },
    ],
  },
  {
    id: 'emergency',
    label: 'Emergency',
    icon: Siren,
    items: [
      { id: 'emergency-access', to: '/emergency', label: 'Emergency Access', icon: AlertTriangle, priority: 'high' },
      { id: 'code-blue', to: '/code-blue', label: 'Code Blue', icon: Heart },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    collapsible: false,
    items: [
      { id: 'settings', to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// =============================================================================
// Lab Technician Navigation
// =============================================================================

export const LAB_TECH_NAV: NavSection[] = [
  {
    id: 'main',
    label: 'Main',
    icon: Home,
    defaultExpanded: true,
    items: [
      { id: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: Home, priority: 'high' },
      { id: 'patients', to: '/patients', label: 'Patient Search', icon: Search },
    ],
  },
  {
    id: 'specimen',
    label: 'Specimen Management',
    icon: TestTube,
    defaultExpanded: true,
    items: [
      { id: 'specimen', to: '/specimen', label: 'Specimen Collection', icon: TestTube, priority: 'high' },
      { id: 'chain', to: '/chain-of-custody', label: 'Chain of Custody', icon: FileText },
    ],
  },
  {
    id: 'results',
    label: 'Results & QC',
    icon: FlaskConical,
    items: [
      { id: 'lab-results', to: '/lab-results', label: 'Lab Results', icon: FlaskConical, priority: 'high' },
      { id: 'qc', to: '/lab-qc', label: 'Lab QC', icon: FileCheck },
    ],
  },
  {
    id: 'critical',
    label: 'Critical Values',
    icon: AlertTriangle,
    items: [
      { id: 'critical', to: '/critical-value', label: 'Critical Values', icon: AlertTriangle, priority: 'high' },
    ],
  },
  {
    id: 'blood-bank',
    label: 'Blood Bank',
    icon: Droplets,
    items: [
      { id: 'blood', to: '/blood-bank', label: 'Blood Bank', icon: Droplets },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    collapsible: false,
    items: [
      { id: 'settings', to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// =============================================================================
// Pharmacist Navigation
// =============================================================================

export const PHARMACIST_NAV: NavSection[] = [
  {
    id: 'main',
    label: 'Main',
    icon: Home,
    defaultExpanded: true,
    items: [
      { id: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: Home, priority: 'high' },
      { id: 'patients', to: '/patients', label: 'Patient Search', icon: Search },
    ],
  },
  {
    id: 'prescriptions',
    label: 'Prescription Processing',
    icon: Pill,
    defaultExpanded: true,
    items: [
      { id: 'orders', to: '/orders', label: 'Rx Queue', icon: ClipboardList, priority: 'high' },
      { id: 'e-prescribe', to: '/e-prescribe', label: 'Prescriptions', icon: Pill, priority: 'high' },
      { id: 'med-admin', to: '/medication-admin', label: 'Dispensing Log', icon: ListChecks },
    ],
  },
  {
    id: 'drug-safety',
    label: 'Drug Safety',
    icon: AlertTriangle,
    items: [
      { id: 'interactions', to: '/drug-interactions', label: 'Drug Interactions', icon: AlertTriangle, priority: 'high' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    collapsible: false,
    items: [
      { id: 'settings', to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// =============================================================================
// Quick Actions per Role
// =============================================================================

export const ROLE_QUICK_ACTIONS: Record<Role, QuickAction[]> = {
  Admin: [
    { id: 'add-user', to: '/user-management', label: 'Add User', icon: UserPlus, shortcut: 'U' },
    { id: 'reports', to: '/analytics', label: 'Reports', icon: BarChart3, shortcut: 'R' },
  ],
  Doctor: [
    { id: 'new-soap', to: '/soap', label: 'New SOAP', icon: FileText, shortcut: 'S' },
    { id: 'new-rx', to: '/e-prescribe', label: 'New Rx', icon: Pill, shortcut: 'P' },
  ],
  Nurse: [
    { id: 'vitals', to: '/vitals', label: 'Vitals', icon: Activity, shortcut: 'V' },
    { id: 'give-med', to: '/mar', label: 'Give Med', icon: Pill, shortcut: 'M' },
  ],
  LabTechnician: [
    { id: 'enter-result', to: '/lab-results', label: 'Enter Result', icon: FlaskConical, shortcut: 'R' },
    { id: 'critical', to: '/critical-value', label: 'Critical', icon: AlertTriangle, shortcut: 'C' },
  ],
  Pharmacist: [
    { id: 'verify', to: '/orders', label: 'Verify Rx', icon: FileCheck, shortcut: 'V' },
    { id: 'dispense', to: '/medication-admin', label: 'Dispense', icon: Package, shortcut: 'D' },
  ],
  Patient: [],
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get navigation sections for a specific role
 */
export function getNavForRole(role: Role): NavSection[] {
  switch (role) {
    case 'Admin':
      return ADMIN_NAV;
    case 'Doctor':
      return DOCTOR_NAV;
    case 'Nurse':
      return NURSE_NAV;
    case 'LabTechnician':
      return LAB_TECH_NAV;
    case 'Pharmacist':
      return PHARMACIST_NAV;
    default:
      return DOCTOR_NAV; // Fallback
  }
}

/**
 * Get theme for a specific role
 */
export function getThemeForRole(role: Role): RoleTheme {
  return ROLE_THEMES[role] || ROLE_THEMES.Doctor;
}

/**
 * Get quick actions for a specific role
 */
export function getQuickActionsForRole(role: Role): QuickAction[] {
  return ROLE_QUICK_ACTIONS[role] || [];
}

/**
 * Get all navigation items flattened (for search/command palette)
 */
export function getAllNavItems(role: Role): NavItem[] {
  const sections = getNavForRole(role);
  return sections.flatMap(section => section.items);
}

/**
 * Find nav item by path
 */
export function findNavItemByPath(role: Role, path: string): NavItem | undefined {
  const items = getAllNavItems(role);
  return items.find(item => item.to === path);
}

/**
 * Get default expanded sections for a role
 */
export function getDefaultExpandedSections(role: Role): Set<string> {
  const sections = getNavForRole(role);
  const expanded = sections
    .filter(section => section.defaultExpanded)
    .map(section => section.id);
  return new Set(expanded);
}
