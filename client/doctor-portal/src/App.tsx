import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import { useThemeStore } from './store/themeStore';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PatientWorkspace } from './workspace/PatientWorkspace';
import { DirectoryReasonGate } from './components/AccessReasonGate';
import { I18nProvider, DialogHost, TransactionAuthorizationHost } from '@medichain/shared';

// Loading fallback for lazy-loaded components
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

// Eager-loaded core pages (critical path)
import { ClinicianOfflineProvider } from './offline/ClinicianOffline';
import LoginPage from './pages/LoginPage';
import ActivatePage from './pages/ActivatePage';
import DashboardPage from './pages/DashboardPage';

// Lazy-loaded pages grouped by feature for optimal chunking
// Patient Management
const PatientSearchPage = lazy(() => import('./pages/PatientSearchPage'));
const PatientDetailPage = lazy(() => import('./pages/PatientDetailPage'));
const AmbulanceRunPage = lazy(() => import('./ems/AmbulanceRunPage'));
const IncomingAmbulancesPage = lazy(() => import('./ems/IncomingAmbulancesPage'));
const TodayPage = lazy(() => import('./pages/TodayPage'));
const WardRosterPage = lazy(() => import('./pages/WardRosterPage'));

const RegisterPatientPage = lazy(() => import('./pages/RegisterPatientPage'));
const AccessLogsPage = lazy(() => import('./pages/AccessLogsPage'));
const ManagedDevicesPage = lazy(() => import('./pages/ManagedDevicesPage'));
const RetentionPage = lazy(() => import('./pages/RetentionPage'));
const SecurityIncidentsPage = lazy(() => import('./pages/SecurityIncidentsPage'));
const NationalIdReviewsPage = lazy(() => import('./pages/NationalIdReviewsPage'));
const LabReviewPage = lazy(() => import('./pages/LabReviewPage'));

// Settings
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));

// Clinical Documentation
const TriagePage = lazy(() => import('./pages/TriagePage'));
const SOAPNotePage = lazy(() => import('./pages/SOAPNotePage'));
const VitalSignsPage = lazy(() => import('./pages/VitalSignsPage'));
const ProgressNotePage = lazy(() => import('./pages/ProgressNotePage'));
const HistoryAndPhysicalPage = lazy(() => import('./pages/HistoryAndPhysicalPage'));
const DischargePage = lazy(() => import('./pages/DischargePage'));
const ConsultPage = lazy(() => import('./pages/ConsultPage'));
const AMAPage = lazy(() => import('./pages/AMAPage'));

// Emergency Protocols
const EmergencyAccessPage = lazy(() => import('./pages/EmergencyAccessPage'));
const EmergencyProtocolsPage = lazy(() => import('./pages/EmergencyProtocolsPage'));
const CodeBluePage = lazy(() => import('./pages/CodeBluePage'));
const TraumaPage = lazy(() => import('./pages/TraumaPage'));
const EmsHandoffPage = lazy(() => import('./pages/EmsHandoffPage'));
const StrokePage = lazy(() => import('./pages/StrokePage'));
const CardiacPage = lazy(() => import('./pages/CardiacPage'));
const SepsisPage = lazy(() => import('./pages/SepsisPage'));
const MCIPage = lazy(() => import('./pages/MCIPage'));

// Nursing
const NursingPage = lazy(() => import('./pages/NursingPage'));
const NursingCarePlanPage = lazy(() => import('./pages/NursingCarePlanPage'));
const CarePlanPage = lazy(() => import('./pages/CarePlanPage'));
const IntakeOutputPage = lazy(() => import('./pages/IntakeOutputPage'));
const WoundCarePage = lazy(() => import('./pages/WoundCarePage'));
const IVSitePage = lazy(() => import('./pages/IVSitePage'));
const ShiftHandoffPage = lazy(() => import('./pages/ShiftHandoffPage'));
const FallRiskPage = lazy(() => import('./pages/FallRiskPage'));
const IncidentReportPage = lazy(() => import('./pages/IncidentReportPage'));

// Medications & Orders
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const EPrescribePage = lazy(() => import('./pages/EPrescribePage'));
const MedicationAdminPage = lazy(() => import('./pages/MedicationAdminPage'));
const DrugInteractionsPage = lazy(() => import('./pages/DrugInteractionsPage'));

