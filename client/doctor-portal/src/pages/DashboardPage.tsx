import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, usePatientStore } from '../store';
import { apiUrl, useTranslation } from '@medichain/shared';
import { 
  Users, 
  AlertTriangle, 
  ArrowRight,
  Clock,
  TestTube,
  Loader2,
  Heart,
  Siren,
  ClipboardList,
  AlertCircle,
  UserPlus
} from 'lucide-react';
import { Link } from 'react-router-dom';

// API Response types matching backend
interface Patient {
  patient_id: string;
  health_id: string;
  full_name: string;
  date_of_birth: string;
  gender: string;
  blood_type?: string;
  allergies: string[];
  current_medications: string[];
  medical_conditions: string[];
  emergency_contact?: {
    name: string;
    phone: string;
    relationship: string;
  };
}

interface LabSubmission {
  id: string;
  patient_id: string;
  patient_name: string;
  test_name: string;
  submitted_at: string;
  status: string;
  results?: Record<string, unknown>;
}

/**
 * Mirrors `CriticalValueEntity`. The previous shape declared `critical_reason`
 * and `reported_at`, neither of which the API sends: the reason rendered as an
 * empty string after a stray "-", and `new Date(undefined)` printed
 * "Invalid Date" next to a potassium of 6.9.
 */
interface CriticalValue {
  id: string;
  patient_id: string;
  test_name: string;
  value: string;
  unit: string | null;
  severity: string | null;
  critical_low: string | null;
  critical_high: string | null;
  reference_low: string | null;
  reference_high: string | null;
  created_at: string;
  notified_at: string | null;
  acknowledged_at: string | null;
}

interface CodeBlueRecord {
  // API fields (from backend)
  event_id?: string;
  code_leader?: string;
  // Legacy/expected fields
  record_id?: string;
  patient_id: string;
  location: string;
  initiated_at?: string;
  team_leader?: string;
  outcome?: string | { toString: () => string };
}

/**
 * Mirrors `PhysicianOrderEntity`. The previous shape declared `order_id`,
 * `description` and `ordered_at`; the API sends `id`, `order_details` and
 * `order_datetime`, so every order rendered as "lab:" with no text, an
 * "Invalid Date", and — because `key` was undefined for all of them — React
 * could not tell two orders apart.
 */
interface PhysicianOrder {
  id: string;
  patient_id: string;
  order_type: string;
  order_details: { text?: string } | null;
  indication: string | null;
  priority: string;
  order_datetime: string;
  status: string;
}

interface ConsultNote {
  consult_id: string;
  patient_id: string;
  requesting_provider: string;
  consulting_specialty: string;
  reason: string;
  requested_at: string;
  status: string;
}

interface DashboardResponse {
  role: string;
  patients: {
    total: number;
    list: Patient[];
  };
  pending_lab_approvals: LabSubmission[];
  critical_values: CriticalValue[];
  recent_code_blues: CodeBlueRecord[];
  active_orders: PhysicianOrder[];
  pending_consults: ConsultNote[];
  alerts: {
    pending_labs_count: number;
    critical_values_count: number;
    code_blues_count: number;
  };
}

/**
 * Format a timestamp, or return an em dash.
 *
 * `new Date(undefined).toLocaleString()` renders the literal string
 * "Invalid Date", which on a clinical dashboard sits where a time should be and
 * looks like a data-integrity fault rather than a missing field. An absent
 * timestamp should read as absent.
 */
function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? '—' : when.toLocaleString();
}

/** The breached limit, so a critical value is interpretable without the LIS. */
function criticalRange(cv: CriticalValue): string {
  if (cv.critical_high) return `critical > ${cv.critical_high}`;
  if (cv.critical_low) return `critical < ${cv.critical_low}`;
  if (cv.reference_low && cv.reference_high) {
    return `ref ${cv.reference_low}–${cv.reference_high}`;
  }
  return '';
}

/** The order's clinical text, which lives in `order_details.text`. */
function orderText(order: PhysicianOrder): string {
  return order.order_details?.text?.trim() || order.indication?.trim() || '';
}

/**
 * Stat card component
 */
