/**
 * React i18n layer (Phase 3.5).
 *
 * Wraps the framework-agnostic helpers in `./index` with a provider + hook +
 * language switcher. Translations for the active locale are deep-merged over
 * en-US so any missing key transparently falls back to English. Persists the
 * choice to localStorage and sets the document text direction (RTL-aware).
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  createTranslator,
  detectLocale,
  getDirection,
  loadLocaleFromStorage,
  saveLocaleToStorage,
  LOCALE_CONFIGS,
  type SupportedLocale,
  type TranslationRecord,
} from './index';
import enUS from './locales/en-US';
import frFR from './locales/fr-FR';
import swKE from './locales/sw-KE';
import amET from './locales/am-ET';

/** Locales we ship translations for (others fall back to English). */
const BUNDLES: Partial<Record<SupportedLocale, TranslationRecord>> = {
  'en-US': enUS,
  'fr-FR': frFR,
  'sw-KE': swKE,
  'am-ET': amET,
};

/** Locales offered in the switcher (target markets + English). */
export const ACTIVE_LOCALES: SupportedLocale[] = ['en-US', 'fr-FR', 'sw-KE', 'am-ET'];

/** Deep-merge `override` onto `base` (objects merged, scalars overridden). */
function deepMerge(base: TranslationRecord, override: TranslationRecord): TranslationRecord {
  const out: TranslationRecord = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const existing = out[k];
    if (v && typeof v === 'object' && existing && typeof existing === 'object') {
      out[k] = deepMerge(existing as TranslationRecord, v as TranslationRecord);
    } else {
      out[k] = v;
    }
  }
  return out;
}

interface I18nState {
  locale: SupportedLocale;
  setLocale: (l: SupportedLocale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    () => loadLocaleFromStorage() || detectLocale()
  );

  const t = useMemo(() => {
    const merged = deepMerge(enUS, BUNDLES[locale] ?? {});
    return createTranslator(merged);
  }, [locale]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dir = getDirection(locale);
    }
  }, [locale]);

  const setLocale = useCallback((l: SupportedLocale) => {
    setLocaleState(l);
    saveLocaleToStorage(l);
  }, []);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used within an I18nProvider');
  return ctx;
}

/** A minimal language switcher (native select) usable in any app shell. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useTranslation();
  return (
    <select
      className={className}
      value={locale}
      onChange={(e) => setLocale(e.target.value as SupportedLocale)}
      aria-label="Language"
    >
      {ACTIVE_LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_CONFIGS[l].nativeName}
        </option>
      ))}
    </select>
  );
}
