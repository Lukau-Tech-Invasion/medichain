/**
 * The runs this device is working on, as last seen — so the crew keeps seeing
 * their timeline when the signal drops.
 *
 * When an entry is queued instead of sent (no signal), it is added here marked
 * `pending`, and the run's status moves the way the server will move it. The
 * queued copy itself is sealed in IndexedDB and replayed under its original
 * operation key; this map is memory only (no health data in browser storage),
 * so after a reload the timeline shows what the server has, plus the
 * "Not sent yet" count from the queue.
 */
import { useSyncExternalStore } from 'react';
import type { AddEmsRunEventBody, EmsRun, EmsRunEvent, EmsRunStatus, EmsRunWithEvents } from '@medichain/shared';

export interface LocalEvent extends EmsRunEvent {
  pending?: boolean;
}

export interface LocalRun extends Omit<EmsRunWithEvents, 'events'> {
  events: LocalEvent[];
}

const runs = new Map<string, LocalRun>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** `RUN-` + 32 hex: an id the device can choose before it has signal. */
export function newRunId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `RUN-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The status an entry moves a run to (mirrors api/src/handlers/ems_runs.rs `transition`). */
export function nextStatus(status: EmsRunStatus, kind: AddEmsRunEventBody['kind']): EmsRunStatus {
  if (kind === 'left_scene' && status === 'in_progress') return 'en_route';
  if (kind === 'handed_over' && status === 'en_route') return 'arrived';
  if (kind === 'no_transport' && status === 'in_progress') return 'no_transport';
  if (kind === 'cancelled' && (status === 'in_progress' || status === 'en_route')) return 'cancelled';
  return status;
}

export function putRun(run: EmsRunWithEvents): void {
  // Keep entries still waiting to be sent: the server does not have them yet.
  const pending = (runs.get(run.id)?.events ?? []).filter((e) => e.pending && !run.events.some((s) => s.id === e.id));
  runs.set(run.id, { ...run, events: [...run.events, ...pending] });
  emit();
}

/** A run started with no signal: the device's own copy until the server has it. */
export function putLocalRun(run: EmsRun): void {
  runs.set(run.id, { ...run, events: [] });
  emit();
}

/** An entry that is queued, not sent: show it now, marked pending. */
export function addPendingEvent(runId: string, body: AddEmsRunEventBody, recordedBy: string, destinationName?: string): void {
  const run = runs.get(runId);
  if (!run) return;
  const event: LocalEvent = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    run_id: runId,
    kind: body.kind,
    occurred_at: body.occurred_at ?? new Date().toISOString(),
    recorded_by: recordedBy,
    payload: body.payload ?? null,
    pending: true,
  };
  runs.set(runId, {
    ...run,
    status: nextStatus(run.status, body.kind),
    ...(body.destination_facility_id ? { destination_facility_id: body.destination_facility_id, destination_name: destinationName ?? run.destination_name } : {}),
    events: [...run.events, event],
  });
  emit();
}

export function useLocalRun(runId: string): LocalRun | undefined {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => runs.get(runId),
  );
}

/** Forget every run (sign-out). */
export function clearLocalRuns(): void {
  runs.clear();
  emit();
}
