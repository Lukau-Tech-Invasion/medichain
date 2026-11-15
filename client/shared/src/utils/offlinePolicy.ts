/**
 * Which writes a clinician may make without signal.
 *
 * Owner decision, 2026-11-04: **documentation** works offline — notes, vital
 * signs, observations, assessments. Prescribing, orders, dispensing and
 * medication administration do not: each depends on a check only the server
 * can make at that moment (allergies, interactions, the dose already given),
 * and queueing one would let it run blind.
 *
 * A route not listed here fails offline exactly as before. Listing one is a
 * clinical-safety decision, not a convenience, and the list is deliberately
 * short. Each listed handler stamps its record with `support::clinical_time`,
 * so a reading sent hours later keeps the time it was taken.
 */
import type { RequestOptions } from '../api/client';

type Intent = NonNullable<RequestOptions['queueWhenOffline']>;

export interface OfflineRoute {
  method: 'POST';
  path: string;
  category: Intent['category'];
  /** What the clinician sees in the unsent list. */
  description: string;
}

export const CLINICIAN_OFFLINE_ROUTES: readonly OfflineRoute[] = [
  { method: 'POST', path: '/api/clinical/vitals', category: 'medical-records', description: 'Vital signs' },
  { method: 'POST', path: '/api/clinical/gcs', category: 'medical-records', description: 'Glasgow Coma Scale' },
  { method: 'POST', path: '/api/clinical/soap', category: 'medical-records', description: 'SOAP note' },
  { method: 'POST', path: '/api/clinical/progress-note', category: 'medical-records', description: 'Progress note' },
  { method: 'POST', path: '/api/clinical/hp', category: 'medical-records', description: 'History and physical' },
  { method: 'POST', path: '/api/clinical/triage', category: 'medical-records', description: 'Triage assessment' },
  { method: 'POST', path: '/api/nursing/intake-output/record', category: 'medical-records', description: 'Fluid intake or output' },
  { method: 'POST', path: '/api/emergency/io', category: 'medical-records', description: 'Fluid intake or output' },
  { method: 'POST', path: '/api/emergency/wound', category: 'medical-records', description: 'Wound assessment' },
  { method: 'POST', path: '/api/emergency/iv-site', category: 'medical-records', description: 'IV site check' },
  { method: 'POST', path: '/api/emergency/fall-risk', category: 'medical-records', description: 'Fall risk assessment' },
];

function patientOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const id = record.patient_id ?? record.patientId;
  return typeof id === 'string' && id ? id : undefined;
}

/** The queue intent for a write under `routes`, or `undefined` if it must not queue. */
export function offlineIntentFor(
  routes: readonly OfflineRoute[],
  method: string,
  path: string,
  body: unknown,
): Intent | undefined {
  const bare = path.split('?')[0];
  const route = routes.find((r) => r.method === method.toUpperCase() && r.path === bare);
  if (!route) return undefined;
  return { category: route.category, description: route.description, patientId: patientOf(body) };
}
