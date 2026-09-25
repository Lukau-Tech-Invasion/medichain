/**
 * In-app replacements for `window.confirm` and `window.prompt`.
 *
 * # Why the native ones are not used
 *
 * A browser dialog is drawn by the browser, so it ignores the theme (a white
 * box over a dark page), cannot be read in context by a screen reader, and --
 * the reason this exists -- can be suppressed outright. Embedded browsers and
 * cross-origin frames answer `prompt()` with `null` without showing anything,
 * and every handler here reads `null` as "the user cancelled". So the
 * pharmacist's Dispense button did nothing at all: no dialog, no error, no
 * request. Seventeen controls across both applications were built that way.
 *
 * # Shape
 *
 * `confirmDialog` and `promptDialog` keep the native semantics -- a boolean,
 * and a string or `null` -- so a call site changes from `window.prompt(x)` to
 * `await promptDialog(x)` and nothing else about its validation moves.
 *
 * They are functions rather than a hook so the handlers that need them do not
 * have to be restructured to obtain one. Each application mounts one
 * `<DialogHost />` inside its i18n provider. When nothing is mounted -- a unit
 * test rendering a single page -- a host mounts itself on first use, so a test
 * drives the real dialog rather than a stubbed global.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from '../i18n/react';

export interface ConfirmDialogOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A destructive action: the confirm button is styled as one, and Cancel takes focus. */
  destructive?: boolean;
}

export interface PromptDialogOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: 'text' | 'number';
  defaultValue?: string;
  /** Refuse to submit an empty or whitespace-only answer. */
  required?: boolean;
}

type DialogRequest = { id: number } & (
  | { kind: 'confirm'; options: ConfirmDialogOptions; resolve: (answer: boolean) => void }
  | { kind: 'prompt'; options: PromptDialogOptions; resolve: (answer: string | null) => void }
);

// One dialog at a time; later requests wait their turn rather than stacking.
let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();
let mountedHosts = 0;
let selfMounted = false;
let nextId = 1;

function publish(next: DialogRequest[]): void {
  queue = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ensureHost(): void {
  if (mountedHosts > 0 || selfMounted || typeof document === 'undefined') return;
  selfMounted = true;
  const container = document.createElement('div');
  container.setAttribute('data-dialog-host', 'self-mounted');
  document.body.appendChild(container);
  createRoot(container).render(<DialogHost />);
}

function enqueue(request: DistributiveOmit<DialogRequest, 'id'>): void {
  ensureHost();
  publish([...queue, { ...request, id: nextId++ } as DialogRequest]);
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function settle(request: DialogRequest, answer: boolean | string | null): void {
  publish(queue.filter((pending) => pending !== request));
  if (request.kind === 'confirm') request.resolve(answer === true);
  else request.resolve(typeof answer === 'string' ? answer : null);
}

/** `window.confirm`, themed and accessible. Resolves `true` only on an explicit confirm. */
export function confirmDialog(options: ConfirmDialogOptions | string): Promise<boolean> {
  const resolved = typeof options === 'string' ? { message: options } : options;
  return new Promise((resolve) => enqueue({ kind: 'confirm', options: resolved, resolve }));
}

/** `window.prompt`, themed and accessible. Resolves `null` when cancelled. */
export function promptDialog(options: PromptDialogOptions | string): Promise<string | null> {
  const resolved = typeof options === 'string' ? { message: options } : options;
  return new Promise((resolve) => enqueue({ kind: 'prompt', options: resolved, resolve }));
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Keep Tab inside the dialog: behind it is a page the user cannot act on. */
function trapTab(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function ActiveDialog({ request }: { request: DialogRequest }) {
  const { t } = useTranslation();
  const titleId = useId();
  const messageId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { options } = request;
  const isPrompt = request.kind === 'prompt';
  const promptOptions = isPrompt ? (request.options as PromptDialogOptions) : null;
  const destructive = !isPrompt && (options as ConfirmDialogOptions).destructive === true;
  const [value, setValue] = useState(promptOptions?.defaultValue ?? '');
  const blocked = Boolean(promptOptions?.required) && value.trim() === '';

  // Focus goes where the user is expected to act, and returns to whatever
  // opened the dialog when it closes -- otherwise a keyboard user is dropped
  // at the top of the page.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const target = isPrompt ? inputRef.current : destructive ? cancelRef.current : confirmRef.current;
    target?.focus();
    return () => opener?.focus?.();
  }, [isPrompt, destructive]);

  const cancel = () => settle(request, isPrompt ? null : false);
  const submit = () => {
    if (blocked) return;
    settle(request, isPrompt ? value : true);
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" aria-hidden="true" onClick={cancel} />
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
        <div
          role={destructive ? 'alertdialog' : 'dialog'}
          aria-modal="true"
          aria-labelledby={options.title ? titleId : undefined}
          aria-describedby={messageId}
          aria-label={options.title ? undefined : options.message}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              cancel();
            }
            trapTab(event);
          }}
          className="pointer-events-auto w-full max-w-md rounded-xl border border-border bg-surface p-5 text-content shadow-xl"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {options.title && (
              <h2 id={titleId} className="mb-2 text-lg font-semibold text-content">
                {options.title}
              </h2>
            )}
            {isPrompt ? (
              <label id={messageId} className="block text-sm text-content-secondary">
                {options.message}
                <input
                  ref={inputRef}
                  type={promptOptions?.inputType ?? 'text'}
                  inputMode={promptOptions?.inputType === 'number' ? 'numeric' : undefined}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  required={promptOptions?.required}
                  className="mt-2 w-full rounded-lg border px-3 py-2"
                />
              </label>
            ) : (
              <p id={messageId} className="text-sm text-content-secondary">
                {options.message}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={cancel}
                className="rounded-lg border border-border-interactive px-4 py-2 text-sm text-content hover:bg-surface-sunken"
              >
                {options.cancelLabel ?? t('common.cancel')}
              </button>
              <button
                ref={confirmRef}
                type="submit"
                disabled={blocked}
                className={
                  destructive
                    ? 'rounded-lg bg-critical px-4 py-2 text-sm font-medium text-critical-fg disabled:bg-disabled disabled:text-disabled-fg'
                    : 'rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg disabled:bg-disabled disabled:text-disabled-fg'
                }
              >
                {options.confirmLabel ?? (isPrompt ? t('common.ok') : t('common.confirm'))}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

/**
 * Renders whichever dialog is at the head of the queue. Mount once per
 * application, inside the i18n provider so the default labels translate.
 */
export function DialogHost() {
  const pending = useSyncExternalStore(subscribe, () => queue, () => queue);

  useEffect(() => {
    mountedHosts += 1;
    return () => {
      mountedHosts -= 1;
    };
  }, []);

  const head = pending[0];
  // Keyed on the request so each dialog starts with fresh input state.
  return head ? <ActiveDialog key={head.id} request={head} /> : null;
}
