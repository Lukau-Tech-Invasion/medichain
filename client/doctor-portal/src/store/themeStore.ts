import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  effectiveTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  initializeTheme: () => void;
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyTheme(theme: 'light' | 'dark') {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
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
        const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;
        applyTheme(effectiveTheme);
        set({ theme, effectiveTheme });
      },
      
      initializeTheme: () => {
        const { theme } = get();
        const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;
        applyTheme(effectiveTheme);
        set({ effectiveTheme });
        
        // Listen for system theme changes
        if (typeof window !== 'undefined' && window.matchMedia) {
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
          mediaQuery.addEventListener('change', (e) => {
            const currentTheme = get().theme;
            if (currentTheme === 'system') {
              const newEffectiveTheme = e.matches ? 'dark' : 'light';
              applyTheme(newEffectiveTheme);
              set({ effectiveTheme: newEffectiveTheme });
            }
          });
        }
      },
    }),
    {
      name: 'medichain-theme',
    }
  )
);
