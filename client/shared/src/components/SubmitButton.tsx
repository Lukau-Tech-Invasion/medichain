/**
 * Save, showing what the submission is doing.
 *
 * Never disabled to signal "invalid": a disabled button cannot say why, has poor
 * contrast and cannot be focused (GOV.UK Design System guidance). It is
 * `aria-disabled` only while a request is in flight, so a second press is
 * refused by `useSubmission` rather than by a control the user cannot inspect.
 */
import { Check, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import type { SubmissionStatus } from '../forms/submission';
import { useTranslation } from '../i18n/react';

export interface SubmitButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  status: SubmissionStatus;
  /** The verb, e.g. "Save vital signs". */
  label: string;
}

export function SubmitButton({ status, label, className = '', ...rest }: SubmitButtonProps) {
  const { t } = useTranslation();
  const saving = status === 'saving';
  const saved = status === 'saved' || status === 'duplicate';
  return (
    <button
      type="submit"
      aria-disabled={saving || undefined}
      className={`mc-press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-5 py-2 font-semibold ${
        saved ? 'border border-ok bg-ok-subtle text-ok-subtle-fg' : 'bg-brand text-brand-fg hover:bg-brand-hover'
      } focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ${className}`}
      {...rest}
    >
      {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {saved && <Check className="mc-pop h-4 w-4" aria-hidden="true" />}
      <span aria-live="polite">{saving ? t('common.saving') : saved ? t('forms.saved') : label}</span>
    </button>
  );
}
