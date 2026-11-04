import { describe, expect, it } from 'vitest';
import { recordLabel, recordedSummary } from './handoffDraft';

const base = { patient_id: 'P1', full_name: 'A', date_of_birth: null, bed_label: null };

describe('handoff draft text', () => {
  it('names each kind of record once with its count', () => {
    const text = recordedSummary({ ...base, recorded: [{ resource_type: 'vital_signs', count: 2, last_at: null }, { resource_type: 'wound_care', count: 1, last_at: null }] }, 'none', 'Recorded:');
    expect(text).toBe('Recorded:\n• Vital signs ×2\n• Wound care');
  });

  it('says nothing was recorded rather than leaving the field blank', () => {
    expect(recordedSummary({ ...base, recorded: [] }, 'Nothing recorded this shift', 'Recorded:')).toBe('Nothing recorded this shift');
  });

  it('labels record types readably', () => {
    expect(recordLabel('intake-output')).toBe('Intake output');
  });
});
