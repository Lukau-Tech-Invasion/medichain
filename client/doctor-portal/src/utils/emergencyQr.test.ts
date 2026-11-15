import { describe, it, expect } from 'vitest';
import { parseEmergencyCode, cameraErrorMessage } from '@medichain/shared';

/** The JSON the API prints into a patient's Medical ID QR (medical_id/core.rs). */
const medicalIdQr = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'medichain_medical_id',
    version: '1.1',
    patient_id: 'PAT-1',
    name: 'Ayanda Ngcobo',
    dob: '2001-06-14',
    blood_type: 'AB+',
    critical_allergies: ['latex'],
    dnr: false,
    dnr_verified: false,
    organ_donor: false,
    emergency_contact: { name: 'Nomvula Ngcobo', phone: '+27000300402', relationship: 'mother' },
    profile_unavailable: false,
    api_url: '/api/medical-id/PAT-1',
    emergency_proof: 'a'.repeat(64),
    generated_at: 1_800_000_000,
    ...overrides,
  });

describe('parseEmergencyCode', () => {
  it('reads a Medical ID QR: patient, proof and the offline summary', () => {
    const code = parseEmergencyCode(medicalIdQr());
    expect(code.kind).toBe('medical_id');
    if (code.kind !== 'medical_id') return;
    expect(code.patientId).toBe('PAT-1');
    expect(code.proof).toBe('a'.repeat(64));
    expect(code.offline.bloodType).toBe('AB+');
    expect(code.offline.allergies).toEqual(['latex']);
    expect(code.offline.emergencyContact?.phone).toBe('+27000300402');
  });

  it('keeps a code made before the proof existed, with no proof', () => {
    const code = parseEmergencyCode(medicalIdQr({ emergency_proof: undefined }));
    expect(code.kind === 'medical_id' && code.proof).toBeNull();
  });

  it('reads a card tag id, bare or in JSON', () => {
    expect(parseEmergencyCode(' NFC-DEMO-001 ')).toEqual({ kind: 'card', tagId: 'NFC-DEMO-001' });
    expect(parseEmergencyCode('{"tag_id":"NFC-1"}')).toEqual({ kind: 'card', tagId: 'NFC-1' });
    expect(parseEmergencyCode('{"nfc_tag_id":"NFC-2"}')).toEqual({ kind: 'card', tagId: 'NFC-2' });
  });

  it('refuses anything else, without throwing', () => {
    for (const raw of ['', 'https://example.com', '{not json', '[1,2]', '{"type":"other"}']) {
      expect(parseEmergencyCode(raw).kind).toBe('invalid');
    }
    expect(parseEmergencyCode(medicalIdQr({ patient_id: '' })).kind).toBe('invalid');
  });

  it('does not invent an unmeasured value', () => {
    const code = parseEmergencyCode(medicalIdQr({ dnr: undefined, blood_type: undefined, emergency_contact: null }));
    if (code.kind !== 'medical_id') throw new Error('expected a medical id');
    expect(code.offline.dnr).toBeNull();
    expect(code.offline.bloodType).toBeNull();
    expect(code.offline.emergencyContact).toBeNull();
  });
});

describe('cameraErrorMessage', () => {
  it('tells a refused permission apart from a missing or busy camera', () => {
    expect(cameraErrorMessage(new DOMException('x', 'NotAllowedError'))).toMatch(/permission was refused/);
    expect(cameraErrorMessage(new DOMException('x', 'NotFoundError'))).toMatch(/No camera/);
    expect(cameraErrorMessage(new DOMException('x', 'NotReadableError'))).toMatch(/in use/);
    expect(cameraErrorMessage('?')).toMatch(/could not be opened/);
  });
});
