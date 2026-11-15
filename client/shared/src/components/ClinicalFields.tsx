/**
 * Small controls clinical forms kept rebuilding by hand.
 *
 * `NumberField` — a measurement. `type="text"` with `inputMode` rather than
 * `type="number"`: a number input silently drops what it cannot parse ("12,5"
 * reads as empty), changes value on a scroll wheel, and shows spinners nobody
 * uses. `inputMode` still brings up the numeric keypad on a phone. The value
 * stays the string the person typed; the form decides what an empty field
 * means (rule 9: absent, never 0).
 *
 * `NowButton` — fills a time field with the current time in one tap. Most
 * charted times are "now"; typing a datetime on a tablet is six fields.
 */
import { forwardRef, type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Clock } from 'lucide-react';
import { useFieldA11y, fieldBorderClass, FIELD_BASE_CLASS } from './field';
import { FieldLabel, FieldError, FieldHelp } from './FieldParts';
import { useTranslation } from '../i18n/react';

// ux-allow(no-form): a field component; the page that uses it supplies the <form>.

export interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown after the value, and read with the label ("Heart rate, beats per minute"). */
  unit?: string;
  /** Whole numbers only (counts, mmHg); decimals otherwise (temperature, mmol/L). */
  integer?: boolean;
  error?: string;
  helperText?: string;
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(
  ({ label, value, onChange, unit, integer, error, helperText, id, required, className, ...props }, ref) => {
    const field = useFieldA11y({ id, error, helperText, required });
    const pattern = integer ? '^-?[0-9]*$' : '^-?[0-9]*[.,]?[0-9]*$';
    return (
      <div className="w-full">
        <FieldLabel htmlFor={field.controlId} required={required}>
          {label}
          {unit && <span className="sr-only">, {unit}</span>}
        </FieldLabel>
        <div className="relative">
          <input
            ref={ref}
            type="text"
            inputMode={integer ? 'numeric' : 'decimal'}
            autoComplete="off"
            value={value}
            onChange={(e) => {
              const next = e.target.value.trim();
              if (next === '' || new RegExp(pattern).test(next)) onChange(next.replace(',', '.'));
            }}
            required={required}
            className={clsx(FIELD_BASE_CLASS, fieldBorderClass(Boolean(error)), 'tabular-nums', unit && 'pr-16', className)}
            {...field.controlProps}
            {...props}
          />
          {unit && (
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-content-muted">
              {unit}
            </span>
          )}
        </div>
        {error && field.errorId && <FieldError id={field.errorId}>{error}</FieldError>}
        {helperText && !error && field.helperId && <FieldHelp id={field.helperId}>{helperText}</FieldHelp>}
      </div>
    );
  },
);
NumberField.displayName = 'NumberField';

/** The current local time in the format a `datetime-local` (or `time`) input takes. */
export function localNow(kind: 'datetime-local' | 'time' | 'date' = 'datetime-local', now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (kind === 'date') return date;
  if (kind === 'time') return time;
  return `${date}T${time}`;
}

export function NowButton({ onNow, kind = 'datetime-local', label }: {
  onNow: (value: string) => void;
  kind?: 'datetime-local' | 'time' | 'date';
  /** Names the field, so several Now buttons on one form are distinguishable to a screen reader. */
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => onNow(localNow(kind))}
      aria-label={label ? t('kit.nowFor', { field: label }) : t('kit.now')}
      className="mc-press inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border-interactive px-3 text-sm font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <Clock className="h-4 w-4" aria-hidden="true" />
      {kind === 'date' ? t('kit.today') : t('kit.now')}
    </button>
  );
}
