import type { AccessLogEntry } from '@medichain/shared';

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

/** Whether a session disclosed information or changed the record. */
export type AccessKind = 'viewed' | 'changed';

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
  /** How many of the session's rows carry a finalized chain transaction. */
  anchoredCount: number;
  rowCount: number;
}

/** Reason shown when a row predates reason recording or none was given. */
const REASON_UNKNOWN = 'Not stated';

/** Category shown for rows written before categories were recorded. */
const RESOURCE_UNKNOWN = 'Medical record';

/**
 * Classify a stored action as a disclosure or a change.
 *
 * Mirrors the server's alert allowlist (`support::access_alert_for`): reads are
 * named, everything else is a change. An allowlist of reads, not of writes, so a
 * new write action can never be shown to a patient as "viewed".
 *
 * @param action - The stored `access_type`.
 * @returns `'viewed'` for reads, otherwise `'changed'`.
 */
export function kindOf(action: string): AccessKind {
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
    anchoredCount: entry.blockchain_tx_hash ? 1 : 0,
    rowCount: 1,
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
  if (entry.blockchain_tx_hash) {
    session.anchoredCount += 1;
  }
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

/** Anchor state of a whole session, for the badge beside it. */
export type AnchorState = 'anchored' | 'partial' | 'pending';

/**
 * Summarise a session's blockchain anchoring.
 *
 * @param session - A grouped session.
 * @returns `'anchored'` only when every row has a finalized transaction.
 */
export function anchorStateOf(session: AccessSession): AnchorState {
  if (session.anchoredCount === 0) return 'pending';
  return session.anchoredCount === session.rowCount ? 'anchored' : 'partial';
}
