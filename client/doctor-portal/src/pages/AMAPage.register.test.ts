import { describe, expect, it } from 'vitest';
import type { AmaRegisterRow } from '@medichain/shared';
import { matchesSearch, toAmaRecord } from './AMAPage.register';

/** A row exactly as `GET /api/platform/list/ama-discharges` serves it. */
const row = (overrides: Partial<AmaRegisterRow> = {}): AmaRegisterRow => ({
  id: 'AMA-1',
  patient_id: 'PAT-1',
  created_at: '2026-11-12T08:00:00Z',
  discharge_datetime: '2026-11-12T08:00:00Z',
  attending_physician_id: 'doctor_a',
  diagnosis: 'Pneumonia',
  recommended_treatment: 'IV antibiotics',
  patient_statement: 'I need to get home',
  risk_level: 'high',
  status: 'pending-signatures',
  patient_signed: false,
  signature_refused_reason: null,
  signatures_collected_at: null,
  witness_name: 'Nurse B',
  witness_signed: false,
  provider_attested: true,
  ...overrides,
});

describe('toAmaRecord', () => {
  it('reads every field the page shows from the name the server sends it under', () => {
    expect(toAmaRecord(row())).toEqual({
      id: 'AMA-1',
      patientId: 'PAT-1',
      filedAt: new Date('2026-11-12T08:00:00Z'),
      status: 'pending-signatures',
      riskLevel: 'high',
      providerId: 'doctor_a',
      diagnosis: 'Pneumonia',
      recommendedTreatment: 'IV antibiotics',
      patientStatement: 'I need to get home',
      patientSigned: false,
      signatureRefusedReason: undefined,
      witnessName: 'Nurse B',
      witnessSigned: false,
      providerAttested: true,
    });
  });

  it('a missing or unreadable time is absent, never today', () => {
    expect(toAmaRecord(row({ created_at: '' })).filedAt).toBeUndefined();
    expect(toAmaRecord(row({ created_at: 'not a date' })).filedAt).toBeUndefined();
  });

  it('nothing written is absent, and an unknown risk level is not shown as one', () => {
    const record = toAmaRecord(row({ diagnosis: null, patient_statement: '  ', risk_level: 'hgih' }));
    expect(record.diagnosis).toBeUndefined();
    expect(record.patientStatement).toBeUndefined();
    expect(record.riskLevel).toBeUndefined();
  });

  it('carries a signed discharge as completed, and a refusal as the reason given', () => {
    const record = toAmaRecord(row({
      status: 'completed', patient_signed: false, signature_refused_reason: 'Would not sign', witness_signed: true,
    }));
    expect(record.status).toBe('completed');
    expect(record.signatureRefusedReason).toBe('Would not sign');
    expect(record.witnessSigned).toBe(true);
  });
});

describe('matchesSearch', () => {
  const record = toAmaRecord(row());

  it('matches the record id, the patient id or the diagnosis, ignoring case', () => {
    expect(matchesSearch(record, 'ama-1')).toBe(true);
    expect(matchesSearch(record, 'pat-1')).toBe(true);
    expect(matchesSearch(record, 'PNEUMO')).toBe(true);
    expect(matchesSearch(record, 'fracture')).toBe(false);
  });

  it('an empty search matches everything', () => {
    expect(matchesSearch(record, '   ')).toBe(true);
  });
});
