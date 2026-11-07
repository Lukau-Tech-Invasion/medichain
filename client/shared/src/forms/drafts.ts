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
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiClient } from '../api/client';
import { useUnsavedChanges } from './unsavedChanges';

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
  // Restored once per form-and-patient, not once per mount: a page inside the
  // workspace learns its patient a render after it mounts, and a draft looked
  // up before then is looked up under no patient at all.
  // On screen, this form keeps its own draft: the workspace typing guard stands aside.
  useEffect(() => {
    keepingOwnDraft.set(formId, (keepingOwnDraft.get(formId) ?? 0) + 1);
    return () => {
      keepingOwnDraft.set(formId, (keepingOwnDraft.get(formId) ?? 1) - 1);
    };
  }, [formId]);
  const restoredFor = useRef<string | null>(null);
  const key = `${formId}|${patientId ?? '-'}`;
  useEffect(() => {
    if (restoredFor.current === key) return;
    restoredFor.current = key;
    const draft = readDraft<T>(formId, patientId);
    if (draft !== undefined) restore(draft);
    // Keyed on the form and patient only: a restore on any other change would
    // overwrite what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (restoredFor.current !== key) return;
    if (dirty) writeDraft(formId, patientId, value);
    else clearDraft(formId, patientId);
  }, [formId, patientId, key, value, dirty]);
}

/** Forms on screen that keep their own draft (see `useDraftFields`). */
const keepingOwnDraft = new Map<string, number>();

/**
 * Whether the form `formId` is on screen and keeps its own draft. The patient
 * workspace's generic typing guard stands aside for these, so a form is never
 * counted as unsaved twice.
 */
export function keepsOwnDraft(formId: string): boolean {
  return (keepingOwnDraft.get(formId) ?? 0) > 0;
}

/** One field of a form: its value and its setter, as `useState` returns them. */
export type DraftField = readonly [unknown, (value: never) => void];

/**
 * The chosen keys of a form held as one state object, as draft fields. Leave
 * out the patient and anything the form fills in by itself, or choosing a
 * patient alone would count as unsaved work.
 */
export function draftFieldsOf<T extends object, K extends keyof T>(
  value: T,
  set: (update: (prev: T) => T) => void,
  keys: readonly K[],
): Record<string, DraftField> {
  return Object.fromEntries(keys.map((k) => [
    String(k),
    [value[k], (v: T[K]) => set((prev) => ({ ...prev, [k]: v }))] as const,
  ]));
}

/**
 * Draft-keeping for a form whose fields are separate `useState`s: list them
 * once and the form keeps a draft for this tab, warns before a link discards
 * it, and is named by "Close patient". A field counts as changed when it
 * differs from what the form first rendered with, so nothing is "dirty" until
 * the clinician types.
 *
 * Call `markSaved()` after a successful save: the values on screen become the
 * new starting point and the draft is dropped.
 */
export function useDraftFields(
  formId: string,
  patientId: string | undefined,
  label: string,
  fields: Record<string, DraftField>,
): { dirty: boolean; markSaved: () => void } {
  const values = Object.fromEntries(Object.entries(fields).map(([k, [v]]) => [k, v]));
  const serial = JSON.stringify(values);
  const baseline = useRef<string | null>(null);
  // After a save the form usually clears itself in the same handler; the
  // values to compare against are the ones that render shows, not these.
  const savedPending = useRef(false);
  // A save with nothing else to re-render still needs one, to adopt its values.
  const [, rerender] = useState(0);
  if (baseline.current === null || savedPending.current) {
    baseline.current = serial;
    savedPending.current = false;
  }
  const dirty = serial !== baseline.current;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  useFormDraft<Record<string, unknown>>(formId, patientId, values, dirty, (draft) => {
    for (const [k, [, set]] of Object.entries(fieldsRef.current)) {
      if (k in draft) (set as (v: unknown) => void)(draft[k]);
    }
  });
  useUnsavedChanges(dirty, label, { keptAsDraft: true });
  const markSaved = useCallback(() => {
    savedPending.current = true;
    clearDraft(formId, patientId);
    rerender((n) => n + 1);
  }, [formId, patientId]);
  return { dirty, markSaved };
}
