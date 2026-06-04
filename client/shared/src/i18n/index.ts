/**
 * MediChain Internationalization (i18n) Module
 *
 * A lightweight i18n solution for the MediChain patient and doctor portals.
 * Supports language switching, nested translations, and interpolation.
 */

export type SupportedLocale =
  | 'en-US'
  | 'en-GB'
  | 'es-ES'
  | 'es-MX'
  | 'fr-FR'
  | 'de-DE'
  | 'it-IT'
  | 'pt-BR'
  | 'zh-CN'
  | 'zh-TW'
  | 'ja-JP'
  | 'ko-KR'
  | 'ar-SA'
  | 'hi-IN'
  | 'ru-RU'
  | 'sw-KE'
  | 'am-ET'
  | 'vi-VN';

export interface LocaleConfig {
  code: SupportedLocale;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
  dateFormat: string;
  timeFormat: '12h' | '24h';
}

export const LOCALE_CONFIGS: Record<SupportedLocale, LocaleConfig> = {
  'en-US': { code: 'en-US', name: 'English (US)', nativeName: 'English', direction: 'ltr', dateFormat: 'MM/DD/YYYY', timeFormat: '12h' },
  'en-GB': { code: 'en-GB', name: 'English (UK)', nativeName: 'English', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  'es-ES': { code: 'es-ES', name: 'Spanish (Spain)', nativeName: 'Español', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  'es-MX': { code: 'es-MX', name: 'Spanish (Mexico)', nativeName: 'Español', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  'fr-FR': { code: 'fr-FR', name: 'French', nativeName: 'Français', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  'de-DE': { code: 'de-DE', name: 'German', nativeName: 'Deutsch', direction: 'ltr', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  'it-IT': { code: 'it-IT', name: 'Italian', nativeName: 'Italiano', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  'pt-BR': { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  'zh-CN': { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', direction: 'ltr', dateFormat: 'YYYY-MM-DD', timeFormat: '24h' },
  'zh-TW': { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', direction: 'ltr', dateFormat: 'YYYY/MM/DD', timeFormat: '24h' },
  'ja-JP': { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', direction: 'ltr', dateFormat: 'YYYY/MM/DD', timeFormat: '24h' },
  'ko-KR': { code: 'ko-KR', name: 'Korean', nativeName: '한국어', direction: 'ltr', dateFormat: 'YYYY.MM.DD', timeFormat: '24h' },
  'ar-SA': { code: 'ar-SA', name: 'Arabic', nativeName: 'العربية', direction: 'rtl', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  'hi-IN': { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  'ru-RU': { code: 'ru-RU', name: 'Russian', nativeName: 'Русский', direction: 'ltr', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  'vi-VN': { code: 'vi-VN', name: 'Vietnamese', nativeName: 'Tiếng Việt', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  // African target markets (Phase 3.5)
  'sw-KE': { code: 'sw-KE', name: 'Swahili', nativeName: 'Kiswahili', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  'am-ET': { code: 'am-ET', name: 'Amharic', nativeName: 'አማርኛ', direction: 'ltr', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
};

// Translation key-value store for each locale
export type TranslationKey = string;
export type TranslationValue = string | { [key: string]: TranslationValue };
export type TranslationRecord = { [key: string]: TranslationValue };

/**
 * Get a nested value from a translation object using dot notation
 * @example getNestedValue({ common: { save: 'Save' } }, 'common.save') => 'Save'
 */
function getNestedValue(obj: TranslationRecord, path: string): string | undefined {
  const keys = path.split('.');
  let current: TranslationRecord | string | undefined = obj;

  for (const key of keys) {
    if (current === undefined || typeof current === 'string') {
      return undefined;
    }
    current = current[key];
  }

  return typeof current === 'string' ? current : undefined;
}

/**
 * Interpolate variables in a translation string
 * @example interpolate('Hello, {{name}}!', { name: 'John' }) => 'Hello, John!'
 */
function interpolate(text: string, variables?: Record<string, string | number>): string {
  if (!variables) return text;

  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Creates a translation function for a given locale and translations
 */
export function createTranslator(translations: TranslationRecord) {
  return function t(key: string, variables?: Record<string, string | number>): string {
    const value = getNestedValue(translations, key);
    if (value === undefined) {
      console.warn(`[i18n] Missing translation for key: ${key}`);
      return key;
    }
    return interpolate(value, variables);
  };
}

/**
 * Format a date according to locale preferences
 */
export function formatDate(date: Date | string | number, locale: SupportedLocale): string {
  const d = new Date(date);
  const config = LOCALE_CONFIGS[locale];

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  switch (config.dateFormat) {
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'DD.MM.YYYY':
      return `${day}.${month}.${year}`;
    case 'YYYY/MM/DD':
      return `${year}/${month}/${day}`;
    case 'YYYY.MM.DD':
      return `${year}.${month}.${day}`;
    default:
      return `${month}/${day}/${year}`;
  }
}

/**
 * Format a time according to locale preferences
 */
export function formatTime(date: Date | string | number, locale: SupportedLocale): string {
  const d = new Date(date);
  const config = LOCALE_CONFIGS[locale];

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');

  if (config.timeFormat === '12h') {
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${period}`;
  }

  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

/**
 * Get the text direction for a locale
 */
export function getDirection(locale: SupportedLocale): 'ltr' | 'rtl' {
  return LOCALE_CONFIGS[locale]?.direction || 'ltr';
}

/**
 * Detect the best locale based on browser settings
 */
export function detectLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') return 'en-US';

  const browserLocales = navigator.languages || [navigator.language];

  for (const browserLocale of browserLocales) {
    // Exact match
    if (browserLocale in LOCALE_CONFIGS) {
      return browserLocale as SupportedLocale;
    }

    // Language prefix match (e.g., 'es' matches 'es-ES')
    const prefix = browserLocale.split('-')[0];
    const match = Object.keys(LOCALE_CONFIGS).find((code) => code.startsWith(prefix + '-'));
    if (match) {
      return match as SupportedLocale;
    }
  }

  return 'en-US';
}

/**
 * Load a locale's translations from localStorage cache or default
 */
export function loadLocaleFromStorage(): SupportedLocale {
  if (typeof localStorage === 'undefined') return 'en-US';

  const stored = localStorage.getItem('medichain-locale');
  if (stored && stored in LOCALE_CONFIGS) {
    return stored as SupportedLocale;
  }

  return detectLocale();
}

/**
 * Save a locale preference to localStorage
 */
export function saveLocaleToStorage(locale: SupportedLocale): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('medichain-locale', locale);
  }
}
