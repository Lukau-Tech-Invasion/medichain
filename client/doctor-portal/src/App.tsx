import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';

// Authentication & Core
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';

// Patient Management
import PatientSearchPage from './pages/PatientSearchPage';
import PatientDetailPage from './pages/PatientDetailPage';
import RegisterPatientPage from './pages/RegisterPatientPage';
import AccessLogsPage from './pages/AccessLogsPage';

// Clinical Documentation
import TriagePage from './pages/TriagePage';
import SOAPNotePage from './pages/SOAPNotePage';
import VitalSignsPage from './pages/VitalSignsPage';
import ProgressNotePage from './pages/ProgressNotePage';
import HistoryAndPhysicalPage from './pages/HistoryAndPhysicalPage';
import DischargePage from './pages/DischargePage';
import ConsultPage from './pages/ConsultPage';
import AMAPage from './pages/AMAPage';

// Emergency Protocols
import EmergencyAccessPage from './pages/EmergencyAccessPage';
import EmergencyProtocolsPage from './pages/EmergencyProtocolsPage';
import CodeBluePage from './pages/CodeBluePage';
import TraumaPage from './pages/TraumaPage';
import StrokePage from './pages/StrokePage';
import CardiacPage from './pages/CardiacPage';
import SepsisPage from './pages/SepsisPage';
import MCIPage from './pages/MCIPage';

// Nursing
import NursingPage from './pages/NursingPage';
import NursingCarePlanPage from './pages/NursingCarePlanPage';
import MARPage from './pages/MARPage';
import CarePlanPage from './pages/CarePlanPage';
import IntakeOutputPage from './pages/IntakeOutputPage';
import WoundCarePage from './pages/WoundCarePage';
import IVSitePage from './pages/IVSitePage';
import ShiftHandoffPage from './pages/ShiftHandoffPage';
import FallRiskPage from './pages/FallRiskPage';
import IncidentReportPage from './pages/IncidentReportPage';

// Medications & Orders
import OrdersPage from './pages/OrdersPage';
import EPrescribePage from './pages/EPrescribePage';
import MedicationAdminPage from './pages/MedicationAdminPage';
import DrugInteractionsPage from './pages/DrugInteractionsPage';

// Specialty
import BurnPage from './pages/BurnPage';
import PsychPage from './pages/PsychPage';
import ToxicologyPage from './pages/ToxicologyPage';
import PediatricsPage from './pages/PediatricsPage';
import ObstetricsPage from './pages/ObstetricsPage';

// Procedures
import IntubationPage from './pages/IntubationPage';
import LacerationRepairPage from './pages/LacerationRepairPage';
import SplintPage from './pages/SplintPage';

// Surgical
import PreOpPage from './pages/PreOpPage';
import OperativeNotePage from './pages/OperativeNotePage';
import PostOpPage from './pages/PostOpPage';
import AnesthesiaPage from './pages/AnesthesiaPage';

// Lab & Diagnostics
import LabResultsPage from './pages/LabResultsPage';
import LabResultPage from './pages/LabResultPage';
import SpecimenPage from './pages/SpecimenPage';
import ChainOfCustodyPage from './pages/ChainOfCustodyPage';
import LabQCPage from './pages/LabQCPage';
import CriticalValuePage from './pages/CriticalValuePage';
import BloodBankPage from './pages/BloodBankPage';

// Imaging & Radiology
import ImagingPage from './pages/ImagingPage';
import RadiologyPage from './pages/RadiologyPage';
import PathologyPage from './pages/PathologyPage';

// Patient History & Health Maintenance
import ImmunizationPage from './pages/ImmunizationPage';
import FamilyHistoryPage from './pages/FamilyHistoryPage';

// Administrative & Morgue
import DeathCertificatePage from './pages/DeathCertificatePage';
import AutopsyPage from './pages/AutopsyPage';

// Admin Portal
import AdminDashboardPage from './pages/AdminDashboardPage';
import UserManagementPage from './pages/UserManagementPage';
import OrderSetsPage from './pages/OrderSetsPage';
import NoteTemplatesPage from './pages/NoteTemplatesPage';
import BarcodePage from './pages/BarcodePage';
import AnalyticsPage from './pages/AnalyticsPage';
import CDSAlertsPage from './pages/CDSAlertsPage';

