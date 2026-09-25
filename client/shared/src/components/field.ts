import { useId } from 'react';

/**
 * The accessibility wiring every form control needs, in one place.
 *
 * `Input`, `Select` and `Textarea` each rendered a label, an error and a
 * control, and each wired them slightly differently — which is how three
 * components ended up sharing the same three defects:
 *
 *  1. **The id came from the label text.** `label.toLowerCase().replace(/\s+/g,'-')`
 *     means two fields labelled "Name" on one page produce the same DOM id, and
 *     `htmlFor` resolves to whichever rendered first. Clicking the second label
 *     focuses the first input. `useId()` is stable across renders and unique per
 *     instance, which is what the attribute needs.
 *
 *  2. **The error was adjacent but not associated.** A `<p>` under the input is
 *     visually next to it and, to a screen reader, unrelated to it. WCAG 3.3.1
 *     (Error Identification) and 1.3.1 (Info and Relationships) want the
 *     relationship to be programmatically determinable: `aria-describedby`
 *     pointing at the message, and `aria-invalid` on the control.
 *
 *  3. **Nothing announced.** An error that appears after submit is never spoken
 *     unless it lands in a live region.
 *
 * Returning the attributes rather than rendering them keeps this usable from
 * any control — including ones this file does not know about.
 */
export interface FieldA11y {
  /** Unique id for the control; pass to `id` and the label's `htmlFor`. */
  controlId: string;
  /** Props to spread onto the control itself. */
  controlProps: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
    'aria-required': boolean | undefined;
  };
  /** Id for the error element, or undefined when there is no error. */
  errorId: string | undefined;
  /** Id for the helper element, or undefined when there is none. */
  helperId: string | undefined;
}

export function useFieldA11y(options: {
  id?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
}): FieldA11y {
  const generated = useId();
  const controlId = options.id ?? `field-${generated}`;
  const errorId = options.error ? `${controlId}-error` : undefined;
  const helperId = options.helperText && !options.error ? `${controlId}-help` : undefined;

  // Both are listed when both exist. `aria-describedby` takes a space-separated
  // list, and a user who reaches an invalid field still wants the instruction
  // that would have prevented the error.
  const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;

  return {
    controlId,
    controlProps: {
      id: controlId,
      'aria-invalid': options.error ? true : undefined,
      'aria-describedby': describedBy,
      'aria-required': options.required ? true : undefined,
    },
    errorId,
    helperId,
  };
}

/**
 * Border classes for a control, by state.
 *
 * `border-red-500` survived the token migration untouched here. It is a fixed
 * palette shade with no dark value, so an invalid field in dark mode kept a
 * light-mode red edge. `border-critical` carries both.
 */
export function fieldBorderClass(hasError: boolean): string {
  return hasError
    ? 'border-critical focus:ring-critical focus:border-critical'
    : 'border-border-interactive focus:ring-focus focus:border-focus';
}

/**
 * Base control classes shared by input, select and textarea.
 *
 * `text-base` is not cosmetic: iOS Safari zooms the viewport when a focused
 * input has a font-size below 16px, which leaves the user zoomed in and
 * scrolled sideways with no obvious way back. 1rem fixes a legibility problem
 * and a layout bug at once.
 */
export const FIELD_BASE_CLASS =
  'w-full px-4 py-2 text-base border rounded-lg transition-colors ' +
  'focus:outline-none focus:ring-2 ' +
  'disabled:bg-disabled disabled:text-disabled-fg disabled:cursor-not-allowed';