function StatCard({
  icon, 
  label, 
  value, 
  color,
  loading = false
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string | number;
  color: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-surface rounded-xl shadow p-6">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-content-muted">{label}</p>
          {loading ? (
            <Loader2 className="animate-spin text-content-muted" size={24} />
          ) : (
            <p className="text-2xl font-bold text-content">{value}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout, restoreSession } = useAuthStore();
  const { recentPatients, setRecentPatients } = usePatientStore();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !user) {
      navigate('/login');
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    if (!user) return;
    
    const fetchDashboard = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(apiUrl('/api/dashboard/doctor'), {
          headers: {
            'X-User-Id': user.walletAddress,
            'X-Provider-Role': user.role,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const data: DashboardResponse = await response.json();
          setDashboard(data);
          setApiConnected(true);
          
          // Sync patients to store for recent patients list
          if (data.patients?.list && data.patients.list.length > 0) {
            const mappedPatients = data.patients.list.slice(0, 10).map(p => ({
              patientId: p.patient_id,
              healthId: p.health_id,
              fullName: p.full_name,
              dateOfBirth: p.date_of_birth,
              gender: p.gender,
              bloodType: p.blood_type,
              allergies: p.allergies,
              currentMedications: p.current_medications,
              medicalConditions: p.medical_conditions,
              emergencyContact: p.emergency_contact,
              lastAccessed: new Date().toISOString(),
            }));
            setRecentPatients(mappedPatients);
          }
        } else if (response.status === 401) {
          // Session invalid - try to restore or logout
          const restored = await restoreSession();
          if (!restored) {
            logout();
            navigate('/login');
          }
          return;
        } else {
          const errData = await response.json().catch(() => ({}));
          setError(errData.error || `API Error: ${response.status}`);
          setApiConnected(false);
        }
      } catch (err) {
        setError(t('docDashboard.errorCannotConnect'));
        setApiConnected(false);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
    
    // Refresh dashboard every 30 seconds
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [user, setRecentPatients]);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">
            {t('docDashboard.welcomeBack', { name: user?.username || 'Doctor' })}
          </h1>
          <p className="text-content-muted mt-1">
            {t('docDashboard.subtitle')}
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
          apiConnected
            ? 'bg-ok-subtle text-ok-subtle-fg'
            : 'bg-critical-subtle text-critical-subtle-fg'
        }`}>
          <div className={`w-2 h-2 rounded-full ${apiConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          {apiConnected ? t('docDashboard.apiConnected') : t('docDashboard.apiDisconnected')}
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-critical-subtle border border-critical rounded-lg p-4 text-critical-subtle-fg flex items-center gap-3">
          <AlertCircle size={20} />
          <div>
            <p className="font-medium">{t('docDashboard.connectionErrorTitle')}</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Critical Alerts Banner */}
      {dashboard?.alerts && (dashboard.alerts.critical_values_count > 0 || dashboard.alerts.code_blues_count > 0) && (
        <div className="mb-6 bg-critical text-critical-fg rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Siren className="animate-pulse" size={24} />
            <div>
              <p className="font-bold">{t('docDashboard.criticalAlertsTitle')}</p>
              <p className="text-critical-fg text-sm">
                {t('docDashboard.criticalAlertsSummary', { critical: dashboard.alerts.critical_values_count, codeBlues: dashboard.alerts.code_blues_count })}
              </p>
            </div>
          </div>
          <Link to="/alerts" className="bg-surface text-critical-subtle-fg px-4 py-2 rounded-lg font-medium hover:bg-critical-subtle">
            {t('docDashboard.viewAlertsBtn')}
          </Link>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          icon={<Users className="text-brand" size={24} />}
          label={t('docDashboard.statTotalPatients')}
          value={dashboard?.patients?.total || 0}
          color="bg-brand-subtle"
          loading={loading}
        />
        <StatCard
          icon={<TestTube className="text-caution-subtle-fg" size={24} />}
          label={t('docDashboard.statPendingLabReviews')}
          value={dashboard?.alerts?.pending_labs_count || 0}
          color="bg-caution-subtle"
          loading={loading}
        />
        <StatCard
          icon={<AlertTriangle className="text-critical-subtle-fg" size={24} />}
          label={t('docDashboard.statCriticalValues')}
          value={dashboard?.alerts?.critical_values_count || 0}
          color="bg-critical-subtle"
          loading={loading}
        />
        <StatCard
          icon={<ClipboardList className="text-content-secondary" size={24} />}
          label={t('docDashboard.statActiveOrders')}
          value={dashboard?.active_orders?.length || 0}
          color="bg-surface-sunken"
          loading={loading}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Emergency Access Card */}
        <Link
          to="/emergency"
          className="bg-gradient-to-r from-emergency-500 to-emergency-600 rounded-xl p-6 text-white hover:from-emergency-600 hover:to-emergency-700 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold mb-1">
                <Siren size={20} aria-hidden="true" /> {t('docDashboard.emergencyAccessTitle')}
              </h3>
              <p className="text-emergency-100 text-sm">
                {t('docDashboard.emergencyAccessDesc')}
              </p>
            </div>
            <ArrowRight className="group-hover:translate-x-1 transition-transform" size={24} />
          </div>
        </Link>

        {/* Register Patient Card */}
        <Link
          to="/register"
          className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-xl p-6 text-white hover:from-primary-600 hover:to-primary-700 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold mb-1">
                <UserPlus size={20} aria-hidden="true" /> {t('docDashboard.registerPatientTitle')}
              </h3>
              <p className="text-brand-fg text-sm">
                {t('docDashboard.registerPatientDesc')}
              </p>
            </div>
            <ArrowRight className="group-hover:translate-x-1 transition-transform" size={24} />
          </div>
        </Link>

        {/* Triage Card */}
        <Link
          to="/triage"
          className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl p-6 text-white hover:from-amber-600 hover:to-orange-600 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold mb-1">
                <ClipboardList size={20} aria-hidden="true" /> {t('docDashboard.triageAssessmentTitle')}
              </h3>
              <p className="text-amber-100 text-sm">
                {t('docDashboard.triageAssessmentDesc')}
              </p>
            </div>
            <ArrowRight className="group-hover:translate-x-1 transition-transform" size={24} />
          </div>
        </Link>
      </div>

      {/* Critical Values Alert */}
      {dashboard?.critical_values && dashboard.critical_values.length > 0 && (
        <div className="bg-critical-subtle border border-critical rounded-xl mb-8">
          <div className="p-4 border-b border-critical">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-critical-subtle-fg" size={20} />
              <h2 className="font-semibold text-critical-subtle-fg">{t('docDashboard.criticalLabValuesTitle')}</h2>
              <span className="bg-critical text-critical-fg text-xs px-2 py-0.5 rounded-full animate-pulse">
                {t('docDashboard.urgentBadge', { count: dashboard.critical_values.length })}
              </span>
            </div>
          </div>
          <div className="divide-y divide-red-200">
            {dashboard.critical_values.slice(0, 5).map((cv) => (
              <div
                key={cv.id}
                className="flex items-center justify-between p-4 hover:bg-critical-subtle transition-colors"
              >
                <div>
                  <p className="font-medium text-content">{cv.test_name}</p>
                  {/* The unit and the breached limit are what make the number
                      mean anything — 6.9 is unremarkable in one assay and
                      life-threatening in another. Both were dropped. */}
                  <p className="text-sm text-critical-subtle-fg font-mono">
                    {cv.value}
                    {cv.unit ? ` ${cv.unit}` : ''}
                    {criticalRange(cv) ? ` · ${criticalRange(cv)}` : ''}
                  </p>
                </div>
                {/* `critical-subtle-fg`, matching the value above it, not
                    `content-muted`. A neutral grey is tuned for a neutral
                    surface: on the dark-mode critical tint it measures 3.95:1,
                    below AA. Emphasis here comes from size, which costs no
                    contrast. */}
                <div className="text-right">
                  <p className="text-sm text-critical-subtle-fg">{t('docDashboard.patientLabel', { id: cv.patient_id })}</p>
                  <p className="text-xs text-critical-subtle-fg">
                    {formatWhen(cv.notified_at ?? cv.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Lab Reviews */}
      {dashboard?.pending_lab_approvals && dashboard.pending_lab_approvals.length > 0 && (
        <div className="bg-caution-subtle border border-caution rounded-xl mb-8">
          <div className="p-4 border-b border-caution">
            <div className="flex items-center gap-2">
              <TestTube className="text-caution-subtle-fg" size={20} />
              <h2 className="font-semibold text-caution-subtle-fg">{t('docDashboard.pendingLabReviewsTitle')}</h2>
              <span className="bg-caution text-caution-fg text-xs px-2 py-0.5 rounded-full">
                {dashboard.pending_lab_approvals.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-amber-200">
            {dashboard.pending_lab_approvals.slice(0, 5).map((lab) => (
              <Link
                key={lab.id}
                to={`/lab-results?id=${lab.id}`}
                className="flex items-center justify-between p-4 hover:bg-caution-subtle transition-colors"
              >
                <div>
                  <p className="font-medium text-content">{lab.patient_name}</p>
                  <p className="text-sm text-content-muted">{lab.test_name}</p>
                </div>
                <span className="text-xs text-content-muted">
                  {new Date(lab.submitted_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
          <div className="p-3 bg-caution-subtle rounded-b-xl">
            <Link to="/lab-results" className="text-caution-subtle-fg text-sm font-medium flex items-center gap-1 justify-center">
              {t('docDashboard.viewAllPendingLabs')} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* Recent Code Blues */}
      {dashboard?.recent_code_blues && dashboard.recent_code_blues.length > 0 && (
        <div className="bg-notice-subtle border border-notice rounded-xl mb-8 dark:bg-slate-800 dark:border-slate-600">
          <div className="p-4 border-b border-notice dark:border-slate-600">
            <div className="flex items-center gap-2">
              <Heart className="text-notice-subtle-fg dark:text-blue-400" size={20} />
              <h2 className="font-semibold text-notice-subtle-fg dark:text-blue-300">{t('docDashboard.recentCodeBluesTitle')}</h2>
            </div>
          </div>
          <div className="divide-y divide-blue-200 dark:divide-slate-600">
            {dashboard.recent_code_blues.slice(0, 3).map((code) => {
              // Handle both API field names (event_id/code_leader) and legacy names (record_id/team_leader)
              const recordId = code.event_id || code.record_id || 'unknown';
              const teamLeader = code.code_leader || code.team_leader;
              
              // Convert outcome to readable string - handle enum values
              const outcomeValue = code.outcome ? String(code.outcome) : null;
              const outcomeDisplay = (() => {
                if (!outcomeValue) return t('docDashboard.outcome_inProgress');
                // Handle enum values from API
                switch (outcomeValue) {
                  case 'ROSC': return t('docDashboard.outcome_ROSC');
                  case 'Death': return t('docDashboard.outcome_Death');
                  case 'TransferredOngoing': return t('docDashboard.outcome_TransferredOngoing');
                  case 'FamilyRequestedTermination': return t('docDashboard.outcome_FamilyRequestedTermination');
                  default: return outcomeValue;
                }
              })();
              
              const outcomeClass = (() => {
                if (!outcomeValue || outcomeValue === 'TransferredOngoing') 
                  return 'bg-caution-subtle text-caution-subtle-fg dark:bg-yellow-900/30 dark:text-yellow-300';
                if (outcomeValue === 'ROSC') 
                  return 'bg-ok-subtle text-ok-subtle-fg dark:bg-green-900/30 dark:text-green-300';
                return 'bg-surface-sunken text-content-secondary dark:bg-gray-700 dark:text-gray-300';
              })();

              return (
                <div
                  key={recordId}
                  className="flex items-center justify-between p-4"
                >
                  <div>
                    <p className="font-medium text-content dark:text-white">{t('docDashboard.patientLabel', { id: code.patient_id })}</p>
                    <p className="text-sm text-content-muted dark:text-gray-400">{t('docDashboard.locationLabel', { value: code.location })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-content-muted dark:text-gray-400">{teamLeader || t('docDashboard.noTeamLeader')}</p>
                    <p className={`text-xs px-2 py-1 rounded ${outcomeClass}`}>
                      {outcomeDisplay}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active Orders */}
      {dashboard?.active_orders && dashboard.active_orders.length > 0 && (
        <div className="bg-surface-sunken border border-purple-200 rounded-xl mb-8">
          <div className="p-4 border-b border-purple-200">
            <div className="flex items-center gap-2">
              <ClipboardList className="text-content-secondary" size={20} />
              <h2 className="font-semibold text-content-secondary">{t('docDashboard.activePhysicianOrdersTitle')}</h2>
              <span className="bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">
                {dashboard.active_orders.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-purple-200 max-h-64 overflow-y-auto">
            {dashboard.active_orders.slice(0, 10).map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-4"
              >
                <div>
                  <p className="font-medium text-content">
                    {order.order_type}
                    {orderText(order) ? `: ${orderText(order)}` : ''}
                  </p>
                  <p className="text-sm text-content-muted">{t('docDashboard.patientLabel', { id: order.patient_id })}</p>
                </div>
                <div className="text-right">
                  {/* The API sends lowercase priorities ("stat", "urgent"), so
                      these comparisons never matched and a STAT order rendered
                      in the same neutral grey as a routine one. */}
                  <span className={`text-xs px-2 py-1 rounded ${
                    order.priority?.toLowerCase() === 'stat' ? 'bg-critical-subtle text-critical-subtle-fg' :
                    order.priority?.toLowerCase() === 'urgent' ? 'bg-surface-sunken text-content-secondary' :
                    'bg-surface-sunken text-content-secondary'
                  }`}>
                    {order.priority}
                  </span>
                  <p className="text-xs text-content-muted mt-1">
                    {formatWhen(order.order_datetime)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Patients from API */}
      <div className="bg-surface rounded-xl shadow">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-content">{t('docDashboard.recentPatientsTitle')}</h2>
            <Link to="/patients" className="text-brand hover:text-brand text-sm flex items-center gap-1">
              {t('docDashboard.viewAll')} <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto mb-3 text-gray-300 animate-spin" size={48} />
            <p className="text-content-muted">{t('docDashboard.loadingPatients')}</p>
          </div>
        ) : dashboard?.patients?.list && dashboard.patients.list.length > 0 ? (
          <div className="divide-y divide-border">
            {dashboard.patients.list.slice(0, 8).map((patient) => (
              <Link
                key={patient.patient_id}
                to={`/patients/${patient.patient_id}`}
                className="flex items-center justify-between p-4 hover:bg-surface-sunken transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-brand-subtle rounded-full flex items-center justify-center">
                    <Users className="text-brand" size={20} />
                  </div>
                  <div>
                    <p className="font-medium text-content">{patient.full_name}</p>
                    <p className="text-sm text-content-muted">{patient.health_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {patient.blood_type && (
                    <span className="text-xs bg-critical-subtle text-critical-subtle-fg px-2 py-1 rounded">
                      {patient.blood_type}
                    </span>
                  )}
                  {patient.allergies && patient.allergies.length > 0 && (
                    <span className="text-xs bg-caution-subtle text-caution-subtle-fg px-2 py-1 rounded">
                      {t('docDashboard.allergiesCount', { count: patient.allergies.length })}
                    </span>
                  )}
                  <ArrowRight size={16} className="text-content-muted" />
                </div>
              </Link>
            ))}
          </div>
        ) : recentPatients.length > 0 ? (
          <div className="divide-y divide-border">
            {recentPatients.slice(0, 5).map((patient) => (
              <Link
                key={patient.patientId}
                to={`/patients/${patient.patientId}`}
                className="flex items-center justify-between p-4 hover:bg-surface-sunken transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-brand-subtle rounded-full flex items-center justify-center">
                    <Users className="text-brand" size={20} />
                  </div>
                  <div>
                    <p className="font-medium text-content">{patient.fullName}</p>
                    <p className="text-sm text-content-muted">{patient.patientId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-content-muted">
                  <Clock size={14} />
                  <span>{patient.lastAccessed ? new Date(patient.lastAccessed).toLocaleDateString() : t('docDashboard.naLabel')}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-content-muted">
            <Users className="mx-auto mb-3 text-gray-300" size={48} />
            <p>{t('docDashboard.noPatientsFound')}</p>
            <p className="text-sm mt-1">{t('docDashboard.noPatientsHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
