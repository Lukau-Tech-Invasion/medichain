/**
 * MediChain API endpoints: Appointments.
 */

import { getApiClient } from '../client';
import type {
  Appointment,
  AppointmentCreateResult,
} from '../../types';

// ============================================================================
// Appointments (Phase 17)
// ============================================================================

/**
 * Mirrors `BookAppointmentRequest`. `provider_id` is a request, not an
 * assertion: the server validates it against the caller, and a clinician
 * booking for themselves omits it.
 */
export interface BookAppointmentRequest {
  patient_id: string;
  provider_id?: string;
  appointment_type: string;
  preferred_date: string;
  preferred_time: string;
  scheduled_at?: string;
  duration_minutes?: number;
  reason: string;
  notes?: string;
  location_type?: string;
  department?: string;
  instructions?: string;
}

export async function createAppointment(data: BookAppointmentRequest): Promise<AppointmentCreateResult> {
  return getApiClient().post('/api/appointments', data);
}

/** A clinician a patient can choose to book with. */
export interface BookableProvider {
  user_id: string;
  name: string;
  role: string;
  username?: string;
  specialty?: string | null;
}

/**
 * Registered clinicians, optionally narrowed to one role (e.g. `'doctor'`).
 *
 * Readable by any registered caller, patients included, because choosing who
 * to book with requires knowing who exists. Returns only professional
 * identity - never other patients.
 */
export async function getProviders(
  role?: string
): Promise<{ success: boolean; providers: BookableProvider[]; count: number }> {
  const query = role ? `?role=${encodeURIComponent(role)}` : '';
  return getApiClient().get(`/api/providers${query}`);
}

/**
 * Advance an appointment through its lifecycle.
 *
 * The server enforces the transition table and the caller's rights, so a
 * rejected move comes back as 409 INVALID_TRANSITION or 403, not as a silent
 * no-op. `reason` is required when cancelling.
 */
export async function setAppointmentStatus(
  appointmentId: string,
  status:
    | 'scheduled'
    | 'confirmed'
    | 'checked_in'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'no_show'
    // The party who did not book refuses the proposed time. Distinct from
    // 'cancelled', which either party may do to an already-agreed appointment.
    | 'declined',
  reason?: string
): Promise<{ success: boolean; appointment_id: string; status: string; message: string }> {
  return getApiClient().post(`/api/appointments/${appointmentId}/status`, { status, reason });
}

/** Appointment list item returned by the patient-scope scheduling route. */
export interface PatientAppointmentListItem {
  appointment_id: string;
  /** Legacy instances used `type`; current API responses use `appointment_type`. */
  type?: string;
  appointment_type?: string;
  status: string;
  provider_name: string;
  specialty?: string;
  scheduled_date: string;
  start_time?: string;
  scheduled_time?: number | string | null;
  duration_minutes?: number;
  location?: string | { telehealth_link?: string | null };
  reason?: string;
  visit_reason?: string;
  notes?: string;
  is_telehealth?: boolean;
  telehealth_session_id?: string;
  awaiting_confirmation_from?: 'patient' | 'provider' | null;
}

/**
 * List appointments visible to a patient or their treating provider.
 *
 * Authentication is applied by the shared client; the API determines whether
 * the caller owns this patient's record or is a healthcare provider.
 */
export async function getPatientAppointments(
  patientId: string
): Promise<{ success: boolean; appointments: Appointment[]; count: number }> {
  return getApiClient().get(`/api/appointments/patient/${patientId}`);
}

/**
 * Patient-facing appointment summaries, including the derived confirmation
 * owner and optional telehealth link used by the patient portal.
 *
 * Kept distinct from `getPatientAppointments`: older clinical consumers need
 * the full persisted appointment record, while this route's presentation
 * contract deliberately permits a compact summary.
 */
export async function getPatientAppointmentSummaries(
  patientId: string
): Promise<{ success: boolean; appointments: PatientAppointmentListItem[]; count: number }> {
  return getApiClient().get(`/api/appointments/patient/${patientId}`);
}

export async function checkInAppointment(appointmentId: string): Promise<{ success: boolean; message: string }> {
  return getApiClient().post(`/api/appointments/${appointmentId}/check-in`, {});
}

export async function getAvailableSlots(
  providerId: string,
  date: string
): Promise<{ success: boolean; provider_id: string; date: string; available_slots: string[]; slot_duration_minutes: number }> {
  return getApiClient().get(`/api/appointments/slots/${providerId}/${date}`);
}

/** One weekday a provider works. `weekday` is ISO-8601: 1 = Monday … 7 = Sunday. */
export interface ProviderWorkingDay {
  weekday: number;
  /** `HH:MM`, facility wall-clock — the same clock an appointment carries. */
  start: string;
  end: string;
  /** An unavailable span inside the day. Both ends or neither; the API refuses one. */
  break_start?: string | null;
  break_end?: string | null;
}

/** A dated exception: leave, a conference, an operating list. */
export interface ProviderBlockedTime {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Absent start and end mean the whole day. */
  start?: string | null;
  end?: string | null;
  reason?: string | null;
}

export interface ProviderSchedule {
  provider_id: string;
  working_days: ProviderWorkingDay[];
  blocked: ProviderBlockedTime[];
  slot_minutes: number;
  updated_by?: string | null;
  updated_at?: number | null;
}

/**
 * Read a provider's published working hours.
 *
 * Answers 200 with `has_schedule: false` rather than 404 when none is set.
 * "This provider has not published hours" is a real answer and a booking screen
 * has to tell it apart from "no such provider": with no schedule the default
 * clinic grid still applies, so the provider is bookable, not unavailable.
 */
export async function getProviderSchedule(providerId: string): Promise<{
  success: boolean;
  has_schedule: boolean;
  schedule?: ProviderSchedule;
  provider_id?: string;
  message?: string;
}> {
  return getApiClient().get(`/api/providers/${providerId}/schedule`);
}

/**
 * Publish a provider's working hours.
 *
 * A provider may set their own; an administrator may set anyone's. A clinician
 * setting a colleague's is refused `403 FORBIDDEN` — a diary somebody else can
 * quietly rewrite is one nobody can rely on.
 */
export async function setProviderSchedule(
  providerId: string,
  data: {
    working_days: ProviderWorkingDay[];
    blocked: ProviderBlockedTime[];
    slot_minutes?: number;
  }
): Promise<{ success: boolean; provider_id: string; working_days: number; message: string }> {
  return getApiClient().put(`/api/providers/${providerId}/schedule`, data);
}
