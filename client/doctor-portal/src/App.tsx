import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EmergencyAccessPage from './pages/EmergencyAccessPage';
import PatientSearchPage from './pages/PatientSearchPage';
import PatientDetailPage from './pages/PatientDetailPage';
import RegisterPatientPage from './pages/RegisterPatientPage';
import AccessLogsPage from './pages/AccessLogsPage';
import LabResultsPage from './pages/LabResultsPage';
import SettingsPage from './pages/SettingsPage';

/**
 * Protected route wrapper - ensures user is authenticated
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/**
 * Main App component with routing
 */
function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="emergency" element={<EmergencyAccessPage />} />
        <Route path="patients" element={<PatientSearchPage />} />
        <Route path="patients/:patientId" element={<PatientDetailPage />} />
        <Route path="register" element={<RegisterPatientPage />} />
        <Route path="access-logs" element={<AccessLogsPage />} />
        <Route path="lab-results" element={<LabResultsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
