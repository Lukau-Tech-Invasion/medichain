import { combineSealStatuses } from '@medichain/shared';
import type { AccessLogEntry, CombinedSealStatus, RowVerification, SealStatus } from '@medichain/shared';

/**
 * Turns raw access-log rows into the sessions a patient can read.
 *
 * Opening one chart issues ~20 reads (profile, vitals, labs, notes...). Listing
 * each row would bury the one line the patient needs -- "Dr Dlamini viewed your
 * vital signs and lab results on Friday, for treatment" -- under twenty near
 * duplicates. Rows are grouped when the same person, at the same place, for the
 * same reason, did the same kind of thing within {@link SESSION_GAP_MINUTES} of
 * their previous row.
 */

/** Longest pause, in minutes, between two rows that still count as one session. */
export const SESSION_GAP_MINUTES = 30;

const MILLISECONDS_PER_MINUTE = 60_000;

/** A disclosure, change, receipt request, or de-identified research inclusion. */
export type AccessKind = 'viewed' | 'changed' | 'requested' | 'research';

/** One grouped access session, ready to render. */
export interface AccessSession {
  /** Stable key: the id of the session's first row. */
  key: string;
  accessorId: string;
  accessorName: string;
  role: string;
  /** Facility id, or the accessor's department when no facility is recorded. */
  place: string | null;
  reason: string;
  kind: AccessKind;
  startedAt: string;
  endedAt: string;
  /** Distinct plain-language categories, in the order first touched. */
  resources: string[];
  emergency: boolean;
  /** Each row's `seal_status`, as the server reported it (null when it did not). */
  sealStatuses: Array<SealStatus | null>;
  rowCount: number;
  /** The access-log row ids in this session, for verification (WP8). */
  rowIds: string[];
  /** What authorised the access (WP9), e.g. `care_relationship`, `break_glass`. */
  authorityType: string | null;
  /** For a care relationship, where it came from (`encounter`, `referral`). */
  authoritySource: string | null;
}

/** Reason shown when a row predates reason recording or none was given. */
const REASON_UNKNOWN = 'Not stated';

/** Category shown for rows written before categories were recorded. */
const RESOURCE_UNKNOWN = 'Medical record';

/**
 * Classify a stored action without implying that a request committed a change.
 *
 * Reads are named explicitly; other actions default to changes except the
 * request and research actions below. A new write cannot silently become a read.
 *
 * Inclusion in a research export is its own kind: it is neither a person
 * reading the record nor a change to it, and the patient is told exactly that.
 *
 * @param action - The stored `access_type`.
 * Receipt requests record an attempt, not proof of a successful record change.
 * @returns The recorded action kind, keeping receipt requests distinct from changes.
 */
export function kindOf(action: string): AccessKind {
  if (action === 'handoff_receipt_requested') return 'requested';
  if (action === 'research_export_included') return 'research';
  const isRead =
    action.startsWith('view') ||
    action.startsWith('download') ||
    action.startsWith('nfc_') ||
    action === 'list_records' ||
    action === 'qr_verification' ||
    action === 'emergency';
  return isRead ? 'viewed' : 'changed';
}

/**
 * Where the accessor was, for display.
 *
 * @param entry - One access-log row.
 * @returns The facility, else the department, else null (never a guess).
 */
function placeOf(entry: AccessLogEntry): string | null {
  return entry.location || entry.accessor_department || null;
}

/**
 * Whether `entry` continues `session` rather than starting a new one.
 *
 * @param session - The most recent open session.
 * @param entry - The next row in time order.
 * @returns True when accessor, place, reason, kind and emergency flag match and
 *   the gap since the session's last row is within {@link SESSION_GAP_MINUTES}.
 */
function continues(session: AccessSession, entry: AccessLogEntry): boolean {
  const gap = new Date(entry.timestamp).getTime() - new Date(session.endedAt).getTime();
  return (
    session.accessorId === entry.accessor_id &&
    session.place === placeOf(entry) &&
    session.reason === (entry.access_reason || REASON_UNKNOWN) &&
    session.kind === kindOf(entry.access_type) &&
    session.emergency === entry.emergency &&
    session.authorityType === (entry.authority_type ?? null) &&
    gap >= 0 &&
    gap <= SESSION_GAP_MINUTES * MILLISECONDS_PER_MINUTE
  );
}

/**
 * Start a new session from one row.
 *
 * @param entry - The row that opens the session.
 * @returns A session containing only that row.
 */
