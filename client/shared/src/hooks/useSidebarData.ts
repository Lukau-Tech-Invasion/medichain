/**
 * Sidebar Data Hooks
 * 
 * Hooks for fetching real-time data from the API for sidebar badges,
 * recent patients, and notifications.
 * 
 * @module hooks/useSidebarData
 * @version 1.0.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiClient } from '../api/client';
import type {
  Role,
  DoctorDashboardResponse,
  NurseDashboardResponse,
  LabDashboardResponse,
  AdminDashboardResponse,
  PharmacistDashboardResponse,
  PatientProfile,
  MessagesResponse,
  NotificationsResponse,
} from '../types';

// =============================================================================
// Types
// =============================================================================

export interface SidebarBadges {
  // Doctor badges
  pendingLabApprovals: number;
  criticalValues: number;
  codeBlues: number;
  
  // Nurse badges
  vitalsDue: number;
  medsDue: number;
  woundsToAssess: number;
  ivsToCheck: number;
  
  // Lab Tech badges
  pendingTests: number;
  criticalLabValues: number;
  rejectionsToday: number;
  
  // Pharmacist badges
  pendingRx: number;
  drugInteractions: number;
  allergyAlerts: number;
  
  // Admin badges
  totalUsers: number;
  totalPatients: number;
  pendingLabsAdmin: number;
  
  // Universal badges
  unreadMessages: number;
  unreadNotifications: number;
}

export interface RecentPatient {
  id: string;
  name: string;
  healthId?: string;
  lastSeen?: string;
}

export interface SidebarDataState {
  badges: SidebarBadges;
  recentPatients: RecentPatient[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

const DEFAULT_BADGES: SidebarBadges = {
  pendingLabApprovals: 0,
  criticalValues: 0,
  codeBlues: 0,
  vitalsDue: 0,
  medsDue: 0,
  woundsToAssess: 0,
  ivsToCheck: 0,
  pendingTests: 0,
  criticalLabValues: 0,
  rejectionsToday: 0,
  pendingRx: 0,
  drugInteractions: 0,
  allergyAlerts: 0,
  totalUsers: 0,
  totalPatients: 0,
  pendingLabsAdmin: 0,
  unreadMessages: 0,
  unreadNotifications: 0,
};

// =============================================================================
// API Fetchers
// =============================================================================

async function fetchDoctorDashboard(): Promise<DoctorDashboardResponse | null> {
  try {
    const response = await getApiClient().get<DoctorDashboardResponse>('/api/dashboard/doctor');
    return response;
  } catch {
    return null;
  }
}

async function fetchNurseDashboard(): Promise<NurseDashboardResponse | null> {
  try {
    const response = await getApiClient().get<NurseDashboardResponse>('/api/dashboard/nurse');
    return response;
  } catch {
    return null;
  }
}

async function fetchLabDashboard(): Promise<LabDashboardResponse | null> {
  try {
    const response = await getApiClient().get<LabDashboardResponse>('/api/dashboard/lab');
    return response;
  } catch {
    return null;
  }
}

async function fetchAdminDashboard(): Promise<AdminDashboardResponse | null> {
  try {
    const response = await getApiClient().get<AdminDashboardResponse>('/api/dashboard/admin');
    return response;
  } catch {
    return null;
  }
}

async function fetchPharmacistDashboard(): Promise<PharmacistDashboardResponse | null> {
  try {
    const response = await getApiClient().get<PharmacistDashboardResponse>('/api/dashboard/pharmacist');
    return response;
  } catch {
    return null;
  }
}

async function fetchMessages(): Promise<MessagesResponse | null> {
  try {
    const response = await getApiClient().get<MessagesResponse>('/api/messages');
    return response;
  } catch {
    return null;
  }
}

async function fetchNotifications(): Promise<NotificationsResponse | null> {
  try {
    const response = await getApiClient().get<NotificationsResponse>('/api/notifications');
    return response;
  } catch {
    return null;
  }
}

// =============================================================================
// Main Hook
// =============================================================================

/**
 * Hook to fetch and manage sidebar data based on user role
 * 
 * @param role - The current user's role
 * @param refreshInterval - How often to refresh data in milliseconds (default 30s)
 */
