/**
 * One patient in a shift handoff, as the page edits it (mockup c2).
 *
 * The server drafts each SBAR section as lines with a source and a time; the
 * nurse edits, removes and adds lines, makes the Stable / Watch / Unstable
 * call, and reviews each patient in turn. On save, each section's lines are
 * joined into the SBAR text the handoff record has always stored, and the
 * Recommendation lines are also sent as the to-do list.
 */
import type { HandoffDraftLine, HandoffDraftPatient, HandoffLineSource } from '@medichain/shared';

export type Stability = 'stable' | 'watch' | 'unstable';
export type Priority = 'routine' | 'urgent' | 'critical';
export const SECTIONS = ['situation', 'background', 'assessment', 'recommendation'] as const;
export type Section = (typeof SECTIONS)[number];

export interface HandoffLine {
  /** Stable key for React; never sent. */
  key: string;
  text: string;
  /** Absent for a line the nurse added. */
  source?: HandoffLineSource;
  at?: string | null;
}

export interface PatientHandoff {
  patientId: string;
  patientName: string;
  room: string;
  diagnosis: string;
  codeStatus: string;
  isolation?: string;
  priority: Priority;
  lines: Record<Section, HandoffLine[]>;
  /** Unset until the nurse makes the call: an unassessed patient is not stable. */
  stability?: Stability;
  /** Opened and moved past with "Next patient". */
  reviewed: boolean;
  /** Discharged during this shift (ISO time); absent while still admitted. */
  dischargedAt?: string;
  /** How many records the nurse wrote this shift, for the list. */
  entries: number;
  ivAccess: string;
  diet: string;
  activity: string;
  pendingLabs: string;
  pendingTests: string;
  medications: { scheduled: string; prn: string; drips: string };
  safetyRisks: string[];
  pendingOrders: string;
  familyUpdates: string;
  additionalNotes: string;
}

let serial = 0;
export function lineKey(): string {
  serial += 1;
  return `line-${serial}`;
}

/** How a drafted line is worded on screen; by default, the server's English. */
export type LineWriter = (line: HandoffDraftLine) => string;
const asSent: LineWriter = (line) => line.text;

/**
 * A writer that words each line in the portal's language from
 * `docShiftHandoff.line.<code>`, filled with what was recorded. A code the
 * portal has no wording for, or a sentence left with a gap, falls back to the
 * server's English rather than showing a key or a placeholder.
 */
export function lineWriter(t: (key: string, values?: Record<string, string>) => string): LineWriter {
  return (line) => {
    const key = `docShiftHandoff.line.${line.code}`;
    const worded = t(key, line.values ?? {});
    if (!line.code || worded === key || worded.includes('{{')) return line.text;
    return worded.trim();
  };
}

function linesOf(drafted: HandoffDraftLine[] | undefined, write: LineWriter): HandoffLine[] {
  return (drafted ?? []).map((l) => ({ key: lineKey(), text: write(l), source: l.source, at: l.at }));
}

/** A patient as nobody has written anything about them yet. */
export function blankPatient(patientId: string, patientName: string, room = ''): PatientHandoff {
  return {
    patientId,
    patientName,
    room,
    diagnosis: '',
    codeStatus: 'Not recorded',
    priority: 'routine',
    lines: { situation: [], background: [], assessment: [], recommendation: [] },
    reviewed: false,
    entries: 0,
    ivAccess: '',
    diet: '',
    activity: '',
    pendingLabs: '',
    pendingTests: '',
    medications: { scheduled: '', prn: '', drips: '' },
    safetyRisks: [],
    pendingOrders: '',
    familyUpdates: '',
    additionalNotes: '',
  };
}

/** A patient from the server's shift draft, its lines prefilled. */
export function fromDraft(
  d: HandoffDraftPatient,
  unreadableName: string,
  write: LineWriter = asSent,
): PatientHandoff {
  const patient = blankPatient(d.patient_id, d.full_name ?? unreadableName, d.bed_label ?? '');
  patient.entries = d.recorded.reduce((n, r) => n + r.count, 0);
  if (d.discharged_at) patient.dischargedAt = d.discharged_at;
  if (d.sbar) {
    patient.lines = {
      situation: linesOf(d.sbar.situation, write),
      background: linesOf(d.sbar.background, write),
      assessment: linesOf(d.sbar.assessment, write),
      recommendation: linesOf(d.sbar.recommendation, write),
    };
  }
  return patient;
}

/** What the list shows beside a patient. */
export type ListStatus = Stability | 'reviewed' | 'toReview';

export function listStatus(p: PatientHandoff): ListStatus {
  // A patient to keep an eye on says so whether or not they were reviewed.
  if (p.stability === 'watch' || p.stability === 'unstable') return p.stability;
  return p.reviewed ? 'reviewed' : 'toReview';
}

function filled(lines: HandoffLine[]): string[] {
  return lines.map((l) => l.text.trim()).filter(Boolean);
}

/** The patient as the handoff endpoint takes it. */
export function toPayload(p: PatientHandoff) {
  const { lines, reviewed: _reviewed, entries: _entries, stability, ...rest } = p;
  const todos = filled(lines.recommendation);
  return {
    ...rest,
    sbar: {
      situation: filled(lines.situation).join('\n'),
      background: filled(lines.background).join('\n'),
      assessment: filled(lines.assessment).join('\n'),
      recommendation: todos.join('\n'),
    },
    // Absent rather than empty: a field nobody filled is not sent (rule 9).
    ...(stability ? { stability } : {}),
    ...(todos.length ? { todos } : {}),
  };
}

/** The next selected patient still to review after `current`, wrapping round. */
export function nextToReview(patients: PatientHandoff[], selected: Set<string>, current: string | null): string | null {
  const order = patients.filter((p) => selected.has(p.patientId));
  const at = order.findIndex((p) => p.patientId === current);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(at + step + order.length) % order.length];
    if (candidate && candidate.patientId !== current && !candidate.reviewed) return candidate.patientId;
  }
  return null;
}
