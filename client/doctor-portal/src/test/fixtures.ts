/**
 * Test fixtures for the shapes the API actually returns.
 *
 * Written after `vi.mocked()` replaced a pile of `as any` casts and revealed
 * that a dozen test files were mocking `getPatients()` with `{ patient_id,
 * full_name }` — and six of them with a `health_id` field that exists on
 * neither the client type nor the API's. A test that asserts against a shape
 * the server never sends proves only that the test agrees with itself.
 *
 * Override what a test is actually about; inherit the rest.
 */
import type { PatientProfile } from '@medichain/shared';

export function patientProfile(overrides: Partial<PatientProfile> = {}): PatientProfile {
  return {
    patient_id: 'PAT-001',
    full_name: 'Test Patient',
    date_of_birth: '1990-01-01',
    national_id: '9001010000000',
    gender: 'female',
    emergency_info: {
      patient_id: 'PAT-001',
      blood_type: 'O+',
      allergies: [],
      chronic_conditions: [],
      current_medications: [],
      emergency_contacts: [],
      organ_donor: false,
      dnr_status: false,
      last_updated: '2026-01-01T00:00:00Z',
    },
    created_at: '2026-01-01T00:00:00Z',
    last_updated: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
