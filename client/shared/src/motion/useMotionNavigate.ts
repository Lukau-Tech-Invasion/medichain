/**
 * Navigate with a View Transition when the browser can and the user allows it.
 *
 * React Router 6.30 offers `viewTransition` only with a data router; both apps
 * use `<BrowserRouter>`, so this calls the browser API directly. MDN is explicit
 * that `startViewTransition` does NOT skip itself for `prefers-reduced-motion`
 * (library: `frontend-motion-and-animation.md` §9) -- checked here, and
 * `motion.css` also turns the transition groups off under that preference.
 */
import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

/** True when the user asked the operating system to reduce motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Run `update` inside a View Transition when allowed; otherwise immediately. */
export function withViewTransition(update: () => void): void {
  const doc = typeof document === 'undefined' ? undefined : (document as ViewTransitionDocument);
  if (!doc?.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

export function useMotionNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to: To, options?: NavigateOptions) => withViewTransition(() => navigate(to, options)),
    [navigate],
  );
}