export function useSidebarData(
  role: Role | null,
  refreshInterval: number = 30000
): SidebarDataState & { refetch: () => Promise<void> } {
  const [state, setState] = useState<SidebarDataState>({
    badges: DEFAULT_BADGES,
    recentPatients: [],
    isLoading: true,
    error: null,
    lastUpdated: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!role) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      const updatedBadges: Partial<SidebarBadges> = {};
      let recentPatients: RecentPatient[] = [];

      // Fetch messages and notifications for all roles
      const [messagesData, notificationsData] = await Promise.all([
        fetchMessages(),
        fetchNotifications(),
      ]);

      if (messagesData) {
        updatedBadges.unreadMessages = messagesData.unread_count;
      }
      if (notificationsData) {
        updatedBadges.unreadNotifications = notificationsData.unread_count;
      }

      // Fetch role-specific dashboard data
      switch (role) {
        case 'Doctor': {
          const data = await fetchDoctorDashboard();
          if (data) {
            updatedBadges.pendingLabApprovals = data.alerts.pending_labs_count;
            updatedBadges.criticalValues = data.alerts.critical_values_count;
            updatedBadges.codeBlues = data.alerts.code_blues_count;
            
            // Extract recent patients
            recentPatients = (data.patients.list || []).slice(0, 5).map((p: PatientProfile) => ({
              id: p.patient_id,
              name: p.full_name,
              healthId: undefined,
              lastSeen: p.created_at,
            }));
          }
          break;
        }
        case 'Nurse': {
          const data = await fetchNurseDashboard();
          if (data) {
            updatedBadges.vitalsDue = data.tasks.vitals_due;
            updatedBadges.ivsToCheck = data.tasks.ivs_to_check;
            // `tasks.meds_due` and `tasks.wounds_to_assess` were read here and
            // were not in the payload — the badges showed `undefined`. Meds due
            // is derivable from the list the same response carries, and the
            // wound count is now computed by the dashboard from the wound
            // assessments rather than left at a zero nobody calculated.
            updatedBadges.medsDue = (data.medication_records || []).length;
            updatedBadges.woundsToAssess = data.tasks.wounds_to_assess ?? 0;

            // Extract recent patients
            recentPatients = (data.patients.list || []).slice(0, 5).map((p) => ({
              id: p.patient_id,
              name: p.full_name,
              healthId: p.health_id,
              lastSeen: p.date_of_birth,
            }));
          }
          break;
        }
        case 'LabTechnician': {
          const data = await fetchLabDashboard();
          if (data) {
            // `/api/dashboard/lab` returns no `alerts` block. Reading
            // `data.alerts.pending_tests` threw a TypeError into the outer
            // catch, which set an error state nothing renders — so a lab
            // technician's badges sat at zero, silently, re-failing every 30s.
            updatedBadges.pendingTests = data.test_queue?.pending_count ?? 0;
            updatedBadges.criticalLabValues = (data.critical_notifications || []).length;
            updatedBadges.rejectionsToday = (data.rejections || []).length;
          }
          break;
        }
        case 'Pharmacist': {
          const data = await fetchPharmacistDashboard();
          if (data) {
            // Same as the lab case: `/api/dashboard/pharmacist` returns no
            // `alerts` block, so reading it threw and the pharmacist's badges
            // never left zero. The counts the block was meant to carry are all
            // derivable from what the response does contain.
            updatedBadges.pendingRx = data.prescriptions?.pending_fill ?? 0;
            updatedBadges.drugInteractions = (data.drug_interactions || []).length;
            updatedBadges.allergyAlerts = (data.allergy_alerts || []).length;
          }
          break;
        }
        case 'Admin': {
          const data = await fetchAdminDashboard();
          if (data) {
            updatedBadges.totalUsers = data.system_stats.total_users;
            updatedBadges.totalPatients = data.system_stats.total_patients;
            updatedBadges.pendingLabsAdmin = data.lab_submissions.pending;
          }
          break;
        }
        case 'Patient':
          // Patient role doesn't have sidebar badges typically
          break;
      }

      if (isMountedRef.current) {
        setState(prev => ({
          badges: { ...prev.badges, ...updatedBadges },
          recentPatients,
          isLoading: false,
          error: null,
          lastUpdated: new Date(),
        }));
      }
    } catch (err) {
      if (isMountedRef.current) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to fetch sidebar data',
        }));
      }
    }
  }, [role]);

  // Initial fetch and interval setup
  useEffect(() => {
    isMountedRef.current = true;
    fetchData();
    window.addEventListener('medichain:sidebar-refresh', fetchData);

    if (refreshInterval > 0) {
      intervalRef.current = setInterval(fetchData, refreshInterval);
    }

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('medichain:sidebar-refresh', fetchData);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchData, refreshInterval]);

  return {
    ...state,
    refetch: fetchData,
  };
}

// =============================================================================
// Individual Badge Hooks (for granular use)
// =============================================================================

/**
 * Hook to get pending lab approvals count (for Doctors)
 */
export function usePendingLabApprovals(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      const data = await fetchDoctorDashboard();
      if (data) {
        setCount(data.alerts.pending_labs_count);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return count;
}

/**
 * Hook to get pending tests count (for Lab Techs)
 */
export function usePendingTests(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      const data = await fetchLabDashboard();
      if (data) {
        setCount(data.test_queue?.pending_count ?? 0);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return count;
}

/**
 * Hook to get pending prescriptions count (for Pharmacists)
 */
export function usePendingRx(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      const data = await fetchPharmacistDashboard();
      if (data) {
        setCount(data.prescriptions?.pending_fill ?? 0);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return count;
}

/**
 * Hook to get vitals due count (for Nurses)
 */
export function useVitalsDue(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      const data = await fetchNurseDashboard();
      if (data) {
        setCount(data.tasks.vitals_due);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return count;
}

/**
 * Hook to get unread notifications count (for all roles)
 */
export function useUnreadNotifications(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      const data = await fetchNotifications();
      if (data) {
        setCount(data.unread_count);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return count;
}

/**
 * Hook to get unread messages count (for all roles)
 */
export function useUnreadMessages(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      const data = await fetchMessages();
      if (data) {
        setCount(data.unread_count);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return count;
}
