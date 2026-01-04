import { useAuthStore, usePatientStore } from '../store';
import { 
  Users, 
  AlertTriangle, 
  FileText, 
  Activity,
  ArrowRight,
  Clock
} from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Stat card component
 */
function StatCard({ 
  icon, 
  label, 
  value, 
  color 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { user } = useAuthStore();
  const { recentPatients } = usePatientStore();

  // Mock stats for demo
  const stats = {
    totalPatients: 1247,
    emergencyAccesses: 23,
    recordsToday: 156,
    activeAlerts: 3,
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.username || 'Doctor'}
        </h1>
        <p className="text-gray-500 mt-1">
          Here's what's happening with your patients today.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          icon={<Users className="text-primary-600\" size={24} />}
          label="Total Patients"
          value={stats.totalPatients}
          color="bg-primary-100"
        />
        <StatCard
          icon={<AlertTriangle className="text-emergency-600" size={24} />}
          label="Emergency Accesses"
          value={stats.emergencyAccesses}
          color="bg-emergency-100"
        />
        <StatCard
          icon={<FileText className="text-success-600" size={24} />}
          label="Records Today"
          value={stats.recordsToday}
          color="bg-success-100"
        />
        <StatCard
          icon={<Activity className="text-amber-600" size={24} />}
          label="Active Alerts"
          value={stats.activeAlerts}
          color="bg-amber-100"
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Emergency Access Card */}
        <Link
          to="/emergency"
          className="bg-gradient-to-r from-emergency-500 to-emergency-600 rounded-xl p-6 text-white hover:from-emergency-600 hover:to-emergency-700 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold mb-1">🚨 Emergency Access</h3>
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
              <h3 className="text-lg font-semibold mb-1">➕ Register Patient</h3>
              <p className="text-primary-100 text-sm">
                Add a new patient to the system
              </p>
            </div>
            <ArrowRight className="group-hover:translate-x-1 transition-transform" size={24} />
          </div>
        </Link>
      </div>

      {/* Recent Patients */}
      <div className="bg-white rounded-xl shadow">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Recent Patients</h2>
            <Link to="/patients" className="text-primary-600 hover:text-primary-700 text-sm flex items-center gap-1">
              View all <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        
        {recentPatients.length > 0 ? (
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
            <p>No recent patients</p>
            <p className="text-sm mt-1">Access a patient to see them here</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
