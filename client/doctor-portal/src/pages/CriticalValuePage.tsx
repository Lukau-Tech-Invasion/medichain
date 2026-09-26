import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getPatients,
  listCriticalValues,
  createCriticalValue,
  acknowledgeCriticalValue,
  cancelCriticalValue,
  getApiErrorMessage,
  useScoringCatalog,
  useTranslation,
  Alert,
  LoadingSpinner,
  Input,
  useValidatedForm,
  criticalValueAckSchema,
  criticalValueReportSchema,
  confirmDialog,
  promptDialog,
} from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import type { PatientDirectoryEntry } from '@medichain/shared';
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
import StaffName from '../components/StaffName';
import PatientSelect from '../components/PatientSelect';

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
// The call list is the server's (`clinical_scoring::CRITICAL_VALUE_THRESHOLDS`,
// served in the scoring catalogue). It lived here as a literal, and the page
// classified each report itself (rule 8); it now only previews.

const CriticalValuePage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { showSuccess, showError } = useToastActions();
  const [patients, setPatients] = useState<PatientDirectoryEntry[]>([]);
  const { catalog } = useScoringCatalog();
  const thresholds: CriticalValueThreshold[] = useMemo(
    () =>
      (catalog?.critical_values?.thresholds ?? []).map((entry) => ({
        analyte: entry.analyte,
        unit: entry.unit,
        criticalLow: entry.critical_low ?? undefined,
        criticalHigh: entry.critical_high ?? undefined,
        panicLow: entry.panic_low ?? undefined,
        panicHigh: entry.panic_high ?? undefined,
      })),
    [catalog]
  );
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
      setPatients(Array.isArray(patientData) ? patientData : []);
      
      // `listCriticalValues` returns `{ success, total, items }` — the client
      // wraps the server's bare array back into that envelope. This read
      // `Array.isArray(criticalData) ? criticalData : []`, which is false for
      // an object, so the list was always empty: no unacknowledged critical
      // value ever appeared on this screen. The test mocked a bare array, so it
      // passed against a shape the endpoint does not return.
      const items = (Array.isArray(criticalData)
        ? criticalData
        : (criticalData?.items ?? [])) as Record<string, unknown>[];
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
      setError(err instanceof Error ? err.message : t('docCriticalValue.errorFetchFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const determineCriticalLevel = (
    analyte: string,
    value: number
  ): { level: CriticalLevel; threshold: string } | null => {
    const threshold = thresholds.find((t) => t.analyte === analyte);
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

  const {
    errors: reportErrors,
    validate: validateReport,
    validateField: validateReportField,
    clearField: clearReportField,
  } = useValidatedForm(criticalValueReportSchema);

  const handleReportCriticalValue = async () => {
    // The ordering provider is who gets called. Without it the notification has
    // no addressee and the value sits in a queue -- which is the one outcome a
    // critical-value workflow exists to prevent.
    if (!newCritical.patientId) {
      showError(t('docCriticalValue.errorRequiredFields'));
      return;
    }
    if (!validateReport(newCritical)) {
      return;
    }

    const patient = patients.find((p) => p.patient_id === newCritical.patientId);
    if (!patient) return;

    const value = parseFloat(newCritical.value);
    const criticalInfo = determineCriticalLevel(newCritical.analyte, value);

    if (!criticalInfo) {
      showError(t('docCriticalValue.errorNotCritical'));
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

    try {
      setIsLoading(true);
      const response = await createCriticalValue(newNotification) as { success?: boolean; error?: string; notification_id?: string };
      if (response.success !== false) {
        await fetchData();
        setNewCritical({
          patientId: '',
          analyte: '',
          value: '',
          unit: '',
          orderingProvider: '',
        });
        setActiveTab('pending');
        showSuccess(t('docCriticalValue.successCreated', { id: response.notification_id ?? '' }));
      } else {
        showError(response.error || t('docCriticalValue.errorCreateFailed'));
      }
    } catch (err) {
      console.error('Error creating critical value notification:', err);
      showError(getApiErrorMessage(err, t('docCriticalValue.errorGenericCreate')));
    } finally {
      setIsLoading(false);
    }
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

  const {
    errors,
    validate: validateAck,
    validateField,
    clearField,
  } = useValidatedForm(criticalValueAckSchema);

  const handleAcknowledge = async () => {
    if (!selectedNotification) return;

    // Read-back is the safety procedure, so the message belongs on the box the
    // clinician has to fill, not in a toast above a long notification panel.
    if (!validateAck(acknowledgment)) {
      return;
    }

    const expectedReadBack = `${selectedNotification.analyte} ${selectedNotification.value} ${selectedNotification.unit}`;
    const readBackMatch = acknowledgment.readBackValue.toLowerCase().includes(
      selectedNotification.value.toString()
    );

    if (!readBackMatch) {
      const proceed = await confirmDialog({
        message: t('docCriticalValue.readBackMismatchConfirm', { expected: expectedReadBack }),
        destructive: true,
      });
      if (!proceed) return;
    }

    try {
      await acknowledgeCriticalValue(selectedNotification.notificationId, {
        notifiedProvider: acknowledgment.notifiedProvider,
        notificationMethod: acknowledgment.notificationMethod,
        readBackValue: acknowledgment.readBackValue,
        acknowledgmentNotes: acknowledgment.acknowledgmentNotes,
      });
    } catch (err) {
      showError(getApiErrorMessage(err, t('docCriticalValue.errorAcknowledgeFailed')));
      return;
    }
    await fetchData();
    setSelectedNotification(null);
    setAcknowledgment({
      notificationMethod: 'phone',
      notifiedProvider: '',
      readBackValue: '',
      acknowledgmentNotes: '',
    });
    showSuccess(t('docCriticalValue.successAcknowledged'));
  };

  const handleCancelNotification = async (notificationId: string, reason: string) => {
    try {
      await cancelCriticalValue(notificationId, reason);
    } catch (err) {
      showError(getApiErrorMessage(err, t('docCriticalValue.errorCancelFailed')));
      return;
    }
    await fetchData();
    showSuccess(t('docCriticalValue.successCancelled'));
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
      pending: 'bg-critical-subtle text-critical-subtle-fg',
      'in-progress': 'bg-caution-subtle text-caution-subtle-fg',
      acknowledged: 'bg-ok-subtle text-ok-subtle-fg',
      escalated: 'bg-surface-sunken text-content-secondary',
      cancelled: 'bg-muted text-muted-fg',
    };
    return badges[status] || 'bg-muted text-muted-fg';
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
      'critical-high': 'bg-surface-sunken text-content-secondary',
      'critical-low': 'bg-surface-sunken text-content-secondary',
      panic: 'bg-critical-subtle text-critical-subtle-fg',
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
      <div className="bg-gradient-to-r from-teal-700 to-cyan-800 text-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold mb-2">{t('docCriticalValue.title')}</h1>
        <p className="text-white">
          {t('docCriticalValue.subtitle')}
        </p>
        {pendingNotifications.length > 0 && (
          <div className="mt-4 bg-critical text-critical-fg rounded-lg p-3 flex items-center gap-2">
            <Bell className="w-5 h-5 animate-pulse" />
            <span className="font-semibold">
              {pendingNotifications.length !== 1
                ? t('docCriticalValue.pendingBannerPlural', { count: pendingNotifications.length })
                : t('docCriticalValue.pendingBannerSingular', { count: pendingNotifications.length })}
            </span>
          </div>
        )}
      </div>

      {/* The page already tracked this; it just never showed it. A failed
          save left the screen unchanged, which reads as success. */}
      {error && (
        <Alert variant="error" className="mb-6" onClose={() => setError(null)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void fetchData()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 min-h-[24px] rounded-lg border border-critical text-critical-subtle-fg hover:bg-critical-subtle disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('common.refresh')}
            </button>
          </div>
        </Alert>
      )}
      {isLoading && (
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-content-muted">
          <LoadingSpinner size="sm" />
          {t('common.loading')}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-3 font-semibold transition-colors relative ${
            activeTab === 'pending'
              ? 'text-content-secondary border-b-2 border-teal-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docCriticalValue.tabPending')}
          {pendingNotifications.length > 0 && (
            <span className="ml-2 bg-critical text-critical-fg text-xs rounded-full px-2 py-0.5">
              {pendingNotifications.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('report-new')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'report-new'
              ? 'text-content-secondary border-b-2 border-teal-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docCriticalValue.tabReportNew')}
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'history'
              ? 'text-content-secondary border-b-2 border-teal-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docCriticalValue.tabHistory')}
        </button>
        <button
          onClick={() => setActiveTab('thresholds')}
          className={`px-6 py-3 font-semibold transition-colors ${
            activeTab === 'thresholds'
              ? 'text-content-secondary border-b-2 border-teal-600'
              : 'text-content-muted hover:text-content-secondary'
          }`}
        >
          {t('docCriticalValue.tabThresholds')}
        </button>
      </div>

      {/* Pending Notifications Tab */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          {!error && !isLoading && pendingNotifications.length === 0 ? (
            <div className="bg-ok-subtle border border-ok rounded-lg p-8 text-center">
              <CheckCircle className="w-12 h-12 text-ok-subtle-fg mx-auto mb-3" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-ok-subtle-fg mb-2">
                {t('docCriticalValue.noPendingTitle')}
              </h3>
              <p className="text-ok-subtle-fg">
                {t('docCriticalValue.noPendingHint')}
              </p>
            </div>
          ) : (
            pendingNotifications.map((notification) => (
              <div
                key={notification.notificationId}
                className={`border rounded-lg shadow-sm overflow-hidden ${
                  notification.criticalLevel === 'panic'
                    ? 'border-critical bg-critical-subtle'
                    : 'border-orange-300 bg-surface-sunken'
                }`}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-content">
                          {notification.notificationId}
                        </h3>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 ${getCriticalLevelBadge(
                            notification.criticalLevel
                          )}`}
                        >
                          <AlertTriangle className="w-4 h-4" />
                          {notification.criticalLevel === 'panic' ? t('docCriticalValue.panicBadge') : t('docCriticalValue.criticalBadge')}
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 ${getStatusBadge(
                            notification.notificationStatus
                          )}`}
                        >
                          {getStatusIcon(notification.notificationStatus)}
                          {t(`docCriticalValue.status_${notification.notificationStatus}`)}
                        </span>
                      </div>
                      <p className="text-sm text-content-muted">
                        {t('docCriticalValue.reportedLine', { ago: getTimeAgo(notification.reportedAt), time: formatTimestamp(notification.reportedAt) })}
                      </p>
                    </div>
                    <div className="text-right">
                      <Clock className="w-5 h-5 text-critical-subtle-fg inline mr-1" />
                      <span className="text-critical-subtle-fg font-semibold">
                        {getTimeAgo(notification.reportedAt)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4 bg-surface rounded-lg p-4">
                    <div>
                      <p className="text-sm text-content-muted mb-1">{t('docCriticalValue.lblPatient')}</p>
                      <p className="font-semibold text-content">
                        {notification.patientName}
                      </p>
                      <p className="text-sm text-content-muted">{notification.patientId}</p>
                    </div>
                    <div>
                      <p className="text-sm text-content-muted mb-1">{t('docCriticalValue.lblCriticalResult')}</p>
                      <p className="text-2xl font-bold text-critical-subtle-fg">
                        {notification.analyte}: {notification.value} {notification.unit}
                      </p>
                      <p className="text-sm text-critical-subtle-fg font-semibold">
                        {notification.thresholdExceeded}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-content-muted mb-1">{t('docCriticalValue.lblOrderingProvider')}</p>
                      <p className="font-semibold text-content">
                        <StaffName id={notification.orderingProvider} />
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-content-muted mb-1">{t('docCriticalValue.lblReportedBy')}</p>
                      <p className="font-semibold text-content">
                        <StaffName id={notification.reportedBy} />
                      </p>
                    </div>
                  </div>

                  {notification.notificationStatus === 'in-progress' && (
                    <div className="mb-4 bg-caution-subtle border border-caution rounded-lg p-3">
                      <p className="text-sm text-caution-subtle-fg">
                        <Activity className="w-4 h-4 inline mr-1" />
                        {t('docCriticalValue.inProgressNote', {
                          provider: notification.notifiedProvider || '',
                          method: notification.notificationMethod || '',
                          time: notification.notifiedAt ? formatTimestamp(notification.notifiedAt) : ''
                        })}
                      </p>
                    </div>
                  )}

                  {notification.notificationStatus === 'escalated' && (
                    <div className="mb-4 bg-surface-sunken border border-purple-200 rounded-lg p-3">
                      <p className="text-sm text-content-secondary">
                        <Bell className="w-4 h-4 inline mr-1" />
                        {t('docCriticalValue.escalatedNote', {
                          escalatedTo: notification.escalatedTo || '',
                          time: notification.escalatedAt ? formatTimestamp(notification.escalatedAt) : '',
                          provider: notification.notifiedProvider || ''
                        })}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStartNotification(notification)}
                      className="flex-1 bg-brand text-brand-fg px-4 py-2 rounded-lg hover:bg-brand-hover transition-colors font-semibold flex items-center justify-center gap-2"
                    >
                      <Phone className="w-4 h-4" />
                      {t('docCriticalValue.acknowledgeBtn')}
                    </button>
                    <button
                      onClick={async () => {
                        const reason = await promptDialog({
                          message: t('docCriticalValue.cancelReasonPrompt'),
                          required: true,
                        });
                        if (reason) {
                          void handleCancelNotification(notification.notificationId, reason);
                        }
                      }}
                      className="px-4 py-2 border border-border-strong rounded-lg hover:bg-surface-sunken transition-colors"
                    >
                      {t('docCriticalValue.cancelBtn')}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Acknowledgment Modal */}
          {selectedNotification && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="bg-brand text-brand-fg p-4 flex items-center justify-between">
                  <h2 className="text-xl font-bold">{t('docCriticalValue.acknowledgeModalTitle')}</h2>
                  <button
                    onClick={() => setSelectedNotification(null)}
                    className="text-white hover:bg-brand-hover rounded p-1"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  {/* Critical Value Summary */}
                  <div className="bg-critical-subtle border border-critical rounded-lg p-4">
                    <h3 className="font-bold text-critical-subtle-fg mb-2">{t('docCriticalValue.criticalResultTitle')}</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-content-muted">{t('docCriticalValue.lblPatient')}</p>
                        <p className="font-semibold">{selectedNotification.patientName}</p>
                      </div>
                      <div>
                        <p className="text-content-muted">{t('docCriticalValue.resultLabel')}</p>
                        <p className="font-bold text-critical-subtle-fg text-lg">
                          {selectedNotification.analyte}: {selectedNotification.value}{' '}
                          {selectedNotification.unit}
                        </p>
                      </div>
                      <div>
                        <p className="text-content-muted">{t('docCriticalValue.thresholdLabel')}</p>
                        <p className="font-semibold text-critical-subtle-fg">
                          {selectedNotification.thresholdExceeded}
                        </p>
                      </div>
                      <div>
                        <p className="text-content-muted">{t('docCriticalValue.orderingProviderLabel')}</p>
                        <p className="font-semibold"><StaffName id={selectedNotification.orderingProvider} /></p>
                      </div>
                    </div>
                  </div>

                  {/* Notification Method */}
                  <div>
                    <label htmlFor="critval-notification-method" className="block text-sm font-semibold text-content-secondary mb-2">
                      {t('docCriticalValue.notificationMethodLabel')} <span className="text-critical-subtle-fg">*</span>
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
                      className="w-full border border-border-interactive rounded-lg px-3 py-2"
                    >
                      <option value="phone">{t('docCriticalValue.method_phone')}</option>
                      <option value="in-person">{t('docCriticalValue.method_in-person')}</option>
                      <option value="secure-message">{t('docCriticalValue.method_secure-message')}</option>
                      <option value="page">{t('docCriticalValue.method_page')}</option>
                    </select>
                  </div>

                  {/* Notified Provider */}
                  <div>
                    <label htmlFor="critval-notified-provider" className="block text-sm font-semibold text-content-secondary mb-2">
                      {t('docCriticalValue.providerNotifiedLabel')} <span className="text-critical-subtle-fg">*</span>
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
                      placeholder={t('docCriticalValue.providerNotifiedPh')}
                      className="w-full border border-border-interactive rounded-lg px-3 py-2"
                    />
                  </div>

                  {/* Read-Back Verification */}
                  <div className="bg-notice-subtle border border-notice rounded-lg p-4">
                    <h3 className="font-bold text-notice-subtle-fg mb-2 flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      {t('docCriticalValue.readBackTitle')}
                    </h3>
                    <p className="text-sm text-notice-subtle-fg mb-3">
                      {t('docCriticalValue.readBackIntro')}
                    </p>
                    <label htmlFor="critval-read-back" className="block text-sm font-semibold text-content-secondary mb-2">
                      {t('docCriticalValue.providerReadBackLabel')} <span className="text-critical-subtle-fg">*</span>
                    </label>
                    <Input
                      id="critval-read-back"
                      type="text"
                      value={acknowledgment.readBackValue}
                      onChange={(e) => {
                        clearField('readBackValue');
                        setAcknowledgment({ ...acknowledgment, readBackValue: e.target.value });
                      }}
                      onBlur={() => validateField('readBackValue', acknowledgment)}
                      error={errors.readBackValue}
                      placeholder={t('docCriticalValue.readBackPh', { analyte: selectedNotification.analyte, value: selectedNotification.value, unit: selectedNotification.unit })}
                      className="w-full border border-border-interactive rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-content-muted mt-1">
                      {t('docCriticalValue.readBackExample')}
                    </p>
                  </div>

                  {/* Acknowledgment Notes */}
                  <div>
                    <label htmlFor="critval-action-plan" className="block text-sm font-semibold text-content-secondary mb-2">
                      {t('docCriticalValue.providerResponseLabel')}
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
                      placeholder={t('docCriticalValue.providerResponsePh')}
                      className="w-full border border-border-interactive rounded-lg px-3 py-2"
                      rows={3}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => void handleAcknowledge()}
                      className="flex-1 bg-brand text-brand-fg px-4 py-3 rounded-lg hover:bg-brand-hover transition-colors font-semibold"
                    >
                      {t('docCriticalValue.completeAcknowledgmentBtn')}
                    </button>
                    <button
                      onClick={() => setSelectedNotification(null)}
                      className="px-6 py-3 border border-border-strong rounded-lg hover:bg-surface-sunken transition-colors"
                    >
                      {t('docCriticalValue.cancelBtn')}
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
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5" />
            {t('docCriticalValue.reportNewTitle')}
          </h2>

          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-2 gap-4">
              {/* Patient Selection */}
              <div>
                <PatientSelect
                  id="critval-patient"
                  label={t('docCriticalValue.patientLabel')}
                  value={newCritical.patientId}
                  onChange={(selectedPatientId) => setNewCritical({ ...newCritical, patientId: selectedPatientId })}
                />
              </div>

              {/* Analyte Selection */}
              <div>
                <label htmlFor="critval-analyte" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docCriticalValue.analyteLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <select
                  id="critval-analyte"
                  value={newCritical.analyte}
                  onChange={(e) => {
                    const selected = thresholds.find((t) => t.analyte === e.target.value);
                    setNewCritical({
                      ...newCritical,
                      analyte: e.target.value,
                      unit: selected?.unit || '',
                    });
                  }}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                >
                  <option value="">{t('docCriticalValue.selectAnalytePh')}</option>
                  {thresholds.map((threshold) => (
                    <option key={threshold.analyte} value={threshold.analyte}>
                      {threshold.analyte}
                    </option>
                  ))}
                </select>
              </div>

              {/* Result Value */}
              <div>
                <label htmlFor="critval-result-value" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docCriticalValue.resultValueLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="critval-result-value"
                  type="number"
                  step="0.01"
                  value={newCritical.value}
                  onChange={(e) => setNewCritical({ ...newCritical, value: e.target.value })}
                  placeholder={t('docCriticalValue.resultValuePh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                />
              </div>

              {/* Unit */}
              <div>
                <label htmlFor="critval-unit" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docCriticalValue.unitLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <input
                  id="critval-unit"
                  type="text"
                  value={newCritical.unit}
                  onChange={(e) => setNewCritical({ ...newCritical, unit: e.target.value })}
                  placeholder={t('docCriticalValue.unitPh')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                  readOnly={!!newCritical.analyte}
                />
              </div>

              {/* Ordering Provider */}
              <div className="col-span-2">
                <label htmlFor="critval-ordering-provider" className="block text-sm font-semibold text-content-secondary mb-2">
                  {t('docCriticalValue.orderingProviderLabel')} <span className="text-critical-subtle-fg">*</span>
                </label>
                <Input
                  id="critval-ordering-provider"
                  type="text"
                  value={newCritical.orderingProvider}
                  onChange={(e) => {
                    clearReportField('orderingProvider');
                    setNewCritical({ ...newCritical, orderingProvider: e.target.value });
                  }}
                  onBlur={() => validateReportField('orderingProvider', newCritical)}
                  error={reportErrors.orderingProvider}
                  placeholder={t('docCriticalValue.providerNotifiedPh')}
                  required
                />
              </div>
            </div>

            {/* Value Check Preview */}
            {newCritical.analyte && newCritical.value && (
              <div className="bg-notice-subtle border border-notice rounded-lg p-4">
                <h3 className="font-bold text-notice-subtle-fg mb-2">{t('docCriticalValue.thresholdCheckTitle')}</h3>
                {(() => {
                  const value = parseFloat(newCritical.value);
                  const result = determineCriticalLevel(newCritical.analyte, value);
                  if (result) {
                    return (
                      <div className="text-sm">
                        <p className="text-notice-subtle-fg">
                          <CheckCircle className="w-4 h-4 inline mr-1 text-ok-subtle-fg" />
                          {t('docCriticalValue.meetsCriteriaLine', { threshold: result.threshold })}
                        </p>
                        <p className="text-notice-subtle-fg mt-1">
                          {t('docCriticalValue.severityLabel')}{' '}
                          <span
                            className={`font-bold ${
                              result.level === 'panic' ? 'text-critical-subtle-fg' : 'text-content-secondary'
                            }`}
                          >
                            {result.level === 'panic' ? t('docCriticalValue.panicBadge') : t('docCriticalValue.criticalBadge')}
                          </span>
                        </p>
                      </div>
                    );
                  } else {
                    return (
                      <p className="text-sm text-content-secondary">
                        <AlertTriangle className="w-4 h-4 inline mr-1" />
                        {t('docCriticalValue.errorNotCritical')}
                      </p>
                    );
                  }
                })()}
              </div>
            )}
          </div>

          {/* Critical Value Policy */}
          <div className="bg-surface-sunken border border-teal-200 rounded-lg p-4 mb-6">
            <h3 className="font-bold text-content-secondary mb-2">{t('docCriticalValue.policyTitle')}</h3>
            <ul className="text-sm text-content-secondary space-y-1">
              <li>• {t('docCriticalValue.policy1')}</li>
              <li>• {t('docCriticalValue.policy2')}</li>
              <li>• {t('docCriticalValue.policy3')}</li>
              <li>• {t('docCriticalValue.policy4')}</li>
              <li>• {t('docCriticalValue.policy5')}</li>
            </ul>
          </div>

          <button
            onClick={handleReportCriticalValue}
            className="w-full bg-brand text-brand-fg px-6 py-3 rounded-lg hover:bg-brand-hover transition-colors font-semibold flex items-center justify-center gap-2"
          >
            <Bell className="w-5 h-5" />
            {t('docCriticalValue.createNotificationBtn')}
          </button>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label htmlFor="critval-search" className="block text-sm font-semibold text-content-secondary mb-2">{t('docCriticalValue.searchLabel')}</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-content-muted w-5 h-5" />
                  <input
                    id="critval-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('docCriticalValue.searchPh')}
                    className="w-full pl-10 pr-4 py-2 border border-border-interactive rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="critval-status" className="block text-sm font-semibold text-content-secondary mb-2">{t('docCriticalValue.statusLabel')}</label>
                <select
                  id="critval-status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as NotificationStatus | 'all')}
                  className="w-full border border-border-interactive rounded-lg px-3 py-2"
                >
                  <option value="all">{t('docCriticalValue.filterAllStatuses')}</option>
                  <option value="pending">{t('docCriticalValue.filterStatus_pending')}</option>
                  <option value="in-progress">{t('docCriticalValue.filterStatus_in-progress')}</option>
                  <option value="acknowledged">{t('docCriticalValue.filterStatus_acknowledged')}</option>
                  <option value="escalated">{t('docCriticalValue.filterStatus_escalated')}</option>
                  <option value="cancelled">{t('docCriticalValue.filterStatus_cancelled')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Notifications Table */}
          <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
            <table className="w-full">
              <thead className="bg-surface-sunken border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                    {t('docCriticalValue.colStatus')}
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                    {t('docCriticalValue.colNotification')}
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                    {t('docCriticalValue.colPatient')}
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                    {t('docCriticalValue.colCriticalResult')}
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                    {t('docCriticalValue.colProvider')}
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                    {t('docCriticalValue.colDetails')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredNotifications.map((notification) => (
                  <tr key={notification.notificationId} className="hover:bg-surface-sunken">
                    <td className="px-4 py-3">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${getStatusBadge(
                          notification.notificationStatus
                        )}`}
                      >
                        {getStatusIcon(notification.notificationStatus)}
                        {t(`docCriticalValue.status_${notification.notificationStatus}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-content">
                        {notification.notificationId}
                      </p>
                      <p className="text-sm text-content-muted">
                        {formatTimestamp(notification.reportedAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-content">{notification.patientName}</p>
                      <p className="text-sm text-content-muted">{notification.patientId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-critical-subtle-fg">
                        {notification.analyte}: {notification.value} {notification.unit}
                      </p>
                      <p className="text-xs text-critical-subtle-fg">{notification.thresholdExceeded}</p>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${getCriticalLevelBadge(
                          notification.criticalLevel
                        )}`}
                      >
                        {notification.criticalLevel === 'panic' ? t('docCriticalValue.panicBadge') : t('docCriticalValue.criticalBadge')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-content"><StaffName id={notification.orderingProvider} /></p>
                      {notification.notifiedProvider && (
                        <p className="text-xs text-content-muted">
                          {t('docCriticalValue.notifiedLine', { provider: notification.notifiedProvider })}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {notification.timeToAcknowledge !== undefined && (
                        <p className="text-content-muted">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {t('docCriticalValue.ackMinLine', { count: notification.timeToAcknowledge })}
                        </p>
                      )}
                      {notification.notificationMethod && (
                        <p className="text-content-muted">
                          <Phone className="w-3 h-3 inline mr-1" />
                          {notification.notificationMethod}
                        </p>
                      )}
                      {notification.readBackVerified && (
                        <p className="text-ok-subtle-fg">
                          <CheckCircle className="w-3 h-3 inline mr-1" />
                          {t('docCriticalValue.readBackVerifiedLabel')}
                        </p>
                      )}
                      {notification.acknowledgmentNotes && (
                        <p className="text-content-muted italic mt-1">
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
        <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
          <div className="p-4 bg-surface-sunken border-b border-border">
            <h2 className="text-lg font-bold">{t('docCriticalValue.thresholdsTitle')}</h2>
            <p className="text-sm text-content-muted mt-1">
              {t('docCriticalValue.thresholdsSubtitle')}
            </p>
          </div>
          <table className="w-full">
            <thead className="bg-surface-sunken border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                  {t('docCriticalValue.colAnalyte')}
                </th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">{t('docCriticalValue.colUnit')}</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                  {t('docCriticalValue.colCriticalLow')}
                </th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                  {t('docCriticalValue.colPanicLow')}
                </th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                  {t('docCriticalValue.colCriticalHigh')}
                </th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-content-secondary">
                  {t('docCriticalValue.colPanicHigh')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {thresholds.map((threshold) => (
                <tr key={threshold.analyte} className="hover:bg-surface-sunken">
                  <td className="px-4 py-3 font-semibold text-content">{threshold.analyte}</td>
                  <td className="px-4 py-3 text-content-muted">{threshold.unit || t('docCriticalValue.naLabel')}</td>
                  <td className="px-4 py-3">
                    {threshold.criticalLow ? (
                      <span className="text-content-secondary font-semibold">
                        {'<'} {threshold.criticalLow}
                      </span>
                    ) : (
                      <span className="text-content-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {threshold.panicLow ? (
                      <span className="text-critical-subtle-fg font-bold">
                        {'<'} {threshold.panicLow}
                      </span>
                    ) : (
                      <span className="text-content-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {threshold.criticalHigh ? (
                      <span className="text-content-secondary font-semibold">
                        {'>'} {threshold.criticalHigh}
                      </span>
                    ) : (
                      <span className="text-content-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {threshold.panicHigh ? (
                      <span className="text-critical-subtle-fg font-bold">
                        {'>'} {threshold.panicHigh}
                      </span>
                    ) : (
                      <span className="text-content-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-4 bg-surface-sunken border-t border-border">
            <div className="flex items-start gap-3 text-sm">
              <AlertTriangle className="w-5 h-5 text-content-secondary flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-content mb-1">{t('docCriticalValue.definitionsTitle')}</p>
                <p className="text-content-secondary mb-2">
                  <span className="font-semibold text-content-secondary">{t('docCriticalValue.criticalValuesLabel')}</span> {t('docCriticalValue.criticalValuesDesc')}
                </p>
                <p className="text-content-secondary">
                  <span className="font-semibold text-critical-subtle-fg">{t('docCriticalValue.panicValuesLabel')}</span> {t('docCriticalValue.panicValuesDesc')}
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
