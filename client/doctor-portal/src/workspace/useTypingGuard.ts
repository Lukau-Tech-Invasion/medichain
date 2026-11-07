/**
 * Unsaved work in any workspace form, without the form knowing.
 *
 * Twelve forms keep a full draft of their fields (`useDraftFields`); the rest
 * of the forty-odd do not. For those, typing into the open form marks it as
 * unsaved, so the leave-page warning and "Close patient" (mockup c5) both catch
 * it; a save the server accepts, or opening another form, clears it. It cannot
 * restore what was typed -- only a form's own draft can -- but it stops the
 * work being lost without a word.
 */
import { useEffect, useState, type RefObject } from 'react';
import { getApiClient, keepsOwnDraft, useUnsavedChanges } from '@medichain/shared';

export function useTypingGuard(
  area: RefObject<HTMLElement>,
  formId: string | undefined,
  label: string,
  /** Mutations that are not the form being saved (notifications, scoring previews). */
  notASave: RegExp,
  /** Changes when the form on screen is thrown away and remounted empty. */
  resetKey?: unknown,
): void {
  const [typed, setTyped] = useState(false);

  // A different form, none, or the same one emptied: nothing typed there yet.
  useEffect(() => setTyped(false), [formId, resetKey]);

  useEffect(() => {
    const el = area.current;
    if (!el || !formId) return undefined;
    const onInput = (event: Event) => {
      // Only forms that keep no draft of their own; React state changes do not
      // dispatch input events, so what arrives here is the person's typing.
      if (keepsOwnDraft(formId)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="search"], input[type="search"]')) return;
      setTyped(true);
    };
    el.addEventListener('input', onInput, true);
    el.addEventListener('change', onInput, true);
    return () => {
      el.removeEventListener('input', onInput, true);
      el.removeEventListener('change', onInput, true);
    };
  }, [area, formId]);

  useEffect(() => getApiClient().onMutationSucceeded(({ path }) => {
    if (!notASave.test(path)) setTyped(false);
  }), [notASave]);

  useUnsavedChanges(typed, label);
}
