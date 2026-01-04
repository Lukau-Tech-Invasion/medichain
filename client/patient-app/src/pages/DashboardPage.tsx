import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
  const [patientData, setPatientData] = useState<PatientData | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load patient data
    const loadData = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));

      // Demo data
      setPatientData({
        patientId: 'PAT-001-DEMO',
        name: 'John Doe',
        healthId: 'MCHI-2026-DEMO-XXXX',
        bloodType: 'O+',
        allergies: ['Penicillin', 'Sulfa drugs'],
        medications: ['Metformin 500mg', 'Lisinopril 10mg'],
        conditions: ['Type 2 Diabetes', 'Hypertension'],
        lastVisit: '2026-01-02',
      });

      setRecentActivity([
        {
          id: '1',
          type: 'access',
          description: 'Dr. Smith accessed your records',
          timestamp: '2026-01-04T10:30:00Z',
          accessor: 'Dr. Smith',
        },
        {
          id: '2',
          type: 'update',
          description: 'Lab results added to your records',
          timestamp: '2026-01-03T15:45:00Z',
        },
        {
          id: '3',
          type: 'consent',
          description: 'Emergency access granted to City Hospital',
          timestamp: '2026-01-02T09:15:00Z',
        },
      ]);

      setIsLoading(false);
    };

    loadData();
  }, []);

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
            Hello, {patientData?.name.split(' ')[0]} 👋
          </h1>
          <p className="text-neutral-600">
            Your health, your control
          </p>
        </div>
        <button className="relative p-2 text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors">
          <Bell className="w-6 h-6" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-emergency-400 rounded-full" />
        </button>
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
