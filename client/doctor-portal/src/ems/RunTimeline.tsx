/**
 * A run's whole timeline and its crew line, shared by the receiving board and
 * the band the receiving team keeps above the chart.
 */
import { formatTimestamp, useTranslation } from '@medichain/shared';
import type { EmsRunWithEvents } from '@medichain/shared';
import { describeEvent, eventLabel } from './runSummary';

type Translate = (key: string, values?: Record<string, string>) => string;

/** "Unit 14 (P. Mokoena)", whichever parts the crew recorded; null when neither. */
export function crewLine(run: EmsRunWithEvents, t: Translate): string | null {
  const crew = run.crew.filter((c) => c.trim()).join(', ');
  if (run.unit_number) return crew ? `${t('ems.unit', { unit: run.unit_number })} (${crew})` : t('ems.unit', { unit: run.unit_number });
  return crew || null;
}

/** Every entry the crew made, oldest first -- the order a handover is told in. */
export function RunTimeline({ id, run }: { id: string; run: EmsRunWithEvents }) {
  const { t } = useTranslation();
  const ordered = [...run.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  return (
    <ol id={id} className="mt-2 space-y-1 border-l-2 border-border-strong pl-3 text-sm">
      {ordered.map((e) => (
        <li key={e.id}>
          <span className="mr-2 tabular-nums text-content-muted">{formatTimestamp(e.occurred_at, { timeStyle: 'short' })}</span>
          <span className="font-semibold text-content">{eventLabel(e, t)}</span>
          {describeEvent(e) && <span className="text-content-secondary"> · {describeEvent(e)}</span>}
        </li>
      ))}
    </ol>
  );
}
