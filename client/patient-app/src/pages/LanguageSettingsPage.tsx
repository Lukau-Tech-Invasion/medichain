import React, { useEffect, useState } from 'react';
import {
  getApiErrorMessage,
  getUserSettings,
  LOCALE_CONFIGS,
  saveUserSettings,
  setLanguagePreference,
  useTranslation,
} from '@medichain/shared';
import type { SupportedLocale } from '@medichain/shared';
import {
  Globe,
  Check,
  Search,
  ChevronRight,
  Calendar,
  Clock,
  Thermometer,
  Ruler,
  Settings,
  RefreshCw,
  Info
} from 'lucide-react';

/**
 * LanguageSettingsPage
 * 
 * Full-featured page for changing app language and localization settings.
 * Includes language selection, regional formats, and accessibility options.
 */

interface Language {
  code: string;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
  region: string;
  isAvailable: boolean;
  translationProgress: number;
}

interface RegionalSettings {
  dateFormat: string;
  timeFormat: '12h' | '24h';
  firstDayOfWeek: 'sunday' | 'monday' | 'saturday';
  temperatureUnit: 'celsius' | 'fahrenheit';
  measurementSystem: 'metric' | 'imperial';
  currencySymbol: string;
  numberFormat: 'comma-period' | 'period-comma' | 'space-comma';
}

const DEFAULT_REGIONAL_SETTINGS: RegionalSettings = {
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  firstDayOfWeek: 'sunday',
  temperatureUnit: 'fahrenheit',
  measurementSystem: 'imperial',
  currencySymbol: 'R',
  numberFormat: 'comma-period',
};

type LanguageSettingsPreferences = {
  regionalSettings?: RegionalSettings;
};

/**
 * Accept only the format values this screen can render. User settings are a
 * generic JSON document, so an old or malformed record must not put this
 * controlled form into an invalid state.
 */
function readRegionalSettings(value: unknown): RegionalSettings | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RegionalSettings>;
  const validDateFormats = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD.MM.YYYY', 'DD-MM-YYYY'];
  if (
    !validDateFormats.includes(candidate.dateFormat ?? '') ||
    !['12h', '24h'].includes(candidate.timeFormat ?? '') ||
    !['sunday', 'monday', 'saturday'].includes(candidate.firstDayOfWeek ?? '') ||
    !['celsius', 'fahrenheit'].includes(candidate.temperatureUnit ?? '') ||
    !['metric', 'imperial'].includes(candidate.measurementSystem ?? '') ||
    !['comma-period', 'period-comma', 'space-comma'].includes(candidate.numberFormat ?? '') ||
    typeof candidate.currencySymbol !== 'string' ||
    candidate.currencySymbol.length === 0 ||
    candidate.currencySymbol.length > 8
  ) {
    return null;
  }

  return candidate as RegionalSettings;
}

/**
 * Resolve the locale's currency symbol from shared LOCALE_CONFIGS. MediChain
 * targets African markets, so unknown/unsupported language codes fall back to
 * the platform default (ZAR "R") rather than a bare US '$'.
 */
const currencySymbolFor = (code: string): string =>
  LOCALE_CONFIGS[code as SupportedLocale]?.currencySymbol ?? 'R';

/**
 * Short code badge for a locale (e.g. "en-US" -> "EN", "zh-CN" -> "ZH").
 * Replaces flag emoji: flags render inconsistently across platforms and are a
 * poor proxy for languages. The full language name is always shown alongside.
 */
const languageBadge = (code: string): string =>
  (code.split('-')[0] || code).toUpperCase();

