import React, { useState, useEffect, useCallback } from 'react';
import { getPatients, listCriticalValues, createCriticalValue } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientProfile } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Phone,
  FileText,
  Activity,
  Search,
  Plus,
  Bell,
  XCircle,
  RefreshCw,
} from 'lucide-react';

/**
 * CriticalValuePage
 * 
 * Page for reporting and acknowledging critical lab values.
 * Implements read-back verification workflow per Joint Commission requirements.
 */

type CriticalLevel = 'critical-high' | 'critical-low' | 'panic';
type NotificationStatus = 'pending' | 'in-progress' | 'acknowledged' | 'escalated' | 'cancelled';
type NotificationMethod = 'phone' | 'in-person' | 'secure-message' | 'page';

interface CriticalValueThreshold {
  analyte: string;
  unit: string;
  criticalHigh?: number;
  criticalLow?: number;
  panicHigh?: number;
  panicLow?: number;
}

interface CriticalValueNotification {
  notificationId: string;
  patientId: string;
  patientName: string;
  analyte: string;
  value: number;
  unit: string;
  criticalLevel: CriticalLevel;
  thresholdExceeded: string; // e.g., "Critical High (>20)", "Panic Low (<2.5)"
  reportedBy: string; // Lab technician who generated the result
  reportedAt: string; // ISO timestamp
  orderingProvider: string; // Provider who ordered the test
  notificationStatus: NotificationStatus;
  notifiedProvider?: string; // Provider who was notified
  notificationMethod?: NotificationMethod;
  notifiedAt?: string; // ISO timestamp
  readBackVerified?: boolean; // Did provider read back the value?
  readBackValue?: string; // What the provider read back
  acknowledgmentNotes?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  escalatedTo?: string; // If no response, escalated to supervisor
  escalatedAt?: string;
  timeToAcknowledge?: number; // Minutes from reported to acknowledged
}

// Critical value thresholds database
const CRITICAL_THRESHOLDS: CriticalValueThreshold[] = [
  { analyte: 'Glucose', unit: 'mg/dL', criticalLow: 40, criticalHigh: 500, panicLow: 20, panicHigh: 700 },
  { analyte: 'Potassium', unit: 'mmol/L', criticalLow: 2.5, criticalHigh: 6.0, panicLow: 2.0, panicHigh: 7.0 },
  { analyte: 'Sodium', unit: 'mmol/L', criticalLow: 120, criticalHigh: 160, panicLow: 115, panicHigh: 170 },
  { analyte: 'Calcium', unit: 'mg/dL', criticalLow: 6.0, criticalHigh: 13.0, panicLow: 5.0, panicHigh: 15.0 },
  { analyte: 'Hemoglobin', unit: 'g/dL', criticalLow: 5.0, panicLow: 4.0 },
  { analyte: 'Platelets', unit: '10^9/L', criticalLow: 20, panicLow: 10 },
  { analyte: 'WBC', unit: '10^9/L', criticalLow: 1.0, criticalHigh: 30.0, panicLow: 0.5, panicHigh: 50.0 },
  { analyte: 'INR', unit: 'ratio', criticalHigh: 5.0, panicHigh: 8.0 },
  { analyte: 'Troponin', unit: 'ng/mL', criticalHigh: 0.5, panicHigh: 10.0 },
  { analyte: 'Creatinine', unit: 'mg/dL', criticalHigh: 5.0, panicHigh: 10.0 },
  { analyte: 'pH', unit: '', criticalLow: 7.20, criticalHigh: 7.60, panicLow: 7.10, panicHigh: 7.70 },
  { analyte: 'pCO2', unit: 'mmHg', criticalLow: 20, criticalHigh: 70, panicLow: 15, panicHigh: 90 },
  { analyte: 'pO2', unit: 'mmHg', criticalLow: 40, panicLow: 30 },
];

