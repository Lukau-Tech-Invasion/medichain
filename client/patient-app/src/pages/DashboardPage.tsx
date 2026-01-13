import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiUrl } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Heart,
  FileText,
  Shield,
  QrCode,
  Clock,
  AlertTriangle,
  ChevronRight,
  Activity,
  Bell,
  Droplets,
  Pill,
  Wifi,
  WifiOff,
  LogOut,
} from 'lucide-react';

interface PatientData {
  patientId: string;
  name: string;
  healthId: string;
  bloodType: string;
  allergies: string[];
  medications: string[];
  conditions: string[];
  lastVisit: string;
  upcomingAppointments: number;
  unreadMessages: number;
}

interface RecentActivity {
  id: string;
  type: 'access' | 'update' | 'consent';
  description: string;
  timestamp: string;
  accessor?: string;
}

/**
 * Patient Dashboard Page
 * 
 * Main hub for patients to:
 * - View health summary
 * - Quick access to emergency card
 * - See recent activity
 * - Navigate to key features
 * 
 * © 2025 Trustware. All rights reserved.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { patient, isAuthenticated, logout } = usePatientAuthStore();
  const [patientData, setPatientData] = useState<PatientData | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    // Load patient data from API
    const loadData = async () => {
      if (!patient) {
        setIsLoading(false);
        return;
      }

      try {
        // Use health ID from authenticated patient
        const patientId = patient.healthId;
        
        const response = await fetch(apiUrl(`/api/patients/${patientId}`), {
          headers: {
            'X-User-Id': patient.walletAddress,
            'X-Health-Id': patient.healthId,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setApiConnected(true);
          
          setPatientData({
            patientId: data.patient_id,
            name: data.full_name || patient.fullName,
            healthId: data.health_id || patient.healthId,
            bloodType: formatBloodType(data.blood_type) || patient.bloodType || 'Unknown',
            allergies: data.allergies || [],
            medications: data.current_medications || [],
            conditions: data.medical_conditions || [],
            lastVisit: data.last_visit || new Date().toISOString().split('T')[0],
            upcomingAppointments: data.upcoming_appointments || 0,
            unreadMessages: data.unread_messages || 0,
          });

          // Fetch access logs for recent activity
          const logsResponse = await fetch(`/api/access-logs/${patientId}`, {
            headers: { 
              'X-User-Id': patient.walletAddress,
              'X-Health-Id': patient.healthId,
            },
          });
          
          if (logsResponse.ok) {
            const logsData = await logsResponse.json();
            const activities: RecentActivity[] = (logsData.logs || []).slice(0, 5).map((log: {
              log_id: string;
              action_type: string;
              accessor_name: string;
              accessed_at: string;
            }) => ({
              id: log.log_id,
              type: log.action_type === 'view' ? 'access' : log.action_type === 'consent' ? 'consent' : 'update',
              description: `${log.accessor_name} ${log.action_type === 'view' ? 'accessed your records' : log.action_type}`,
              timestamp: log.accessed_at,
              accessor: log.accessor_name,
            }));
            setRecentActivity(activities);
          }
        } else {
          // API returned error - use local data from wallet
          setApiConnected(false);
          setPatientData({
            patientId: patient.healthId,
            name: patient.fullName,
            healthId: patient.healthId,
            bloodType: patient.bloodType || 'Unknown',
            allergies: [],
            medications: [],
            conditions: [],
            lastVisit: new Date().toISOString().split('T')[0],
            upcomingAppointments: 0,
            unreadMessages: 0,
          });
        }
      } catch {
        // API not available - use local data
        setApiConnected(false);
        if (patient) {
          setPatientData({
            patientId: patient.healthId,
            name: patient.fullName,
            healthId: patient.healthId,
            bloodType: patient.bloodType || 'Unknown',
            allergies: [],
            medications: [],
            conditions: [],
            lastVisit: new Date().toISOString().split('T')[0],
            upcomingAppointments: 0,
            unreadMessages: 0,
          });
        }
      } finally {
        setIsLoading(false);
      }
    };

    if (patient) {
      loadData();
    }
  }, [patient]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const formatBloodType = (bt: string | undefined): string => {
    if (!bt) return 'Unknown';
    const map: Record<string, string> = {
      'APositive': 'A+', 'ANegative': 'A-',
      'BPositive': 'B+', 'BNegative': 'B-',
      'ABPositive': 'AB+', 'ABNegative': 'AB-',
      'OPositive': 'O+', 'ONegative': 'O-',
    };
    return map[bt] || bt;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-8 bg-neutral-200 rounded w-48" />
        <div className="h-40 bg-neutral-200 rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-24 bg-neutral-200 rounded-xl" />
          <div className="h-24 bg-neutral-200 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">
            Hello, {patient?.firstName || patientData?.name.split(' ')[0]} 👋
          </h1>
          <p className="text-neutral-600">
            Your health, your control
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* API Status */}
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? 'Live' : 'Demo'}
          </div>
          <button className="relative p-2 text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors">
            <Bell className="w-6 h-6" />
            {(patientData?.unreadMessages || 0) > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-emergency-400 text-white text-xs rounded-full flex items-center justify-center">
                {patientData?.unreadMessages}
              </span>
            )}
          </button>
          <button 
            onClick={handleLogout}
            className="p-2 text-neutral-600 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors"
            title="Disconnect Wallet"
          >
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Health Status Card */}
      <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Heart className="w-7 h-7" />
            </div>
            <div>
              <h2 className="font-semibold text-lg">Health ID Active</h2>
              <p className="text-white/80 text-sm">{patientData?.healthId}</p>
            </div>
          </div>
          <div className="health-indicator !bg-white" />
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <Droplets className="w-5 h-5 mx-auto mb-1" />
            <div className="font-bold">{patientData?.bloodType}</div>
            <div className="text-xs text-white/70">Blood Type</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <AlertTriangle className="w-5 h-5 mx-auto mb-1" />
            <div className="font-bold">{patientData?.allergies.length}</div>
            <div className="text-xs text-white/70">Allergies</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <Pill className="w-5 h-5 mx-auto mb-1" />
            <div className="font-bold">{patientData?.medications.length}</div>
            <div className="text-xs text-white/70">Medications</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <Link
          to="/emergency-card"
          className="patient-card flex flex-col items-center justify-center gap-3 p-6 hover:border-primary-200 border-2 border-transparent"
        >
          <div className="w-14 h-14 bg-emergency-50 rounded-2xl flex items-center justify-center">
            <QrCode className="w-7 h-7 text-emergency-500" />
          </div>
          <div className="text-center">
            <div className="font-medium text-neutral-900">Emergency Card</div>
            <div className="text-sm text-neutral-500">Show QR / NFC</div>
          </div>
        </Link>

        <Link
          to="/records"
          className="patient-card flex flex-col items-center justify-center gap-3 p-6 hover:border-primary-200 border-2 border-transparent"
        >
          <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center">
            <FileText className="w-7 h-7 text-primary-500" />
          </div>
          <div className="text-center">
            <div className="font-medium text-neutral-900">My Records</div>
            <div className="text-sm text-neutral-500">View all</div>
          </div>
        </Link>

        <Link
          to="/consent"
          className="patient-card flex flex-col items-center justify-center gap-3 p-6 hover:border-primary-200 border-2 border-transparent"
        >
          <div className="w-14 h-14 bg-success-50 rounded-2xl flex items-center justify-center">
            <Shield className="w-7 h-7 text-success-500" />
          </div>
          <div className="text-center">
            <div className="font-medium text-neutral-900">Access Control</div>
            <div className="text-sm text-neutral-500">Manage consent</div>
          </div>
        </Link>

        <Link
          to="/profile"
          className="patient-card flex flex-col items-center justify-center gap-3 p-6 hover:border-primary-200 border-2 border-transparent"
        >
          <div className="w-14 h-14 bg-info-light rounded-2xl flex items-center justify-center">
            <Activity className="w-7 h-7 text-info" />
          </div>
          <div className="text-center">
            <div className="font-medium text-neutral-900">My Profile</div>
            <div className="text-sm text-neutral-500">Health info</div>
          </div>
        </Link>
      </div>

      {/* Critical Alerts */}
      {patientData?.allergies && patientData.allergies.length > 0 && (
        <div className="warning-card">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-emergency-500" />
            <span className="font-medium text-emergency-700">Critical Allergies</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {patientData.allergies.map((allergy, idx) => (
              <span
                key={idx}
                className="px-3 py-1 bg-emergency-100 text-emergency-700 rounded-full text-sm font-medium"
              >
                {allergy}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="patient-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-neutral-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-neutral-500" />
            Recent Activity
          </h3>
          <Link to="/consent" className="text-sm text-primary-500 hover:text-primary-600 font-medium">
            View all
          </Link>
        </div>

        <div className="space-y-3">
          {recentActivity.map((activity) => (
            <div
              key={activity.id}
              className="flex items-center gap-3 p-3 bg-neutral-50 rounded-xl"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                activity.type === 'access' ? 'bg-primary-100 text-primary-600' :
                activity.type === 'update' ? 'bg-success-100 text-success-600' :
                'bg-info-light text-info'
              }`}>
                {activity.type === 'access' ? <Shield className="w-5 h-5" /> :
                 activity.type === 'update' ? <FileText className="w-5 h-5" /> :
                 <Activity className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-900 truncate">
                  {activity.description}
                </p>
                <p className="text-xs text-neutral-500">
                  {formatTime(activity.timestamp)}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-neutral-400" />
            </div>
          ))}
        </div>
      </div>

      {/* Last Visit Info */}
      <div className="info-card flex items-center justify-between">
        <div>
          <p className="text-sm text-info-dark font-medium">Last Healthcare Visit</p>
          <p className="text-info">{patientData?.lastVisit ? formatDate(patientData.lastVisit) : 'N/A'}</p>
        </div>
        <Link
          to="/records"
          className="text-sm text-info font-medium hover:underline flex items-center gap-1"
        >
          View details <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
