/**
 * The screens under Me, each built from pages that used to stand alone
 * (patient-app plan, 2026-11-01; approved 2026-11-04). Each former page is a
 * section and still makes every read it made, so nothing a patient could see
 * became unreachable. The old addresses redirect here (`App.tsx`).
 */
import { lazy } from 'react';
import { useTranslation } from '@medichain/shared';
import { MergedScreen } from '../components/MergedScreen';

// Each section's code loads when it is opened, as the separate pages' did.
const ConsentManagementPage = lazy(() => import('./ConsentManagementPage').then((m) => ({ default: m.ConsentManagementPage })));
const AccessHistoryPage = lazy(() => import('./AccessHistoryPage').then((m) => ({ default: m.AccessHistoryPage })));
const EmergencyCardPage = lazy(() => import('./EmergencyCardPage').then((m) => ({ default: m.EmergencyCardPage })));
const MedicalIdPage = lazy(() => import('./MedicalIdPage').then((m) => ({ default: m.MedicalIdPage })));
const InsurancePage = lazy(() => import('./InsurancePage'));
const FamilyGroupPage = lazy(() => import('./FamilyGroupPage').then((m) => ({ default: m.FamilyGroupPage })));
const SettingsPage = lazy(() => import('./SettingsPage').then((m) => ({ default: m.SettingsPage })));
const LanguageSettingsPage = lazy(() => import('./LanguageSettingsPage'));
const OfflineSyncPage = lazy(() => import('./OfflineSyncPage'));

/** Who can see my records, and who has. */
export function PrivacyScreen() {
  const { t } = useTranslation();
  return (
    <MergedScreen title={t('me.whoSees')} sections={[
      { id: 'access', label: t('me.tabAccess'), render: () => <ConsentManagementPage /> },
      { id: 'viewed', label: t('me.tabViewed'), render: () => <AccessHistoryPage /> },
    ]} />
  );
}

/** One emergency card, one code; the lock-screen and sharing views beside it. */
export function EmergencyCardScreen() {
  const { t } = useTranslation();
  return (
    <MergedScreen title={t('me.emergencyCard')} sections={[
      { id: 'card', label: t('me.card'), render: () => <EmergencyCardPage /> },
      { id: 'medical-id', label: t('me.medicalId'), render: () => <MedicalIdPage /> },
    ]} />
  );
}

/** Insurance cards and family. */
export function CardsScreen() {
  const { t } = useTranslation();
  return (
    <MergedScreen title={t('me.cardsFamily')} sections={[
      { id: 'insurance', label: t('me.insurance'), render: () => <InsurancePage /> },
      { id: 'family', label: t('me.family'), render: () => <FamilyGroupPage /> },
    ]} />
  );
}

/**
 * The app's settings. "Saved on this phone" is what Offline sync was, without
 * its switches for features that did not exist: the queue it shows still sends
 * by itself, and a conflict still needs somewhere to be resolved.
 */
export function AppSettingsScreen() {
  const { t } = useTranslation();
  return (
    <MergedScreen title={t('me.settings')} sections={[
      { id: 'settings', label: t('me.tabGeneral'), render: () => <SettingsPage /> },
      { id: 'language', label: t('me.language'), render: () => <LanguageSettingsPage /> },
      { id: 'offline', label: t('me.onThisPhone'), render: () => <OfflineSyncPage /> },
    ]} />
  );
}
