/**
 * Admin Dashboard Page
 * 
 * System administration dashboard with:
 * - System status monitoring (API, Database, IPFS)
 * - User management overview by role
 * - Emergency events tracking
 * - Access log audit trail
 * - NFC card management
 * - Quick admin actions
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Activity,
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  CreditCard,
  FileText,
  UserPlus,
  BarChart3,
  Settings,
  Key,
  Loader2,
  Siren,
  Database,
  Server,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { getAdminDashboard, detailedHealthCheck, type ServiceHealth } from '@medichain/shared';
import {
  StatCard,
  QuickActionsPanel,
  type QuickAction,
} from '../components/dashboard';

interface SystemStats {
  total_users: number;
  total_patients: number;
  doctors: number;
  nurses: number;
  lab_technicians: number;
  pharmacists: number;
  patient_users: number;
}

interface EmergencyEvents {
  code_blues: number;
  traumas: number;
  strokes: number;
  sepsis_cases: number;
  total: number;
}

interface NFCCards {
  total: number;
  cards: Array<{
    card_id: string;
    patient_id: string;
    status: string;
  }>;
}

interface LabSubmissions {
  total: number;
  pending: number;
  approved: number;
}

interface AccessLog {
  access_id: string;
  accessor_id: string;
  patient_id: string;
  access_type: string;
  timestamp: string;
  reason?: string;
}

interface AdminDashboardData {
  role: string;
  system_stats: SystemStats;
  emergency_events: EmergencyEvents;
  nfc_cards: NFCCards;
  lab_submissions: LabSubmissions;
  recent_access_logs: AccessLog[];
}

// System health status from /api/health/detailed
interface SystemStatus {
  name: string;
  status: 'online' | 'degraded' | 'offline';
  lastCheck: string;
  latency_ms?: number | null;
  message?: string | null;
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemStatus, setSystemStatus] = useState<SystemStatus[]>([]);
  const [healthLoading, setHealthLoading] = useState(true);
  const [lastHealthCheck, setLastHealthCheck] = useState<string>(new Date().toISOString());

  useEffect(() => {
    loadDashboard();
    loadHealthStatus();
  }, []);

  const loadHealthStatus = async () => {
    try {
      setHealthLoading(true);
      const healthData = await detailedHealthCheck();
      const services: SystemStatus[] = healthData.services.map((svc: ServiceHealth) => ({
        name: svc.name,
        status: svc.status as 'online' | 'degraded' | 'offline',
        lastCheck: healthData.timestamp,
        latency_ms: svc.latency_ms,
        message: svc.message,
      }));
      setSystemStatus(services);
      setLastHealthCheck(healthData.timestamp);
    } catch (error) {
      console.error('Failed to load health status:', error);
      // Fallback to degraded state if health check fails
      setSystemStatus([
        { name: 'API Server', status: 'offline', lastCheck: new Date().toISOString(), message: 'Health check failed' },
        { name: 'Database', status: 'offline', lastCheck: new Date().toISOString() },
        { name: 'IPFS Storage', status: 'offline', lastCheck: new Date().toISOString() },
      ]);
    } finally {
      setHealthLoading(false);
    }
  };

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const response = await getAdminDashboard();
      setData(response as AdminDashboardData);
    } catch (error) {
      console.error('Failed to load admin dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  // Quick actions for admins
  const quickActions: QuickAction[] = [
    { id: 'add-user', label: 'Add User', icon: UserPlus, href: '/user-management', color: 'primary' },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, href: '/analytics', color: 'blue' },
    { id: 'audit', label: 'Audit Report', icon: FileText, href: '/access-logs', color: 'purple' },
    { id: 'roles', label: 'Manage Roles', icon: Key, href: '/user-management', color: 'amber' },
    { id: 'nfc', label: 'NFC Cards', icon: CreditCard, href: '/barcode', color: 'green' },
    { id: 'settings', label: 'Settings', icon: Settings, href: '/settings', color: 'teal' },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'degraded': return 'text-amber-500';
      case 'offline': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online': return <CheckCircle className="text-green-500" size={18} />;
      case 'degraded': return <AlertTriangle className="text-amber-500" size={18} />;
      case 'offline': return <AlertTriangle className="text-red-500" size={18} />;
      default: return <Clock className="text-gray-500" size={18} />;
    }
  };

  const getAccessTypeColor = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'emergency':
      case 'emergency_access':
        return 'bg-red-100 text-red-700';
      case 'failed':
      case 'failed_login':
        return 'bg-red-100 text-red-700';
      case 'view':
      case 'read':
        return 'bg-green-100 text-green-700';
      case 'update':
      case 'write':
        return 'bg-blue-100 text-blue-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="mx-auto animate-spin text-purple-600" size={48} />
          <p className="mt-4 text-gray-600">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load dashboard data. Please try again.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Administration</h1>
          <p className="text-gray-500">Monitor system health and manage users</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
            <Shield size={14} className="inline mr-1" />
            Admin
          </span>
        </div>
      </div>

      {/* System Status Banner */}
      <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Server size={16} />
            SYSTEM STATUS
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={loadHealthStatus}
              disabled={healthLoading}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
            >
              <RefreshCw size={12} className={healthLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <span className="text-xs text-gray-500">
              Last check: {new Date(lastHealthCheck).toLocaleTimeString()}
            </span>
          </div>
        </div>
        {healthLoading && systemStatus.length === 0 ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Checking system health...</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6">
            {systemStatus.map((system) => (
              <div key={system.name} className="flex items-center gap-2">
                {getStatusIcon(system.status)}
                <span className="text-sm text-gray-700">{system.name}:</span>
                <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${getStatusColor(system.status)}`}>
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      system.status === 'online'
                        ? 'bg-green-500'
                        : system.status === 'degraded'
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                    }`}
                    aria-hidden="true"
                  />
                  {system.status === 'online'
                    ? 'Online'
                    : system.status === 'degraded'
                    ? 'Degraded'
                    : 'Offline'}
                </span>
                {system.latency_ms !== undefined && system.latency_ms !== null && (
                  <span className="text-xs text-gray-400">({system.latency_ms}ms)</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Users size={24} />}
          label="Total Users"
          value={data.system_stats?.total_users || 0}
          color="bg-purple-100"
          onClick={() => navigate('/user-management')}
        />
        <StatCard
          icon={<Activity size={24} />}
          label="Total Patients"
          value={data.system_stats?.total_patients || 0}
          color="bg-blue-100"
          onClick={() => navigate('/patient-search')}
        />
        <StatCard
          icon={<Siren size={24} />}
          label="Emergency Events"
          value={data.emergency_events?.total || 0}
          color="bg-red-100"
        />
        <StatCard
          icon={<FileText size={24} />}
          label="Access Logs Today"
          value={data.recent_access_logs?.length || 0}
          color="bg-green-100"
          onClick={() => navigate('/access-logs')}
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Users by Role */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Users size={16} />
            USERS BY ROLE
          </h3>
          <div className="space-y-3">
            {[
              { role: 'Doctors', count: data.system_stats?.doctors || 0, color: 'bg-blue-500' },
              { role: 'Nurses', count: data.system_stats?.nurses || 0, color: 'bg-green-500' },
              { role: 'Lab Technicians', count: data.system_stats?.lab_technicians || 0, color: 'bg-amber-500' },
              { role: 'Pharmacists', count: data.system_stats?.pharmacists || 0, color: 'bg-pink-500' },
              { role: 'Patients', count: data.system_stats?.patient_users || 0, color: 'bg-purple-500' },
            ].map((item) => (
              <div key={item.role} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700">{item.role}</span>
                    <span className="font-medium">{item.count}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${item.color}`}
                      style={{ width: `${Math.min((item.count / (data.system_stats?.total_users || 1)) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/user-management')}
            className="mt-4 w-full py-2 text-sm text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded transition-colors"
          >
            Manage Users →
          </button>
        </div>

        {/* Emergency Events */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Siren size={16} />
            EMERGENCY EVENTS
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { type: 'Code Blue', count: data.emergency_events?.code_blues || 0, color: 'bg-red-100 text-red-700' },
              { type: 'Trauma', count: data.emergency_events?.traumas || 0, color: 'bg-orange-100 text-orange-700' },
              { type: 'Stroke', count: data.emergency_events?.strokes || 0, color: 'bg-yellow-100 text-yellow-700' },
              { type: 'Sepsis', count: data.emergency_events?.sepsis_cases || 0, color: 'bg-amber-100 text-amber-700' },
            ].map((event) => (
              <div key={event.type} className={`p-3 rounded-lg ${event.color}`}>
                <div className="text-2xl font-bold">{event.count}</div>
                <div className="text-sm">{event.type}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/emergency-protocols')}
            className="mt-4 w-full py-2 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
          >
            View Emergency Log →
          </button>
        </div>
      </div>

      {/* Access Logs Table */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <FileText size={16} />
            RECENT ACCESS LOGS
          </h3>
          <button
            onClick={() => navigate('/access-logs')}
            className="text-xs text-purple-600 hover:text-purple-800"
          >
            View All
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.recent_access_logs?.slice(0, 10).map((log) => (
                <tr key={log.access_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {log.accessor_id?.slice(0, 12)}...
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {log.access_type}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {log.patient_id?.slice(0, 12) || '-'}...
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded ${getAccessTypeColor(log.access_type)}`}>
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          log.access_type?.includes('emergency')
                            ? 'bg-orange-500'
                            : log.access_type?.includes('fail')
                            ? 'bg-red-500'
                            : 'bg-green-500'
                        }`}
                        aria-hidden="true"
                      />
                      {log.access_type?.includes('emergency')
                        ? 'Emer'
                        : log.access_type?.includes('fail')
                        ? 'Fail'
                        : 'Norm'}
                    </span>
                  </td>
                </tr>
              ))}
              {(!data.recent_access_logs || data.recent_access_logs.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No access logs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* NFC Card Status */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <CreditCard size={16} />
            NFC CARD STATUS
          </h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{data.nfc_cards?.total || 0}</div>
              <div className="text-xs text-gray-500">Total Issued</div>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-700">
                {data.nfc_cards?.cards?.filter(c => c.status === 'active').length || 0}
              </div>
              <div className="text-xs text-green-600">Active</div>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-700">
                {data.nfc_cards?.cards?.filter(c => c.status === 'revoked').length || 0}
              </div>
              <div className="text-xs text-red-600">Revoked</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/barcode')}
              className="flex-1 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
            >
              Issue New Card
            </button>
            <button
              onClick={() => navigate('/barcode')}
              className="flex-1 py-2 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
            >
              View All Cards
            </button>
          </div>
        </div>

        {/* Lab Submission Stats */}
        <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Database size={16} />
            LAB SUBMISSION STATS
          </h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{data.lab_submissions?.total || 0}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <div className="text-2xl font-bold text-amber-700">{data.lab_submissions?.pending || 0}</div>
              <div className="text-xs text-amber-600">Pending</div>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-700">{data.lab_submissions?.approved || 0}</div>
              <div className="text-xs text-green-600">Approved</div>
            </div>
          </div>
          <button
            onClick={() => navigate('/lab-results')}
            className="w-full py-2 text-sm text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded transition-colors"
          >
            View Lab Analytics →
          </button>
        </div>
      </div>

      {/* Quick Admin Actions */}
      <QuickActionsPanel actions={quickActions} />
    </div>
  );
}
