import { useId, useState, type ComponentType } from 'react';
import { BedDouble, Clock, HeartPulse, Loader2, ShieldAlert, UserX, Users } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { breakGlass } from '../api/endpoints';

/** Shortest reason the API accepts, in characters. */
const MIN_REASON_CHARS = 10;
/** Longest reason the API accepts, in characters. */
const MAX_REASON_CHARS = 500;

/**
 * The reasons a clinician taps (mockup c1). Each is sent as the reason text
 * itself, so the API's length rule, the patient's notice and the audit row
 * are exactly what a typed reason produces -- these are just reasons nobody
 * has to type in an emergency.
 */
const PRESETS: Array<{ key: string; icon: ComponentType<{ className?: string }> }> = [
  { key: 'breakGlass.presetUnconscious', icon: BedDouble },
  { key: 'breakGlass.presetLifeThreatening', icon: HeartPulse },
  { key: 'breakGlass.presetClinicianUnavailable', icon: UserX },
  { key: 'breakGlass.presetMassCasualty', icon: Users },
];

interface Props {
  patientId: string;
  /** Called once access is granted, so the page can load the chart. */
  onOpened: () => void;
}

/**
 * Break-glass (WP9, mockup c1): shown when a chart read is refused for lack
 * of a care relationship. One tap on a reason opens the chart; another reason
 * can still be written. The patient is told at once, the access is
 * time-limited, and everything read under it is marked as emergency access in
 * the patient's history.
 */
export function BreakGlassPanel({ patientId, onOpened }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const headingId = useId();
  const [reason, setReason] = useState('');
  // Which reason is being sent: a preset's key, 'typed', or null when idle.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const send = async (text: string, which: string) => {
    if (busy) return;
    setBusy(which);
    setError('');
    try {
      await breakGlass(patientId, text);
      onOpened();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('breakGlass.failed'));
    } finally {
      setBusy(null);
    }
  };

  const submitTyped = (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < MIN_REASON_CHARS) {
      // Said in words, not by a greyed-out button that cannot say why.
      setError(t('breakGlass.reasonTooShort', { min: String(MIN_REASON_CHARS) }));
      return;
    }
    void send(reason.trim(), 'typed');
  };

  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-xl space-y-4">
      <div>
        <h2 id={headingId} className="flex items-center gap-2 text-2xl font-bold text-content">
          <ShieldAlert className="h-7 w-7 text-critical-subtle-fg" aria-hidden="true" />
          {t('breakGlass.heading')}
        </h2>
        <p className="mt-1 text-content-secondary">{t('breakGlass.tapReason')}</p>
      </div>

      <div className="space-y-3">
        {PRESETS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => void send(t(key), key)}
            aria-disabled={busy !== null || undefined}
            className="flex min-h-[64px] w-full items-center gap-4 rounded-2xl border-2 border-critical bg-critical-subtle px-4 py-3 text-left text-lg font-semibold text-critical-subtle-fg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 aria-disabled:cursor-wait"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/20" aria-hidden="true">
              {busy === key ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
            </span>
            {t(key)}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-critical-subtle-fg">{error}</p>}

      <p className="flex gap-2 text-sm text-content-muted">
        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('breakGlass.whatHappens')}
      </p>

      <details className="rounded-2xl border border-border bg-surface px-4 py-3">
        <summary className="cursor-pointer font-semibold text-content">{t('breakGlass.otherReason')}</summary>
        <form onSubmit={submitTyped} className="mt-3 space-y-2">
          <label htmlFor={id} className="block text-sm font-medium text-content">
            {t('breakGlass.reasonLabel')}
          </label>
          <textarea
            id={id}
            value={reason}
            maxLength={MAX_REASON_CHARS}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border-interactive bg-surface p-2 text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          <p className="text-xs text-content-muted">{t('breakGlass.reasonHint', { min: String(MIN_REASON_CHARS) })}</p>
          <button
            type="submit"
            aria-disabled={busy !== null || undefined}
            className="flex min-h-[44px] items-center gap-2 rounded-md bg-critical px-3 py-2 text-sm font-medium text-critical-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 aria-disabled:cursor-wait"
          >
            {busy === 'typed' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('breakGlass.submit')}
          </button>
        </form>
      </details>
    </section>
  );
}
