/**
 * The list of what stops a form saving, at the top, focused when Save fails.
 *
 * On a form several screens tall, a failed Save used to change nothing the user
 * could see: the message sat next to a field off-screen and focus stayed on the
 * button. GOV.UK and NHS forms solve this the same way -- a summary at the top
 * that receives focus, each entry a link to its field -- and the library's
 * forms note states the rule: say what to do, next to the problem
 * (`frontend-forms-and-validation.md` §5).
 */
import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from '../i18n/react';

export interface ErrorSummaryProps {
  /** Field id -> message. Entries without a matching element still show. */
  errors: Record<string, string | undefined>;
  /** Bumped by the form on every failed submit, so focus moves each time. */
  attempt: number;
  title?: string;
}

/** Move focus (and scroll) to the first field in `errors` that exists on the page. */
export function focusFirstInvalid(errors: Record<string, string | undefined>): boolean {
  for (const [id, message] of Object.entries(errors)) {
    if (!message) continue;
    const el = document.getElementById(id);
    if (el) {
      el.focus({ preventScroll: false });
      return true;
    }
  }
  return false;
}

export function ErrorSummary({ errors, attempt, title }: ErrorSummaryProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors).filter((entry): entry is [string, string] => Boolean(entry[1]));

  useEffect(() => {
    if (attempt > 0 && entries.length > 0) ref.current?.focus();
    // Focus follows a submit attempt, not every keystroke that changes `errors`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  if (entries.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby="error-summary-title"
      className="mc-enter rounded-lg border-2 border-critical bg-critical-subtle p-4 text-critical-subtle-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <h2 id="error-summary-title" className="flex items-center gap-2 font-semibold">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
        {title ?? t('forms.errorSummaryTitle')}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
        {entries.map(([id, message]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="underline underline-offset-2"
              onClick={(event) => {
                const el = document.getElementById(id);
                if (!el) return;
                event.preventDefault();
                el.focus();
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
