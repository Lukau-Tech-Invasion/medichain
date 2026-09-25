import type { KeyboardEvent } from 'react';

/**
 * Make a non-button element behave like a button for a keyboard user.
 *
 * A `<div onClick={...}>` is invisible to the keyboard: it takes no focus, and
 * Enter and Space do nothing. WCAG 2.2 SC 2.1.1 (Keyboard) is Level A, and this
 * is the most common way to fail it — 17 controls in the doctor portal alone,
 * including patient and staff pickers.
 *
 * **A real `<button>` is still better.** It brings focus, activation, the
 * correct role and form semantics for free, and needs none of this. Use this
 * only where converting the element would change layout in a way that is not
 * worth the churn — a wrapper row whose children include their own controls,
 * for instance, since a button may not contain a button.
 *
 * Returns the four props the remediation needs, so they cannot be applied
 * half-way:
 *
 *   role="button"   the element announces as a control
 *   tabIndex={0}    it can be reached
 *   onClick         pointer activation
 *   onKeyDown       Enter and Space, which is what a button responds to
 *
 * Space is `preventDefault`ed because its default action is to scroll the page,
 * which would otherwise fire the handler *and* jump the viewport.
 */
export function clickable(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    },
  };
}
