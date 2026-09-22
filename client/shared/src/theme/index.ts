/**
 * The one place that decides whether the interface is dark.
 *
 * # Why this is shared
 *
 * The two applications disagreed about what a theme even was. The doctor
 * portal had a real store that toggled `dark` on `<html>`; the patient app had
 * a switch on its Settings page that flipped a boolean in component state,
 * saved it to the server, and **never applied anything** — there was not a
 * single `classList` call in the whole application. So a patient could turn
 * dark mode on, watch the switch move, and see nothing change, for ever.
 *
 * `darkMode: 'class'` is configured in both Tailwind configs, so the entire
 * dark palette in both applications hangs off one class on one element. That
 * makes this small and makes getting it wrong total.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

/** The key both applications persist the preference under. */
export const THEME_STORAGE_KEY = 'medichain-theme-preference';

/** What the operating system is currently asking for. */
export function systemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Resolve a preference to the theme actually shown. */
export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  return preference === 'system' ? systemTheme() : preference;
}

/**
 * Put the theme on the document.
 *
 * Sets both the `dark` class (which Tailwind's `darkMode: 'class'` reads) and
 * `color-scheme`. The second matters and is easy to miss: without it the
 * browser keeps painting form controls, scrollbars and autofill in the light
 * palette, so a dark page still shows a white input with white text in it —
 * which is the exact complaint this module was written for.
 */
export function applyTheme(theme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

/** Read the stored preference, defaulting to following the system. */
export function readThemePreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system';
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // A private window or blocked site data is not an error worth surfacing;
    // following the system is the right fallback.
  }
  return 'system';
}

/** Persist the preference and apply it immediately. */
export function setThemePreference(preference: ThemePreference): 'light' | 'dark' {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can fail; the theme still applies for this session.
  }
  const theme = resolveTheme(preference);
  applyTheme(theme);
  return theme;
}

/**
 * Apply the stored preference and keep following the system while it is
 * `system`.
 *
 * Returns a teardown. Calling this twice without tearing down would attach a
 * second media-query listener — the doctor portal's `initializeTheme` did
 * exactly that, adding one listener per call with no way to remove it.
 */
export function startThemeSync(
  onChange?: (theme: 'light' | 'dark') => void
): () => void {
  const preference = readThemePreference();
  const initial = resolveTheme(preference);
  applyTheme(initial);
  onChange?.(initial);

  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (event: MediaQueryListEvent) => {
    // Only while the user is following the system. Re-read rather than
    // closing over the value: the preference can change after this is armed.
    if (readThemePreference() !== 'system') return;
    const next = event.matches ? 'dark' : 'light';
    applyTheme(next);
    onChange?.(next);
  };
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
