/**
 * Navigate with a View Transition when the browser can.
 *
 * React Router 6.30 offers `viewTransition` only with a data router; both apps
 * use `<BrowserRouter>`, so this calls the browser API directly. MDN is explicit
 * that `startViewTransition` does NOT skip itself for `prefers-reduced-motion`
 * (library: `frontend-motion-and-animation.md` §9); `motion.css` handles it:
 * under that preference every transition is a 150 ms fade, with nothing
 * moving -- a substitute, not a deletion (c10).
 *
 * Opening a patient keeps one thing constant across the change of page: the
 * tapped row's name and avatar glide into the chart's banner, which carries the
 * same `view-transition-name` (`.mc-patient-identity`). The row is tagged only
 * for the length of the transition -- two elements with one name on the same
 * page would abort it.
 */
import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';

type ViewTransition = { finished: Promise<unknown> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransition;
};

/** The name the chart banner's identity carries; a source row borrows it. */
export const PATIENT_IDENTITY_TRANSITION = 'patient-identity';

/** True when the user asked the operating system to reduce motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Run `update` inside a View Transition when the browser has them; otherwise
 * immediately. `shared`, when given, is the element the next page's identity
 * grows out of.
 */
export function withViewTransition(update: () => void, shared?: HTMLElement | null): void {
  const doc = typeof document === 'undefined' ? undefined : (document as ViewTransitionDocument);
  if (!doc?.startViewTransition) {
    update();
    return;
  }
  // The banner already on screen (switching patients inside a chart) keeps the
  // name itself; a second element with it would abort the transition.
  const borrow = shared && !doc.querySelector('.mc-patient-identity') ? shared : null;
  if (borrow) borrow.style.setProperty('view-transition-name', PATIENT_IDENTITY_TRANSITION);
  const untag = () => borrow?.style.removeProperty('view-transition-name');
  try {
    const transition = doc.startViewTransition(() => flushSync(update));
    transition.finished.then(untag, untag);
  } catch {
    untag();
    update();
  }
}

export function useMotionNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to: To, options?: NavigateOptions & { shared?: HTMLElement | null }) => {
      const { shared, ...rest } = options ?? {};
      withViewTransition(() => navigate(to, rest), shared);
    },
    [navigate],
  );
}