// Scheduling
import AppointmentSchedulerPage from './pages/AppointmentSchedulerPage';

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
 * MediChain Doctor Portal - Main App Component
 * 
 * Comprehensive healthcare provider interface with:
 * - Clinical documentation (SOAP, H&P, Progress Notes)
 * - Emergency protocols (Code Blue, Trauma, Stroke, Cardiac, Sepsis, MCI)
 * - Nursing documentation (MAR, Care Plans, I/O, Wound Care)
 * - Lab & Radiology ordering and results
 * - Surgical documentation (Pre-Op, Op Notes, Post-Op, Anesthesia)
 * - Specialty modules (Burn, Psych, Toxicology, Pediatrics, OB)
 * - Admin functions (User Management, Analytics, CDS Alerts)
 * 
 * © 2025 Trustware. All rights reserved.
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
        {/* Core Navigation */}
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="settings" element={<SettingsPage />} />

        {/* Patient Management */}
        <Route path="patients" element={<PatientSearchPage />} />
        <Route path="patients/:patientId" element={<PatientDetailPage />} />
        <Route path="register" element={<RegisterPatientPage />} />
        <Route path="access-logs" element={<AccessLogsPage />} />

        {/* Clinical Documentation */}
        <Route path="triage" element={<TriagePage />} />
        <Route path="soap" element={<SOAPNotePage />} />
        <Route path="vitals" element={<VitalSignsPage />} />
        <Route path="progress-note" element={<ProgressNotePage />} />
        <Route path="history-physical" element={<HistoryAndPhysicalPage />} />
        <Route path="discharge" element={<DischargePage />} />
        <Route path="consult" element={<ConsultPage />} />
        <Route path="ama" element={<AMAPage />} />

        {/* Emergency Protocols */}
        <Route path="emergency" element={<EmergencyAccessPage />} />
        <Route path="emergency-protocols" element={<EmergencyProtocolsPage />} />
        <Route path="code-blue" element={<CodeBluePage />} />
        <Route path="trauma" element={<TraumaPage />} />
        <Route path="stroke" element={<StrokePage />} />
        <Route path="cardiac" element={<CardiacPage />} />
        <Route path="sepsis" element={<SepsisPage />} />
        <Route path="mci" element={<MCIPage />} />

        {/* Nursing */}
        <Route path="nursing" element={<NursingPage />} />
        <Route path="nursing-care-plan" element={<NursingCarePlanPage />} />
        <Route path="mar" element={<MARPage />} />
        <Route path="care-plan" element={<CarePlanPage />} />
        <Route path="intake-output" element={<IntakeOutputPage />} />
        <Route path="wound-care" element={<WoundCarePage />} />
        <Route path="iv-site" element={<IVSitePage />} />
        <Route path="shift-handoff" element={<ShiftHandoffPage />} />
        <Route path="fall-risk" element={<FallRiskPage />} />
        <Route path="incident-report" element={<IncidentReportPage />} />

        {/* Medications & Orders */}
        <Route path="orders" element={<OrdersPage />} />
        <Route path="e-prescribe" element={<EPrescribePage />} />
        <Route path="medication-admin" element={<MedicationAdminPage />} />
        <Route path="drug-interactions" element={<DrugInteractionsPage />} />

        {/* Specialty */}
        <Route path="burn" element={<BurnPage />} />
        <Route path="psych" element={<PsychPage />} />
        <Route path="toxicology" element={<ToxicologyPage />} />
        <Route path="pediatrics" element={<PediatricsPage />} />
        <Route path="obstetrics" element={<ObstetricsPage />} />

        {/* Procedures */}
        <Route path="intubation" element={<IntubationPage />} />
        <Route path="laceration-repair" element={<LacerationRepairPage />} />
        <Route path="splint" element={<SplintPage />} />

        {/* Surgical */}
        <Route path="pre-op" element={<PreOpPage />} />
        <Route path="operative-note" element={<OperativeNotePage />} />
        <Route path="post-op" element={<PostOpPage />} />
        <Route path="anesthesia" element={<AnesthesiaPage />} />

        {/* Lab & Diagnostics */}
        <Route path="lab-results" element={<LabResultsPage />} />
        <Route path="lab-result/:resultId" element={<LabResultPage />} />
        <Route path="specimen" element={<SpecimenPage />} />
        <Route path="chain-of-custody" element={<ChainOfCustodyPage />} />
        <Route path="lab-qc" element={<LabQCPage />} />
        <Route path="critical-value" element={<CriticalValuePage />} />
        <Route path="blood-bank" element={<BloodBankPage />} />

        {/* Imaging & Radiology */}
        <Route path="imaging" element={<ImagingPage />} />
        <Route path="radiology" element={<RadiologyPage />} />
        <Route path="pathology" element={<PathologyPage />} />

        {/* Patient History & Health Maintenance */}
        <Route path="immunization" element={<ImmunizationPage />} />
        <Route path="family-history" element={<FamilyHistoryPage />} />

        {/* Administrative & Morgue */}
        <Route path="death-certificate" element={<DeathCertificatePage />} />
        <Route path="autopsy" element={<AutopsyPage />} />

        {/* Admin Portal */}
        <Route path="admin" element={<AdminDashboardPage />} />
        <Route path="user-management" element={<UserManagementPage />} />
        <Route path="order-sets" element={<OrderSetsPage />} />
        <Route path="note-templates" element={<NoteTemplatesPage />} />
        <Route path="barcode" element={<BarcodePage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="cds-alerts" element={<CDSAlertsPage />} />

        {/* Scheduling */}
        <Route path="appointments" element={<AppointmentSchedulerPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
