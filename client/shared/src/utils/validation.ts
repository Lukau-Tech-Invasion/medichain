/**
 * Validation Utilities
 * Implements Section 6.1 from COMPREHENSIVE_CONNECTION_ANALYSIS.md
 */

/**
 * Validate phone number (international format)
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  return phoneRegex.test(phone.replace(/[\s-()]/g, ''));
}

/**
 * Normalize a phone number to a `tel:`-safe E.164-ish string (leading `+`,
 * digits only). Returns `null` when the input is not a valid phone number, so
 * callers can render an "unverified number" state instead of a broken `tel:`
 * link. Accepts common African formats with spaces, dashes and parentheses.
 *
 * @example normalizePhone('+27 (82) 555-1234') => '+27825551234'
 * @example normalizePhone('not a number')       => null
 */
export function normalizePhone(phone: string): string | null {
  if (!phone || typeof phone !== 'string') return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  // Collapse any stray '+' to a single leading one.
  const normalized = cleaned.startsWith('+')
    ? '+' + cleaned.slice(1).replace(/\+/g, '')
    : cleaned.replace(/\+/g, '');
  return isValidPhoneNumber(normalized) ? normalized : null;
}
