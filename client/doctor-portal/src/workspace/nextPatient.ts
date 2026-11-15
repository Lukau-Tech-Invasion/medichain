/**
 * Who comes after this patient, for "Close · next" (mockup c5).
 *
 * Taken from the clinician's own booked appointments today. A clinic runs
 * late, so an appointment up to half an hour past its time still counts as
 * waiting; anything older is assumed seen or gone. There is no "seen" flag to
 * read, so this is a guess about order, never about attendance -- the button
 * names the patient and the time, and the clinician decides.
 */
import type { DoctorToday, TodayPatient } from '@medichain/shared';

export interface NextPatient {
  patientId: string;
  name: string;
  at: string;
}

const STILL_WAITING_MS = 30 * 60 * 1000;

export function nextPatient(
  today: Pick<DoctorToday, 'appointments'>,
  names: TodayPatient[],
  currentPatientId: string,
  now: number = Date.now(),
): NextPatient | null {
  const readable = new Map(names.filter((p) => p.content_available && p.full_name).map((p) => [p.patient_id, p.full_name]));
  const upcoming = today.appointments
    .map((a) => ({ a, at: Date.parse(a.at) }))
    .filter(({ a, at }) => a.patient_id !== currentPatientId && Number.isFinite(at) && at >= now - STILL_WAITING_MS)
    .sort((x, y) => x.at - y.at);
  const first = upcoming[0]?.a;
  if (!first) return null;
  // A next patient whose name cannot be read gets no button: "next: unknown"
  // says nothing, and offering the one after would silently skip them.
  const name = readable.get(first.patient_id);
  return name ? { patientId: first.patient_id, name, at: first.at } : null;
}
