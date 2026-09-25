import { describe, it, expect } from 'vitest';

// Imported through the package entry point, not by relative path: that is how
// application code reaches these schemas, so a broken export surfaces here.
import {
  VITAL_RANGES,
  rangedNumber,
  bloodPressureSchema,
  dateOfBirthSchema,
  pastDateSchema,
  walletAddressSchema,
  patientIdSchema,
  phoneSchema,
} from '@medichain/shared';

/**
 * The point of these tests is not that zod works. It is that the bounds admit
 * the values a clinician genuinely needs to record and reject the ones that are
 * certainly typos — and that the first half is easy to break while tightening
 * the second.
 */

describe('physiological ranges admit real emergencies', () => {
  // Every one of these is a value a clinician must be able to enter. A
  // validator that rejects them is worse than no validator, because the
  // abnormal readings are the ones that matter.
  const mustAccept: Array<[string, number, keyof typeof VITAL_RANGES]> = [
    ['profound hypotension', 60, 'systolic'],
    ['hypertensive crisis', 220, 'systolic'],
    ['severe bradycardia', 30, 'heartRate'],
    ['SVT', 220, 'heartRate'],
    ['agonal breathing', 5, 'respiratoryRate'],
    ['severe hypothermia', 28, 'temperature'],
    ['hyperpyrexia', 42, 'temperature'],
    ['critical desaturation', 60, 'oxygenSaturation'],
    ['extremely premature neonate', 0.5, 'weightKg'],
  ];

  it.each(mustAccept)('accepts %s (%d)', (_label, value, key) => {
    expect(rangedNumber(VITAL_RANGES[key]).safeParse(value).success).toBe(true);
  });
});

describe('physiological ranges reject slipped decimals', () => {
  const mustReject: Array<[string, number, keyof typeof VITAL_RANGES]> = [
    ['systolic with an extra digit', 1200, 'systolic'],
    ['heart rate typo', 800, 'heartRate'],
    ['saturation above 100%', 101, 'oxygenSaturation'],
    ['negative weight', -5, 'weightKg'],
    ['temperature entered in Fahrenheit', 98.6, 'temperature'],
  ];

  it.each(mustReject)('rejects %s (%d)', (_label, value, key) => {
    expect(rangedNumber(VITAL_RANGES[key]).safeParse(value).success).toBe(false);
  });

  it('names the acceptable range rather than saying "invalid"', () => {
    const result = rangedNumber(VITAL_RANGES.systolic).safeParse(1200);
    expect(result.success).toBe(false);
    if (!result.success) {
      // An error message should state the rule to satisfy, not the state that
      // failed. "Invalid value" is a validator's output; a range is a message.
      expect(result.error.issues[0].message).toContain('40');
      expect(result.error.issues[0].message).toContain('300');
      expect(result.error.issues[0].message).not.toMatch(/invalid/i);
    }
  });
});

describe('blood pressure is validated as a pair', () => {
  it('accepts a normal reading', () => {
    expect(bloodPressureSchema.safeParse({ systolic: 120, diastolic: 80 }).success).toBe(true);
  });

  it('rejects a transposed pair even though both numbers are plausible', () => {
    // 80/120 passes every per-field check and reads as profound hypotension.
    // Only a cross-field rule catches it.
    const result = bloodPressureSchema.safeParse({ systolic: 80, diastolic: 120 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/swapped|higher/i);
    }
  });

  it('rejects equal values', () => {
    expect(bloodPressureSchema.safeParse({ systolic: 90, diastolic: 90 }).success).toBe(false);
  });
});

describe('dates', () => {
  it('rejects a future date of birth', () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    expect(dateOfBirthSchema.safeParse(nextYear.toISOString().slice(0, 10)).success).toBe(false);
  });

  it('accepts a date entered today', () => {
    // Compared at end-of-day, so a clinic in a timezone ahead of UTC can record
    // a birth that happened this morning.
    const today = new Date().toISOString().slice(0, 10);
    expect(pastDateSchema.safeParse(today).success).toBe(true);
  });

  it('rejects an implausible age', () => {
    expect(dateOfBirthSchema.safeParse('1850-01-01').success).toBe(false);
  });

  it('accepts a plausible elderly patient', () => {
    const ninetyYearsAgo = new Date();
    ninetyYearsAgo.setFullYear(ninetyYearsAgo.getFullYear() - 90);
    expect(dateOfBirthSchema.safeParse(ninetyYearsAgo.toISOString().slice(0, 10)).success).toBe(true);
  });
});

describe('identifiers', () => {
  it('accepts a real SS58 address', () => {
    expect(
      walletAddressSchema.safeParse('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY').success
    ).toBe(true);
  });

  it('rejects an address containing base58-excluded characters', () => {
    expect(walletAddressSchema.safeParse('0OIl'.repeat(12)).success).toBe(false);
  });

  it('accepts a patient id and rejects a wallet in its place', () => {
    expect(patientIdSchema.safeParse('PAT-3b765e2d').success).toBe(true);
    // The wallet-vs-PAT- namespace confusion is a recurring, fail-closed bug
    // class in this codebase; catching it at the form is cheap.
    expect(
      patientIdSchema.safeParse('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY').success
    ).toBe(false);
  });

  it('accepts numbers from every market this product targets', () => {
    // An SA-only rule would have rejected two of the three national-ID
    // integrations this product ships. A validator that rejects a whole
    // country is worse than none.
    expect(phoneSchema.safeParse('0821234567').success).toBe(true);      // South Africa
    expect(phoneSchema.safeParse('+27821234567').success).toBe(true);    // South Africa E.164
    expect(phoneSchema.safeParse('+251911234567').success).toBe(true);   // Ethiopia
    expect(phoneSchema.safeParse('+233201234567').success).toBe(true);   // Ghana
    expect(phoneSchema.safeParse('+234 802 123 4567').success).toBe(true); // spaces tolerated
  });

  it('still rejects a truncated or non-numeric number', () => {
    expect(phoneSchema.safeParse('12345').success).toBe(false);
    expect(phoneSchema.safeParse('not-a-number').success).toBe(false);
  });
});
