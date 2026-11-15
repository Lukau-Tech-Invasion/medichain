/**
 * What a scanned emergency code holds.
 *
 * Two things can open emergency access: the patient's NFC card (its tag id,
 * sometimes printed as a QR) and the Medical ID QR the patient downloads from
 * the patient app. The Medical ID QR also carries a small offline summary, so a
 * responder with no connection still sees blood type, allergies and whom to
 * call; and a server-minted `emergency_proof`, without which the server will
 * not open access by patient id (QR codes downloaded before the proof existed
 * carry none).
 */

export interface OfflineEmergencySummary {
  name: string | null;
  dateOfBirth: string | null;
  bloodType: string | null;
  allergies: string[];
  dnr: boolean | null;
  dnrVerified: boolean | null;
  organDonor: boolean | null;
  emergencyContact: { name: string; phone: string; relationship: string | null } | null;
  /** The server could not read the profile when the code was made. */
  profileUnavailable: boolean;
  /** Unix seconds; `null` when the code does not say. */
  generatedAt: number | null;
}

export type ScannedEmergencyCode =
  | { kind: 'card'; tagId: string }
  | { kind: 'medical_id'; patientId: string; proof: string | null; offline: OfflineEmergencySummary }
  | { kind: 'invalid'; reason: string };

const NOT_MEDICHAIN = 'This is not a MediChain medical ID or card code.';

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

function offlineSummary(code: Record<string, unknown>): OfflineEmergencySummary {
  const contact = code.emergency_contact as Record<string, unknown> | null | undefined;
  const contactName = text(contact?.name);
  const contactPhone = text(contact?.phone);
  return {
    name: text(code.name),
    dateOfBirth: text(code.dob),
    bloodType: text(code.blood_type),
    allergies: Array.isArray(code.critical_allergies)
      ? code.critical_allergies.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
      : [],
    dnr: flag(code.dnr),
    dnrVerified: flag(code.dnr_verified),
    organDonor: flag(code.organ_donor),
    emergencyContact:
      contactName && contactPhone
        ? { name: contactName, phone: contactPhone, relationship: text(contact?.relationship) }
        : null,
    profileUnavailable: code.profile_unavailable === true,
    generatedAt: typeof code.generated_at === 'number' ? code.generated_at : null,
  };
}

export function parseEmergencyCode(raw: string): ScannedEmergencyCode {
  const value = raw.trim();
  if (!value) return { kind: 'invalid', reason: 'The code was empty.' };
  if (!value.startsWith('{')) {
    // A card's tag id printed on its own.
    return /^NFC-[A-Za-z0-9-]+$/.test(value) ? { kind: 'card', tagId: value } : { kind: 'invalid', reason: NOT_MEDICHAIN };
  }
  let code: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'invalid', reason: NOT_MEDICHAIN };
    code = parsed as Record<string, unknown>;
  } catch {
    return { kind: 'invalid', reason: NOT_MEDICHAIN };
  }
  if (code.type === 'medichain_medical_id') {
    const patientId = text(code.patient_id);
    if (!patientId) return { kind: 'invalid', reason: 'This medical ID code has no patient on it.' };
    return { kind: 'medical_id', patientId, proof: text(code.emergency_proof), offline: offlineSummary(code) };
  }
  const tagId = text(code.tag_id) ?? text(code.nfc_tag_id);
  return tagId ? { kind: 'card', tagId } : { kind: 'invalid', reason: NOT_MEDICHAIN };
}
