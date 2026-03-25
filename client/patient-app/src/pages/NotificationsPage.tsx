import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl } from '@medichain/shared';
import { usePatientAuthStore } from '../store/authStore';
import {
  Bell,
  AlertTriangle,
  Info,
  CheckCircle,
  Loader2,
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
} from 'lucide-react';

interface Notification {
  notification_id?: string;
  id?: string;
  title?: string;
  message: string;
  type?: string;
  is_read?: boolean;
  read?: boolean;
  created_at?: string;
  timestamp?: string;
}

interface CdsAlert {
  alert_id?: string;
  id?: string;
  title?: string;
  description?: string;
  message?: string;
  severity?: 'high' | 'medium' | 'low' | string;
  alert_type?: string;
  created_at?: string;
  is_acknowledged?: boolean;
}

/**
 * NotificationsPage - System notifications and clinical alerts
 *
 * Features:
 * - Inbox notifications from /api/notifications
 * - CDS clinical alerts from /api/cds/patient/{patientId}/alerts
 * - Severity indicator for alerts (High/Medium/Low)
 *
 * © 2025 Trustware. All rights reserved.
 */
export function NotificationsPage() {
  const navigate = useNavigate();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [alerts, setAlerts] = useState<CdsAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'notifications' | 'alerts'>('notifications');

  useEffect(() => {
    if (!isAuthenticated || !patient) {
      navigate('/login');
    }
  }, [isAuthenticated, patient, navigate]);

  useEffect(() => {
    if (patient) {
      loadAll();
    }
  }, [patient]);

  const loadAll = async () => {
    if (!patient) return;
    setLoading(true);
    const headers = {
      'X-User-Id': patient.walletAddress,
      'X-Health-Id': patient.healthId,
    };
    try {
      const [notifRes, alertsRes] = await Promise.all([
        fetch(apiUrl('/api/notifications'), { headers }),
        fetch(apiUrl(`/api/cds/patient/${patient.healthId}/alerts`), { headers }),
      ]);

      if (notifRes.ok) {
        const d = await notifRes.json();
        setNotifications(d.notifications || []);
        setApiConnected(true);
      }
      if (alertsRes.ok) {
        const d = await alertsRes.json();
        setAlerts(d.alerts || d.cds_alerts || []);
        setApiConnected(true);
      }
    } catch (err) {
      console.error('Failed to load notifications:', err);
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getSeverityBadge = (severity?: string) => {
    switch ((severity || '').toLowerCase()) {
      case 'high':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
            <AlertTriangle className="w-3 h-3" />
            High
          </span>
        );
      case 'medium':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
            <AlertTriangle className="w-3 h-3" />
            Medium
          </span>
        );
      case 'low':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            <Info className="w-3 h-3" />
            Low
          </span>
        );
      default:
        return null;
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read && !n.read).length;
  const highAlerts = alerts.filter(a => (a.severity || '').toLowerCase() === 'high').length;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Notifications</h1>
          <p className="text-neutral-500">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            {highAlerts > 0 ? ` • ${highAlerts} high-priority alert${highAlerts > 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            apiConnected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {apiConnected ? 'Live' : 'Demo'}
          </span>
          <button
            onClick={loadAll}
            className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* High Priority Alert Banner */}
      {highAlerts > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-red-800">
              {highAlerts} High Priority Clinical Alert{highAlerts > 1 ? 's' : ''}
            </p>
            <p className="text-sm text-red-700">
              Please review your clinical alerts and contact your provider if needed.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-200">
        <button
          onClick={() => setActiveTab('notifications')}
          className={`relative px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'notifications'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          Notifications ({notifications.length})
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('alerts')}
          className={`relative px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'alerts'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          Clinical Alerts ({alerts.length})
          {highAlerts > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {highAlerts}
            </span>
          )}
        </button>
      </div>

      {/* Notifications Tab */}
      {activeTab === 'notifications' && (
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-500">No notifications</p>
            </div>
          ) : (
            notifications.map((n, idx) => (
              <div
                key={n.notification_id || n.id || idx}
                className={`patient-card ${!n.is_read && !n.read ? 'border-l-4 border-l-primary-400' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    !n.is_read && !n.read ? 'bg-primary-100' : 'bg-neutral-100'
                  }`}>
                    <Bell className={`w-4 h-4 ${!n.is_read && !n.read ? 'text-primary-600' : 'text-neutral-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {n.title && (
                      <p className="font-medium text-neutral-900">{n.title}</p>
                    )}
                    <p className="text-sm text-neutral-700">{n.message}</p>
                    {(n.created_at || n.timestamp) && (
                      <p className="text-xs text-neutral-400 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(n.created_at || n.timestamp)}
                      </p>
                    )}
                  </div>
                  {(n.is_read || n.read) && (
                    <CheckCircle className="w-4 h-4 text-neutral-300 flex-shrink-0 mt-0.5" />
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Clinical Alerts Tab */}
      {activeTab === 'alerts' && (
        <div className="space-y-3">
          {alerts.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-500">No clinical alerts</p>
            </div>
          ) : (
            alerts.map((alert, idx) => (
              <div
                key={alert.alert_id || alert.id || idx}
                className={`patient-card ${
                  (alert.severity || '').toLowerCase() === 'high'
                    ? 'border-l-4 border-l-red-500'
                    : (alert.severity || '').toLowerCase() === 'medium'
                    ? 'border-l-4 border-l-yellow-400'
                    : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      (alert.severity || '').toLowerCase() === 'high' ? 'bg-red-100' :
                      (alert.severity || '').toLowerCase() === 'medium' ? 'bg-yellow-100' :
                      'bg-blue-100'
                    }`}>
                      <AlertTriangle className={`w-4 h-4 ${
                        (alert.severity || '').toLowerCase() === 'high' ? 'text-red-600' :
                        (alert.severity || '').toLowerCase() === 'medium' ? 'text-yellow-600' :
                        'text-blue-600'
                      }`} />
                    </div>
                    <div>
                      {alert.title && (
                        <p className="font-medium text-neutral-900">{alert.title}</p>
                      )}
                      <p className="text-sm text-neutral-700">
                        {alert.description || alert.message}
                      </p>
                      {alert.created_at && (
                        <p className="text-xs text-neutral-400 mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(alert.created_at)}
                        </p>
                      )}
                    </div>
                  </div>
                  {getSeverityBadge(alert.severity)}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
