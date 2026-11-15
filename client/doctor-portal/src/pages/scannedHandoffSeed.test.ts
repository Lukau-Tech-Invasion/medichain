import { describe, it, expect } from 'vitest';
import { scannedHandoffSeed } from './scannedHandoffSeed';

const scanned = { patientId: 'PAT-TEST', allergies: ['Penicillin'], currentMedications: ['Recorded medicine'], chronicConditions: ['Recorded condition'] };
describe('scan to handover', () => {
  it('carries disclosed identity and history without fabricating current observations', () => {
    expect(scannedHandoffSeed({ currentEmergency: scanned, emergencyExpiresAt: new Date(2000) }, 1000)).toEqual({
      patientId: 'PAT-TEST', sample: { allergies: 'Penicillin', medications: 'Recorded medicine', past_history: 'Recorded condition' },
    });
  });
  it('does not carry an expired or missing emergency grant', () => {
    for (const expiry of [null, new Date(1000), new Date('invalid')]) {
      expect(scannedHandoffSeed({ currentEmergency: scanned, emergencyExpiresAt: expiry }, 1000)).toEqual({ patientId: '', sample: {} });
    }
  });
  it('leaves unavailable history blank rather than claiming none', () => {
    expect(scannedHandoffSeed({ currentEmergency: { patientId: 'PAT-TEST', allergies: [], currentMedications: [] }, emergencyExpiresAt: new Date(2000) }, 1000).sample).toEqual({allergies: '', medications: '', past_history: ''});
  });
});
