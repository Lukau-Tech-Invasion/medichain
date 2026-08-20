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
      // Defaults to 'light', NOT 'system', and that is deliberate.
      //
      // `darkMode: 'class'` is configured and this store correctly toggles the
      // class on <html>. What does not exist is the dark theme itself: 4 of 152
      // doctor-portal pages carry any `dark:` variant, 3 of 13 shared
      // components, and 0 of 53 patient-app pages. Defaulting to 'system'
      // therefore handed every user with a dark OS -- a large share of them --
      // a dark shell wrapped around light-only content: pale grey labels on
      // near-white cards floating in a dark page, on clinical screens.
      //
      // Nobody chose that. It happened to them on first load, which is why the
      // illegibility kept being reported as random rather than as one setting.
      // Until the dark palette is genuinely implemented, the honest default is
      // the theme that actually exists. `setTheme('dark')` still works for
      // anyone who opts in knowingly; see the note beside the Settings control.
      theme: 'light',
      effectiveTheme: 'light',
      
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
