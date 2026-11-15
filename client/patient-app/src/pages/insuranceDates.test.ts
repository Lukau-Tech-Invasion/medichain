import { describe, expect, it } from 'vitest';
import { validInsuranceDates } from './insuranceDates';

describe('insurance calendar dates', () => {
  it.each([
    ['2026-12-31', '2026-01-01'], ['2026-02-29', ''], ['', '2026-04-31'],
    ['2026-1-01', ''], ['0000-01-01', ''], ['not-a-date', ''],
  ])('rejects invalid range %s to %s', (from, to) => expect(validInsuranceDates(from, to)).toBe(false));

  it.each([
    ['', ''], [' ', ''], ['2024-02-29', ''], ['', '2026-10-15'],
    ['2026-10-15', '2026-10-15'], [' 2026-01-01 ', '2026-12-31'],
  ])('accepts optional or ordered range %s to %s', (from, to) => expect(validInsuranceDates(from, to)).toBe(true));
});
