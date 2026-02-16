import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@medichain/shared';
import { ToastProvider } from './components/Toast';
import {
  LoginPage,
  DashboardPage,
  MyProfilePage,
  MyRecordsPage,
  ConsentManagementPage,
  EmergencyCardPage,
  SettingsPage,
  MedicationsPage,
  AppointmentsPage,
  MessagesPage,
  SymptomTrackerPage,
  MedicalIdPage,
  MedicationRemindersPage,
  FamilyGroupPage,
  TelehealthPage,
  WearablesPage,
  LabTrendsPage,
  InsurancePage,
  SatisfactionSurveyPage,
  SymptomCheckerPage,
  LanguageSettingsPage,
  OfflineSyncPage,
} from './pages';

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
    <ToastProvider>
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes with layout */}
      <Route path="/" element={<Layout variant="patient" />}>
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
      </Route>

      {/* Catch all - redirect to dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </ToastProvider>
  );
}

export default App;
