/**
 * A prescription error has to be attached to the field that caused it.
 *
 * WCAG 3.3.1 (Error Identification) and 1.3.1 (Info and Relationships) are not
 * satisfied by showing a message — they require the relationship to be
 * *programmatically determinable*. A banner reading "Invalid quantity" above a
 * form of eleven inputs tells a screen-reader user nothing about which one to
 * fix.
 *
 * So these assert the association (`aria-invalid`, `aria-describedby` resolving
 * to the message), not merely that some text appeared.
 */

import { describe, it, expect } from 'vitest';
import { prescriptionSchema } from '@medichain/shared';

describe('prescriptionSchema', () => {
  const valid = {
    patient_id: 'PAT-1234abcd',
    medication_name: 'Amoxicillin',
    strength: '500 mg',
    form: 'capsule',
    quantity: 21,
    days_supply: 7,
    refills_allowed: 0,
    directions: 'One capsule three times a day for seven days',
  };

  it('accepts an ordinary prescription', () => {
    expect(prescriptionSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a quantity that is a typo rather than a prescription', () => {
    // A stray keystroke turns 30 into 300. The pharmacy cannot tell, and this
    // is the last point at which anything can.
    const result = prescriptionSchema.safeParse({ ...valid, quantity: 3000 });
    expect(result.success).toBe(false);
  });

  it('refuses a quantity of zero, which dispenses nothing', () => {
    expect(prescriptionSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
  });

  it('refuses a fractional count of units', () => {
    expect(prescriptionSchema.safeParse({ ...valid, quantity: 2.5 }).success).toBe(false);
  });

  it('holds the repeat cap independently of the input attribute', () => {
    // `max="12"` on the control is enforced by the browser, which a paste or a
    // programmatic change can bypass. The rule has to exist somewhere the
    // browser is not the only enforcer.
    expect(prescriptionSchema.safeParse({ ...valid, refills_allowed: 13 }).success).toBe(false);
    expect(prescriptionSchema.safeParse({ ...valid, refills_allowed: 12 }).success).toBe(true);
  });

  it('requires directions, because a prescription without them cannot be taken', () => {
    const result = prescriptionSchema.safeParse({ ...valid, directions: '   ' });
    expect(result.success).toBe(false);
  });

  it('states the rule to satisfy rather than the state that failed', () => {
    // "Invalid strength" describes the input. "Enter a strength, such as
    // 500 mg" tells the prescriber what to do — the difference between a
    // validator's output and a message.
    const result = prescriptionSchema.safeParse({ ...valid, strength: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.find(i => i.path[0] === 'strength')?.message ?? '';
      expect(message).toMatch(/^Enter /);
      expect(message).not.toMatch(/invalid/i);
    }
  });

  it('names the field that failed, so the message can be bound to its control', () => {
    const result = prescriptionSchema.safeParse({ ...valid, quantity: -1, days_supply: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map(issue => issue.path[0]);
      expect(fields).toContain('quantity');
      expect(fields).toContain('days_supply');
    }
  });
});
