/**
 * A form's unsent content, kept while the user moves around the app.
 *
 * Memory only, by decision: a draft can hold clinical findings, and nothing
 * about a patient is left in browser storage. It survives navigation inside the
 * tab (including the Back button, which the router cannot intercept) and is gone
 * on reload, sign-out, or once saved.
 *
 * Keyed by the signed-in account, the patient and the form, so one clinician's
 * half-written note never appears for another account or another patient.
 */
import { useEffect, useRef } from 'react';
import { getApiClient } from '../api/client';

const drafts = new Map<string, unknown>();

function draftKey(formId: string, patientId: string | undefined): string {
  return `${getApiClient().getUserId() ?? 'anonymous'}|${patientId ?? '-'}|${formId}`;
}

export function readDraft<T>(formId: string, patientId?: string): T | undefined {
  return drafts.get(draftKey(formId, patientId)) as T | undefined;
}

export function writeDraft(formId: string, patientId: string | undefined, value: unknown): void {
  drafts.set(draftKey(formId, patientId), value);
}

export function clearDraft(formId: string, patientId?: string): void {
  drafts.delete(draftKey(formId, patientId));
}

/** Every draft held for `patientId` by the signed-in account (for "Close patient"). */
export function draftsForPatient(patientId: string): string[] {
  const prefix = `${getApiClient().getUserId() ?? 'anonymous'}|${patientId}|`;
  return [...drafts.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

/** Forget every draft (sign-out). */
export function clearAllDrafts(): void {
  drafts.clear();
}

/**
 * Keep `value` as this form's draft while `dirty`; on mount, hand back a stored
 * draft through `restore` once.
 */
export function useFormDraft<T>(
  formId: string,
  patientId: string | undefined,
  value: T,
  dirty: boolean,
  restore: (draft: T) => void,
): void {
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const draft = readDraft<T>(formId, patientId);
    if (draft !== undefined) restore(draft);
    // Mount-only by design: a later restore would overwrite what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    if (dirty) writeDraft(formId, patientId, value);
    else clearDraft(formId, patientId);
  }, [formId, patientId, value, dirty]);
}
