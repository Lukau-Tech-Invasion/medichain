/**
 * Patients this tab has already identified, by name, in a way that was itself
 * controlled: chosen from the directory (which asks for a reason and is
 * audited) or read from their card.
 *
 * The break-glass screen (c1) shows a name only from here. It never asks the
 * server who a patient id belongs to: that would let anyone holding an id
 * learn whose record it is without breaking the glass, which is the very
 * disclosure break-glass exists to record (Security Engineering 3e, ch. 10,
 * p. 15, "Attribution" and "Aggregation control").
 *
 * Memory only. Nothing here reaches browser storage, and a reload forgets it.
 */
export interface IdentifiedPatient {
  patientId: string;
  name: string;
  dateOfBirth?: string | null;
  gender?: string | null;
}

/** Bounded: a shift's worth of look-ups, oldest forgotten first. */
const MAX = 50;
const known = new Map<string, IdentifiedPatient>();

export function rememberIdentified(patient: IdentifiedPatient): void {
  if (!patient.patientId || !patient.name.trim()) return;
  known.delete(patient.patientId);
  known.set(patient.patientId, patient);
  if (known.size > MAX) {
    const oldest = known.keys().next().value;
    if (oldest !== undefined) known.delete(oldest);
  }
}

export function identifiedPatient(patientId: string): IdentifiedPatient | null {
  return known.get(patientId) ?? null;
}

/** Tests only. */
export function forgetIdentifiedForTests(): void {
  known.clear();
}
