import { useCallback, useRef, useState } from 'react';

/**
 * One write at a time per page.
 *
 * A second press while a save is in flight used to send a second request:
 * React state updates are asynchronous, so a `disabled={submitting}` button
 * still accepts the click that arrives before the re-render. The ref is
 * synchronous; `pending` is for the button.
 *
 * A blocked form submission still has its default prevented, or the browser
 * would navigate away on the second press.
 */
export function useSubmitGuard() {
  const running = useRef(false);
  const [pending, setPending] = useState(false);

  const guard = useCallback(
    <A extends unknown[]>(handler: (...args: A) => Promise<void> | void) =>
      async (...args: A): Promise<void> => {
        if (running.current) {
          (args[0] as { preventDefault?: () => void } | undefined)?.preventDefault?.();
          return;
        }
        running.current = true;
        setPending(true);
        try {
          await handler(...args);
        } finally {
          running.current = false;
          setPending(false);
        }
      },
    [],
  );

  return { pending, guard };
}
