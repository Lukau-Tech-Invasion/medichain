import { ShieldAlert } from 'lucide-react';

interface RestrictedSectionProps {
  /** What the reader tried to open, e.g. "System administration". */
  title: string;
  /** Which role the section belongs to, e.g. "administrators". */
  audience: string;
  /** The role the current user actually holds, when known. */
  currentRole?: string;
}

/**
 * Explain that a section is restricted, instead of painting a blank page.
 *
 * Several administrator-only screens correctly received a 403 and then rendered
 * nothing at all — a reader could not tell a permissions boundary from a broken
 * page, and would reasonably retry or report a fault. Naming the restriction and
 * the role that holds it is both kinder and less noisy than a silent empty
 * screen or a generic "failed to load".
 */
export function RestrictedSection({ title, audience, currentRole }: RestrictedSectionProps) {
  return (
    <div className="p-8">
      <div
        role="status"
        className="mx-auto flex max-w-xl items-start gap-4 rounded-lg border border-amber-300 bg-amber-50 p-6 dark:border-amber-700 dark:bg-amber-950"
      >
        <ShieldAlert className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-100">
            {title} is restricted to {audience}
          </h2>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
            {currentRole
              ? `You are signed in as ${currentRole}, which cannot open this section.`
              : 'Your role cannot open this section.'}{' '}
            Ask an administrator if you need access.
          </p>
        </div>
      </div>
    </div>
  );
}