// Specialty
const BurnPage = lazy(() => import('./pages/BurnPage'));
const PsychPage = lazy(() => import('./pages/PsychPage'));
const ToxicologyPage = lazy(() => import('./pages/ToxicologyPage'));
const PediatricsPage = lazy(() => import('./pages/PediatricsPage'));
const ObstetricsPage = lazy(() => import('./pages/ObstetricsPage'));

// Procedures
const IntubationPage = lazy(() => import('./pages/IntubationPage'));
const LacerationRepairPage = lazy(() => import('./pages/LacerationRepairPage'));
const SplintPage = lazy(() => import('./pages/SplintPage'));

// Surgical
const PreOpPage = lazy(() => import('./pages/PreOpPage'));
const OperativeNotePage = lazy(() => import('./pages/OperativeNotePage'));
const PostOpPage = lazy(() => import('./pages/PostOpPage'));
const AnesthesiaPage = lazy(() => import('./pages/AnesthesiaPage'));

// Lab & Diagnostics
const LabResultsPage = lazy(() => import('./pages/LabResultsPage'));
const LabResultPage = lazy(() => import('./pages/LabResultPage'));
const SpecimenPage = lazy(() => import('./pages/SpecimenPage'));
const ChainOfCustodyPage = lazy(() => import('./pages/ChainOfCustodyPage'));
const LabQCPage = lazy(() => import('./pages/LabQCPage'));
const CriticalValuePage = lazy(() => import('./pages/CriticalValuePage'));
const BloodBankPage = lazy(() => import('./pages/BloodBankPage'));

// Imaging & Radiology
const ImagingPage = lazy(() => import('./pages/ImagingPage'));
const RadiologyPage = lazy(() => import('./pages/RadiologyPage'));
const PathologyPage = lazy(() => import('./pages/PathologyPage'));

// Patient History & Health Maintenance
const ImmunizationPage = lazy(() => import('./pages/ImmunizationPage'));
const FamilyHistoryPage = lazy(() => import('./pages/FamilyHistoryPage'));

// Administrative & Morgue
const DeathCertificatePage = lazy(() => import('./pages/DeathCertificatePage'));
const HealthIdCardsPage = lazy(() => import('./pages/HealthIdCardsPage'));
const AutopsyPage = lazy(() => import('./pages/AutopsyPage'));

