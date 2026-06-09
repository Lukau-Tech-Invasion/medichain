import React, { useState, useEffect } from 'react';
import { usePatientAuthStore } from '../store/authStore';
import { setLanguagePreference, LOCALE_CONFIGS } from '@medichain/shared';
import type { SupportedLocale } from '@medichain/shared';
import {
  Globe,
  Check,
  Search,
  ChevronRight,
  Calendar,
  Clock,
  DollarSign,
  Thermometer,
  Ruler,
  Scale,
  MapPin,
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
  const patient = usePatientAuthStore((s) => s.patient);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en-US');
  const [showRegionalSettings, setShowRegionalSettings] = useState(false);
  const [regionalSettings, setRegionalSettings] = useState<RegionalSettings>({
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
    firstDayOfWeek: 'sunday',
    temperatureUnit: 'fahrenheit',
    measurementSystem: 'imperial',
    currencySymbol: currencySymbolFor('en-US'),
    numberFormat: 'comma-period'
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const languages: Language[] = [
    { code: 'en-US', name: 'English (US)', nativeName: 'English', direction: 'ltr', region: 'Americas', isAvailable: true, translationProgress: 100 },
    { code: 'en-GB', name: 'English (UK)', nativeName: 'English', direction: 'ltr', region: 'Europe', isAvailable: true, translationProgress: 100 },
    { code: 'es-ES', name: 'Spanish (Spain)', nativeName: 'Español', direction: 'ltr', region: 'Europe', isAvailable: true, translationProgress: 98 },
    { code: 'es-MX', name: 'Spanish (Mexico)', nativeName: 'Español', direction: 'ltr', region: 'Americas', isAvailable: true, translationProgress: 95 },
    { code: 'fr-FR', name: 'French', nativeName: 'Français', direction: 'ltr', region: 'Europe', isAvailable: true, translationProgress: 92 },
    { code: 'de-DE', name: 'German', nativeName: 'Deutsch', direction: 'ltr', region: 'Europe', isAvailable: true, translationProgress: 90 },
    { code: 'it-IT', name: 'Italian', nativeName: 'Italiano', direction: 'ltr', region: 'Europe', isAvailable: true, translationProgress: 88 },
    { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português', direction: 'ltr', region: 'Americas', isAvailable: true, translationProgress: 85 },
    { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', direction: 'ltr', region: 'Asia', isAvailable: true, translationProgress: 82 },
    { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', direction: 'ltr', region: 'Asia', isAvailable: true, translationProgress: 78 },
    { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', direction: 'ltr', region: 'Asia', isAvailable: true, translationProgress: 75 },
    { code: 'ko-KR', name: 'Korean', nativeName: '한국어', direction: 'ltr', region: 'Asia', isAvailable: true, translationProgress: 72 },
    { code: 'ar-SA', name: 'Arabic', nativeName: 'العربية', direction: 'rtl', region: 'Middle East', isAvailable: true, translationProgress: 68 },
    { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', direction: 'ltr', region: 'Asia', isAvailable: true, translationProgress: 65 },
    { code: 'ru-RU', name: 'Russian', nativeName: 'Русский', direction: 'ltr', region: 'Europe', isAvailable: true, translationProgress: 70 },
    { code: 'vi-VN', name: 'Vietnamese', nativeName: 'Tiếng Việt', direction: 'ltr', region: 'Asia', isAvailable: true, translationProgress: 55 },
    { code: 'th-TH', name: 'Thai', nativeName: 'ไทย', direction: 'ltr', region: 'Asia', isAvailable: false, translationProgress: 40 },
    { code: 'nl-NL', name: 'Dutch', nativeName: 'Nederlands', direction: 'ltr', region: 'Europe', isAvailable: false, translationProgress: 35 },
    { code: 'pl-PL', name: 'Polish', nativeName: 'Polski', direction: 'ltr', region: 'Europe', isAvailable: false, translationProgress: 30 },
    { code: 'tr-TR', name: 'Turkish', nativeName: 'Türkçe', direction: 'ltr', region: 'Europe', isAvailable: false, translationProgress: 25 }
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
    try {
      // Persist the language preference to the backend (was: simulated setTimeout)
      await setLanguagePreference({
        user_id: patient?.walletAddress || '',
        preferred_language: selectedLanguage.split('-')[0],
        secondary_language: null,
        reading_proficiency: 'Fluent',
        needs_interpreter: false,
        interpreter_language: null,
        updated_at: Math.floor(Date.now() / 1000),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Network/API failure — leave the selection applied locally.
    } finally {
      setSaving(false);
    }
  };

  const getCurrentLanguage = () => languages.find(l => l.code === selectedLanguage);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-500 text-white p-6">
        <div className="flex items-center gap-3 mb-2">
          <Globe className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Language & Region</h1>
        </div>
        <p className="text-indigo-100">Customize your language and regional preferences</p>
      </div>

      {/* Current Selection */}
      <div className="p-4 -mt-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 font-bold text-sm" aria-hidden="true">
                {languageBadge(getCurrentLanguage()?.code ?? '')}
              </span>
              <div>
                <p className="font-semibold text-gray-900">{getCurrentLanguage()?.name}</p>
                <p className="text-sm text-gray-500">{getCurrentLanguage()?.nativeName}</p>
              </div>
            </div>
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
              Active
            </span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 mb-4">
        <div className="relative">
          <label htmlFor="lang-search" className="sr-only">Search languages</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="lang-search"
            type="text"
            placeholder="Search languages..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Language List */}
      <div className="px-4 mb-6">
        {Object.entries(groupedLanguages).map(([region, langs]) => (
          <div key={region} className="mb-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
              {region}
            </h3>
            <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
              {langs.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageSelect(lang.code)}
                  disabled={!lang.isAvailable}
                  className={`w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors ${
                    !lang.isAvailable ? 'opacity-50 cursor-not-allowed' : ''
                  } ${selectedLanguage === lang.code ? 'bg-indigo-50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-100 text-gray-700 font-bold text-xs" aria-hidden="true">
                      {languageBadge(lang.code)}
                    </span>
                    <div className="text-left">
                      <p className={`font-medium ${selectedLanguage === lang.code ? 'text-indigo-600' : 'text-gray-900'}`}>
                        {lang.name}
                      </p>
                      <p className="text-sm text-gray-500">{lang.nativeName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {lang.translationProgress < 100 && (
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <span>{lang.translationProgress}%</span>
                        <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500"
                            style={{ width: `${lang.translationProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {!lang.isAvailable && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
                        Coming Soon
                      </span>
                    )}
                    {selectedLanguage === lang.code ? (
                      <Check className="w-5 h-5 text-indigo-600" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-300" />
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
          className="w-full flex items-center justify-between p-4 bg-white rounded-lg shadow"
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-gray-600" />
            <span className="font-medium text-gray-900">Regional Format Settings</span>
          </div>
          <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${showRegionalSettings ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {/* Regional Settings Panel */}
      {showRegionalSettings && (
        <div className="px-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4 space-y-4">
            {/* Date Format */}
            <div>
              <label htmlFor="lang-date-format" className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Calendar className="w-4 h-4" /> Date Format
              </label>
              <select
                id="lang-date-format"
                value={regionalSettings.dateFormat}
                onChange={(e) => setRegionalSettings(prev => ({ ...prev, dateFormat: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                {dateFormats.map(df => (
                  <option key={df.value} value={df.value}>
                    {df.label} (e.g., {df.example})
                  </option>
                ))}
              </select>
            </div>

            {/* Time Format */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Clock className="w-4 h-4" /> Time Format
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, timeFormat: '12h' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.timeFormat === '12h'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  12-hour (2:30 PM)
                </button>
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, timeFormat: '24h' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.timeFormat === '24h'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  24-hour (14:30)
                </button>
              </div>
            </div>

            {/* First Day of Week */}
            <div>
              <label htmlFor="lang-first-day" className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Calendar className="w-4 h-4" /> First Day of Week
              </label>
              <select
                id="lang-first-day"
                value={regionalSettings.firstDayOfWeek}
                onChange={(e) => setRegionalSettings(prev => ({ ...prev, firstDayOfWeek: e.target.value as typeof regionalSettings.firstDayOfWeek }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
                <option value="saturday">Saturday</option>
              </select>
            </div>

            {/* Temperature Unit */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Thermometer className="w-4 h-4" /> Temperature Unit
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, temperatureUnit: 'fahrenheit' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.temperatureUnit === 'fahrenheit'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  °F Fahrenheit
                </button>
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, temperatureUnit: 'celsius' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.temperatureUnit === 'celsius'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  °C Celsius
                </button>
              </div>
            </div>

            {/* Measurement System */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Ruler className="w-4 h-4" /> Measurement System
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, measurementSystem: 'imperial' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.measurementSystem === 'imperial'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  Imperial (lb, ft, in)
                </button>
                <button
                  onClick={() => setRegionalSettings(prev => ({ ...prev, measurementSystem: 'metric' }))}
                  className={`flex-1 py-2 rounded-lg border ${
                    regionalSettings.measurementSystem === 'metric'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  Metric (kg, m, cm)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Medical Translation Info */}
      <div className="px-4 mb-6">
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-900">Medical Terminology</h4>
              <p className="text-sm text-blue-700 mt-1">
                Medical terms and diagnoses are displayed in both your selected language and English for accuracy. 
                Critical alerts and emergency information will always be shown in multiple languages for safety.
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
              ? 'bg-green-500 text-white'
              : saving
              ? 'bg-gray-300 text-gray-500'
              : 'bg-gradient-to-r from-indigo-600 to-violet-500 text-white hover:from-indigo-700 hover:to-violet-600'
          }`}
        >
          {saved ? (
            <span className="flex items-center justify-center gap-2">
              <Check className="w-5 h-5" /> Settings Saved!
            </span>
          ) : saving ? (
            <span className="flex items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" /> Saving...
            </span>
          ) : (
            'Save Language Settings'
          )}
        </button>
      </div>
    </div>
  );
};

export default LanguageSettingsPage;
