/**
 * Work on the open patient not yet saved: the form on screen with unsaved
 * changes, and every draft kept for another form. Shared by "Close patient"
 * (each with Save and Discard) and "This visit" (listed as "Not saved yet"),
 * so the two never disagree about what would be lost.
 */
export interface PendingWork {
  key: string;
  label: string;
  formId?: string;
  onScreen: boolean;
}

export function pendingWork(input: {
  /** Forms holding a draft for this patient. */
  drafts: string[];
  /** Labels of forms registered as having unsaved changes. */
  unsaved: string[];
  /** The form on screen, if any. */
  currentForm?: string;
  labelOf: (formId: string) => string;
  /** The on-screen work was just thrown away. */
  onScreenDiscarded?: boolean;
}): PendingWork[] {
  const { drafts, unsaved, currentForm, labelOf } = input;
  const elsewhere = drafts
    .filter((d) => d !== currentForm)
    .map((d) => ({ key: d, label: labelOf(d), formId: d, onScreen: false }));
  const draftOnScreen = currentForm !== undefined && drafts.includes(currentForm);
  if (input.onScreenDiscarded || (unsaved.length === 0 && !draftOnScreen)) return elsewhere;
  // The form on screen is named as the rail names it; its own registration and
  // the typing guard would otherwise name it twice ("SOAP note, SOAP Notes").
  const label = currentForm ? labelOf(currentForm) : [...new Set(unsaved)].join(', ');
  return [{ key: `on-screen-${currentForm ?? ''}`, label, formId: currentForm, onScreen: true }, ...elsewhere];
}