const LanguageSettingsPage: React.FC = () => {
  const { t, locale, setLocale } = useTranslation();
  const regionLabel = (region: string) =>
    ({
      Americas: t('languageSettings.regionAmericas'),
      Europe: t('languageSettings.regionEurope'),
      Asia: t('languageSettings.regionAsia'),
      'Middle East': t('languageSettings.regionMiddleEast'),
    }[region] || region);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>(locale);
  const [showRegionalSettings, setShowRegionalSettings] = useState(false);
  const [regionalSettings, setRegionalSettings] = useState<RegionalSettings>({
    ...DEFAULT_REGIONAL_SETTINGS,
    currencySymbol: currencySymbolFor('en-US'),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserSettings<LanguageSettingsPreferences>()
      .then((settings) => {
        const stored = readRegionalSettings(settings.regionalSettings);
        if (!cancelled && stored) setRegionalSettings(stored);
      })
      .catch((error) => {
        if (!cancelled) {
          setSettingsError(getApiErrorMessage(error, t('languageSettings.loadError')));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const languages: Language[] = [
    { code: 'en-US', name: 'English (US)', nativeName: 'English', direction: 'ltr', region: 'Americas', isAvailable: true, translationProgress: 100 },
    { code: 'fr-FR', name: 'French', nativeName: 'Français', direction: 'ltr', region: 'Africa', isAvailable: false, translationProgress: 1 },
    { code: 'sw-KE', name: 'Kiswahili', nativeName: 'Kiswahili', direction: 'ltr', region: 'Africa', isAvailable: false, translationProgress: 1 },
    { code: 'am-ET', name: 'Amharic', nativeName: 'አማርኛ', direction: 'ltr', region: 'Africa', isAvailable: false, translationProgress: 1 },
    { code: 'zu-ZA', name: 'isiZulu', nativeName: 'isiZulu', direction: 'ltr', region: 'Africa', isAvailable: false, translationProgress: 1 },
    { code: 'ha-NG', name: 'Hausa', nativeName: 'Hausa', direction: 'ltr', region: 'Africa', isAvailable: false, translationProgress: 1 },
  ];

  const dateFormats = [
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY', example: '12/25/2024' },
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY', example: '25/12/2024' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD', example: '2024-12-25' },
    { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY', example: '25.12.2024' },
    { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY', example: '25-12-2024' }
  ];

  const filteredLanguages = languages.filter(lang =>
    lang.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lang.nativeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lang.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const groupedLanguages = filteredLanguages.reduce((acc, lang) => {
    if (!acc[lang.region]) acc[lang.region] = [];
    acc[lang.region].push(lang);
    return acc;
  }, {} as Record<string, Language[]>);

  const handleLanguageSelect = (code: string) => {
    const lang = languages.find(l => l.code === code);
    if (lang && lang.isAvailable) {
      setSelectedLanguage(code);
      setLocale(code as SupportedLocale);
      
      // Auto-adjust regional settings based on language
      if (code.startsWith('en-US')) {
        setRegionalSettings({
          dateFormat: 'MM/DD/YYYY',
          timeFormat: '12h',
          firstDayOfWeek: 'sunday',
          temperatureUnit: 'fahrenheit',
          measurementSystem: 'imperial',
          currencySymbol: currencySymbolFor(code),
          numberFormat: 'comma-period'
        });
      } else if (code.startsWith('en-GB') || code.startsWith('de') || code.startsWith('fr')) {
        setRegionalSettings({
          dateFormat: 'DD/MM/YYYY',
          timeFormat: '24h',
          firstDayOfWeek: 'monday',
          temperatureUnit: 'celsius',
          measurementSystem: 'metric',
          currencySymbol: currencySymbolFor(code),
          numberFormat: 'period-comma'
        });
      } else if (code.startsWith('ar')) {
        setRegionalSettings({
          dateFormat: 'DD/MM/YYYY',
          timeFormat: '12h',
          firstDayOfWeek: 'saturday',
          temperatureUnit: 'celsius',
          measurementSystem: 'metric',
          currencySymbol: currencySymbolFor(code),
          numberFormat: 'comma-period'
        });
      }
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaved(false);
    setSettingsError(null);
    try {
      // The server derives the subject from the authenticated token. Sending a
      // wallet address or client timestamp here is both misleading and ignored.
      await setLanguagePreference({
        language_code: selectedLanguage,
      });

      // Merge at write time: /api/settings also holds notification, privacy,
      // and wearable preferences owned by other patient-app screens.
      const current = await getUserSettings<Record<string, unknown>>();
      await saveUserSettings({ ...current, regionalSettings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setSettingsError(getApiErrorMessage(error, t('languageSettings.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const getCurrentLanguage = () => languages.find(l => l.code === selectedLanguage);

  return (
    <div className="min-h-screen bg-surface-sunken">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-700 to-violet-800 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Globe className="w-8 h-8" />
          <h1 className="text-2xl font-bold">{t('languageSettings.title')}</h1>
        </div>
        <p className="text-white">{t('languageSettings.subtitle')}</p>
      </div>

      {/* Current Selection */}
      <div className="p-4 -mt-4">
        <div className="bg-surface rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface-sunken text-content-secondary font-bold text-sm" aria-hidden="true">
                {languageBadge(getCurrentLanguage()?.code ?? '')}
              </span>
              <div>
                <p className="font-semibold text-content">{getCurrentLanguage()?.name}</p>
                <p className="text-sm text-content-muted">{getCurrentLanguage()?.nativeName}</p>
              </div>
            </div>
            <span className="px-3 py-1 bg-ok-subtle text-ok-subtle-fg rounded-full text-sm font-medium">
              {t('languageSettings.active')}
            </span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 mb-4">
        <div className="relative">
          <label htmlFor="lang-search" className="sr-only">{t('languageSettings.searchLabel')}</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-muted" />
          <input
            id="lang-search"
            type="text"
            placeholder={t('languageSettings.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-border-interactive rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {settingsError && (
        <div className="px-4 mb-4" role="alert">
          <div className="rounded-lg border border-critical-subtle-fg/20 bg-critical-subtle p-3 text-sm text-critical-subtle-fg">
            {settingsError}
          </div>
        </div>
      )}

      {/* Language List */}
      <div className="px-4 mb-6">
        {Object.entries(groupedLanguages).map(([region, langs]) => (
          <div key={region} className="mb-4">
            <h3 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-2 px-1">
              {regionLabel(region)}
            </h3>
            <div className="bg-surface rounded-lg shadow divide-y divide-border">
              {langs.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageSelect(lang.code)}
                  disabled={!lang.isAvailable}
                  className={`w-full flex items-center justify-between p-4 hover:bg-surface-sunken transition-colors ${
                    !lang.isAvailable ? 'cursor-not-allowed' : ''
                  } ${selectedLanguage === lang.code ? 'bg-surface-sunken' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-surface-sunken text-content-secondary font-bold text-xs" aria-hidden="true">
                      {languageBadge(lang.code)}
                    </span>
                    <div className="text-left">
                      <p className={`font-medium ${selectedLanguage === lang.code ? 'text-content-secondary' : 'text-content'}`}>
                        {lang.name}
                      </p>
                      <p className="text-sm text-content-muted">{lang.nativeName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {lang.translationProgress < 100 && (
                      <div className="flex items-center gap-1 text-xs text-content-muted">
                        <span>{lang.translationProgress}%</span>
                        <div className="w-12 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500"
                            style={{ width: `${lang.translationProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {!lang.isAvailable && (
                      <span className="px-2 py-0.5 bg-surface-sunken text-content-muted text-xs rounded">
                        {t('languageSettings.comingSoon')}
                      </span>
                    )}
                    {selectedLanguage === lang.code ? (
                      <Check className="w-5 h-5 text-content-secondary" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-content-muted" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Regional Settings Toggle */}
      <div className="px-4 mb-4">
        <button
          onClick={() => setShowRegionalSettings(!showRegionalSettings)}
          className="w-full flex items-center justify-between p-4 bg-surface rounded-lg shadow"
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-content-muted" />
            <span className="font-medium text-content">{t('languageSettings.regionalSettings')}</span>
          </div>
          <ChevronRight className={`w-5 h-5 text-content-muted transition-transform ${showRegionalSettings ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {/* Regional Settings Panel */}
      {showRegionalSettings && (
        <div className="px-4 mb-6">
          <div className="bg-surface rounded-lg shadow p-4 space-y-4">
            {/* Date Format */}
            <div>
              <label htmlFor="lang-date-format" className="flex items-center gap-2 text-sm font-medium text-content-secondary mb-2">
                <Calendar className="w-4 h-4" /> {t('languageSettings.dateFormat')}
              </label>
              <select
                id="lang-date-format"
                value={regionalSettings.dateFormat}
                onChange={(e) => setRegionalSettings(prev => ({ ...prev, dateFormat: e.target.value }))}
                className="w-full border border-border-interactive rounded-lg px-3 py-2"
              >
                {dateFormats.map(df => (
                  <option key={df.value} value={df.value}>
                    {t('languageSettings.formatExample', { label: df.label, example: df.example })}
                  </option>
                ))}
              </select>
            </div>

            {/* Time Format */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-content-secondary mb-2">
                <Clock className="w-4 h-4" /> {t('languageSettings.timeFormat')}
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, timeFormat: '12h' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.timeFormat === '12h'
                      ? 'border-indigo-600 bg-surface-sunken text-content-secondary'
                      : 'border-border-strong text-content-secondary'
                  }`}
                >
                  {t('languageSettings.time12')}
                </button>
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, timeFormat: '24h' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.timeFormat === '24h'
                      ? 'border-indigo-600 bg-surface-sunken text-content-secondary'
                      : 'border-border-strong text-content-secondary'
                  }`}
                >
                  {t('languageSettings.time24')}
                </button>
              </div>
            </div>

            {/* First Day of Week */}
            <div>
              <label htmlFor="lang-first-day" className="flex items-center gap-2 text-sm font-medium text-content-secondary mb-2">
                <Calendar className="w-4 h-4" /> {t('languageSettings.firstDayOfWeek')}
              </label>
              <select
                id="lang-first-day"
                value={regionalSettings.firstDayOfWeek}
                onChange={(e) => setRegionalSettings(prev => ({ ...prev, firstDayOfWeek: e.target.value as typeof regionalSettings.firstDayOfWeek }))}
                className="w-full border border-border-interactive rounded-lg px-3 py-2"
              >
                <option value="sunday">{t('languageSettings.sunday')}</option>
                <option value="monday">{t('languageSettings.monday')}</option>
                <option value="saturday">{t('languageSettings.saturday')}</option>
              </select>
            </div>

            {/* Temperature Unit */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-content-secondary mb-2">
                <Thermometer className="w-4 h-4" /> {t('languageSettings.temperatureUnit')}
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, temperatureUnit: 'fahrenheit' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.temperatureUnit === 'fahrenheit'
                      ? 'border-indigo-600 bg-surface-sunken text-content-secondary'
                      : 'border-border-strong text-content-secondary'
                  }`}
                >
                  {t('languageSettings.fahrenheit')}
                </button>
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, temperatureUnit: 'celsius' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.temperatureUnit === 'celsius'
                      ? 'border-indigo-600 bg-surface-sunken text-content-secondary'
                      : 'border-border-strong text-content-secondary'
                  }`}
                >
                  {t('languageSettings.celsius')}
                </button>
              </div>
            </div>

            {/* Measurement System */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-content-secondary mb-2">
                <Ruler className="w-4 h-4" /> {t('languageSettings.measurementSystem')}
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, measurementSystem: 'imperial' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.measurementSystem === 'imperial'
                      ? 'border-indigo-600 bg-surface-sunken text-content-secondary'
                      : 'border-border-strong text-content-secondary'
                  }`}
                >
                  {t('languageSettings.imperial')}
                </button>
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, measurementSystem: 'metric' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.measurementSystem === 'metric'
                      ? 'border-indigo-600 bg-surface-sunken text-content-secondary'
                      : 'border-border-strong text-content-secondary'
                  }`}
                >
                  {t('languageSettings.metric')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Medical Translation Info */}
      <div className="px-4 mb-6">
        <div className="bg-notice-subtle rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-notice-subtle-fg flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-notice-subtle-fg">{t('languageSettings.medicalTermTitle')}</h4>
              <p className="text-sm text-notice-subtle-fg mt-1">
                {t('languageSettings.medicalTermBody')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="px-4 pb-8">
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className={`w-full py-3 rounded-lg font-medium transition-colors ${
            saved
              ? 'bg-green-700 text-white'
              : saving
              ? 'bg-gray-300 text-content-muted'
              : 'bg-gradient-to-r from-indigo-700 to-violet-800 text-white hover:from-indigo-800 hover:to-violet-900'
          }`}
        >
          {saved ? (
            <span className="flex items-center justify-center gap-2">
              <Check className="w-5 h-5" /> {t('languageSettings.saved')}
            </span>
          ) : saving ? (
            <span className="flex items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" /> {t('languageSettings.saving')}
            </span>
          ) : (
            t('languageSettings.saveButton')
          )}
        </button>
      </div>
    </div>
  );
};

export default LanguageSettingsPage;
