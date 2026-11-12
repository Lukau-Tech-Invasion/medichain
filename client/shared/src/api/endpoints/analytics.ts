/**
 * MediChain API endpoints: Analytics, role dashboards and the doctor's "Today" list.
 */

import { getApiClient } from '../client';
import type {
  AdminDashboardResponse,
  AppointmentAnalyticsResponse,
  DashboardMetricsResponse,
  DoctorDashboardResponse,
  LabDashboardResponse,
  NurseDashboardResponse,
  PharmacistDashboardResponse,
  QualityMetricsResponse,
} from '../../types';

// ============================================================================
// Analytics (Phase 31)
// ============================================================================

export async function getDashboardMetrics(params: Record<string, string>): Promise<DashboardMetricsResponse> {
  const query = new URLSearchParams(params).toString();
  return getApiClient().get(`/api/platform/analytics/dashboard?${query}`);
}

export async function getAppointmentAnalytics(
  range?: { start_date: string; end_date: string }
): Promise<AppointmentAnalyticsResponse> {
  const query = range ? `?${new URLSearchParams(range).toString()}` : '';
  return getApiClient().get(`/api/platform/analytics/appointments${query}`);
}

export async function getQualityMetrics(): Promise<QualityMetricsResponse> {
  return getApiClient().get('/api/platform/analytics/quality');
}

/**
 * Operational indicators counted from stored records, and the ones this
 * deployment cannot measure, named rather than estimated.
 */
export interface OperationalMetrics {
  measured: {
    radiology_queue: number;
    lab_pending: number;
    lab_turnaround_median_minutes: number | null;
    unacknowledged_critical_values: number;
    patient_satisfaction_average: number | null;
    patient_satisfaction_responses: number;
  };
  unmeasured: string[];
}

export async function getOperationalMetrics(): Promise<OperationalMetrics> {
  return getApiClient().get('/api/platform/analytics/operations');
}

// ============================================================================
// Dashboards
// ============================================================================

/**
 * Get doctor dashboard data
 */
export async function getDoctorDashboard(): Promise<DoctorDashboardResponse> {
  return getApiClient().get('/api/dashboard/doctor');
}

/**
 * Get nurse dashboard data
 */
export async function getNurseDashboard(): Promise<NurseDashboardResponse> {
  return getApiClient().get('/api/dashboard/nurse');
}

/**
 * Get lab tech dashboard data
 */
export async function getLabDashboard(): Promise<LabDashboardResponse> {
  return getApiClient().get('/api/dashboard/lab');
}

/**
 * Get admin dashboard data
 */
export async function getAdminDashboard(): Promise<AdminDashboardResponse> {
  return getApiClient().get('/api/dashboard/admin');
}

/**
 * Get pharmacist dashboard data
 */
export async function getPharmacistDashboard(): Promise<PharmacistDashboardResponse> {
  return getApiClient().get('/api/dashboard/pharmacist');
}

// ============================================================================
// Doctor "Today" (UX plan WP 3.1): everything waiting on the caller.
// ============================================================================

export type TodayUrgency = 'critical' | 'urgent' | 'routine';

export interface TodayItem {
  id: string;
  patient_id: string;
  title: string;
  detail: string | null;
  at: string;
  urgency: TodayUrgency;
}

export interface TodayPatient {
  patient_id: string;
  full_name: string;
  date_of_birth: string;
  content_available: boolean;
}

export interface DoctorToday {
  date: string;
  patients: TodayPatient[];
  appointments: TodayItem[];
  consults: TodayItem[];
  refills: TodayItem[];
  results_to_review: TodayItem[];
  critical_values: TodayItem[];
  /** Sources that failed to load: an empty list there is not "nothing waiting". */
  unavailable: string[];
}

export async function getDoctorToday(): Promise<{ today: DoctorToday; names: TodayPatient[] }> {
  return getApiClient().get('/api/dashboard/doctor/today');
}

/** One patient on a clinician's day, as kept on the device for offline use. */
export interface OfflinePatient {
  patient_id: string;
  full_name: string;
  date_of_birth: string;
  gender: string | null;
  blood_type: string | null;
  allergies: Array<{ name: string; severity?: string; reaction?: string | null }>;
  current_medications: string[];
  chronic_conditions: string[];
  emergency_contacts: Array<{ name?: string; phone?: string; relationship?: string }>;
  dnr_status: boolean;
  languages: string[];
  last_updated: string;
  listed_for: Array<{ kind: 'care' | 'appointment' | 'ward'; at: string | null; detail: string | null }>;
}

export interface OfflineBundle {
  generated_at: string;
  expires_at: string;
  patients: OfflinePatient[];
  /** Listed, but the record could not be read or its download not recorded. */
  withheld: number;
  /** Listed, but the caller holds no authority to take this chart offline. */
  not_permitted: number;
}

/** The caller's day, for use without signal. Each patient's download is logged. */
export async function getClinicianOfflineBundle(): Promise<OfflineBundle> {
  // `patients` beside the expiry: the default unwrap would drop the envelope.
  return getApiClient().get('/api/clinician/offline-bundle', { keepEnvelope: true });
}
