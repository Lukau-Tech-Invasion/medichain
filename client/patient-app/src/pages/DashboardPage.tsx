import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAccessLogs, getPatient, useTranslation } from '@medichain/shared';
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
 * © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
        const patientId = patient.healthId;
        try {
          const data = await getPatient(patientId);
          const emergencyInfo = data.emergency_info || {};
          setApiConnected(true);
          
          setPatientData({
            patientId: data.patient_id,
            name: data.full_name || patient.fullName,
            healthId: patient.healthId,
            bloodType: formatBloodType(emergencyInfo.blood_type) || patient.bloodType || 'Unknown',
            allergies: (emergencyInfo.allergies || []).map((allergy: string | { name: string }) =>
              typeof allergy === 'string' ? allergy : allergy.name
            ),
            medications: emergencyInfo.current_medications || [],
            conditions: emergencyInfo.chronic_conditions || [],
            // This profile endpoint has no visit, appointment, or message
            // counters. Keep those fields empty rather than inventing values
            // from a client clock or an undocumented response shape.
            lastVisit: '',
            upcomingAppointments: 0,
            unreadMessages: 0,
          });

          // Fetch access logs for recent activity
          const logsData = await getAccessLogs(patientId);
          const activities: RecentActivity[] = (logsData.access_logs || []).slice(0, 5).map((log) => ({
            id: log.access_id,
            type: log.access_type === 'view' ? 'access' : log.access_type === 'consent' ? 'consent' : 'update',
            description: `${log.accessor_id} ${log.access_type === 'view' ? t('dashboard.accessedYourRecords') : log.access_type}`,
            timestamp: log.timestamp,
            accessor: log.accessor_id,
          }));
          setRecentActivity(activities);
        } catch {
          // An unavailable profile must not be replaced by a plausible clinical
          // summary. Identity from the authenticated session is safe to show;
          // clinical fields stay explicitly empty until the record loads.
          setApiConnected(false);
          setPatientData({
            patientId: patient.healthId,
            name: patient.fullName,
            healthId: patient.healthId,
            bloodType: 'Unknown',
            allergies: [],
            medications: [],
            conditions: [],
            lastVisit: '',
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
  }, [patient, t]);

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
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-24 bg-surface-sunken rounded-xl" />
          <div className="h-24 bg-surface-sunken rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">
            {t('dashboard.greeting', {
              name: patient?.firstName || patientData?.name.split(' ')[0] || '',
            })}
          </h1>
          <p className="text-content-muted">
            {t('dashboard.tagline')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* API Status */}
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? t('dashboard.live') : t('dashboard.dataUnavailable')}
          </div>
          <button
            type="button"
            onClick={() => navigate('/notifications')}
            className="relative p-2 text-content-muted hover:bg-surface-sunken rounded-xl transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-6 h-6" />
            {(patientData?.unreadMessages || 0) > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-emergency-400 text-white text-xs rounded-full flex items-center justify-center">
                {patientData?.unreadMessages}
              </span>
            )}
          </button>
          <button 
            onClick={handleLogout}
            className="p-2 text-content-muted hover:bg-critical-subtle hover:text-critical-subtle-fg rounded-xl transition-colors"
            title={t('dashboard.disconnectWallet')}
          >
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Health Status Card */}
      <div className="bg-gradient-to-r from-primary-500 to-primary-600 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-surface/20 rounded-xl flex items-center justify-center">
              <Heart className="w-7 h-7" />
            </div>
            <div>
              <h2 className="font-semibold text-lg">{t('dashboard.healthIdActive')}</h2>
              <p className="text-white/80 text-sm">{patientData?.healthId}</p>
            </div>
          </div>
          <div className="health-indicator !bg-surface" />
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-surface/10 rounded-xl p-3 text-center">
            <Droplets className="w-5 h-5 mx-auto mb-1" />
            <div className="font-bold">{patientData?.bloodType}</div>
            <div className="text-xs text-white/70">{t('dashboard.bloodType')}</div>
          </div>
          <div className="bg-surface/10 rounded-xl p-3 text-center">
            <AlertTriangle className="w-5 h-5 mx-auto mb-1" />
            <div className="font-bold">{patientData?.allergies.length}</div>
            <div className="text-xs text-white/70">{t('dashboard.allergies')}</div>
          </div>
          <div className="bg-surface/10 rounded-xl p-3 text-center">
            <Pill className="w-5 h-5 mx-auto mb-1" />
            <div className="font-bold">{patientData?.medications.length}</div>
            <div className="text-xs text-white/70">{t('dashboard.medications')}</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <Link
          to="/emergency-card"
          className="patient-card flex flex-col items-center justify-center gap-3 p-6 hover:border-brand border-2 border-transparent"
        >
          <div className="w-14 h-14 bg-emergency-50 rounded-2xl flex items-center justify-center">
            <QrCode className="w-7 h-7 text-critical-subtle-fg" />
          </div>
          <div className="text-center">
            <div className="font-medium text-content">{t('dashboard.emergencyCard')}</div>
            <div className="text-sm text-content-muted">{t('dashboard.showQrNfc')}</div>
          </div>
        </Link>

        <Link
          to="/records"
          className="patient-card flex flex-col items-center justify-center gap-3 p-6 hover:border-brand border-2 border-transparent"
        >
          <div className="w-14 h-14 bg-brand-subtle rounded-2xl flex items-center justify-center">
            <FileText className="w-7 h-7 text-primary-500" />
          </div>
          <div className="text-center">
            <div className="font-medium text-content">{t('dashboard.myRecords')}</div>
            <div className="text-sm text-content-muted">{t('dashboard.viewAll')}</div>
          </div>
        </Link>

        <Link
          to="/consent"
          className="patient-card flex flex-col items-center justify-center gap-3 p-6 hover:border-brand border-2 border-transparent"
        >
          <div className="w-14 h-14 bg-success-50 rounded-2xl flex items-center justify-center">
            <Shield className="w-7 h-7 text-success-500" />
          </div>
          <div className="text-center">
            <div className="font-medium text-content">{t('dashboard.accessControl')}</div>
            <div className="text-sm text-content-muted">{t('dashboard.manageConsent')}</div>
          </div>
        </Link>

        <Link
          to="/profile"
          className="patient-card flex flex-col items-center justify-center gap-3 p-6 hover:border-brand border-2 border-transparent"
        >
          <div className="w-14 h-14 bg-info-light rounded-2xl flex items-center justify-center">
            <Activity className="w-7 h-7 text-info" />
          </div>
          <div className="text-center">
            <div className="font-medium text-content">{t('dashboard.myProfile')}</div>
            <div className="text-sm text-content-muted">{t('dashboard.healthInfo')}</div>
          </div>
        </Link>
      </div>

      {/* Critical Alerts */}
      {patientData?.allergies && patientData.allergies.length > 0 && (
        <div className="warning-card">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-critical-subtle-fg" />
            <span className="font-medium text-critical-subtle-fg">{t('dashboard.criticalAllergies')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {patientData.allergies.map((allergy, idx) => (
              <span
                key={idx}
                className="px-3 py-1 bg-emergency-100 text-critical-subtle-fg rounded-full text-sm font-medium"
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
          <h3 className="font-semibold text-content flex items-center gap-2">
            <Clock className="w-5 h-5 text-content-muted" />
            {t('dashboard.recentActivity')}
          </h3>
          <Link to="/consent" className="text-sm text-primary-500 hover:text-brand font-medium inline-flex items-center min-h-[24px] py-1">
            {t('dashboard.viewAll')}
          </Link>
        </div>

        <div className="space-y-3">
          {recentActivity.length === 0 && <p className="text-sm text-content-muted">{t('dashboard.noRecentActivity')}</p>}
          {recentActivity.map((activity) => (
            <div
              key={activity.id}
              className="flex items-center gap-3 p-3 bg-surface-sunken rounded-xl"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                activity.type === 'access' ? 'bg-brand-subtle text-brand-subtle-fg' :
                activity.type === 'update' ? 'bg-success-100 text-success-600' :
                'bg-info-light text-info'
              }`}>
                {activity.type === 'access' ? <Shield className="w-5 h-5" /> :
                 activity.type === 'update' ? <FileText className="w-5 h-5" /> :
                 <Activity className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-content truncate">
                  {activity.description}
                </p>
                <p className="text-xs text-content-muted">
                  {formatTime(activity.timestamp)}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-content-muted" />
            </div>
          ))}
        </div>
      </div>

      {/* Last Visit Info */}
      <div className="info-card flex items-center justify-between">
        <div>
          <p className="text-sm text-info-dark font-medium inline-flex items-center min-h-[24px] py-1">{t('dashboard.lastVisit')}</p>
          <p className="text-info">{patientData?.lastVisit ? formatDate(patientData.lastVisit) : 'N/A'}</p>
        </div>
        <Link
          to="/records"
          className="text-sm text-info font-medium hover:underline flex items-center gap-1 inline-flex items-center min-h-[24px] py-1"
        >
          {t('dashboard.viewDetails')} <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
