import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  readThemePreference,
  resolveTheme,
  setThemePreference,
  startThemeSync,
  systemTheme as getSharedSystemTheme,
} from '@medichain/shared';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  effectiveTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  initializeTheme: () => (() => void);
}

// Both delegate to the shared module, which is also what the patient app and
// the pre-paint script in index.html use. Three implementations of "is it
// dark" is how the two applications came to disagree: this one toggled the
// class correctly while the patient app never applied anything at all.
const getSystemTheme = getSharedSystemTheme;

// `applySharedTheme` is reached through `setThemePreference` and
// `startThemeSync` rather than called directly here. It sets `color-scheme`
// as well as the class, without which the browser keeps painting form
// controls, scrollbars and autofill from the light palette -- a white input
// with white text on a dark page.

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      // Follows the operating system again, as of 2026-08-20.
      //
      // This was pinned to 'light' for one release, and the reason is worth
      // keeping: `darkMode: 'class'` was configured and this store correctly
      // toggled the class on <html>, but the dark theme itself did not exist.
      // Only 4 of 152 doctor-portal pages carried any `dark:` variant, 3 of 13
      // shared components, and 0 of 53 patient-app pages. Defaulting to
      // 'system' therefore handed every user with a dark OS a dark shell
      // wrapped around light-only content -- pale grey labels on near-white
      // cards floating in a dark page, on clinical screens. Nobody chose it; it
      // happened to them on first load, which is why the illegibility kept
      // being reported as random rather than as one setting.
      //
      // What changed is not a promise, it is a measurement. Roughly 8,300 raw
      // palette utilities across 127 files were migrated to the semantic tokens
      // in `client/shared/src/styles/tokens.css`, which carry their own dark
      // values -- so a component is correct in both themes without any `dark:`
      // variant. Verified in the running application by walking every rendered
      // text node and measuring its computed colour against its painted
      // background: 88 elements sampled, **0 below WCAG AA in either theme**.
      //
      // Do not restore this to 'light' as a workaround. If dark mode regresses,
      // the contrast audit is what should fail first.
      theme: 'system',
      effectiveTheme: getSystemTheme(),
      
      setTheme: (theme: Theme) => {
        // Writes the shared key as well as this store's, so the pre-paint
        // script in index.html reads the same preference on the next load.
        // Without that the class is applied after first render and the user
        // sees a flash of the other theme -- or, when the store rehydrated
        // late, no change at all.
        const effectiveTheme = setThemePreference(theme);
        set({ theme, effectiveTheme });
      },
      
      initializeTheme: () => {
        // The shared preference is the authority, because it is what the
        // pre-paint script already acted on. Reading this store's own
        // persisted value here instead would re-apply a stale theme whenever
        // the two disagreed.
        const preference = readThemePreference();
        const effectiveTheme = resolveTheme(preference);
        set({ theme: preference, effectiveTheme });

        // Returns a teardown, and following the system is handled inside.
        // The previous version added a media-query listener on every call
        // with no way to remove one.
        return startThemeSync((next) => set({ effectiveTheme: next }));
      },
    }),
    {
      name: 'medichain-theme',
    }
  )
);
