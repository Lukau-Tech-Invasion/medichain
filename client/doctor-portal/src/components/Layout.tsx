import { OfflineStatusBar } from '../offline/OfflineStatusBar';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store';
import {
  useSidebarData,
  useSSE,
  useTranslation,
  RestrictedSection,
  refreshNotificationBadges,
  NavigationGuard,
  confirmSignOutWithUnsent,
  formatDateOnly,
  formatTimestamp,
} from '@medichain/shared';
import { findDirectoryPatient } from './PatientSelect';
import { clearLocalRuns } from '../ems/runStore';
import {
  LogOut,
  Shield,
  Activity,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  ChevronLeft,
  Bell,
} from 'lucide-react';
import CommandPalette from './CommandPalette';
import { useToastActions } from './Toast';
import {
  getNavForRole,
  getThemeForRole,
  rolesOwningRoute,
  type NavSection,
  type NavItem,
  type Role,
} from '../config/navigation';

/**
 * The plural, lower-case form of each role, for use mid-sentence.
 *
 * `docRoles.*` holds the singular badge label — "Nurse", "Lab Technician" — which
 * is right on a chip and wrong in "This screen is restricted to Nurse".
 */
const ROLE_PLURAL: Record<Role, string> = {
  Admin: 'administrators',
  Doctor: 'doctors',
  Nurse: 'nurses',
  LabTechnician: 'laboratory technicians',
  Pharmacist: 'pharmacists',
  Paramedic: 'paramedics',
  Patient: 'patients',
};

const PARAMEDIC_ALLOWED_ROUTES = new Set(['/dashboard', '/emergency', '/ems-handoff', '/mci', '/settings']);

/** "nurses", or "doctors and nurses" — never "doctors, nurses". */
function formatRoleList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'another role';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// =============================================================================
// Types
// =============================================================================

interface NavSectionProps {
  section: NavSection;
  isExpanded: boolean;
  onToggle: () => void;
  theme: ReturnType<typeof getThemeForRole>;
  isCollapsed: boolean;
  getBadgeCount: (itemId: string) => number | null;
  onMobileClose?: () => void;
}

const RECENT_NAV_KEY = 'medichain.nav.recent';
const RECENT_NAV_LIMIT = 4;

/** Recently opened menu routes; empty when storage is unavailable. */
function readRecentNav(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_NAV_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string').slice(0, RECENT_NAV_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeRecentNav(routes: string[]): void {
  try {
    localStorage.setItem(RECENT_NAV_KEY, JSON.stringify(routes));
  } catch {
    // A private window or blocked storage just means no "Recent" list.
  }
}

interface NavItemProps {
  item: NavItem;
  theme: ReturnType<typeof getThemeForRole>;
  isCollapsed: boolean;
  badgeCount: number | null;
  onMobileClose?: () => void;
}

// =============================================================================
// Badge Mapping
// =============================================================================

/**
 * Maps navigation item IDs to their corresponding badge keys from the API
 */
const BADGE_MAPPINGS: Record<string, string> = {
  // Doctor badges
  'pending-labs': 'pendingLabApprovals',
  'critical-labs': 'criticalValues',
  'code-blue': 'codeBlues',
  'ems-incoming': 'incomingAmbulances',
  
  // Nurse badges
  'vitals': 'vitalsDue',
  'medication-admin': 'medsDue',
  'wound-care': 'woundsToAssess',
  'iv-management': 'ivsToCheck',
  
  // Lab Tech badges
  'test-queue': 'pendingTests',
  'critical-values': 'criticalLabValues',
  'specimen-rejection': 'rejectionsToday',
  
  // Pharmacist badges
  'pending-rx': 'pendingRx',
  'drug-interactions': 'drugInteractions',
  'allergy-alerts': 'allergyAlerts',
  
  // Universal badges
  'notifications': 'unreadNotifications',
  'messages': 'unreadMessages',
};

// =============================================================================
// Navigation Item Component
// =============================================================================

