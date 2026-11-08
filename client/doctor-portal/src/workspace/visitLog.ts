/**
 * "This visit": what was saved for the open patient since the chart was opened.
 *
 * Fed by the API client's successful-mutation signal, attributed to whichever
 * workspace form was open — so every existing form contributes without being
 * edited. Memory only (no PHI in browser storage): it lasts while the patient is
 * open in this tab and is cleared by "Close patient" or sign-out.
 */
import { useSyncExternalStore } from 'react';

export interface VisitEvent {
  at: number;
  /** The form that was open, e.g. "Vital Signs"; or a fixed label for chart events. */
  label: string;
  kind: 'opened' | 'saved';
  /** What it was: "Metformin 500 mg twice daily", or the reason the chart was opened. */
  detail?: string;
}

const visits = new Map<string, VisitEvent[]>();
const listeners = new Set<() => void>();
const EMPTY: VisitEvent[] = [];

const keyOf = (userId: string | undefined, patientId: string) => `${userId ?? '-'}|${patientId}`;

function emit(): void {
  listeners.forEach((l) => l());
}

export function recordVisitEvent(userId: string | undefined, patientId: string, event: VisitEvent): void {
  const key = keyOf(userId, patientId);
  // Newest first; bounded so a very long shift cannot grow it without limit.
  visits.set(key, [event, ...(visits.get(key) ?? [])].slice(0, 200));
  emit();
}

export function visitEvents(userId: string | undefined, patientId: string): VisitEvent[] {
  return visits.get(keyOf(userId, patientId)) ?? EMPTY;
}

export function clearVisit(userId: string | undefined, patientId: string): void {
  visits.delete(keyOf(userId, patientId));
  emit();
}

export function useVisitEvents(userId: string | undefined, patientId: string): VisitEvent[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => visitEvents(userId, patientId),
  );
}
