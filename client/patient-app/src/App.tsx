import { useTextSize } from './hooks/useTextSize';
import { usePatientAuthStore } from './store/authStore';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Layout, I18nProvider, DialogHost, TransactionAuthorizationHost } from '@medichain/shared';
import { ToastProvider } from './components/Toast';
import { MovedTo } from './components/MergedScreen';

// Critical-path pages stay eager so the first paint needs no extra round-trip.
import { LoginPage } from './pages/LoginPage';
import { ActivatePage } from './pages/ActivatePage';
import { DashboardPage } from './pages/DashboardPage';

// Everything else is route-split so a page's code only loads when visited.
// Named-export pages are adapted to the default-export shape React.lazy expects.
const MyProfilePage = lazy(() =>
  import('./pages/MyProfilePage').then((m) => ({ default: m.MyProfilePage }))
);
const MyRecordsPage = lazy(() =>
  import('./pages/MyRecordsPage').then((m) => ({ default: m.MyRecordsPage }))
);
const SatisfactionSurveyPage = lazy(() => import('./pages/SatisfactionSurveyPage'));
const MePage = lazy(() => import('./pages/MePage'));
const MyHealthPage = lazy(() => import('./pages/MyHealthPage'));
const MedicationsPage = lazy(() => import('./pages/MedicationsPage').then((m) => ({ default: m.MedicationsPage })));
const LabResultsPage = lazy(() => import('./pages/LabResultsPage').then((m) => ({ default: m.LabResultsPage })));
const VitalsScreen = lazy(() => import('./pages/TabScreens').then((m) => ({ default: m.VitalsScreen })));
const TrackCheckScreen = lazy(() => import('./pages/TabScreens').then((m) => ({ default: m.TrackCheckScreen })));
const VisitsScreen = lazy(() => import('./pages/TabScreens').then((m) => ({ default: m.VisitsScreen })));
const InboxScreen = lazy(() => import('./pages/TabScreens').then((m) => ({ default: m.InboxScreen })));
const PrivacyScreen = lazy(() => import('./pages/MeScreens').then((m) => ({ default: m.PrivacyScreen })));
const EmergencyCardScreen = lazy(() => import('./pages/MeScreens').then((m) => ({ default: m.EmergencyCardScreen })));
const CardsScreen = lazy(() => import('./pages/MeScreens').then((m) => ({ default: m.CardsScreen })));
const AppSettingsScreen = lazy(() => import('./pages/MeScreens').then((m) => ({ default: m.AppSettingsScreen })));
const MedicalHistoryPage = lazy(() =>
  import('./pages/MedicalHistoryPage').then((m) => ({ default: m.MedicalHistoryPage }))
);

/** Fallback shown while a lazy route chunk is loading. */
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-content-muted">Loading...</p>
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
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
function App() {
  useTextSize();
  const logout = usePatientAuthStore(state => state.logout);
  const isAuthenticated = usePatientAuthStore(state => state.isAuthenticated);
  const location = useLocation();
  return (
    <I18nProvider>
    <ToastProvider>
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivatePage />} />

      {/* Protected routes with layout. The Suspense boundary around Layout
          catches the lazy children it renders through its <Outlet/>. */}
      <Route
        path="/"
        element={
          <Suspense fallback={<PageLoader />}>
            {isAuthenticated ? <Layout variant="patient" onLogout={logout} /> : <Navigate to="/login" replace state={{ from: location }} />}
          </Suspense>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="me" element={<MePage />} />
        <Route path="health" element={<MyHealthPage />} />
        <Route path="profile" element={<MyProfilePage />} />
        <Route path="privacy" element={<PrivacyScreen />} />
        <Route path="cards" element={<CardsScreen />} />
        <Route path="records" element={<MyRecordsPage />} />
        <Route path="consent" element={<MovedTo path="/privacy" />} />
        <Route path="access-history" element={<MovedTo path="/privacy" view="viewed" />} />
        <Route path="emergency-card" element={<EmergencyCardScreen />} />
        <Route path="medications" element={<MedicationsPage />} />
        <Route path="appointments" element={<VisitsScreen />} />
        <Route path="messages" element={<InboxScreen />} />
        <Route path="symptoms" element={<TrackCheckScreen />} />
        <Route path="medical-id" element={<MovedTo path="/emergency-card" view="medical-id" />} />
        <Route path="settings" element={<AppSettingsScreen />} />
        <Route path="reminders" element={<MovedTo path="/medications" />} />
        <Route path="family" element={<MovedTo path="/cards" view="family" />} />
        <Route path="telehealth" element={<MovedTo path="/appointments" view="video" />} />

        {/* New Routes */}
        <Route path="wearables" element={<MovedTo path="/vitals" view="devices" />} />
        <Route path="lab-trends" element={<MovedTo path="/lab-results" />} />
        <Route path="insurance" element={<MovedTo path="/cards" />} />
        <Route path="survey" element={<SatisfactionSurveyPage />} />
        <Route path="symptom-checker" element={<MovedTo path="/symptoms" view="check" />} />
        <Route path="language" element={<MovedTo path="/settings" view="language" />} />
        <Route path="offline-sync" element={<MovedTo path="/settings" view="offline" />} />

        {/* New Pages */}
        <Route path="vitals" element={<VitalsScreen />} />
        <Route path="lab-results" element={<LabResultsPage />} />
        <Route path="notifications" element={<MovedTo path="/messages" view="notifications" />} />
        <Route path="medical-history" element={<MedicalHistoryPage />} />
      </Route>

      {/* Catch all - redirect to dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </ToastProvider>
    <DialogHost />
    {/* Class C confirmations for gated actions (ADR-0008). */}
    <TransactionAuthorizationHost />
    </I18nProvider>
  );
}

export default App;