/** Priority dot and active-item border for each role theme's background. */
const NAV_ACCENT: Record<string, { dot: string; border: string }> = {
  'bg-brand': { dot: 'bg-brand', border: 'border-brand' },
  'bg-caution': { dot: 'bg-caution', border: 'border-caution' },
  'bg-ok': { dot: 'bg-ok', border: 'border-ok' },
  'bg-pink-700': { dot: 'bg-pink-500', border: 'border-pink-500' },
  'bg-purple-700': { dot: 'bg-purple-500', border: 'border-purple-500' },
  'bg-teal-700': { dot: 'bg-teal-500', border: 'border-teal-500' },
  default: { dot: 'bg-content-muted', border: 'border-border-strong' },
};

function NavItemComponent({
  item,
  theme,
  isCollapsed,
  badgeCount,
  onMobileClose,
}: NavItemProps) {
  const ItemIcon = item.icon;
  // Written out in full: a class name assembled from a colour at runtime is
  // invisible to Tailwind's compiler and shipped as no colour at all.
  const accent = NAV_ACCENT[theme.bg] ?? NAV_ACCENT.default;
  
  return (
    <li>
      <NavLink
        to={item.to}
        onClick={onMobileClose}
        title={isCollapsed ? item.label : undefined}
        className={({ isActive }) =>
          `flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 text-sm group relative ${
            isActive
              ? `${theme.activeBg} ${theme.activeText} font-medium border-l-4 ${accent.border} pl-2`
              : 'text-content-muted hover:bg-surface-sunken hover:text-content'
          } ${isCollapsed ? 'justify-center' : ''}`
        }
      >
        <ItemIcon size={18} className="flex-shrink-0" />
        
        {/* Label - hidden when collapsed */}
        {!isCollapsed && (
          <span className="truncate">{item.label}</span>
        )}
        
        {/* Badge count */}
        {badgeCount !== null && badgeCount > 0 && (
          <span className={`
            ${isCollapsed ? 'absolute -top-1 -right-1' : 'ml-auto'}
            min-w-[20px] h-5 px-1.5 flex items-center justify-center
            text-xs font-medium rounded-full
            ${item.priority === 'high' ? 'bg-red-700 text-white' : 'bg-surface-sunken text-content-secondary'}
          `}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
        
        {/* Tooltip for collapsed mode */}
        {isCollapsed && (
          <div className="
            absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded
            opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50
            transition-opacity duration-200
          ">
            {item.label}
            {badgeCount !== null && badgeCount > 0 && ` (${badgeCount})`}
          </div>
        )}
      </NavLink>
    </li>
  );
}

// =============================================================================
// Navigation Section Component
// =============================================================================

function NavSectionComponent({ 
  section, 
  isExpanded, 
  onToggle,
  theme,
  isCollapsed,
  getBadgeCount,
  onMobileClose,
}: NavSectionProps) {
  const SectionIcon = section.icon;
  const isCollapsible = section.collapsible !== false;

  // Calculate total badges for section (when collapsed)
  const sectionBadgeTotal = useMemo(() => {
    if (!isCollapsed) return 0;
    return section.items.reduce((total, item) => {
      const count = getBadgeCount(item.id);
      return total + (count || 0);
    }, 0);
  }, [isCollapsed, section.items, getBadgeCount]);

  // In collapsed mode, show only section icons as nav items
  if (isCollapsed) {
    return (
      <div className="mb-2">
        <NavLink
          to={section.items[0]?.to || '/'}
          onClick={onMobileClose}
          title={section.label}
          className={({ isActive }) =>
            `flex items-center justify-center p-3 rounded-lg transition-all duration-200 group relative ${
              isActive
                ? `${theme.activeBg} ${theme.activeText}`
                : 'text-content-muted hover:bg-surface-sunken hover:text-content'
            }`
          }
        >
          <SectionIcon size={20} />
          
          {/* Section badge total */}
          {sectionBadgeTotal > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-xs font-medium rounded-full bg-red-700 text-white">
              {sectionBadgeTotal > 99 ? '99+' : sectionBadgeTotal}
            </span>
          )}
          
          {/* Tooltip */}
          <div className="
            absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded
            opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50
            transition-opacity duration-200
          ">
            {section.label}
          </div>
        </NavLink>
      </div>
    );
  }

  return (
    <div className="mb-1">
      {isCollapsible ? (
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-3 py-2 text-content-muted hover:bg-surface-sunken rounded-lg transition-colors text-sm font-medium"
          aria-expanded={isExpanded}
        >
          <div className="flex items-center gap-2">
            <SectionIcon size={20} />
            <span>{section.label}</span>
          </div>
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      ) : null}
      
      {(isExpanded || !isCollapsible) && (
        <ul className={`${isCollapsible ? 'ml-4 mt-1' : ''} space-y-1`}>
          {section.items.map((item) => (
            <NavItemComponent
              key={item.id}
              item={item}
              theme={theme}
              isCollapsed={false}
              badgeCount={getBadgeCount(item.id)}
              onMobileClose={onMobileClose}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// =============================================================================
// Main Layout Component
// =============================================================================

/**
 * Main layout with responsive role-based collapsible sidebar navigation
 * 
 * Week 2 Features:
 * - Collapsible sidebar (w-64 → w-16 mini mode)
 * - Mobile hamburger menu with overlay
 * - Real-time badge counts from API
 * - Smooth transitions and animations
 */
function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  
  // A patient's chart or one of its forms: the workspace brings its own navigation.
  const patientOpen = /^\/patients\/[^/]+/.test(location.pathname);

  // Sidebar state
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  
  // Real-time events
  const { events, isConnected: isSSEConnected } = useSSE();
  const { showInfo, showWarning, showSuccess } = useToastActions();
  const lastProcessedEventRef = useRef<number>(0);

  // Rendering still needs a stable navigation shape while auth initializes,
  // but data polling must not invent a clinician role. The old shared Doctor
  // fallback was passed straight to the poller and produced 401s on login.
  const userRole = (user?.role as Role | undefined) ?? 'Doctor';
  const sidebarRole = user ? userRole : null;

  // Fetch real-time sidebar data from API.
  //
  // This hook also returns `recentPatients` and `isLoading`. They are not
  // destructured because nothing here renders them, and the register's note
  // that they are "the exact two props of <RecentPatientsList/>" was wrong on
  // both counts: that component takes `{patientId, fullName, healthId,
  // lastAccessed}` against this hook's `{id, name, healthId, lastSeen}`, so
  // wiring it up as described would have rendered a column of blanks — and the
  // panel it draws (p-8, 48px icons) is dashboard furniture, not a sidebar
  // strip.
  //
  // `DashboardPage` already renders a "Recent Patients" panel inline from the
  // same dashboard response, so the list is not missing from the product; the
  // component is a superseded duplicate of it. Left in place rather than
  // removed, per the project rule on deleting code.
  //
  // `recentPatients` costs no extra request either way: it is derived from the
  // dashboard payload the badges already need.
  const { badges, refetch: refetchBadges } = useSidebarData(
    sidebarRole,
    30000 // Refresh every 30 seconds
  );

  /** "Thandiwe Ndlovu, born 12 Mar 1992" -- or "a patient" when the directory cannot say. */
  const patientLabel = useCallback(async (patientId: string | null | undefined): Promise<string> => {
    const p = patientId ? await findDirectoryPatient(patientId).catch(() => null) : null;
    if (!p?.full_name) return t('liveEvents.aPatient');
    return p.date_of_birth ? t('liveEvents.patientBorn', { name: p.full_name, dob: formatDateOnly(p.date_of_birth) }) : p.full_name;
  }, [t]);

  // Handle incoming real-time events
  useEffect(() => {
    if (events.length > 0) {
      const latestEvent = events[0];
      if (latestEvent.timestamp > lastProcessedEventRef.current) {
        lastProcessedEventRef.current = latestEvent.timestamp;
        refreshNotificationBadges();
        
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
          case 'cds_alert': {
            const { title, severity } = latestEvent.payload;
            // The patient by name and date of birth, never by record id. An
            // absent severity used to read "undefined severity"; it is left out.
            void patientLabel(latestEvent.patient_id).then((who) => showWarning(
              severity ? t('liveEvents.cdsAlertSeverity', { who, severity }) : t('liveEvents.cdsAlert', { who }),
              title || t('liveEvents.cdsAlertTitle'),
            ));
            break;
          }
          case 'lab_result':
            void patientLabel(latestEvent.patient_id).then((who) => showSuccess(
              t('liveEvents.labResult', { who }), t('liveEvents.labResultTitle'),
            ));
            break;
          case 'ems_incoming': {
            // An ambulance is heading here or has arrived: the board reloads
            // now rather than at its next poll, and staff elsewhere are told.
            window.dispatchEvent(new Event('medichain:ems-incoming'));
            const status = latestEvent.payload.status as string | undefined;
            const eta = latestEvent.payload.eta as string | null | undefined;
            if (status === 'arrived') showWarning(t('liveEvents.ambulanceArrived'), t('liveEvents.ambulanceTitle'));
            else if (status === 'en_route') {
              showInfo(eta ? t('liveEvents.ambulanceEta', { time: formatTimestamp(eta, { timeStyle: 'short' }) }) : t('liveEvents.ambulanceComing'),
                t('liveEvents.ambulanceTitle'));
            }
            break;
          }
          case 'reminder_due':
            showInfo(
              latestEvent.payload.message || 'Medication reminder due',
              'Medication Reminder'
            );
            break;
          default:
            showInfo(
              latestEvent.payload.message || 'New system update',
              'Notification'
            );
        }
        
        // Refresh sidebar badges when events arrive as they might affect counts
        refetchBadges();
      }
    }
  }, [events, showInfo, showWarning, showSuccess, refetchBadges, t, patientLabel]);

  // Get role-specific configuration
  const theme = useMemo(() => getThemeForRole(userRole), [userRole]);
  const navigation = useMemo(() => getNavForRole(userRole), [userRole]);

  /**
   * Does the route on screen belong to a different role?
   *
   * The navigation and the router disagreed: `ADMIN_NAV` deliberately omits the
   * bedside clinical screens, and an administrator could still type `/mar` and
   * get a working medication administration record. Nothing refused it — not the
   * router, and not the API, whose `can_edit_medical_records` then included
   * `Admin`. It no longer does; this guard is the half that keeps the control
   * from being offered at all.
   *
   * The shell stays rendered, so a reader can see where they are and navigate
   * away, rather than being bounced somewhere they did not ask for. A redirect
   * would also hide the fact that the link they followed was for somebody else.
   */
  const routeOwners = useMemo(
    () => rolesOwningRoute(userRole, location.pathname),
    [userRole, location.pathname]
  );
  const paramedicRestricted = userRole === 'Paramedic'
    && !PARAMEDIC_ALLOWED_ROUTES.has(location.pathname);
  // Under "More", every section starts folded: the screens used most are
  // already above it, and an open section would only repeat them.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());

  // The role's high-priority destinations, once each, at the top.
  const pinned = useMemo(() => {
    const seen = new Set<string>();
    return navigation.flatMap((s) => s.items).filter((i) => i.priority === 'high' && !seen.has(i.to) && seen.add(i.to));
  }, [navigation]);

  // The last few screens this person opened from the menu. Route ids only --
  // nothing about a patient -- in local storage, so it survives a reload.
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentNav());
  useEffect(() => {
    const hit = navigation.flatMap((s) => s.items).find((i) => i.to === location.pathname);
    if (!hit || pinned.some((p) => p.to === hit.to)) return;
    setRecentIds((prev) => {
      const next = [hit.to, ...prev.filter((to) => to !== hit.to)].slice(0, RECENT_NAV_LIMIT);
      writeRecentNav(next);
      return next;
    });
  }, [location.pathname, navigation, pinned]);
  const recent = useMemo(() => {
    const items = navigation.flatMap((s) => s.items);
    return recentIds.map((to) => items.find((i) => i.to === to)).filter((i): i is NavItem => Boolean(i));
  }, [recentIds, navigation]);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [location.pathname]);

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  // Open command palette with Ctrl/Cmd+K
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Get badge count for a specific nav item
  const getBadgeCount = useCallback((itemId: string): number | null => {
    const badgeKey = BADGE_MAPPINGS[itemId];
    if (!badgeKey) return null;
    const count = badges[badgeKey as keyof typeof badges];
    return typeof count === 'number' ? count : null;
  }, [badges]);

  

  const handleLogout = async () => {
    const proceed = await confirmSignOutWithUnsent({
      title: t('forms.unsentTitle'),
      message: (n) => t('forms.unsentMessage', { n: String(n) }),
      confirm: t('forms.unsentConfirm'),
      cancel: t('forms.unsentCancel'),
    });
    if (!proceed) return;
    clearLocalRuns();
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

  const toggleCollapse = () => {
    setIsCollapsed(prev => !prev);
  };

  const closeMobileMenu = () => {
    setIsMobileOpen(false);
  };

  // Get portal title based on role
  const portalTitle = useMemo(() => {
    switch (userRole) {
      case 'Admin': return 'Admin Portal';
      case 'Doctor': return 'Doctor Portal';
      case 'Nurse': return 'Nurse Portal';
      case 'LabTechnician': return 'Lab Portal';
      case 'Pharmacist': return 'Pharmacy Portal';
      default: return 'Healthcare Portal';
    }
  }, [userRole]);

  // Calculate total unread count for mobile header badge
  const totalUnread = badges.unreadNotifications + badges.unreadMessages;

  /**
   * Sidebar markup, shared by the desktop rail and the mobile drawer.
   *
   * A plain function that is *called*, not a component that is *rendered*.
   * Declaring a component inside another component creates a new component
   * type on every render, so React unmounts and remounts the whole subtree
   * each time. `Layout` re-renders on every SSE event, toast, badge update and
   * connectivity change, so the sidebar was being torn down and rebuilt
   * constantly - restarting its `transition-transform` / `animate-slide-in`
   * animations mid-flight, which is what made the drawer appear to ghost or
   * duplicate while resizing, and threw away focus inside it.
   *
   * Calling it inlines the JSX into Layout's own element tree, so React
   * reconciles the existing DOM instead of replacing it.
   */
  const renderSidebar = (isMobile = false) => (
    <>
      {/* Logo, product and the collapse toggle in one quiet row. */}
      <div className="border-b border-border p-3">
        <div className={`flex items-center gap-3 ${isCollapsed && !isMobile ? 'flex-col' : ''}`}>
          <div className={`h-9 w-9 shrink-0 rounded-lg bg-gradient-to-r ${theme.bgGradient} flex items-center justify-center`}>
            <Shield className="text-white" size={20} />
          </div>
          {(!isCollapsed || isMobile) && (
            <div className="flex-1 min-w-0">
              {/*
                Not an <h1>. The product name in the sidebar chrome is not the
                heading of the page, and `renderSidebar` runs twice (desktop
                rail + mobile drawer), so this rendered TWO `<h1>MediChain</h1>`
                on every screen — three in total with the page's own heading.

                A screen-reader user navigating by heading gets the document
                outline from these, and an outline whose top level is the brand
                name repeated twice tells them nothing about where they are
                (WCAG 2.2 SC 1.3.1). The page heading is now the only h1.
              */}
              <span className="block font-bold text-content">MediChain</span>
              <span className="text-xs text-content-muted">{portalTitle}</span>
            </div>
          )}
          {/* Mobile close button */}
          {isMobile && (
            <button
              onClick={closeMobileMenu}
              className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface-sunken transition-colors"
              aria-label="Close menu"
            >
              <X className="text-content-secondary" size={20} />
            </button>
          )}
          {!isMobile && (
            <button
              onClick={toggleCollapse}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-surface-sunken hover:text-content-secondary"
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <ChevronLeft size={18} className={`transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Navigation: what this role uses most, what this person used last,
          and everything else folded away -- not 50 links at once. */}
      <nav role="navigation" aria-label="Sidebar navigation" className="flex-1 p-3 overflow-y-auto scrollbar-hide">
        {(isCollapsed && !isMobile) ? navigation.map((section) => (
          <NavSectionComponent
            key={section.id}
            section={section}
            isExpanded={false}
            onToggle={() => toggleSection(section.id)}
            theme={theme}
            isCollapsed
            getBadgeCount={getBadgeCount}
          />
        )) : (
          <>
            <ul className="space-y-1">
              {pinned.map((item) => (
                <NavItemComponent key={item.id} item={item} theme={theme} isCollapsed={false}
                  badgeCount={getBadgeCount(item.id)} onMobileClose={isMobile ? closeMobileMenu : undefined} />
              ))}
            </ul>
            {recent.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-content-muted">Recent</p>
                <ul className="space-y-1">
                  {recent.map((item) => (
                    <NavItemComponent key={item.id} item={item} theme={theme} isCollapsed={false}
                      badgeCount={getBadgeCount(item.id)} onMobileClose={isMobile ? closeMobileMenu : undefined} />
                  ))}
                </ul>
              </>
            )}
            <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-content-muted">More</p>
            {navigation.map((section) => (
              <NavSectionComponent
                key={section.id}
                section={section}
                isExpanded={expandedSections.has(section.id)}
                onToggle={() => toggleSection(section.id)}
                theme={theme}
                isCollapsed={false}
                getBadgeCount={getBadgeCount}
                onMobileClose={isMobile ? closeMobileMenu : undefined}
              />
            ))}
          </>
        )}
      </nav>

      {/* User info & logout */}
      <div className="shrink-0 p-2 border-t border-border">
        {(!isCollapsed || isMobile) ? (
          <>
            <div className="flex items-center gap-2 mb-1 px-2">
              <div className={`w-8 h-8 ${theme.bgLight} rounded-full flex items-center justify-center`}>
                <Activity className={theme.textLight} size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-content truncate">
                  {user?.username || 'User'}
                </p>
                <p className="text-xs text-content-muted">{user?.role}</p>
              </div>
            </div>
            {/* Notifications, reachable at every width.
                The bell lived only in the mobile header (`lg:hidden`), so on a
                full-screen portal -- which is how every clinician runs this --
                there was no control for notifications anywhere on the page.
                The badge counted them and nothing could open them. */}
            <div className="flex items-center gap-1">
            <button
              onClick={() => navigate('/notifications')}
              className="flex-1 min-h-[44px] flex items-center justify-between gap-1 px-2 py-2 text-sm text-content-muted hover:text-content hover:bg-surface-sunken rounded-lg transition-colors"
              // The tooltip names what the control does. It used to report the
              // SSE connection state, so hovering "Notifications" said "Live
              // Connection Active" -- which describes the bell's colour, not
              // the button, and is the only thing a screen reader would read.
              // The live state stays on the icon, where it belongs.
              title={
                totalUnread > 0
                  ? `Notifications (${totalUnread} unread)`
                  : 'Notifications'
              }
            >
              <span className="flex items-center gap-2">
                <Bell
                  size={18}
                  className={isSSEConnected ? 'text-notice-subtle-fg' : ''}
                  aria-label={isSSEConnected ? 'Live updates connected' : 'Connecting to live updates'}
                />
                <span>Notifications</span>
              </span>
              {totalUnread > 0 && (
                <span className="min-w-[20px] h-5 px-1 bg-critical text-critical-fg text-xs font-semibold rounded-full flex items-center justify-center">
                  {totalUnread > 9 ? '9+' : totalUnread}
                </span>
              )}
            </button>
            <button
              onClick={handleLogout}
              className="min-h-[44px] flex items-center justify-center gap-1 px-2 py-2 text-sm text-content-muted hover:text-critical-subtle-fg hover:bg-critical-subtle rounded-lg transition-colors"
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>
            </div>
          </>
        ) : (
          <>
          <button
            onClick={() => navigate('/notifications')}
            className="w-full flex items-center justify-center p-3 text-content-muted hover:text-content hover:bg-surface-sunken rounded-lg transition-colors group relative"
            title="Notifications"
          >
            <Bell size={18} className={isSSEConnected ? 'text-notice-subtle-fg' : ''} />
            {totalUnread > 0 && (
              <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-critical text-critical-fg text-[10px] font-semibold rounded-full flex items-center justify-center">
                {totalUnread > 9 ? '9+' : totalUnread}
              </span>
            )}
            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
              Notifications
            </div>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center p-3 text-content-muted hover:text-critical-subtle-fg hover:bg-critical-subtle rounded-lg transition-colors group relative"
            title="Logout"
          >
            <LogOut size={18} />
            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
              Logout
            </div>
          </button>
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-surface-sunken">
      <NavigationGuard />
      {/*
        The skip link is the FIRST focusable element in the document, and that
        placement is the whole feature. It previously lived inside the sidebar,
        which put the header controls, the collapse toggle and the navigation
        section headers ahead of it -- so a keyboard user had to tab through the
        navigation to reach the link offering to skip the navigation.

        `min-h`/`min-w` because it is a real target once focused: WCAG 2.2
        SC 2.5.8 asks for 24x24 CSS px, and `px-2 py-1` around a 14px line box
        does not reach it.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 inline-flex items-center min-h-[24px] min-w-[24px] px-3 py-1.5 bg-surface text-content border border-border-interactive rounded shadow"
      >
        Skip to main content
      </a>
      {/* With a patient open, the patient workspace is the whole screen (mockup
          c4): its banner and form list are the only navigation, and "Close
          patient" is the way back. Two side menus at once read as two apps. */}
      {!patientOpen && <>
      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 h-14 bg-surface shadow-sm flex items-center justify-between px-4 z-40 lg:hidden">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="p-2 rounded-lg hover:bg-surface-sunken transition-colors"
          aria-label="Open menu"
        >
          <Menu size={24} className="text-content-secondary" />
        </button>
        
        <div className="flex items-center gap-2">
          <Shield className={theme.textLight} size={24} />
          <span className="font-bold text-content">MediChain</span>
        </div>
        
        <button
          onClick={() => navigate('/notifications')}
          className="p-2 rounded-lg hover:bg-surface-sunken transition-colors relative"
          aria-label="Notifications"
          title={isSSEConnected ? 'Live Connection Active' : 'Connecting to Live Events...'}
        >
          <Bell size={24} className={isSSEConnected ? 'text-notice-subtle-fg' : 'text-content-secondary'} />
          {totalUnread > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-critical text-critical-fg text-xs rounded-full flex items-center justify-center">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </button>
      </div>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          // ux-allow(overlay): the backdrop behind the mobile navigation drawer; a click on it closes the drawer.
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 w-72 bg-surface shadow-xl z-50 flex flex-col
          transform transition-transform duration-300 ease-in-out lg:hidden
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {renderSidebar(true)}
      </aside>

      {/* Desktop Sidebar */}
      <aside
        className={`
          hidden lg:flex flex-col bg-surface shadow-lg overflow-hidden
          transition-all duration-300 ease-in-out
          ${isCollapsed ? 'w-16' : 'w-64'}
        `}
      >
        {renderSidebar()}
      </aside>
      </>}

      {/* Main content */}
      <main id="main-content" role="main" className={`relative flex-1 bg-surface-sunken ${patientOpen ? 'flex min-h-0 flex-col overflow-hidden' : 'overflow-auto pt-14 lg:pt-0'}`}>
        <OfflineStatusBar />
        {paramedicRestricted ? (
          <RestrictedSection
            title="This screen"
            audience="clinical chart staff"
            currentRole={t('docRoles.Paramedic')}
            guidance="Use the emergency, handover, or mass casualty workspace."
          />
        ) : routeOwners.length > 0 ? (
          <RestrictedSection
            title="This screen"
            audience={formatRoleList(routeOwners.map((r) => ROLE_PLURAL[r]))}
            currentRole={t(`docRoles.${userRole}`)}
            guidance={
              userRole === 'Admin'
                ? 'It is not part of the administrator workspace.'
                : 'Ask an administrator if you need access.'
            }
          />
        ) : (
          <Outlet />
        )}
      </main>
      <CommandPalette open={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} />
    </div>
  );
}

export default Layout;
