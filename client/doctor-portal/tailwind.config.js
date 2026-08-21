/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../shared/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic tokens (client/shared/src/styles/tokens.css).
        // Prefer these over raw palette scales: they say what a colour means,
        // carry their own light/dark values, and are contrast-checked by
        // scripts/check-contrast.py.
        'app-bg': 'rgb(var(--app-bg) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border-default) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
          interactive: 'rgb(var(--border-interactive) / <alpha-value>)',
        },
        content: {
          DEFAULT: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          inverse: 'rgb(var(--text-inverse) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          hover: 'rgb(var(--primary-hover) / <alpha-value>)',
          fg: 'rgb(var(--primary-fg) / <alpha-value>)',
          subtle: 'rgb(var(--primary-subtle-bg) / <alpha-value>)',
          'subtle-fg': 'rgb(var(--primary-subtle-fg) / <alpha-value>)',
        },
        ok: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          fg: 'rgb(var(--success-fg) / <alpha-value>)',
          subtle: 'rgb(var(--success-subtle-bg) / <alpha-value>)',
          'subtle-fg': 'rgb(var(--success-subtle-fg) / <alpha-value>)',
        },
        caution: {
          DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
          fg: 'rgb(var(--warning-fg) / <alpha-value>)',
          subtle: 'rgb(var(--warning-subtle-bg) / <alpha-value>)',
          'subtle-fg': 'rgb(var(--warning-subtle-fg) / <alpha-value>)',
        },
        critical: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          fg: 'rgb(var(--danger-fg) / <alpha-value>)',
          subtle: 'rgb(var(--danger-subtle-bg) / <alpha-value>)',
          'subtle-fg': 'rgb(var(--danger-subtle-fg) / <alpha-value>)',
        },
        notice: {
          DEFAULT: 'rgb(var(--info) / <alpha-value>)',
          fg: 'rgb(var(--info-fg) / <alpha-value>)',
          subtle: 'rgb(var(--info-subtle-bg) / <alpha-value>)',
          'subtle-fg': 'rgb(var(--info-subtle-fg) / <alpha-value>)',
        },
        selected: {
          DEFAULT: 'rgb(var(--selected-bg) / <alpha-value>)',
          fg: 'rgb(var(--selected-fg) / <alpha-value>)',
        },
        // The disabled tokens existed in tokens.css from the start and were
        // never exposed here, so components fell back to `disabled:bg-gray-300
        // text-white` -- 1.47:1 on the Code Blue page's "Finalize Record"
        // button and 2.54:1 on "Start Code". WCAG 1.4.3 does exempt inactive
        // controls, but a clinician who cannot read WHICH action is unavailable
        // during a resuscitation is being told nothing useful.
        disabled: {
          DEFAULT: 'rgb(var(--disabled-bg) / <alpha-value>)',
          fg: 'rgb(var(--disabled-fg) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--disabled-bg) / <alpha-value>)',
          fg: 'rgb(var(--disabled-fg) / <alpha-value>)',
        },
        focus: 'rgb(var(--focus-ring) / <alpha-value>)',
        // MediChain brand colors
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        emergency: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
