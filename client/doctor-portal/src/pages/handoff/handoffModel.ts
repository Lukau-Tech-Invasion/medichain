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

function linesOf(drafted: HandoffDraftLine[] | undefined): HandoffLine[] {
  return (drafted ?? []).map((l) => ({ key: lineKey(), text: l.text, source: l.source, at: l.at }));
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
export function fromDraft(d: HandoffDraftPatient, unreadableName: string): PatientHandoff {
  const patient = blankPatient(d.patient_id, d.full_name ?? unreadableName, d.bed_label ?? '');
  patient.entries = d.recorded.reduce((n, r) => n + r.count, 0);
  if (d.sbar) {
    patient.lines = {
      situation: linesOf(d.sbar.situation),
      background: linesOf(d.sbar.background),
      assessment: linesOf(d.sbar.assessment),
      recommendation: linesOf(d.sbar.recommendation),
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
