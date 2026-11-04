/**
 * Working without signal: which writes may wait on the device, that a replay
 * carries the time it was written, and that "no signal" is not "signed out".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, CLINICIAN_OFFLINE_ROUTES, offlineIntentFor, searchOfflineRoster } from '@medichain/shared';
import type { OfflineBundle } from '@medichain/shared';

describe('which writes queue offline', () => {
  it('queues documentation and names the patient', () => {
    const intent = offlineIntentFor(CLINICIAN_OFFLINE_ROUTES, 'POST', '/api/clinical/vitals', { patient_id: 'PAT-1' });
    expect(intent).toEqual({ category: 'medical-records', description: 'Vital signs', patientId: 'PAT-1' });
  });

  it('never queues prescribing, orders, dispensing or giving medicines', () => {
    for (const path of ['/api/clinical/e-prescribe', '/api/clinical/orders', '/api/pharmacy/dispense', '/api/nursing/mar/administer']) {
      expect(offlineIntentFor(CLINICIAN_OFFLINE_ROUTES, 'POST', path, { patient_id: 'PAT-1' })).toBeUndefined();
    }
  });

  it('does not queue an edit to a listed route', () => {
    expect(offlineIntentFor(CLINICIAN_OFFLINE_ROUTES, 'PUT', '/api/clinical/hp', {})).toBeUndefined();
  });
});

describe('replaying a queued write', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends the time it was written, under the item’s own key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ baseUrl: 'http://api.test', maxRetries: 0 });
    const written = Date.parse('2026-11-04T09:10:00Z');
    await client.replayQueuedMutation('POST', '/api/clinical/vitals', { patient_id: 'PAT-1' }, 'queue-item-1', written);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = new Headers(init.headers);
    expect(headers.get('Idempotency-Key')).toBe('queue-item-1');
    expect(headers.get('X-Offline-Recorded-At')).toBe('2026-11-04T09:10:00.000Z');
  });
});

describe('restoring a session with no signal', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('says unreachable, not ended, and a later refresh can still succeed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const client = new ApiClient({ baseUrl: 'http://api.test' });
    expect(await client.restoreSessionOutcome()).toBe('unreachable');

    // Signal back: the server has the session after all.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'tok' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    expect(await client.restoreSessionOutcome()).toBe('restored');
  });

  it('says ended when the server refuses the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const client = new ApiClient({ baseUrl: 'http://api.test' });
    expect(await client.restoreSessionOutcome()).toBe('ended');
  });
});

describe('searching the day on the device', () => {
  const patient = (id: string, name: string, dob: string) => ({
    patient_id: id, full_name: name, date_of_birth: dob, gender: null, blood_type: null, allergies: [],
    current_medications: [], chronic_conditions: [], emergency_contacts: [], dnr_status: false,
    languages: [], last_updated: '', listed_for: [],
  });
  const bundle: OfflineBundle = {
    generated_at: '', expires_at: '', withheld: 0, not_permitted: 0,
    patients: [patient('PAT-1', 'Thandiwe Nkosi', '1984-03-02'), patient('PAT-2', 'Sipho Dlamini', '1990-07-11')],
  };

  it('matches every word against name, id and date of birth', () => {
    expect(searchOfflineRoster(bundle, 'nkosi thand').map((p) => p.patient_id)).toEqual(['PAT-1']);
    expect(searchOfflineRoster(bundle, 'PAT-2').map((p) => p.patient_id)).toEqual(['PAT-2']);
    expect(searchOfflineRoster(bundle, '1990').map((p) => p.patient_id)).toEqual(['PAT-2']);
    expect(searchOfflineRoster(bundle, '')).toHaveLength(2);
  });
});
