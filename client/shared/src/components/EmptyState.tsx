/**
 * EmptyState Component
 *
 * A consistent, accessible empty-state block for "no data yet" situations —
 * empty lists, no search results, missing optional records. Prefer this over
 * silently rendering nothing (which leaves the user unsure whether data is
 * loading, missing, or failed to load).
 */

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Optional icon shown above the title (e.g. a lucide icon). */
  icon?: ReactNode;
  /** Primary line — what is empty (e.g. "No allergies recorded"). */
  title: string;
  /** Optional supporting line with guidance or context. */
  description?: string;
  /** Optional action (button/link) to resolve the empty state. */
  action?: ReactNode;
  /** Tighter vertical padding for inline/section use. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-6' : 'py-12',
        className,
      )}
    >
      {icon && <div className="mb-3 text-neutral-300">{icon}</div>}
      <p className="font-medium text-neutral-700">{title}</p>
      {description && (
        <p className="mt-1 max-w-xs text-sm text-neutral-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
