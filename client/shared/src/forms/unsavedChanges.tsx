/**
 * "Leave without saving?" — for a router that cannot block navigation itself.
 *
 * # Why
 *
 * No page warned before a sidebar click or a refresh threw away a half-filled
 * form; a 30-field note was lost silently. Both apps use `<BrowserRouter>`,
 * where React Router's `useBlocker` is unavailable, so this guards the two ways
 * work is actually lost:
 *
 *  - an in-app link click: `NavigationGuard`, mounted once per app, catches the
 *    click in the capture phase and asks first;
 *  - a reload, tab close or external navigation: `beforeunload`.
 *
 * The browser's Back button cannot be intercepted without a data router;
 * `useFormDraft` keeps the content in memory so returning restores it.
 */
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirmDialog } from '../components/Dialog';
import { useTranslation } from '../i18n/react';

const dirtyForms = new Map<string, string>();
/** Registrations whose content survives moving around the app (a kept draft). */
const keptAsDraft = new Set<string>();

/** Unsaved forms a link click would lose: those that keep no draft. */
function lostOnNavigation(): string[] {
  return [...dirtyForms].filter(([id]) => !keptAsDraft.has(id)).map(([, label]) => label);
}
const listeners = new Set<() => void>();
let version = 0;
function changed(): void {
  version += 1;
  listeners.forEach((l) => l());
}

/** Labels of the forms with unsaved changes right now. */
export function unsavedForms(): string[] {
  return [...dirtyForms.values()];
}

/** Forget every registration (tests; sign-out after the user chose to discard). */
export function clearUnsavedForms(): void {
  dirtyForms.clear();
  keptAsDraft.clear();
  changed();
}

/** `unsavedForms`, re-rendering as forms gain or lose unsaved changes. */
export function useUnsavedFormLabels(): string[] {
  useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => version,
  );
  return unsavedForms();
}

/**
 * Register this form as holding unsaved changes while `dirty` is true.
 *
 * `keptAsDraft`: the form keeps a draft for the tab, so moving to another
 * screen loses nothing and is not interrupted; a reload or closing the tab
 * still is, because a draft lives in memory only.
 */
export function useUnsavedChanges(dirty: boolean, label: string, options?: { keptAsDraft?: boolean }): void {
  const id = useId();
  const kept = options?.keptAsDraft ?? false;
  useEffect(() => {
    if (dirty) dirtyForms.set(id, label);
    else dirtyForms.delete(id);
    if (dirty && kept) keptAsDraft.add(id);
    else keptAsDraft.delete(id);
    changed();
    return () => {
      dirtyForms.delete(id);
      keptAsDraft.delete(id);
      changed();
    };
  }, [dirty, id, label, kept]);
}

/** Ask before discarding unsaved work; true when the user chose to leave. */
export async function confirmLeave(message: string, title: string, leave: string, stay: string): Promise<boolean> {
  if (dirtyForms.size === 0) return true;
  const ok = await confirmDialog({ title, message, confirmLabel: leave, cancelLabel: stay, destructive: true });
  if (ok) clearUnsavedForms();
  return ok;
}

function internalTarget(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const here = window.location.pathname + window.location.search;
  const there = url.pathname + url.search + url.hash;
  return there === here ? null : there;
}

/** Mount once inside the router: asks before a link click discards a dirty form. */
export function NavigationGuard({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const asking = useRef(false);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const losing = lostOnNavigation();
      if (losing.length === 0 || asking.current) return;
      const target = internalTarget(event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      asking.current = true;
      const names = losing.join(', ');
      void confirmLeave(
        t('forms.leaveMessage', { forms: names }),
        t('forms.leaveTitle'),
        t('forms.leaveConfirm'),
        t('forms.leaveStay'),
      ).then((leave) => {
        asking.current = false;
        if (leave) navigate(target.replace(import.meta.env?.BASE_URL?.replace(/\/$/, '') ?? '', '') || '/');
      });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyForms.size === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [navigate, t]);

  return <>{children}</>;
}
