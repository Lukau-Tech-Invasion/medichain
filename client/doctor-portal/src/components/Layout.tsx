import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store';
import { useSidebarData, useSSE } from '@medichain/shared';
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
  RefreshCw,
} from 'lucide-react';
import CommandPalette from './CommandPalette';
import { useToastActions } from './Toast';
import {
  getNavForRole,
  getThemeForRole,
  getDefaultExpandedSections,
  getQuickActionsForRole,
  type NavSection,
  type NavItem,
  type Role,
} from '../config/navigation';

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

function NavItemComponent({
  item,
  theme,
  isCollapsed,
  badgeCount,
  onMobileClose,
}: NavItemProps) {
  const ItemIcon = item.icon;
  const baseColor = (() => {
    try {
      return theme.bg.replace(/^bg-/, '').replace(/-\d+$/, '');
    } catch {
      return 'gray';
    }
  })();

  const priorityDotClass = `w-2 h-2 rounded-full bg-${baseColor}-500`;
  
  return (
    <li>
      <NavLink
        to={item.to}
        onClick={onMobileClose}
        title={isCollapsed ? item.label : undefined}
        className={({ isActive }) =>
          `flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 text-sm group relative ${
            isActive
              ? `${theme.activeBg} ${theme.activeText} font-medium border-l-4 border-${baseColor}-500 pl-2`
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
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
            ${item.priority === 'high' ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700'}
          `}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
        
        {/* Priority indicator (if no badge) */}
          {(badgeCount === null || badgeCount === 0) && item.priority === 'high' && (
          <span className={`${isCollapsed ? 'absolute top-1 right-1' : 'ml-auto'} ${priorityDotClass}`} />
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
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`
          }
        >
          <SectionIcon size={20} />
          
          {/* Section badge total */}
          {sectionBadgeTotal > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-xs font-medium rounded-full bg-red-500 text-white">
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
          className="w-full flex items-center justify-between px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors text-sm font-medium"
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
  const { user, logout } = useAuthStore();
  
  // Sidebar state
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  
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
  }, [events, showInfo, showWarning, showSuccess, showInfo, refetchBadges]);

  // Get role-specific configuration
  const userRole = (user?.role as Role) || 'Doctor';
  const theme = useMemo(() => getThemeForRole(userRole), [userRole]);
  const navigation = useMemo(() => getNavForRole(userRole), [userRole]);
  const defaultExpanded = useMemo(() => getDefaultExpandedSections(userRole), [userRole]);
  
  const [expandedSections, setExpandedSections] = useState<Set<string>>(defaultExpanded);

  // Fetch real-time sidebar data from API
  const { badges, recentPatients, isLoading: isBadgesLoading, refetch: refetchBadges } = useSidebarData(
    userRole,
    30000 // Refresh every 30 seconds
  );

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

  // Sidebar content (reused for both desktop and mobile)
  const SidebarContent = ({ isMobile = false }: { isMobile?: boolean }) => (
    <>
      {/* Skip link for keyboard users */}
      {!isMobile && (
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-16 focus:left-4 focus:z-50 px-2 py-1 bg-white rounded shadow">
          Skip to main content
        </a>
      )}
      {/* Logo with role-based gradient */}
      <div className={`p-4 bg-gradient-to-r ${theme.bgGradient}`}>
        <div className="flex items-center gap-3">
          <div className={`${isCollapsed && !isMobile ? 'w-8 h-8' : 'w-10 h-10'} bg-white/20 rounded-lg flex items-center justify-center transition-all duration-200`}>
            <Shield className="text-white" size={isCollapsed && !isMobile ? 20 : 24} />
          </div>
          {(!isCollapsed || isMobile) && (
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-lg text-white">MediChain</h1>
              <span className="text-xs text-white/80">{portalTitle}</span>
            </div>
          )}
          {/* Mobile close button */}
          {isMobile && (
            <button
              onClick={closeMobileMenu}
              className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              aria-label="Close menu"
            >
              <X className="text-white" size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Role Badge & Collapse Toggle */}
      <div className={`px-4 py-2 border-b border-gray-100 flex items-center ${isCollapsed && !isMobile ? 'justify-center' : 'justify-between'}`}>
        {(!isCollapsed || isMobile) && (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${theme.bgLight} ${theme.text}`}>
            {user?.role || 'Unknown Role'}
          </span>
        )}
        {/* Desktop collapse toggle */}
        {!isMobile && (
          <button
            onClick={toggleCollapse}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft size={18} className={`transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav role="navigation" aria-label="Sidebar navigation" className="flex-1 p-3 overflow-y-auto scrollbar-hide">
        {navigation.map((section) => (
          <NavSectionComponent
            key={section.id}
            section={section}
            isExpanded={expandedSections.has(section.id)}
            onToggle={() => toggleSection(section.id)}
            theme={theme}
            isCollapsed={isCollapsed && !isMobile}
            getBadgeCount={getBadgeCount}
            onMobileClose={isMobile ? closeMobileMenu : undefined}
          />
        ))}
      </nav>

      {/* Quick Actions */}
      {(!isCollapsed || isMobile) && (
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Quick Actions</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {getQuickActionsForRole(userRole).map(action => (
              <button
                key={action.id}
                onClick={() => { navigate(action.to); if (isMobile) closeMobileMenu(); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-white border hover:bg-gray-50 ${theme.hoverBg}`}
                aria-label={action.label}
              >
                <action.icon size={14} />
                <span className="hidden sm:inline">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* User info & logout */}
      <div className="p-3 border-t border-gray-200">
        {(!isCollapsed || isMobile) ? (
          <>
            <div className="flex items-center gap-3 mb-3 px-2">
              <div className={`w-10 h-10 ${theme.bgLight} rounded-full flex items-center justify-center`}>
                <Activity className={theme.textLight} size={20} />
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
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>
          </>
        ) : (
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center p-3 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors group relative"
            title="Logout"
          >
            <LogOut size={18} />
            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
              Logout
            </div>
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 h-14 bg-white dark:bg-gray-800 shadow-sm flex items-center justify-between px-4 z-40 lg:hidden">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Open menu"
        >
          <Menu size={24} className="text-gray-700 dark:text-gray-200" />
        </button>
        
        <div className="flex items-center gap-2">
          <Shield className={theme.textLight} size={24} />
          <span className="font-bold text-gray-900 dark:text-white">MediChain</span>
        </div>
        
        <button
          onClick={() => navigate('/notifications')}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors relative"
          aria-label="Notifications"
        >
          <Bell size={24} className={isSSEConnected ? 'text-blue-600' : 'text-gray-700'} title={isSSEConnected ? 'Live Connection Active' : 'Connecting to Live Events...'} />
          {totalUnread > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </button>
      </div>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 w-72 bg-white dark:bg-gray-800 shadow-xl z-50 flex flex-col
          transform transition-transform duration-300 ease-in-out lg:hidden
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <SidebarContent isMobile />
      </aside>

      {/* Desktop Sidebar */}
      <aside
        className={`
          hidden lg:flex flex-col bg-white dark:bg-gray-800 shadow-lg overflow-hidden
          transition-all duration-300 ease-in-out
          ${isCollapsed ? 'w-16' : 'w-64'}
        `}
      >
        <SidebarContent />
      </aside>

      {/* Main content */}
      <main id="main-content" role="main" className="flex-1 overflow-auto pt-14 lg:pt-0 bg-gray-100 dark:bg-gray-900">
        <Outlet />
      </main>
      <CommandPalette open={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} />
    </div>
  );
}

export default Layout;
