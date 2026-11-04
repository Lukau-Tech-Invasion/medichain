/**
 * Turn the server's shift draft into handoff text (UX plan WP 5.6). Only what
 * was recorded is stated; a patient with nothing recorded says so, so the
 * receiving nurse can tell "nothing happened" from "nobody wrote it down".
 */
import { formatTimestamp } from '@medichain/shared';
import type { HandoffDraftPatient } from '@medichain/shared';

/** `vital_signs` -> `Vital signs`. */
export function recordLabel(resourceType: string): string {
  const words = resourceType.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : resourceType;
}

/** One line per record type: "Vital signs ×2 (last 14:02)". */
export function recordedSummary(patient: HandoffDraftPatient, nothingRecorded: string, recordedThisShift: string): string {
  if (patient.recorded.length === 0) return nothingRecorded;
  const lines = patient.recorded.map((r) => {
    const times = r.count > 1 ? ` ×${r.count}` : '';
    const last = r.last_at ? ` (${formatTimestamp(r.last_at)})` : '';
    return `• ${recordLabel(r.resource_type)}${times}${last}`;
  });
  return `${recordedThisShift}\n${lines.join('\n')}`;
}
