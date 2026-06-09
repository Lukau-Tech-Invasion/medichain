import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, usePatientStore } from '../store';
import { apiUrl } from '@medichain/shared';
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

interface CriticalValue {
  id: string;
  patient_id: string;
  test_name: string;
  value: string;
  critical_reason: string;
  reported_at: string;
  acknowledged: boolean;
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

interface PhysicianOrder {
  order_id: string;
  patient_id: string;
  order_type: string;
  description: string;
  priority: string;
  ordered_at: string;
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
    <div className="bg-white rounded-xl shadow p-6">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          {loading ? (
            <Loader2 className="animate-spin text-gray-400" size={24} />
          ) : (
            <p className="text-2xl font-bold text-gray-900">{value}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardPage() {
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
        setError('Cannot connect to API server. Make sure the backend is running on port 8080.');
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
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.username || 'Doctor'}
          </h1>
          <p className="text-gray-500 mt-1">
            Here's what's happening with your patients today.
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
          apiConnected 
            ? 'bg-green-100 text-green-700' 
            : 'bg-red-100 text-red-700'
        }`}>
          <div className={`w-2 h-2 rounded-full ${apiConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          {apiConnected ? 'API Connected' : 'API Disconnected'}
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 flex items-center gap-3">
          <AlertCircle size={20} />
          <div>
            <p className="font-medium">Connection Error</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Critical Alerts Banner */}
      {dashboard?.alerts && (dashboard.alerts.critical_values_count > 0 || dashboard.alerts.code_blues_count > 0) && (
        <div className="mb-6 bg-red-600 text-white rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Siren className="animate-pulse" size={24} />
            <div>
              <p className="font-bold">Critical Alerts Require Attention</p>
              <p className="text-red-100 text-sm">
                {dashboard.alerts.critical_values_count} critical values, {dashboard.alerts.code_blues_count} code blues active
              </p>
            </div>
          </div>
          <Link to="/alerts" className="bg-white text-red-600 px-4 py-2 rounded-lg font-medium hover:bg-red-50">
            View Alerts
          </Link>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          icon={<Users className="text-primary-600" size={24} />}
          label="Total Patients"
          value={dashboard?.patients?.total || 0}
          color="bg-primary-100"
          loading={loading}
        />
        <StatCard
          icon={<TestTube className="text-amber-600" size={24} />}
          label="Pending Lab Reviews"
          value={dashboard?.alerts?.pending_labs_count || 0}
          color="bg-amber-100"
          loading={loading}
        />
        <StatCard
          icon={<AlertTriangle className="text-red-600" size={24} />}
          label="Critical Values"
          value={dashboard?.alerts?.critical_values_count || 0}
          color="bg-red-100"
          loading={loading}
        />
        <StatCard
          icon={<ClipboardList className="text-purple-600" size={24} />}
          label="Active Orders"
          value={dashboard?.active_orders?.length || 0}
          color="bg-purple-100"
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
                <Siren size={20} aria-hidden="true" /> Emergency Access
              </h3>
              <p className="text-emergency-100 text-sm">
                Quick NFC tap for emergency patient records
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
                <UserPlus size={20} aria-hidden="true" /> Register Patient
              </h3>
              <p className="text-primary-100 text-sm">
                Add a new patient to the system
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
                <ClipboardList size={20} aria-hidden="true" /> Triage Assessment
              </h3>
              <p className="text-amber-100 text-sm">
                ESI triage for incoming patients
              </p>
            </div>
            <ArrowRight className="group-hover:translate-x-1 transition-transform" size={24} />
          </div>
        </Link>
      </div>

      {/* Critical Values Alert */}
      {dashboard?.critical_values && dashboard.critical_values.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl mb-8">
          <div className="p-4 border-b border-red-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-red-600" size={20} />
              <h2 className="font-semibold text-red-800">Critical Lab Values</h2>
              <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full animate-pulse">
                {dashboard.critical_values.length} URGENT
              </span>
            </div>
          </div>
          <div className="divide-y divide-red-200">
            {dashboard.critical_values.slice(0, 5).map((cv) => (
              <div
                key={cv.id}
                className="flex items-center justify-between p-4 hover:bg-red-100 transition-colors"
              >
                <div>
                  <p className="font-medium text-gray-900">{cv.test_name}</p>
                  <p className="text-sm text-red-600 font-mono">{cv.value} - {cv.critical_reason}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">Patient: {cv.patient_id}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(cv.reported_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Lab Reviews */}
      {dashboard?.pending_lab_approvals && dashboard.pending_lab_approvals.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl mb-8">
          <div className="p-4 border-b border-amber-200">
            <div className="flex items-center gap-2">
              <TestTube className="text-amber-600" size={20} />
              <h2 className="font-semibold text-amber-800">Pending Lab Reviews</h2>
              <span className="bg-amber-600 text-white text-xs px-2 py-0.5 rounded-full">
                {dashboard.pending_lab_approvals.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-amber-200">
            {dashboard.pending_lab_approvals.slice(0, 5).map((lab) => (
              <Link
                key={lab.id}
                to={`/lab-results?id=${lab.id}`}
                className="flex items-center justify-between p-4 hover:bg-amber-100 transition-colors"
              >
                <div>
                  <p className="font-medium text-gray-900">{lab.patient_name}</p>
                  <p className="text-sm text-gray-600">{lab.test_name}</p>
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(lab.submitted_at).toLocaleDateString()}
                </span>
              </Link>
            ))}
          </div>
          <div className="p-3 bg-amber-100 rounded-b-xl">
            <Link to="/lab-results" className="text-amber-700 text-sm font-medium flex items-center gap-1 justify-center">
              View all pending labs <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* Recent Code Blues */}
      {dashboard?.recent_code_blues && dashboard.recent_code_blues.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl mb-8 dark:bg-slate-800 dark:border-slate-600">
          <div className="p-4 border-b border-blue-200 dark:border-slate-600">
            <div className="flex items-center gap-2">
              <Heart className="text-blue-600 dark:text-blue-400" size={20} />
              <h2 className="font-semibold text-blue-800 dark:text-blue-300">Recent Code Blues</h2>
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
                if (!outcomeValue) return 'In Progress';
                // Handle enum values from API
                switch (outcomeValue) {
                  case 'ROSC': return 'ROSC Achieved';
                  case 'Death': return 'Deceased';
                  case 'TransferredOngoing': return 'Transferred';
                  case 'FamilyRequestedTermination': return 'Terminated by Family';
                  default: return outcomeValue;
                }
              })();
              
              const outcomeClass = (() => {
                if (!outcomeValue || outcomeValue === 'TransferredOngoing') 
                  return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
                if (outcomeValue === 'ROSC') 
                  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
                return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
              })();

              return (
                <div
                  key={recordId}
                  className="flex items-center justify-between p-4"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">Patient: {code.patient_id}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Location: {code.location}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600 dark:text-gray-400">{teamLeader || 'No team leader assigned'}</p>
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
        <div className="bg-purple-50 border border-purple-200 rounded-xl mb-8">
          <div className="p-4 border-b border-purple-200">
            <div className="flex items-center gap-2">
              <ClipboardList className="text-purple-600" size={20} />
              <h2 className="font-semibold text-purple-800">Active Physician Orders</h2>
              <span className="bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">
                {dashboard.active_orders.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-purple-200 max-h-64 overflow-y-auto">
            {dashboard.active_orders.slice(0, 10).map((order) => (
              <div
                key={order.order_id}
                className="flex items-center justify-between p-4"
              >
                <div>
                  <p className="font-medium text-gray-900">{order.order_type}: {order.description}</p>
                  <p className="text-sm text-gray-600">Patient: {order.patient_id}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded ${
                    order.priority === 'STAT' ? 'bg-red-100 text-red-700' :
                    order.priority === 'Urgent' ? 'bg-orange-100 text-orange-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {order.priority}
                  </span>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(order.ordered_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Patients from API */}
      <div className="bg-white rounded-xl shadow">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Recent Patients</h2>
            <Link to="/patients" className="text-primary-600 hover:text-primary-700 text-sm flex items-center gap-1">
              View all <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto mb-3 text-gray-300 animate-spin" size={48} />
            <p className="text-gray-500">Loading patients...</p>
          </div>
        ) : dashboard?.patients?.list && dashboard.patients.list.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {dashboard.patients.list.slice(0, 8).map((patient) => (
              <Link
                key={patient.patient_id}
                to={`/patients/${patient.patient_id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                    <Users className="text-primary-600" size={20} />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{patient.full_name}</p>
                    <p className="text-sm text-gray-500">{patient.health_id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {patient.blood_type && (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                      {patient.blood_type}
                    </span>
                  )}
                  {patient.allergies && patient.allergies.length > 0 && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">
                      {patient.allergies.length} allergies
                    </span>
                  )}
                  <ArrowRight size={16} className="text-gray-400" />
                </div>
              </Link>
            ))}
          </div>
        ) : recentPatients.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {recentPatients.slice(0, 5).map((patient) => (
              <Link
                key={patient.patientId}
                to={`/patients/${patient.patientId}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                    <Users className="text-primary-600" size={20} />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{patient.fullName}</p>
                    <p className="text-sm text-gray-500">{patient.patientId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Clock size={14} />
                  <span>{patient.lastAccessed ? new Date(patient.lastAccessed).toLocaleDateString() : 'N/A'}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <Users className="mx-auto mb-3 text-gray-300" size={48} />
            <p>No patients found</p>
            <p className="text-sm mt-1">Register a patient or connect to the API</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
