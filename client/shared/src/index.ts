/**
 * @medichain/shared - Shared components and utilities
 * 
 * National health ID system shared library.
 * Sign-in is by login id and password; identity is `user_id`.
 * 
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */

// Configuration
export * from './config';

// Internationalization (Phase 3.5) — React layer + locale configs/types.
export {
  I18nProvider,
  useTranslation,
  LanguageSwitcher,
  ACTIVE_LOCALES,
} from './i18n/react';
export {
  LOCALE_CONFIGS,
  DEFAULT_CURRENCY,
  formatCurrency,
  formatDate,
  formatDateOnly,
  formatTime,
  // Use this rather than `new Date(x).toLocaleString()` for any stored
  // timestamp: an absent or unparseable value renders as nothing, never as
  // the literal string "Invalid Date".
  formatTimestamp,
  getDirection,
  detectLocale,
} from './i18n';
export type { SupportedLocale, LocaleConfig } from './i18n';

// Password proof and session establishment (staff and patient sign-in).
export * from './auth/proof';
export * from './auth/loginId';
export * from './auth/session';
// The one place that decides whether the interface is dark.
export * from './theme';

// Types (canonical Role definition is here)
export * from './types';

// API Client
export * from './api/client';
export * from './api/endpoints';

// Clinical scoring previews. The stored score is always the server's; these
// only let a form show a total moving as it is filled in, using thresholds
// fetched from the API rather than a second copy of the policy.
export * from './clinical/scoring';

// Push notifications (Phase 5.2)
export { initPushNotifications } from './push';

// Hooks
export * from './hooks';

// Utilities
export * from './utils/cache';
export { lookupOr, componentOr } from './utils/enumLookup';
export * from './utils/indexedDB';
export * from './utils/syncQueue';
export * from './utils/offlineSeal';
export * from './utils/offlinePolicy';
export * from './utils/offlineRoster';
export * from './utils/healthId';
export * from './utils/validation';
export * from './utils/sealStatus';

// Components
export * from './components';
export * from './components/Button';
export * from './components/Card';
export * from './components/Input';
export * from './components/Alert';
export * from './components/Badge';
export * from './components/Loading';
export * from './components/ErrorBoundary';
export * from './components/RestrictedSection';
export * from './components/JitsiMeetComponent';
export * from './utils/contrast';

// Form validation. `clinical` holds the physiological ranges and the reasoning
// behind each bound; `useValidatedForm` binds a schema to per-field errors in
// the shape Input/Select/Textarea already accept.
export * from './validation/clinical';
export * from './validation/useValidatedForm';
export * from './components/field';
export * from './components/FieldParts';
export * from './utils/clickable';
export * from './utils/localDateTime';
export { returnPathFrom } from './utils/returnPath';
export { csvCell, csvRow } from './utils/csv';
export { reloadOnStaleChunks } from './utils/staleChunks';
export { followSessionAcrossTabs, signedInIdentity } from './utils/sessionAcrossTabs';
export { parseEmergencyCode } from './utils/emergencyQr';
export { nfcSupported, nfcErrorMessage, readNfcCardOnce, writeNfcCard, textOfRecords } from './utils/webNfc';
export type { OfflineEmergencySummary, ScannedEmergencyCode } from './utils/emergencyQr';

export { getEmergencyNumber } from './utils/emergencyNumber';

// Form engine: one status per submission, duplicate-safe saves, drafts and the
// unsaved-changes guard (docs/UX_IMPLEMENTATION_PLAN_2026-10-30.md Phase 1.1).
export * from './forms/submission';
export * from './forms/unsavedChanges';
export * from './forms/drafts';
export * from './forms/signOutGuard';
export * from './forms/enterKey';
export * from './components/ErrorSummary';
export * from './components/SubmitButton';
export * from './components/Sheet';
export * from './components/ChoiceChips';
export * from './components/ClinicalFields';
export * from './components/StatusBanner';
export * from './components/WorkQueueItem';
export * from './motion/useMotionNavigate';
export * from './motion/MotionLink';
