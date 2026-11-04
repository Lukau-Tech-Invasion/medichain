/**
 * One task in a work queue: who it is for, what it is, how urgent, and the
 * single action that opens it with the patient and record already loaded.
 *
 * The whole row is the target (≥ 56 px) and is a real link or button, so a
 * queue is navigable by keyboard and reads as a list of tasks to a screen
 * reader. The patient is named by two identifiers — name and date of birth or
 * health ID — because a queue is exactly where two patients with one name sit
 * side by side (Joint Commission NPSG.01.01.01).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export type QueueUrgency = 'critical' | 'urgent' | 'routine';

const URGENCY: Record<QueueUrgency, string> = {
  critical: 'border-l-critical',
  urgent: 'border-l-caution',
  routine: 'border-l-border',
};

export interface WorkQueueItemProps {
  title: string;
  patientName?: string;
  /** The second identifier: date of birth or health ID. */
  patientDetail?: string;
  /** When it is due or how long it has waited, already formatted. */
  when?: string;
  urgency?: QueueUrgency;
  /** A short visible word for the urgency (colour is never the only carrier). */
  urgencyLabel?: string;
  meta?: ReactNode;
  to?: string;
  state?: unknown;
  onOpen?: () => void;
}

export function WorkQueueItem({ title, patientName, patientDetail, when, urgency = 'routine', urgencyLabel, meta, to, state, onOpen }: WorkQueueItemProps) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          {urgencyLabel && urgency !== 'routine' && (
            <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${urgency === 'critical' ? 'bg-critical-subtle text-critical-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'}`}>
              {urgencyLabel}
            </span>
          )}
          <span className="font-semibold text-content">{title}</span>
        </span>
        {(patientName || patientDetail) && (
          <span className="mt-0.5 block text-sm text-content-secondary">
            {patientName}{patientName && patientDetail ? ' · ' : ''}{patientDetail}
          </span>
        )}
        {meta && <span className="mt-0.5 block text-sm text-content-muted">{meta}</span>}
      </span>
      {when && <span className="shrink-0 text-sm tabular-nums text-content-muted">{when}</span>}
      <ChevronRight className="h-5 w-5 shrink-0 text-content-muted" aria-hidden="true" />
    </>
  );
  const className = `mc-press flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-border border-l-4 ${URGENCY[urgency]} bg-surface px-4 py-3 text-left hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus`;
  if (to) return <Link to={to} state={state} onClick={onOpen} className={className}>{body}</Link>;
  return <button type="button" onClick={onOpen} className={className}>{body}</button>;
}
