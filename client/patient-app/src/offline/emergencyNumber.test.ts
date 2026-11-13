import { describe, expect, it } from 'vitest';
import { getEmergencyNumber } from '@medichain/shared';

describe('deployment emergency number', () => {
  it('defaults to South African cellphone emergency routing without locale inference', () => {
    expect(getEmergencyNumber(null)).toBe('112');
    expect(getEmergencyNumber('')).toBe('112');
  });
  it('accepts an explicitly configured regional phone number', () => {
    expect(getEmergencyNumber(' 10177 ')).toBe('10177');
    expect(getEmergencyNumber('911')).toBe('911');
  });
  it('rejects URLs and dialing instructions in emergency configuration', () => {
    expect(getEmergencyNumber('tel:911')).toBe('112');
    expect(getEmergencyNumber('112;123')).toBe('112');
    expect(getEmergencyNumber('javascript:alert(1)')).toBe('112');
  });
});