function openSession(entry: AccessLogEntry): AccessSession {
  return {
    key: entry.access_id,
    accessorId: entry.accessor_id,
    accessorName: entry.accessor_name || entry.accessor_id,
    role: entry.accessor_role,
    place: placeOf(entry),
    reason: entry.access_reason || REASON_UNKNOWN,
    kind: kindOf(entry.access_type),
    startedAt: entry.timestamp,
    endedAt: entry.timestamp,
    resources: [entry.resource_type || RESOURCE_UNKNOWN],
    emergency: entry.emergency,
    sealStatuses: [entry.seal_status ?? null],
    rowCount: 1,
    rowIds: [entry.access_id],
    authorityType: entry.authority_type ?? null,
    authoritySource: entry.authority_source ?? null,
  };
}

/**
 * Fold one more row into a session.
 *
 * @param session - The session being extended (mutated).
 * @param entry - The row to add.
 */
function extend(session: AccessSession, entry: AccessLogEntry): void {
  const resource = entry.resource_type || RESOURCE_UNKNOWN;
  if (!session.resources.includes(resource)) {
    session.resources.push(resource);
  }
  session.endedAt = entry.timestamp;
  session.rowCount += 1;
  session.rowIds.push(entry.access_id);
  session.sealStatuses.push(entry.seal_status ?? null);
}

/**
 * Group access-log rows into sessions, newest session first.
 *
 * @param entries - Rows in any order (the API returns newest first).
 * @returns Sessions ordered from most recent to oldest.
 */
export function groupAccessSessions(entries: AccessLogEntry[]): AccessSession[] {
  const chronological = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const sessions: AccessSession[] = [];
  for (const entry of chronological) {
    const current = sessions[sessions.length - 1];
    if (current && continues(current, entry)) {
      extend(current, entry);
    } else {
      sessions.push(openSession(entry));
    }
  }
  return sessions.reverse();
}

/**
 * Seal state of a whole session, for the badge beside it.
 *
 * @param session - A grouped session.
 * @returns `exported` only when every row the server reported on is exported,
 *   `sealed` when every one is at least sealed, `pending` when none is,
 *   `partial` otherwise, and `null` when no row reported a state.
 */
export function sealStateOf(session: AccessSession): CombinedSealStatus | null {
  return combineSealStatuses(session.sealStatuses);
}

/** What verification says about one session (WP8). */
export type SessionVerification =
  | { state: 'mismatch' }
  | { state: 'signature_invalid' }
  /** Every row proves into a sealed batch, and every batch signature is valid. */
  | { state: 'verified'; sealedAt: string | null }
  /** Every row proves into a sealed batch, but a batch was sealed without a signature. */
  | { state: 'verified_unsigned'; sealedAt: string | null }
  | { state: 'not_sealed' }
  | { state: 'not_checked' };

/** The most recent `sealed_at` among rows, or null when none carries one. */
function latestSealedAt(rows: RowVerification[]): string | null {
  const stamps = rows.map((row) => row.sealed_at).filter((s): s is string => typeof s === 'string');
  return stamps.length > 0 ? stamps.reduce((a, b) => (new Date(a) >= new Date(b) ? a : b)) : null;
}

/**
 * Summarise the verification of a session's rows.
 *
 * Any row that no longer proves into its batch makes the whole session a
 * mismatch, and a failed signature is its own warning. "Verified" needs every
 * row intact AND in a sealed batch with a valid signature; a batch sealed
 * without a key is `verified_unsigned` -- a weaker state that must never read
 * as verified. Anything not yet sealed is "not sealed yet".
 *
 * @param session - A grouped session.
 * @param rows - The verification result rows, by access-log id.
 * @returns The session's verification state.
 */
export function verificationOf(
  session: AccessSession,
  rows: Map<string, RowVerification>,
): SessionVerification {
  const mine = session.rowIds.map((id) => rows.get(id));
  if (mine.some((row) => row === undefined)) return { state: 'not_checked' };
  const checked = mine as RowVerification[];
  if (checked.some((row) => row.integrity === 'mismatch')) return { state: 'mismatch' };
  if (checked.some((row) => row.signature === 'invalid')) return { state: 'signature_invalid' };
  const sealed = checked.every(
    (row) => row.integrity === 'intact' && (row.seal_status === 'sealed' || row.seal_status === 'exported'),
  );
  if (!sealed) return { state: 'not_sealed' };
  const sealedAt = latestSealedAt(checked);
  const fullySigned = checked.every((row) => row.signature === 'valid');
  return { state: fullySigned ? 'verified' : 'verified_unsigned', sealedAt };
}

/** The translation key describing how a session was authorised, if any. */
export function authorityLabelKey(session: AccessSession): string | null {
  switch (session.authorityType) {
    case 'break_glass':
      return 'accessHistory.breakGlassAccess';
    case 'care_relationship':
      return session.authoritySource === 'referral' ? 'accessHistory.viaReferral' : 'accessHistory.viaEncounter';
    case 'patient_grant':
      return 'accessHistory.viaPatientGrant';
    case 'guardian':
      return 'accessHistory.viaGuardian';
    case 'admin':
      return 'accessHistory.viaAdmin';
    default:
      return null;
  }
}
