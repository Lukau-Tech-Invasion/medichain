/**
 * Validation Utilities
 * Implements Section 6.1 from COMPREHENSIVE_CONNECTION_ANALYSIS.md
 */

/**
 * Validate SS58 wallet address format
 * MediChain uses 48-character addresses starting with '5'
 */
export function isValidSS58Address(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  if (address.length !== 48) return false;
  if (!address.startsWith('5')) return false;
  if (!/^[A-Za-z0-9]+$/.test(address)) return false;
  return true;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

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

/**
 * Validate patient ID format (MCHI-YYYY-XXXX-XXXX)
 */
export function isValidPatientId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const patientIdRegex = /^MCHI-\d{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  return patientIdRegex.test(id);
}

/**
 * Validate date of birth (not in future, reasonable age)
 */
export function isValidDateOfBirth(dob: string): boolean {
  if (!dob || typeof dob !== 'string') return false;
  
  const date = new Date(dob);
  if (isNaN(date.getTime())) return false;
  
  const now = new Date();
  if (date > now) return false;  // No future dates
  
  const age = now.getFullYear() - date.getFullYear();
  if (age > 150 || age < 0) return false;  // Reasonable age range
  
  return true;
}

/**
 * Validate blood type
 */
export function isValidBloodType(bloodType: string): boolean {
  const validTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  return validTypes.includes(bloodType);
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate WebSocket URL format
 */
export function isValidWebSocketUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('ws://') || url.startsWith('wss://');
}

/**
 * Sanitize string (remove dangerous characters)
 */
export function sanitizeString(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[<>'"]/g, '').trim();
}

/**
 * Validate and format national ID
 */
export function validateNationalId(id: string, type: 'NIN' | 'GhanaCard' | 'FaydaID' | 'SmartID'): { valid: boolean; formatted?: string; error?: string } {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'ID is required' };
  }

  const cleanId = id.replace(/[\s-]/g, '');

  switch (type) {
    case 'NIN':
      // Nigerian NIN: 11 digits
      if (!/^\d{11}$/.test(cleanId)) {
        return { valid: false, error: 'NIN must be 11 digits' };
      }
      return { valid: true, formatted: cleanId };

    case 'GhanaCard':
      // Ghana Card: GHA-XXXXXXXXX-X (12 alphanumeric after GHA-)
      if (!/^GHA[A-Z0-9]{13}$/i.test(cleanId.toUpperCase())) {
        return { valid: false, error: 'Invalid Ghana Card format' };
      }
      return { valid: true, formatted: cleanId.toUpperCase() };

    case 'FaydaID':
      // Ethiopian Fayda ID: 10-16 alphanumeric
      if (!/^[A-Z0-9]{10,16}$/i.test(cleanId)) {
        return { valid: false, error: 'Fayda ID must be 10-16 alphanumeric characters' };
      }
      return { valid: true, formatted: cleanId.toUpperCase() };

    case 'SmartID':
      // South African Smart ID: 13 digits
      if (!/^\d{13}$/.test(cleanId)) {
        return { valid: false, error: 'Smart ID must be 13 digits' };
      }
      return { valid: true, formatted: cleanId };

    default:
      return { valid: false, error: 'Unknown ID type' };
  }
}
