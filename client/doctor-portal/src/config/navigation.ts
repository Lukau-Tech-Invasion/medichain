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
  Activity,
  FlaskConical,
  Stethoscope,
  Video,
  MessageSquare,
  Microscope,
  Syringe,
  Network,
  Heart,
  Pill,
  Scissors,
  TestTube,
  Image,
  UserCog,
  CreditCard,
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
  Package,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
  Laptop,
  Archive,
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
    bgLight: 'bg-surface-sunken',
    bgGradient: 'from-purple-600 to-purple-700',
    text: 'text-content-secondary',
    textLight: 'text-content-secondary',
    border: 'border-purple-200',
    hoverBg: 'hover:bg-surface-sunken',
    activeBg: 'bg-surface-sunken',
    activeText: 'text-content-secondary',
  },
  Doctor: {
    primary: 'blue',
    bg: 'bg-brand',
    bgLight: 'bg-brand-subtle',
    bgGradient: 'from-primary-600 to-primary-700',
    text: 'text-brand',
    textLight: 'text-brand',
    border: 'border-brand',
    hoverBg: 'hover:bg-brand-subtle',
    activeBg: 'bg-brand-subtle',
    // `text-brand-subtle-fg`, not `text-brand`. Every other role here pairs a
    // `-subtle` background with its matching `-subtle-fg`; Doctor was the one
    // that did not, and the brand colour on its own tint measures 4.24:1 in
    // light mode and 4.07:1 in dark -- below AA both ways. The subtle
    // foreground exists for exactly this pairing and measures 8.6:1.
    activeText: 'text-brand-subtle-fg',
  },
  Nurse: {
    primary: 'green',
    bg: 'bg-ok',
    bgLight: 'bg-ok-subtle',
    bgGradient: 'from-green-600 to-green-700',
    text: 'text-ok-subtle-fg',
    textLight: 'text-ok-subtle-fg',
    border: 'border-ok',
    hoverBg: 'hover:bg-ok-subtle',
    activeBg: 'bg-ok-subtle',
    activeText: 'text-ok-subtle-fg',
  },
  LabTechnician: {
    primary: 'amber',
    bg: 'bg-caution',
    bgLight: 'bg-caution-subtle',
    bgGradient: 'from-amber-600 to-amber-700',
    text: 'text-caution-subtle-fg',
    textLight: 'text-caution-subtle-fg',
    border: 'border-caution',
    hoverBg: 'hover:bg-caution-subtle',
    activeBg: 'bg-caution-subtle',
    activeText: 'text-caution-subtle-fg',
  },
  Pharmacist: {
    primary: 'pink',
    bg: 'bg-pink-600',
    bgLight: 'bg-surface-sunken',
    bgGradient: 'from-pink-600 to-pink-700',
    text: 'text-content-secondary',
    textLight: 'text-content-secondary',
    border: 'border-pink-200',
    hoverBg: 'hover:bg-surface-sunken',
    activeBg: 'bg-surface-sunken',
    activeText: 'text-content-secondary',
  },
  Patient: {
    primary: 'teal',
    bg: 'bg-teal-600',
    bgLight: 'bg-surface-sunken',
    bgGradient: 'from-teal-600 to-teal-700',
    text: 'text-content-secondary',
    textLight: 'text-content-secondary',
    border: 'border-teal-200',
    hoverBg: 'hover:bg-surface-sunken',
    activeBg: 'bg-surface-sunken',
    activeText: 'text-content-secondary',
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
      { id: 'national-id-reviews', to: '/national-id-reviews', label: 'National ID Reviews', icon: ShieldCheck, priority: 'high' },
      { id: 'health-id-cards', to: '/health-id-cards', label: 'Health ID Cards', icon: CreditCard, priority: 'high' },
      // Renamed: this route is the barcode SCANNER. Calling it a registry
      // is what hid the absence of an actual card registry for so long.
      { id: 'barcode', to: '/barcode', label: 'Barcode Scanner', icon: FileCheck },
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
      { id: 'devices', to: '/devices', label: 'Approved Devices', icon: Laptop },
      { id: 'retention', to: '/retention', label: 'Data Retention', icon: Archive },
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
      // Issued at registration, by the clinician in front of the patient --
      // which is why this sits beside Register Patient rather than in an
      // administrative section.
      { id: 'health-id-cards', to: '/health-id-cards', label: 'Health ID Cards', icon: CreditCard },
      { id: 'appointments', to: '/appointments', label: 'Appointments', icon: Calendar },
      // The hours the slots on the Appointments screen are generated from.
      // Without them booking falls back to a default grid that is the same for
      // every provider, which is how a 09:00 gets offered with a surgeon whose
      // list starts at 14:00.
      { id: 'working-hours', to: '/working-hours', label: 'Working Hours', icon: Clock },
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
      // Doctors and nurses are who the templates API serves; this lived only
      // in the admin navigation, which the router enforces, so the people who
      // could use templates could not open the page and the one role that
      // could open it was refused by the API.
      { id: 'templates', to: '/note-templates', label: 'Note Templates', icon: FileText },
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
      // A doctor drafts an order set and a pharmacist approves it, and this
      // lived only in the admin navigation -- which the router enforces -- so
      // neither party could open the page whose workflow is theirs.
      { id: 'order-sets', to: '/order-sets', label: 'Order Sets', icon: ClipboardList },
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
      { id: 'protocols', to: '/emergency-protocols', label: 'Emergency Protocols', icon: Siren },
    ],
  },
  {
    // Consults, messages and video are how a clinician reaches another person.
    // All three existed; only the consult had a way in.
    id: 'communication',
    label: 'Communication',
    icon: MessageSquare,
    items: [
      { id: 'messages', to: '/messages', label: 'Messages', icon: MessageSquare },
      { id: 'telehealth', to: '/telehealth', label: 'Telehealth', icon: Video },
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
      // A pedigree over three generations is a specialty assessment, and the
      // page has been built and unreachable.
      { id: 'family-history', to: '/family-history', label: 'Family History', icon: Network },
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
      // Distinct from "Lab Results", which is a read view. This is the queue of
      // results waiting for a clinician's signature — the workflow had a
      // dashboard tile and an API but no screen, so the queue was unreachable.
      { id: 'lab-review', to: '/lab-review', label: 'Lab Review', icon: FileCheck, priority: 'high' },
      { id: 'critical', to: '/critical-value', label: 'Critical Values', icon: AlertTriangle, priority: 'high' },
      { id: 'imaging', to: '/imaging', label: 'Imaging', icon: Image },
      { id: 'radiology', to: '/radiology', label: 'Radiology', icon: Image },
      // Histology sits with the other diagnostics a clinician reads, not with
      // the laboratory's own bench work.
      { id: 'pathology', to: '/pathology', label: 'Pathology', icon: Microscope },
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
      { id: 'health-id-cards', to: '/health-id-cards', label: 'Health ID Cards', icon: CreditCard },
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
      // The multi-patient view of the same care plans. Distinct from
      // `/care-plan`, which writes one.
      { id: 'nursing-care-plans', to: '/nursing-care-plan', label: 'Care Plan Board', icon: ClipboardList },
      // Immunisations are a nursing task at the bedside and in the clinic.
      { id: 'immunization', to: '/immunization', label: 'Immunisations', icon: Syringe },
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
      { id: 'templates', to: '/note-templates', label: 'Note Templates', icon: FileText },
      { id: 'nursing-hub', to: '/nursing', label: 'Nursing Hub', icon: Stethoscope },
      { id: 'messages', to: '/messages', label: 'Messages', icon: MessageSquare },
    ],
  },
  {
    id: 'emergency',
    label: 'Emergency',
    icon: Siren,
    items: [
      { id: 'emergency-access', to: '/emergency', label: 'Emergency Access', icon: AlertTriangle, priority: 'high' },
      { id: 'code-blue', to: '/code-blue', label: 'Code Blue', icon: Heart },
      // The protocol set itself — what to do, in order, when one of these is
      // called. Reachable only by typing the URL until now, which is the worst
      // possible property for a page nobody opens except in an emergency.
      { id: 'protocols', to: '/emergency-protocols', label: 'Emergency Protocols', icon: Siren },
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
    id: 'histology',
    label: 'Histology',
    icon: Microscope,
    items: [
      { id: 'pathology', to: '/pathology', label: 'Pathology', icon: Microscope },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    icon: MessageSquare,
    items: [
      { id: 'messages', to: '/messages', label: 'Messages', icon: MessageSquare },
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
      // The pharmacist is the only role that can approve a drafted order set,
      // and had no way to reach the screen that asks them to.
      { id: 'order-sets', to: '/order-sets', label: 'Order Sets', icon: ClipboardList, priority: 'high' },
    ],
  },
  {
    // A pharmacist queries a prescription by messaging the prescriber. The
    // screen existed; the pharmacist had no way to it.
    id: 'communication',
    label: 'Communication',
    icon: MessageSquare,
    items: [
      { id: 'messages', to: '/messages', label: 'Messages', icon: MessageSquare },
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

// =============================================================================
// Route ownership
// =============================================================================

/** The five staff navigations, paired with the role each belongs to. */
const NAV_BY_ROLE: ReadonlyArray<readonly [Role, NavSection[]]> = [
  ['Admin', ADMIN_NAV],
  ['Doctor', DOCTOR_NAV],
  ['Nurse', NURSE_NAV],
  ['LabTechnician', LAB_TECH_NAV],
  ['Pharmacist', PHARMACIST_NAV],
];

const pathsOf = (sections: NavSection[]): string[] =>
  sections.flatMap(section => section.items.map(item => item.to));

/** Every route that appears in at least one role's navigation. */
const ASSIGNED_ROUTES: ReadonlySet<string> = new Set(
  NAV_BY_ROLE.flatMap(([, sections]) => pathsOf(sections))
);

/**
 * Which roles, if any, this route belongs to instead of `role`.
 *
 * Returns an empty array when the route is `role`'s own, and also when it
 * belongs to nobody — deep routes (`/patients/:id`), the per-role dashboard
 * aliases, and a handful of screens reachable only by link. Those are
 * deliberately not judged here: the question this answers is narrow, and it is
 * "has the product assigned this screen to somebody else?", not "should anyone
 * be able to open it?".
 *
 * # Why this exists
 *
 * The navigation and the authorization disagreed. `ADMIN_NAV` is a curated
 * fourteen routes — user management, access logs, analytics, and the
 * medico-legal ones (emergency, MCI, death certificate, autopsy) — and pointedly
 * not the bedside clinical screens. But nothing stopped an administrator typing
 * `/mar` and getting a working medication administration record, because the
 * router had no notion of who a route was for.
 *
 * That was found by `e2e/roles.spec.ts` signing in as each account. The first
 * reading of it was that the screen would be harmless because the server would
 * refuse the writes. It would not have: `Role::can_edit_medical_records` was
 * `Admin | Doctor | Nurse`, so an administrator's clinical writes succeeded. The
 * two halves of the product had different ideas about what an administrator
 * does, and the permissive half was winning silently.
 *
 * Both halves have since been settled the same way. `Admin` has been removed
 * from `can_edit_medical_records` in `api/src/types/domain.rs`, so the server
 * refuses those writes too, and this guard is what stops the screen offering
 * them in the first place. Neither is redundant: the API is the authority, and
 * this is what keeps a clinician from being shown a control that will fail.
 */
export function rolesOwningRoute(role: Role, path: string): Role[] {
  if (!ASSIGNED_ROUTES.has(path)) return [];
  const own = new Set(pathsOf(getNavForRole(role)));
  if (own.has(path)) return [];
  return NAV_BY_ROLE.filter(([, sections]) => pathsOf(sections).includes(path)).map(([r]) => r);
}
