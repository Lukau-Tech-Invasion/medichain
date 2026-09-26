import { useId, useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { breakGlass } from '../api/endpoints';

/** Shortest reason the API accepts, in characters. */
const MIN_REASON_CHARS = 10;
/** Longest reason the API accepts, in characters. */
const MAX_REASON_CHARS = 500;

interface Props {
  patientId: string;
  /** Called once access is granted, so the page can load the chart. */
  onOpened: () => void;
}

/**
 * Break-glass (WP9): shown when a chart read is refused for lack of a care
 * relationship. The clinician states why; the patient is told at once, the
 * access is time-limited, and everything read under it is marked as
 * emergency access in the patient's history.
 */
export function BreakGlassPanel({ patientId, onOpened }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const length = reason.trim().length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await breakGlass(patientId, reason.trim());
      onOpened();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('breakGlass.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-3 rounded-lg border border-caution bg-surface p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-content">
        <ShieldAlert className="h-5 w-5 text-caution-subtle-fg" aria-hidden="true" />
        {t('breakGlass.title')}
      </h2>
      <p className="text-sm text-content-secondary">{t('breakGlass.explainer')}</p>
      <label htmlFor={id} className="block text-sm font-medium text-content">
        {t('breakGlass.reasonLabel')}
      </label>
      <textarea
        id={id}
        value={reason}
        maxLength={MAX_REASON_CHARS}
        rows={3}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-md border border-border bg-surface p-2 text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      <p className="text-xs text-content-muted">{t('breakGlass.reasonHint', { min: String(MIN_REASON_CHARS) })}</p>
      {error && <p role="alert" className="text-sm text-critical-subtle-fg">{error}</p>}
      <button
        type="submit"
        disabled={busy || length < MIN_REASON_CHARS}
        className="flex items-center gap-2 rounded-md bg-critical px-3 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {t('breakGlass.submit')}
      </button>
    </form>
  );
}
