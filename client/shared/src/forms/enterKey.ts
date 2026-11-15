import type { KeyboardEvent } from 'react';

/**
 * Keep Enter in a single-line field from submitting a builder form.
 *
 * A form that is built up piece by piece (diagnoses, goals, patients in a
 * handover) has small "add" fields inside the one form that saves the whole.
 * Enter in one of those must not file the record half-written. Put this on the
 * form's `onKeyDown`: Enter in an `<input>` is swallowed; textareas keep their
 * newline, and the save button still submits.
 */
export function keepEnterInField(event: KeyboardEvent<HTMLElement>): void {
  const target = event.target as HTMLElement;
  if (event.key === 'Enter' && target.tagName === 'INPUT') event.preventDefault();
}
