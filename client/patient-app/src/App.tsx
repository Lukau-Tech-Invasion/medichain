import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@shared/components';
import {
  LoginPage,
  DashboardPage,
  MyProfilePage,
  MyRecordsPage,
  ConsentManagementPage,
  EmergencyCardPage,
  SettingsPage,
} from './pages';

/**
 * MediChain Patient Portal Application
 * 
 * Patient-facing interface for:
 * - Viewing medical records
 * - Managing consent/access permissions
 * - Accessing emergency QR code/NFC card info
 * - Viewing access history
 * 
 * © 2025 Trustware. All rights reserved.
 */
function App() {
  return (
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
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* Catch all - redirect to dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
