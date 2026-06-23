import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Layout, I18nProvider } from '@medichain/shared';
import { ToastProvider } from './components/Toast';

// Critical-path pages stay eager so the first paint needs no extra round-trip.
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';

// Everything else is route-split so a page's code only loads when visited.
// Named-export pages are adapted to the default-export shape React.lazy expects.
const MyProfilePage = lazy(() =>
  import('./pages/MyProfilePage').then((m) => ({ default: m.MyProfilePage }))
);
const MyRecordsPage = lazy(() =>
  import('./pages/MyRecordsPage').then((m) => ({ default: m.MyRecordsPage }))
);
const ConsentManagementPage = lazy(() =>
  import('./pages/ConsentManagementPage').then((m) => ({ default: m.ConsentManagementPage }))
);
const EmergencyCardPage = lazy(() =>
  import('./pages/EmergencyCardPage').then((m) => ({ default: m.EmergencyCardPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const MedicationsPage = lazy(() =>
  import('./pages/MedicationsPage').then((m) => ({ default: m.MedicationsPage }))
);
const AppointmentsPage = lazy(() =>
  import('./pages/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage }))
);
const MessagesPage = lazy(() =>
  import('./pages/MessagesPage').then((m) => ({ default: m.MessagesPage }))
);
const SymptomTrackerPage = lazy(() =>
  import('./pages/SymptomTrackerPage').then((m) => ({ default: m.SymptomTrackerPage }))
);
const MedicalIdPage = lazy(() =>
  import('./pages/MedicalIdPage').then((m) => ({ default: m.MedicalIdPage }))
);
const MedicationRemindersPage = lazy(() =>
  import('./pages/MedicationRemindersPage').then((m) => ({ default: m.MedicationRemindersPage }))
);
const FamilyGroupPage = lazy(() =>
  import('./pages/FamilyGroupPage').then((m) => ({ default: m.FamilyGroupPage }))
);
const TelehealthPage = lazy(() =>
  import('./pages/TelehealthPage').then((m) => ({ default: m.TelehealthPage }))
);
const WearablesPage = lazy(() => import('./pages/WearablesPage'));
const LabTrendsPage = lazy(() => import('./pages/LabTrendsPage'));
const InsurancePage = lazy(() => import('./pages/InsurancePage'));
const SatisfactionSurveyPage = lazy(() => import('./pages/SatisfactionSurveyPage'));
const SymptomCheckerPage = lazy(() => import('./pages/SymptomCheckerPage'));
const LanguageSettingsPage = lazy(() => import('./pages/LanguageSettingsPage'));
const OfflineSyncPage = lazy(() => import('./pages/OfflineSyncPage'));
const VitalsPage = lazy(() =>
  import('./pages/VitalsPage').then((m) => ({ default: m.VitalsPage }))
);
const LabResultsPage = lazy(() =>
  import('./pages/LabResultsPage').then((m) => ({ default: m.LabResultsPage }))
);
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage }))
);
const MedicalHistoryPage = lazy(() =>
  import('./pages/MedicalHistoryPage').then((m) => ({ default: m.MedicalHistoryPage }))
);

/** Fallback shown while a lazy route chunk is loading. */
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  );
}

/**
 * MediChain Patient Portal Application
 *
 * Patient-facing interface for:
 * - Viewing medical records and lab results
 * - Managing consent/access permissions
 * - Accessing emergency QR code/NFC card info
 * - Tracking medications and reminders
 * - Wearable device integrations
 * - Telehealth appointments
 * - Family group management
 * - Symptom checking and tracking
 * - Insurance and billing information
 *
 * © 2025 Trustware. All rights reserved.
 */
function App() {
  return (
    <I18nProvider>
    <ToastProvider>
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes with layout. The Suspense boundary around Layout
          catches the lazy children it renders through its <Outlet/>. */}
      <Route
        path="/"
        element={
          <Suspense fallback={<PageLoader />}>
            <Layout variant="patient" />
          </Suspense>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="profile" element={<MyProfilePage />} />
        <Route path="records" element={<MyRecordsPage />} />
        <Route path="consent" element={<ConsentManagementPage />} />
        <Route path="emergency-card" element={<EmergencyCardPage />} />
        <Route path="medications" element={<MedicationsPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="symptoms" element={<SymptomTrackerPage />} />
        <Route path="medical-id" element={<MedicalIdPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="reminders" element={<MedicationRemindersPage />} />
        <Route path="family" element={<FamilyGroupPage />} />
        <Route path="telehealth" element={<TelehealthPage />} />

        {/* New Routes */}
        <Route path="wearables" element={<WearablesPage />} />
        <Route path="lab-trends" element={<LabTrendsPage />} />
        <Route path="insurance" element={<InsurancePage />} />
        <Route path="survey" element={<SatisfactionSurveyPage />} />
        <Route path="symptom-checker" element={<SymptomCheckerPage />} />
        <Route path="language" element={<LanguageSettingsPage />} />
        <Route path="offline-sync" element={<OfflineSyncPage />} />

        {/* New Pages */}
        <Route path="vitals" element={<VitalsPage />} />
        <Route path="lab-results" element={<LabResultsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="medical-history" element={<MedicalHistoryPage />} />
      </Route>

      {/* Catch all - redirect to dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </ToastProvider>
    </I18nProvider>
  );
}

export default App;
