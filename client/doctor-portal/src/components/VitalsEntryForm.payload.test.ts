import { describe, expect, it } from 'vitest';
import { vitalsPayload, type VitalsDraft } from './VitalsEntryForm';
import { lastRecordedLine } from '../pages/VitalSignsPage';

const blank: VitalsDraft = {
  heart_rate: '', respiratory_rate: '', bp_systolic: '', bp_diastolic: '', temperature: '',
  oxygen_saturation: '', pain_scale: '', gcs_total: '', blood_glucose: '', weight_kg: '', notes: '',
  consciousness: '', breathing: '', taken_at: '',
};

describe('time taken (c3)', () => {
  it('sends no time when nobody entered one, so the server uses its own', () => {
    const body = vitalsPayload('PAT-1', { ...blank, heart_rate: '88' });
    expect('taken_at' in body).toBe(false);
  });

  it('sends the entered local time as an instant', () => {
    const body = vitalsPayload('PAT-1', { ...blank, heart_rate: '88', taken_at: '2026-11-09T09:10' });
    expect(body.taken_at).toBe(new Date('2026-11-09T09:10').toISOString());
  });
});

describe('last recorded (c3)', () => {
  const t = (key: string, vars?: Record<string, string>) => `${key}${vars ? JSON.stringify(vars) : ''}`;
  const reading = {
    reading_id: 'VS-1', patient_id: 'PAT-1', recorded_at: '2026-11-09T08:00:00Z', recorded_by: 'u',
    heart_rate: 88, respiratory_rate: null, blood_pressure_systolic: 128, blood_pressure_diastolic: 82,
    temperature_celsius: null, oxygen_saturation: null, pain_scale: null, gcs_total: null,
    blood_glucose: null, weight_kg: null,
  };

  it('names only what was measured', () => {
    const line = lastRecordedLine(reading, t);
    expect(line).toContain('docVitalSigns.lastBp');
    expect(line).toContain('docVitalSigns.lastPulse');
    expect(line).not.toContain('docVitalSigns.lastTemp');
  });
});