const CriticalValuePage: React.FC = () => {
  const { user } = useAuthStore();
  const { showSuccess, showError, showWarning } = useToastActions();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [notifications, setNotifications] = useState<CriticalValueNotification[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'report-new' | 'history' | 'thresholds'>('pending');
  const [selectedNotification, setSelectedNotification] = useState<CriticalValueNotification | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<NotificationStatus | 'all'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state for reporting new critical value
  const [newCritical, setNewCritical] = useState({
    patientId: '',
    analyte: '',
    value: '',
    unit: '',
    orderingProvider: '',
  });

  // Form state for acknowledgment
  const [acknowledgment, setAcknowledgment] = useState({
    notificationMethod: 'phone' as NotificationMethod,
    notifiedProvider: '',
    readBackValue: '',
    acknowledgmentNotes: '',
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [patientData, criticalData] = await Promise.all([
        getPatients(),
        listCriticalValues()
      ]);
      setPatients(patientData);
      
      // Map API response to interface
      const items = (criticalData.items || []) as Record<string, unknown>[];
      const mappedNotifications: CriticalValueNotification[] = items.map((item) => ({
        notificationId: (item.notification_id || item.notificationId || '') as string,
        patientId: (item.patient_id || item.patientId || '') as string,
        patientName: (item.patient_name || item.patientName || '') as string,
        analyte: (item.analyte || '') as string,
        value: (item.value || 0) as number,
        unit: (item.unit || '') as string,
        criticalLevel: (item.critical_level || item.criticalLevel || 'critical-high') as CriticalLevel,
        thresholdExceeded: (item.threshold_exceeded || item.thresholdExceeded || '') as string,
        reportedBy: (item.reported_by || item.reportedBy || '') as string,
        reportedAt: (item.reported_at || item.reportedAt || '') as string,
        orderingProvider: (item.ordering_provider || item.orderingProvider || '') as string,
        notificationStatus: (item.notification_status || item.notificationStatus || 'pending') as NotificationStatus,
        notifiedProvider: item.notified_provider || item.notifiedProvider,
        notificationMethod: item.notification_method || item.notificationMethod,
        notifiedAt: item.notified_at || item.notifiedAt,
        readBackVerified: item.read_back_verified ?? item.readBackVerified,
        readBackValue: item.read_back_value || item.readBackValue,
        acknowledgmentNotes: item.acknowledgment_notes || item.acknowledgmentNotes,
        acknowledgedBy: item.acknowledged_by || item.acknowledgedBy,
        acknowledgedAt: item.acknowledged_at || item.acknowledgedAt,
        escalatedTo: item.escalated_to || item.escalatedTo,
        escalatedAt: item.escalated_at || item.escalatedAt,
        timeToAcknowledge: item.time_to_acknowledge || item.timeToAcknowledge,
      } as CriticalValueNotification));
      
      setNotifications(mappedNotifications);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch critical value data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const determineCriticalLevel = (
    analyte: string,
    value: number
  ): { level: CriticalLevel; threshold: string } | null => {
    const threshold = CRITICAL_THRESHOLDS.find((t) => t.analyte === analyte);
    if (!threshold) return null;

    if (threshold.panicHigh && value >= threshold.panicHigh) {
      return { level: 'panic', threshold: `Panic High (>${threshold.panicHigh})` };
    }
    if (threshold.panicLow && value <= threshold.panicLow) {
      return { level: 'panic', threshold: `Panic Low (<${threshold.panicLow})` };
    }
    if (threshold.criticalHigh && value >= threshold.criticalHigh) {
      return { level: 'critical-high', threshold: `Critical High (>${threshold.criticalHigh})` };
    }
    if (threshold.criticalLow && value <= threshold.criticalLow) {
      return { level: 'critical-low', threshold: `Critical Low (<${threshold.criticalLow})` };
    }

    return null;
  };

  const handleReportCriticalValue = () => {
    if (!newCritical.patientId || !newCritical.analyte || !newCritical.value || !newCritical.orderingProvider) {
      showWarning('Please fill in all required fields');
      return;
    }

    const patient = patients.find((p) => p.patient_id === newCritical.patientId);
    if (!patient) return;

    const value = parseFloat(newCritical.value);
    const criticalInfo = determineCriticalLevel(newCritical.analyte, value);

    if (!criticalInfo) {
      showWarning('This value does not meet critical thresholds');
      return;
    }

    const newNotification: CriticalValueNotification = {
      notificationId: `CV-${String(notifications.length + 1).padStart(3, '0')}`,
      patientId: patient.patient_id,
      patientName: patient.full_name,
      analyte: newCritical.analyte,
      value: value,
      unit: newCritical.unit,
      criticalLevel: criticalInfo.level,
      thresholdExceeded: criticalInfo.threshold,
      reportedBy: user?.userId || 'UNKNOWN',
      reportedAt: new Date().toISOString(),
      orderingProvider: newCritical.orderingProvider,
      notificationStatus: 'pending',
    };

    setNotifications([newNotification, ...notifications]);
    setNewCritical({
      patientId: '',
      analyte: '',
      value: '',
      unit: '',
      orderingProvider: '',
    });
    setActiveTab('pending');
    showSuccess(`Critical value notification ${newNotification.notificationId} created`);
  };

  const handleStartNotification = (notification: CriticalValueNotification) => {
    setSelectedNotification(notification);
    setAcknowledgment({
      notificationMethod: 'phone',
      notifiedProvider: notification.orderingProvider,
      readBackValue: '',
      acknowledgmentNotes: '',
    });
  };

  const handleAcknowledge = () => {
    if (!selectedNotification) return;

    if (!acknowledgment.notifiedProvider || !acknowledgment.readBackValue) {
      showWarning('Provider name and read-back verification are required');
      return;
    }

    const expectedReadBack = `${selectedNotification.analyte} ${selectedNotification.value} ${selectedNotification.unit}`;
    const readBackMatch = acknowledgment.readBackValue.toLowerCase().includes(
      selectedNotification.value.toString()
    );

    if (!readBackMatch) {
      const confirm = window.confirm(
        `Read-back value does not match expected value "${expectedReadBack}". Continue anyway?`
      );
      if (!confirm) return;
    }

    const updatedNotifications = notifications.map((n) => {
      if (n.notificationId === selectedNotification.notificationId) {
        const notifiedAt = new Date(n.reportedAt);
        const acknowledgedAt = new Date();
        const timeToAck = Math.round((acknowledgedAt.getTime() - notifiedAt.getTime()) / 1000 / 60);

        return {
          ...n,
          notificationStatus: 'acknowledged' as NotificationStatus,
          notifiedProvider: acknowledgment.notifiedProvider,
          notificationMethod: acknowledgment.notificationMethod,
          notifiedAt: new Date().toISOString(),
          readBackVerified: readBackMatch,
          readBackValue: acknowledgment.readBackValue,
          acknowledgmentNotes: acknowledgment.acknowledgmentNotes,
          acknowledgedBy: user?.userId || 'UNKNOWN',
          acknowledgedAt: new Date().toISOString(),
          timeToAcknowledge: timeToAck,
        };
      }
      return n;
    });

    setNotifications(updatedNotifications);
    setSelectedNotification(null);
    setAcknowledgment({
      notificationMethod: 'phone',
      notifiedProvider: '',
      readBackValue: '',
      acknowledgmentNotes: '',
    });
    showSuccess('Critical value acknowledged and documented');
  };

  const handleCancelNotification = (notificationId: string, reason: string) => {
    const updatedNotifications = notifications.map((n) => {
      if (n.notificationId === notificationId) {
        return {
          ...n,
          notificationStatus: 'cancelled' as NotificationStatus,
          acknowledgmentNotes: `Cancelled: ${reason}`,
          acknowledgedBy: user?.userId || 'UNKNOWN',
          acknowledgedAt: new Date().toISOString(),
        };
      }
      return n;
    });

    setNotifications(updatedNotifications);
    showSuccess('Notification cancelled');
  };

  const filteredNotifications = notifications.filter((n) => {
    const matchesSearch =
      n.notificationId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.analyte.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || n.notificationStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const pendingNotifications = notifications.filter(
    (n) => n.notificationStatus === 'pending' || n.notificationStatus === 'in-progress' || n.notificationStatus === 'escalated'
  );

  const getStatusBadge = (status: NotificationStatus) => {
    const badges = {
      pending: 'bg-red-100 text-red-800',
      'in-progress': 'bg-yellow-100 text-yellow-800',
      acknowledged: 'bg-green-100 text-green-800',
      escalated: 'bg-purple-100 text-purple-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };
    return badges[status] || 'bg-gray-100 text-gray-800';
  };

  const getStatusIcon = (status: NotificationStatus) => {
    switch (status) {
      case 'pending':
        return <AlertTriangle className="w-4 h-4" />;
      case 'in-progress':
        return <Activity className="w-4 h-4" />;
      case 'acknowledged':
        return <CheckCircle className="w-4 h-4" />;
      case 'escalated':
        return <Bell className="w-4 h-4" />;
      case 'cancelled':
        return <XCircle className="w-4 h-4" />;
    }
  };

  const getCriticalLevelBadge = (level: CriticalLevel) => {
    const badges = {
      'critical-high': 'bg-orange-100 text-orange-800',
      'critical-low': 'bg-orange-100 text-orange-800',
      panic: 'bg-red-100 text-red-800',
    };
    return badges[level];
  };

  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const getTimeAgo = (isoString: string) => {
    const now = Date.now();
    const timestamp = new Date(isoString).getTime();
    const diffMinutes = Math.round((now - timestamp) / 1000 / 60);

    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)} hr ago`;
    return `${Math.round(diffMinutes / 1440)} days ago`;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-600 to-cyan-500 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">Critical Value Reporting</h1>
        <p className="text-teal-50">
          Alert notification and read-back verification workflow
        </p>
        {pendingNotifications.length > 0 && (
          <div className="mt-4 bg-white/20 rounded-lg p-3 flex items-center gap-2">
            <Bell className="w-5 h-5 animate-pulse" />
            <span className="font-semibold">
              {pendingNotifications.length} pending notification{pendingNotifications.length !== 1 ? 's' : ''} requiring action
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-3 font-semibold transition-colors relative ${
            activeTab === 'pending'
              ? 'text-teal-600 border-b-2 border-teal-600'
              : 'text-gray-600 hover:text-teal-600'
          }`}
        >
          Pending Notifications
          {pendingNotifications.length > 0 && (
            <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
              {pendingNotifications.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('report-new')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'report-new'
              ? 'text-teal-600 border-b-2 border-teal-600'
              : 'text-gray-600 hover:text-teal-600'
          }`}
        >
          Report Critical Value
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'history'
              ? 'text-teal-600 border-b-2 border-teal-600'
              : 'text-gray-600 hover:text-teal-600'
          }`}
        >
          History
        </button>
        <button
          onClick={() => setActiveTab('thresholds')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'thresholds'
              ? 'text-teal-600 border-b-2 border-teal-600'
              : 'text-gray-600 hover:text-teal-600'
          }`}
        >
          Critical Thresholds
        </button>
      </div>

      {/* Pending Notifications Tab */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          {pendingNotifications.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-green-900 mb-2">
                No Pending Notifications
              </h3>
              <p className="text-green-700">
                All critical values have been acknowledged
              </p>
            </div>
          ) : (
            pendingNotifications.map((notification) => (
              <div
                key={notification.notificationId}
                className={`border rounded-lg shadow-sm overflow-hidden ${
                  notification.criticalLevel === 'panic'
                    ? 'border-red-300 bg-red-50'
                    : 'border-orange-300 bg-orange-50'
                }`}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-gray-900">
                          {notification.notificationId}
                        </h3>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 ${getCriticalLevelBadge(
                            notification.criticalLevel
                          )}`}
                        >
                          <AlertTriangle className="w-4 h-4" />
                          {notification.criticalLevel === 'panic' ? 'PANIC' : 'CRITICAL'}
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 ${getStatusBadge(
                            notification.notificationStatus
                          )}`}
                        >
                          {getStatusIcon(notification.notificationStatus)}
                          {notification.notificationStatus.toUpperCase().replace('-', ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Reported {getTimeAgo(notification.reportedAt)} •{' '}
                        {formatTimestamp(notification.reportedAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Clock className="w-5 h-5 text-red-600 inline mr-1" />
                      <span className="text-red-700 font-semibold">
                        {getTimeAgo(notification.reportedAt)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4 bg-white rounded-lg p-4">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Patient</p>
                      <p className="font-semibold text-gray-900">
                        {notification.patientName}
                      </p>
                      <p className="text-sm text-gray-600">{notification.patientId}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Critical Result</p>
                      <p className="text-2xl font-bold text-red-700">
                        {notification.analyte}: {notification.value} {notification.unit}
                      </p>
                      <p className="text-sm text-red-600 font-semibold">
                        {notification.thresholdExceeded}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Ordering Provider</p>
                      <p className="font-semibold text-gray-900">
                        {notification.orderingProvider}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Reported By</p>
                      <p className="font-semibold text-gray-900">
                        {notification.reportedBy}
                      </p>
                    </div>
                  </div>

                  {notification.notificationStatus === 'in-progress' && (
                    <div className="mb-4 bg-yellow-100 border border-yellow-200 rounded-lg p-3">
                      <p className="text-sm text-yellow-900">
                        <Activity className="w-4 h-4 inline mr-1" />
                        Notification in progress - contacted {notification.notifiedProvider} via{' '}
                        {notification.notificationMethod} at{' '}
                        {notification.notifiedAt && formatTimestamp(notification.notifiedAt)}
                      </p>
                    </div>
                  )}

                  {notification.notificationStatus === 'escalated' && (
                    <div className="mb-4 bg-purple-100 border border-purple-200 rounded-lg p-3">
                      <p className="text-sm text-purple-900">
                        <Bell className="w-4 h-4 inline mr-1" />
                        Escalated to {notification.escalatedTo} at{' '}
                        {notification.escalatedAt && formatTimestamp(notification.escalatedAt)} - no
                        response from {notification.notifiedProvider}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStartNotification(notification)}
                      className="flex-1 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-semibold flex items-center justify-center gap-2"
                    >
                      <Phone className="w-4 h-4" />
                      Acknowledge & Document
                    </button>
                    <button
                      onClick={() => {
                        const reason = prompt('Reason for cancellation:');
                        if (reason) {
                          handleCancelNotification(notification.notificationId, reason);
                        }
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Acknowledgment Modal */}
          {selectedNotification && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="bg-teal-600 text-white p-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold">Acknowledge Critical Value</h2>
                  <button
                    onClick={() => setSelectedNotification(null)}
                    className="text-white hover:bg-teal-700 rounded p-1"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  {/* Critical Value Summary */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h3 className="font-bold text-red-900 mb-2">Critical Result</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-gray-600">Patient</p>
                        <p className="font-semibold">{selectedNotification.patientName}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Result</p>
                        <p className="font-bold text-red-700 text-lg">
                          {selectedNotification.analyte}: {selectedNotification.value}{' '}
                          {selectedNotification.unit}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">Threshold</p>
                        <p className="font-semibold text-red-700">
                          {selectedNotification.thresholdExceeded}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">Ordering Provider</p>
                        <p className="font-semibold">{selectedNotification.orderingProvider}</p>
                      </div>
                    </div>
                  </div>

                  {/* Notification Method */}
                  <div>
                    <label htmlFor="critval-notification-method" className="block text-sm font-semibold text-gray-700 mb-2">
                      Notification Method <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="critval-notification-method"
                      value={acknowledgment.notificationMethod}
                      onChange={(e) =>
                        setAcknowledgment({
                          ...acknowledgment,
                          notificationMethod: e.target.value as NotificationMethod,
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="phone">Phone Call</option>
                      <option value="in-person">In-Person</option>
                      <option value="secure-message">Secure Message</option>
                      <option value="page">Page/Beeper</option>
                    </select>
                  </div>

                  {/* Notified Provider */}
                  <div>
                    <label htmlFor="critval-notified-provider" className="block text-sm font-semibold text-gray-700 mb-2">
                      Provider Notified <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="critval-notified-provider"
                      type="text"
                      value={acknowledgment.notifiedProvider}
                      onChange={(e) =>
                        setAcknowledgment({
                          ...acknowledgment,
                          notifiedProvider: e.target.value,
                        })
                      }
                      placeholder="Provider name or ID"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>

                  {/* Read-Back Verification */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      Read-Back Verification (Required)
                    </h3>
                    <p className="text-sm text-blue-800 mb-3">
                      The provider must read back the critical value to verify understanding. Enter
                      exactly what the provider stated.
                    </p>
                    <label htmlFor="critval-read-back" className="block text-sm font-semibold text-gray-700 mb-2">
                      Provider Read-Back <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="critval-read-back"
                      type="text"
                      value={acknowledgment.readBackValue}
                      onChange={(e) =>
                        setAcknowledgment({
                          ...acknowledgment,
                          readBackValue: e.target.value,
                        })
                      }
                      placeholder={`Expected: ${selectedNotification.analyte} ${selectedNotification.value} ${selectedNotification.unit}`}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      Example: "Potassium 7.2 millimoles per liter"
                    </p>
                  </div>

                  {/* Acknowledgment Notes */}
                  <div>
                    <label htmlFor="critval-action-plan" className="block text-sm font-semibold text-gray-700 mb-2">
                      Provider Response / Action Plan
                    </label>
                    <textarea
                      id="critval-action-plan"
                      value={acknowledgment.acknowledgmentNotes}
                      onChange={(e) =>
                        setAcknowledgment({
                          ...acknowledgment,
                          acknowledgmentNotes: e.target.value,
                        })
                      }
                      placeholder="Document provider's acknowledgment and planned actions..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      rows={3}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleAcknowledge}
                      className="flex-1 bg-teal-600 text-white px-4 py-3 rounded-lg hover:bg-teal-700 transition-colors font-semibold"
                    >
                      Complete Acknowledgment
                    </button>
                    <button
                      onClick={() => setSelectedNotification(null)}
                      className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Report New Critical Value Tab */}
      {activeTab === 'report-new' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Report New Critical Value
          </h2>

          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-2 gap-4">
              {/* Patient Selection */}
              <div>
                <label htmlFor="critval-patient" className="block text-sm font-semibold text-gray-700 mb-2">
                  Patient <span className="text-red-600">*</span>
                </label>
                <select
                  id="critval-patient"
                  value={newCritical.patientId}
                  onChange={(e) => setNewCritical({ ...newCritical, patientId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">Select patient...</option>
                  {patients.map((patient) => (
                    <option key={patient.patient_id} value={patient.patient_id}>
                      {patient.full_name} ({patient.patient_id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Analyte Selection */}
              <div>
                <label htmlFor="critval-analyte" className="block text-sm font-semibold text-gray-700 mb-2">
                  Analyte/Test <span className="text-red-600">*</span>
                </label>
                <select
                  id="critval-analyte"
                  value={newCritical.analyte}
                  onChange={(e) => {
                    const selected = CRITICAL_THRESHOLDS.find((t) => t.analyte === e.target.value);
                    setNewCritical({
                      ...newCritical,
                      analyte: e.target.value,
                      unit: selected?.unit || '',
                    });
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="">Select analyte...</option>
                  {CRITICAL_THRESHOLDS.map((threshold) => (
                    <option key={threshold.analyte} value={threshold.analyte}>
                      {threshold.analyte}
                    </option>
                  ))}
                </select>
              </div>

              {/* Result Value */}
              <div>
                <label htmlFor="critval-result-value" className="block text-sm font-semibold text-gray-700 mb-2">
                  Result Value <span className="text-red-600">*</span>
                </label>
                <input
                  id="critval-result-value"
                  type="number"
                  step="0.01"
                  value={newCritical.value}
                  onChange={(e) => setNewCritical({ ...newCritical, value: e.target.value })}
                  placeholder="Enter value"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              {/* Unit */}
              <div>
                <label htmlFor="critval-unit" className="block text-sm font-semibold text-gray-700 mb-2">
                  Unit <span className="text-red-600">*</span>
                </label>
                <input
                  id="critval-unit"
                  type="text"
                  value={newCritical.unit}
                  onChange={(e) => setNewCritical({ ...newCritical, unit: e.target.value })}
                  placeholder="Unit of measurement"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  readOnly={!!newCritical.analyte}
                />
              </div>

              {/* Ordering Provider */}
              <div className="col-span-2">
                <label htmlFor="critval-ordering-provider" className="block text-sm font-semibold text-gray-700 mb-2">
                  Ordering Provider <span className="text-red-600">*</span>
                </label>
                <input
                  id="critval-ordering-provider"
                  type="text"
                  value={newCritical.orderingProvider}
                  onChange={(e) =>
                    setNewCritical({ ...newCritical, orderingProvider: e.target.value })
                  }
                  placeholder="Provider ID or name"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>

            {/* Value Check Preview */}
            {newCritical.analyte && newCritical.value && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-bold text-blue-900 mb-2">Critical Threshold Check</h3>
                {(() => {
                  const value = parseFloat(newCritical.value);
                  const result = determineCriticalLevel(newCritical.analyte, value);
                  if (result) {
                    return (
                      <div className="text-sm">
                        <p className="text-blue-800">
                          <CheckCircle className="w-4 h-4 inline mr-1 text-green-600" />
                          This value meets <strong>{result.threshold}</strong> criteria
                        </p>
                        <p className="text-blue-700 mt-1">
                          Severity:{' '}
                          <span
                            className={`font-bold ${
                              result.level === 'panic' ? 'text-red-700' : 'text-orange-700'
                            }`}
                          >
                            {result.level === 'panic' ? 'PANIC' : 'CRITICAL'}
                          </span>
                        </p>
                      </div>
                    );
                  } else {
                    return (
                      <p className="text-sm text-orange-800">
                        <AlertTriangle className="w-4 h-4 inline mr-1" />
                        This value does not meet critical thresholds
                      </p>
                    );
                  }
                })()}
              </div>
            )}
          </div>

          {/* Critical Value Policy */}
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-6">
            <h3 className="font-bold text-teal-900 mb-2">Critical Value Reporting Policy</h3>
            <ul className="text-sm text-teal-800 space-y-1">
              <li>• Notify ordering provider within 30 minutes of result availability</li>
              <li>• Document provider name, notification method, and time</li>
              <li>• Obtain and document read-back verification</li>
              <li>• Escalate to supervisor if provider cannot be reached within 30 minutes</li>
              <li>• All notifications must be acknowledged within 1 hour</li>
            </ul>
          </div>

          <button
            onClick={handleReportCriticalValue}
            className="w-full bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700 transition-colors font-semibold flex items-center justify-center gap-2"
          >
            <Bell className="w-5 h-5" />
            Create Critical Value Notification
          </button>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label htmlFor="critval-search" className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    id="critval-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by notification ID, patient, or analyte..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="critval-status" className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select
                  id="critval-status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as NotificationStatus | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="in-progress">In Progress</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="escalated">Escalated</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          </div>

          {/* Notifications Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                    Notification
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                    Patient
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                    Critical Result
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                    Provider
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredNotifications.map((notification) => (
                  <tr key={notification.notificationId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${getStatusBadge(
                          notification.notificationStatus
                        )}`}
                      >
                        {getStatusIcon(notification.notificationStatus)}
                        {notification.notificationStatus.replace('-', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">
                        {notification.notificationId}
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatTimestamp(notification.reportedAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{notification.patientName}</p>
                      <p className="text-sm text-gray-600">{notification.patientId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-red-700">
                        {notification.analyte}: {notification.value} {notification.unit}
                      </p>
                      <p className="text-xs text-red-600">{notification.thresholdExceeded}</p>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${getCriticalLevelBadge(
                          notification.criticalLevel
                        )}`}
                      >
                        {notification.criticalLevel === 'panic' ? 'PANIC' : 'CRITICAL'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-900">{notification.orderingProvider}</p>
                      {notification.notifiedProvider && (
                        <p className="text-xs text-gray-600">
                          Notified: {notification.notifiedProvider}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {notification.timeToAcknowledge !== undefined && (
                        <p className="text-gray-600">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Ack: {notification.timeToAcknowledge} min
                        </p>
                      )}
                      {notification.notificationMethod && (
                        <p className="text-gray-600">
                          <Phone className="w-3 h-3 inline mr-1" />
                          {notification.notificationMethod}
                        </p>
                      )}
                      {notification.readBackVerified && (
                        <p className="text-green-600">
                          <CheckCircle className="w-3 h-3 inline mr-1" />
                          Read-back verified
                        </p>
                      )}
                      {notification.acknowledgmentNotes && (
                        <p className="text-gray-600 italic mt-1">
                          {notification.acknowledgmentNotes.substring(0, 50)}
                          {notification.acknowledgmentNotes.length > 50 && '...'}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Critical Thresholds Tab */}
      {activeTab === 'thresholds' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-200">
            <h2 className="text-lg font-bold">Critical Value Thresholds</h2>
            <p className="text-sm text-gray-600 mt-1">
              Laboratory reference ranges for critical and panic values
            </p>
          </div>
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                  Analyte/Test
                </th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Unit</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                  Critical Low
                </th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                  Panic Low
                </th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                  Critical High
                </th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">
                  Panic High
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {CRITICAL_THRESHOLDS.map((threshold) => (
                <tr key={threshold.analyte} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-900">{threshold.analyte}</td>
                  <td className="px-4 py-3 text-gray-600">{threshold.unit || 'N/A'}</td>
                  <td className="px-4 py-3">
                    {threshold.criticalLow ? (
                      <span className="text-orange-700 font-semibold">
                        {'<'} {threshold.criticalLow}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {threshold.panicLow ? (
                      <span className="text-red-700 font-bold">
                        {'<'} {threshold.panicLow}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {threshold.criticalHigh ? (
                      <span className="text-orange-700 font-semibold">
                        {'>'} {threshold.criticalHigh}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {threshold.panicHigh ? (
                      <span className="text-red-700 font-bold">
                        {'>'} {threshold.panicHigh}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-4 bg-gray-50 border-t border-gray-200">
            <div className="flex items-start gap-3 text-sm">
              <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-900 mb-1">Threshold Definitions</p>
                <p className="text-gray-700 mb-2">
                  <span className="font-semibold text-orange-700">Critical Values:</span> Require
                  prompt notification (within 30 minutes) and acknowledgment
                </p>
                <p className="text-gray-700">
                  <span className="font-semibold text-red-700">Panic Values:</span> Life-threatening
                  results requiring immediate notification and intervention
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CriticalValuePage;
