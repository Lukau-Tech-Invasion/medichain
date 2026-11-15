/**
 * The merged screens under My health, Visits and Messages (patient-app plan,
 * 2026-11-01; approved 2026-11-04). As in `MeScreens.tsx`, each former page is
 * a section that still makes every read it made, and its old address
 * redirects to it (`App.tsx`).
 */
import { lazy } from 'react';
import { useTranslation } from '@medichain/shared';
import { MergedScreen } from '../components/MergedScreen';

const VitalsPage = lazy(() => import('./VitalsPage').then((m) => ({ default: m.VitalsPage })));
const WearablesPage = lazy(() => import('./WearablesPage'));
const SymptomTrackerPage = lazy(() => import('./SymptomTrackerPage').then((m) => ({ default: m.SymptomTrackerPage })));
const SymptomCheckerPage = lazy(() => import('./SymptomCheckerPage'));
const AppointmentsPage = lazy(() => import('./AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })));
const TelehealthPage = lazy(() => import('./TelehealthPage').then((m) => ({ default: m.TelehealthPage })));
const MessagesPage = lazy(() => import('./MessagesPage').then((m) => ({ default: m.MessagesPage })));
const NotificationsPage = lazy(() => import('./NotificationsPage').then((m) => ({ default: m.NotificationsPage })));

/** Readings, whether a clinician took them or a device did. */
export function VitalsScreen() {
  const { t } = useTranslation();
  return (
    <MergedScreen title={t('screens.vitals')} sections={[
      { id: 'readings', label: t('screens.readings'), render: () => <VitalsPage /> },
      { id: 'devices', label: t('screens.devices'), render: () => <WearablesPage /> },
    ]} />
  );
}

/** Keeping track of symptoms, and checking one. */
export function TrackCheckScreen() {
  const { t } = useTranslation();
  return (
    <MergedScreen title={t('screens.trackCheck')} sections={[
      { id: 'track', label: t('screens.track'), render: () => <SymptomTrackerPage /> },
      { id: 'check', label: t('screens.check'), render: () => <SymptomCheckerPage /> },
    ]} />
  );
}

/** Appointments, including the ones held by video. */
export function VisitsScreen() {
  const { t } = useTranslation();
  return (
    <MergedScreen title={t('screens.visits')} sections={[
      { id: 'appointments', label: t('screens.appointments'), render: () => <AppointmentsPage /> },
      { id: 'video', label: t('screens.video'), render: () => <TelehealthPage /> },
    ]} />
  );
}

/** One inbox: conversations with the care team, and notices from the system. */
export function InboxScreen() {
  const { t } = useTranslation();
  return (
    <MergedScreen title={t('screens.inbox')} sections={[
      { id: 'messages', label: t('screens.messages'), render: () => <MessagesPage /> },
      { id: 'notifications', label: t('screens.notifications'), render: () => <NotificationsPage /> },
    ]} />
  );
}