// Admin Portal
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage'));
const ClaimsEobPage = lazy(() => import('./pages/ClaimsEobPage'));
const ResearchExportsPage = lazy(() => import('./pages/ResearchExportsPage'));
const OrderSetsPage = lazy(() => import('./pages/OrderSetsPage'));
const NoteTemplatesPage = lazy(() => import('./pages/NoteTemplatesPage'));
const BarcodePage = lazy(() => import('./pages/BarcodePage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const CDSAlertsPage = lazy(() => import('./pages/CDSAlertsPage'));

// Scheduling
const AppointmentSchedulerPage = lazy(() => import('./pages/AppointmentSchedulerPage'));
const ProviderSchedulePage = lazy(() => import('./pages/ProviderSchedulePage'));

// Telehealth & Messaging
const TelehealthPage = lazy(() => import('./pages/TelehealthPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));

// Role-Specific Dashboards
const NurseDashboardPage = lazy(() => import('./pages/NurseDashboardPage'));
const LabTechDashboardPage = lazy(() => import('./pages/LabTechDashboardPage'));
const PharmacistDashboardPage = lazy(() => import('./pages/PharmacistDashboardPage'));

/**
 * Protected route wrapper - ensures user is authenticated
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated || !user) {
    // Remember where they were going; sign-in returns them there.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

/**
 * Smart Dashboard Router - Routes users to their role-specific dashboard
 * Following the Role-Based Dashboard Research document requirements
 */
function SmartDashboardRouter() {
  const { user } = useAuthStore();
  const role = user?.role?.toLowerCase() || 'doctor';

  switch (role) {
    case 'admin':
      return <Suspense fallback={<PageLoader />}><AdminDashboardPage /></Suspense>;
    case 'nurse':
      return <Suspense fallback={<PageLoader />}><NurseDashboardPage /></Suspense>;
    case 'labtechnician':
    case 'lab_technician':
    case 'lab':
      return <Suspense fallback={<PageLoader />}><LabTechDashboardPage /></Suspense>;
    case 'pharmacist':
      return <Suspense fallback={<PageLoader />}><PharmacistDashboardPage /></Suspense>;
    case 'paramedic':
      return <Navigate to="/ems-run" replace />;
    case 'doctor':
    default:
      return <DashboardPage />;
  }
}

/** The dashboard each role owns, keyed by the normalised role name. */
const DASHBOARD_ROLES: Record<string, string> = {
  doctor: 'doctor',
  nurse: 'nurse',
  labtechnician: 'lab',
  lab_technician: 'lab',
  lab: 'lab',
  pharmacist: 'pharmacist',
  admin: 'admin',
};

/**
 * A role's own dashboard, opened directly.
 *
 * These aliases rendered for anyone signed in, so a pharmacist could open the
 * nurse's ward board by typing its address. The endpoints behind each panel
 * enforce their own roles, so the result was a screen of refusals rather than
 * a leak -- still the wrong answer. Anyone else is sent to their own dashboard.
 */
function OwnDashboard({ dashboard, children }: { dashboard: string; children: React.ReactNode }) {
  const { user } = useAuthStore();
  const own = DASHBOARD_ROLES[user?.role?.toLowerCase() ?? ''];
  if (own !== dashboard) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/**
 * Suspense wrapper for lazy-loaded routes
 */
function LazyRoute({ element }: { element: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{element}</Suspense>;
}

/**
 * Every patient-scoped form, by route segment, for the patient workspace
 * (`/patients/:patientId/:form`). The same elements the flat routes use, so a
 * form behaves identically wherever it is opened.
 */
const PATIENT_FORM_ELEMENTS: Record<string, React.ReactNode> = {
  'ama': <LazyRoute element={<AMAPage />} />,
  'anesthesia': <LazyRoute element={<AnesthesiaPage />} />,
  'appointments': <LazyRoute element={<AppointmentSchedulerPage />} />,
  'autopsy': <LazyRoute element={<AutopsyPage />} />,
  'blood-bank': <LazyRoute element={<BloodBankPage />} />,
  'burn': <LazyRoute element={<BurnPage />} />,
  'cardiac': <LazyRoute element={<CardiacPage />} />,
  'care-plan': <LazyRoute element={<CarePlanPage />} />,
  'cds-alerts': <LazyRoute element={<CDSAlertsPage />} />,
  'chain-of-custody': <LazyRoute element={<ChainOfCustodyPage />} />,
  'claims-eob': <LazyRoute element={<ClaimsEobPage />} />,
  'code-blue': <LazyRoute element={<CodeBluePage />} />,
  'consult': <LazyRoute element={<ConsultPage />} />,
  'critical-value': <LazyRoute element={<CriticalValuePage />} />,
  'death-certificate': <LazyRoute element={<DeathCertificatePage />} />,
  'discharge': <LazyRoute element={<DischargePage />} />,
  'drug-interactions': <LazyRoute element={<DrugInteractionsPage />} />,
  'e-prescribe': <LazyRoute element={<EPrescribePage />} />,
  'emergency-protocols': <LazyRoute element={<EmergencyProtocolsPage />} />,
  'ems-handoff': <LazyRoute element={<EmsHandoffPage />} />,
  'fall-risk': <LazyRoute element={<FallRiskPage />} />,
  'family-history': <LazyRoute element={<FamilyHistoryPage />} />,
  'health-id-cards': <LazyRoute element={<HealthIdCardsPage />} />,
  'history-physical': <LazyRoute element={<HistoryAndPhysicalPage />} />,
  'imaging': <LazyRoute element={<ImagingPage />} />,
  'immunization': <LazyRoute element={<ImmunizationPage />} />,
  'incident-report': <LazyRoute element={<IncidentReportPage />} />,
  'intake-output': <LazyRoute element={<IntakeOutputPage />} />,
  'intubation': <LazyRoute element={<IntubationPage />} />,
  'iv-site': <LazyRoute element={<IVSitePage />} />,
  'lab-results': <LazyRoute element={<LabResultsPage />} />,
  'laceration-repair': <LazyRoute element={<LacerationRepairPage />} />,
  'mar': <LazyRoute element={<MedicationAdminPage />} />,
  'medication-admin': <LazyRoute element={<MedicationAdminPage />} />,
  'nursing': <LazyRoute element={<NursingPage />} />,
  'nursing-care-plan': <LazyRoute element={<NursingCarePlanPage />} />,
  'obstetrics': <LazyRoute element={<ObstetricsPage />} />,
  'operative-note': <LazyRoute element={<OperativeNotePage />} />,
  'orders': <LazyRoute element={<OrdersPage />} />,
  'pathology': <LazyRoute element={<PathologyPage />} />,
  'pediatrics': <LazyRoute element={<PediatricsPage />} />,
  'post-op': <LazyRoute element={<PostOpPage />} />,
  'pre-op': <LazyRoute element={<PreOpPage />} />,
  'progress-note': <LazyRoute element={<ProgressNotePage />} />,
  'psych': <LazyRoute element={<PsychPage />} />,
  'retention': <LazyRoute element={<RetentionPage />} />,
  'sepsis': <LazyRoute element={<SepsisPage />} />,
  'shift-handoff': <LazyRoute element={<ShiftHandoffPage />} />,
  'soap': <LazyRoute element={<SOAPNotePage />} />,
  'specimen': <LazyRoute element={<SpecimenPage />} />,
  'splint': <LazyRoute element={<SplintPage />} />,
  'stroke': <LazyRoute element={<StrokePage />} />,
  'telehealth': <LazyRoute element={<TelehealthPage />} />,
  'toxicology': <LazyRoute element={<ToxicologyPage />} />,
  'trauma': <LazyRoute element={<TraumaPage />} />,
  'triage': <LazyRoute element={<TriagePage />} />,
  'vitals': <LazyRoute element={<VitalSignsPage />} />,
  'wound-care': <LazyRoute element={<WoundCarePage />} />,
};

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
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  
  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivatePage />} />

      {/* Protected routes - wrapped in Suspense for lazy loading */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <ClinicianOfflineProvider>
              <DirectoryReasonGate>
                <Suspense fallback={<PageLoader />}>
                  <Layout />
                </Suspense>
              </DirectoryReasonGate>
            </ClinicianOfflineProvider>
          </ProtectedRoute>
        }
      >
        {/* Core Navigation */}
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<SmartDashboardRouter />} />
        <Route path="settings" element={<LazyRoute element={<SettingsPage />} />} />
        {/* The header bell has always navigated here. Until now no route
            served it, so the catch-all redirected every click to the
            dashboard -- the badge was visible and its list was not. */}
        <Route path="notifications" element={<LazyRoute element={<NotificationsPage />} />} />

        {/* Role-Specific Dashboards (direct access) */}
        <Route path="dashboard/doctor" element={<OwnDashboard dashboard="doctor"><DashboardPage /></OwnDashboard>} />
        <Route path="dashboard/nurse" element={<OwnDashboard dashboard="nurse"><LazyRoute element={<NurseDashboardPage />} /></OwnDashboard>} />
        <Route path="dashboard/lab" element={<OwnDashboard dashboard="lab"><LazyRoute element={<LabTechDashboardPage />} /></OwnDashboard>} />
        <Route path="dashboard/pharmacist" element={<OwnDashboard dashboard="pharmacist"><LazyRoute element={<PharmacistDashboardPage />} /></OwnDashboard>} />
        <Route path="dashboard/admin" element={<OwnDashboard dashboard="admin"><LazyRoute element={<AdminDashboardPage />} /></OwnDashboard>} />

        {/* Patient Management */}
        <Route path="patients" element={<LazyRoute element={<PatientSearchPage />} />} />
        <Route path="patients/:patientId" element={<PatientWorkspace forms={PATIENT_FORM_ELEMENTS} home={<LazyRoute element={<PatientDetailPage />} />} />} />
        <Route path="ems-run" element={<LazyRoute element={<AmbulanceRunPage />} />} />
        <Route path="ems-run/:runId" element={<LazyRoute element={<AmbulanceRunPage />} />} />
        <Route path="ems-incoming" element={<LazyRoute element={<IncomingAmbulancesPage />} />} />
        <Route path="today" element={<LazyRoute element={<TodayPage />} />} />
        <Route path="wards" element={<LazyRoute element={<WardRosterPage />} />} />
        <Route path="patients/:patientId/:form" element={<PatientWorkspace forms={PATIENT_FORM_ELEMENTS} home={<LazyRoute element={<PatientDetailPage />} />} />} />
        <Route path="register" element={<LazyRoute element={<RegisterPatientPage />} />} />
        <Route path="access-logs" element={<LazyRoute element={<AccessLogsPage />} />} />
        <Route path="devices" element={<LazyRoute element={<ManagedDevicesPage />} />} />
        <Route path="retention" element={<LazyRoute element={<RetentionPage />} />} />
        <Route path="security-incidents" element={<LazyRoute element={<SecurityIncidentsPage />} />} />
        <Route path="national-id-reviews" element={<LazyRoute element={<NationalIdReviewsPage />} />} />
        <Route path="lab-review" element={<LazyRoute element={<LabReviewPage />} />} />

        {/* Clinical Documentation */}
        <Route path="triage" element={<LazyRoute element={<TriagePage />} />} />
        <Route path="soap" element={<LazyRoute element={<SOAPNotePage />} />} />
        <Route path="vitals" element={<LazyRoute element={<VitalSignsPage />} />} />
        <Route path="progress-note" element={<LazyRoute element={<ProgressNotePage />} />} />
        <Route path="history-physical" element={<LazyRoute element={<HistoryAndPhysicalPage />} />} />
        <Route path="discharge" element={<LazyRoute element={<DischargePage />} />} />
        <Route path="consult" element={<LazyRoute element={<ConsultPage />} />} />
        <Route path="ama" element={<LazyRoute element={<AMAPage />} />} />

        {/* Emergency Protocols */}
        <Route path="emergency" element={<LazyRoute element={<EmergencyAccessPage />} />} />
        <Route path="emergency-protocols" element={<LazyRoute element={<EmergencyProtocolsPage />} />} />
        <Route path="code-blue" element={<LazyRoute element={<CodeBluePage />} />} />
        <Route path="trauma" element={<LazyRoute element={<TraumaPage />} />} />
        <Route path="ems-handoff" element={<LazyRoute element={<EmsHandoffPage />} />} />
        <Route path="stroke" element={<LazyRoute element={<StrokePage />} />} />
        <Route path="cardiac" element={<LazyRoute element={<CardiacPage />} />} />
        <Route path="sepsis" element={<LazyRoute element={<SepsisPage />} />} />
        <Route path="mci" element={<LazyRoute element={<MCIPage />} />} />

        {/* Nursing */}
        <Route path="nursing" element={<LazyRoute element={<NursingPage />} />} />
        <Route path="nursing-care-plan" element={<LazyRoute element={<NursingCarePlanPage />} />} />
        {/* The nurse's MAR. MARPage, which this used to render, read a response
            shape the API never sent and so never listed a prescribed medicine;
            it also invented an 08:00 dose for any free-text frequency. This is
            the page that records doses against real prescriptions. */}
        <Route path="mar" element={<LazyRoute element={<MedicationAdminPage />} />} />
        <Route path="care-plan" element={<LazyRoute element={<CarePlanPage />} />} />
        <Route path="intake-output" element={<LazyRoute element={<IntakeOutputPage />} />} />
        <Route path="wound-care" element={<LazyRoute element={<WoundCarePage />} />} />
        <Route path="iv-site" element={<LazyRoute element={<IVSitePage />} />} />
        <Route path="shift-handoff" element={<LazyRoute element={<ShiftHandoffPage />} />} />
        <Route path="fall-risk" element={<LazyRoute element={<FallRiskPage />} />} />
        <Route path="incident-report" element={<LazyRoute element={<IncidentReportPage />} />} />

        {/* Medications & Orders */}
        <Route path="orders" element={<LazyRoute element={<OrdersPage />} />} />
        <Route path="e-prescribe" element={<LazyRoute element={<EPrescribePage />} />} />
        <Route path="medication-admin" element={<LazyRoute element={<MedicationAdminPage />} />} />
        <Route path="drug-interactions" element={<LazyRoute element={<DrugInteractionsPage />} />} />

        {/* Specialty */}
        <Route path="burn" element={<LazyRoute element={<BurnPage />} />} />
        <Route path="psych" element={<LazyRoute element={<PsychPage />} />} />
        <Route path="toxicology" element={<LazyRoute element={<ToxicologyPage />} />} />
        <Route path="pediatrics" element={<LazyRoute element={<PediatricsPage />} />} />
        <Route path="obstetrics" element={<LazyRoute element={<ObstetricsPage />} />} />

        {/* Procedures */}
        <Route path="intubation" element={<LazyRoute element={<IntubationPage />} />} />
        <Route path="laceration-repair" element={<LazyRoute element={<LacerationRepairPage />} />} />
        <Route path="splint" element={<LazyRoute element={<SplintPage />} />} />

        {/* Surgical */}
        <Route path="pre-op" element={<LazyRoute element={<PreOpPage />} />} />
        <Route path="operative-note" element={<LazyRoute element={<OperativeNotePage />} />} />
        <Route path="post-op" element={<LazyRoute element={<PostOpPage />} />} />
        <Route path="anesthesia" element={<LazyRoute element={<AnesthesiaPage />} />} />

        {/* Lab & Diagnostics */}
        <Route path="lab-results" element={<LazyRoute element={<LabResultsPage />} />} />
        <Route path="lab-result/:resultId" element={<LazyRoute element={<LabResultPage />} />} />
        <Route path="specimen" element={<LazyRoute element={<SpecimenPage />} />} />
        <Route path="chain-of-custody" element={<LazyRoute element={<ChainOfCustodyPage />} />} />
        <Route path="lab-qc" element={<LazyRoute element={<LabQCPage />} />} />
        <Route path="critical-value" element={<LazyRoute element={<CriticalValuePage />} />} />
        <Route path="blood-bank" element={<LazyRoute element={<BloodBankPage />} />} />

        {/* Imaging & Radiology */}
        <Route path="imaging" element={<LazyRoute element={<ImagingPage />} />} />
        <Route path="radiology" element={<LazyRoute element={<RadiologyPage />} />} />
        <Route path="pathology" element={<LazyRoute element={<PathologyPage />} />} />

        {/* Patient History & Health Maintenance */}
        <Route path="immunization" element={<LazyRoute element={<ImmunizationPage />} />} />
        <Route path="family-history" element={<LazyRoute element={<FamilyHistoryPage />} />} />

        {/* Administrative & Morgue */}
        <Route path="death-certificate" element={<LazyRoute element={<DeathCertificatePage />} />} />
        <Route path="health-id-cards" element={<LazyRoute element={<HealthIdCardsPage />} />} />
        <Route path="autopsy" element={<LazyRoute element={<AutopsyPage />} />} />

        {/* Admin Portal */}
        <Route path="admin" element={<LazyRoute element={<AdminDashboardPage />} />} />
        <Route path="user-management" element={<LazyRoute element={<UserManagementPage />} />} />
        <Route path="claims-eob" element={<LazyRoute element={<ClaimsEobPage />} />} />
        <Route path="research-exports" element={<LazyRoute element={<ResearchExportsPage />} />} />
        <Route path="order-sets" element={<LazyRoute element={<OrderSetsPage />} />} />
        <Route path="note-templates" element={<LazyRoute element={<NoteTemplatesPage />} />} />
        <Route path="barcode" element={<LazyRoute element={<BarcodePage />} />} />
        <Route path="analytics" element={<LazyRoute element={<AnalyticsPage />} />} />
        <Route path="cds-alerts" element={<LazyRoute element={<CDSAlertsPage />} />} />

        {/* Scheduling */}
        <Route path="appointments" element={<LazyRoute element={<AppointmentSchedulerPage />} />} />
        <Route path="working-hours" element={<LazyRoute element={<ProviderSchedulePage />} />} />

        {/* Telehealth & Messaging */}
        <Route path="telehealth" element={<LazyRoute element={<TelehealthPage />} />} />
        <Route path="messages" element={<LazyRoute element={<MessagesPage />} />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

/**
 * Wrapped App with Error Boundary
 * Catches any unhandled errors and displays a fallback UI
 */
function AppWithErrorBoundary() {
  return (
    <ErrorBoundary
      title="MediChain Error"
      onError={(error, errorInfo) => {
        // In production, send to error tracking service
        console.error('Global error caught:', error);
        console.error('Component stack:', errorInfo.componentStack);
      }}
    >
      <I18nProvider>
        <App />
        <DialogHost />
        {/* Class C confirmations for gated actions (ADR-0008). */}
        <TransactionAuthorizationHost />
      </I18nProvider>
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;
