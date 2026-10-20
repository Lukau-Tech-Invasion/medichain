import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getNotifications,
  getPatientCdsAlerts,
  markNotificationRead,
  markNotificationsRead,
  removeNotification,
  useTranslation,
} from '@medichain/shared';
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
  X,
} from 'lucide-react';

interface Notification {
  notification_id?: string;
  id?: string;
  title?: string;
  message?: string;
  type?: string;
  is_read?: boolean;
  /** Read by this account: shown under History rather than New. */
  read?: boolean;
  /** `type:id`: what read and remove are addressed by. */
  key?: string | null;
  created_at?: string | number;
  timestamp?: string | number;
}

interface ClinicalNotification {
  alert_id?: string; id?: string; title?: string; description?: string; message?: string;
  severity?: string; created_at?: string | number;
}

/**
 * NotificationsPage - System notifications and clinical alerts
 *
 * Features:
 * - Inbox notifications from /api/notifications
 * - CDS clinical alerts from /api/cds/patient/{patientId}/alerts
 * - Severity indicator for alerts (High/Medium/Low)
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
function useNotificationsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { patient, isAuthenticated } = usePatientAuthStore();
  const [activeTab, setActiveTab] = useState<'notifications' | 'alerts'>('notifications');
  const inboxLoad = useCallback(() => getNotifications(), []);
  const patientId = patient?.healthId ?? '';
  const alertsLoad = useCallback(() => getPatientCdsAlerts(patientId), [patientId]);
  const owner = `${patient?.userId}:${patient?.healthId}:${isAuthenticated}`;
  const enabled = !!patient && isAuthenticated;
  const inbox = useNotificationRead(inboxLoad, owner, enabled);
  const clinical = useNotificationRead(alertsLoad, owner, enabled);
  const notifications: Notification[] = inbox.data?.notifications ?? [];
  const alerts: ClinicalNotification[] = clinical.data?.alerts ?? [];
  const [view, setView] = useState<'new' | 'history'>('new');
  const inboxError = inbox.status === 'failed';
  const alertsError = clinical.status === 'failed';
  const [markError, setMarkError] = useState(false);
  const [marking, setMarking] = useState(false);
  const markPending = useRef(false);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const loadAll = (only?: 'inbox' | 'alerts') => {
    if (only !== 'alerts') void inbox.reload();
    if (only !== 'inbox') void clinical.reload();
  };
  useEffect(() => {
    if (!isAuthenticated || !patient) navigate('/login');
    setMarkError(false);
  }, [isAuthenticated, patient, navigate]);

  // Opening one moves it from New to History; removing one takes it off this
  // account's screen only. The record and its audit log are kept.
  const isUnread = (entry: Notification) => entry.read !== true;
  const unreadCount = notifications.filter(isUnread).length;
  const [removeError, setRemoveError] = useState(false);
  const markOne = async (entry: Notification) => {
    if (!isUnread(entry) || !entry.key) return;
    try {
      await markNotificationRead(entry.key);
    } catch (err) {
      console.error('Failed to mark notification read:', err);
      setMarkError(true);
      return;
    }
    await inbox.reload();
  };
  const removeOne = async (entry: Notification) => {
    if (!entry.key) return;
    setRemoveError(false);
    try {
      await removeNotification(entry.key);
    } catch (err) {
      console.error('Failed to remove notification:', err);
      setRemoveError(true);
      return;
    }
    await inbox.reload();
  };

  const handleMarkAllRead = async () => {
    if (markPending.current) return;
    markPending.current = true;
    setMarking(true);
    setMarkError(false);
    const requestOwner = owner;
    try {
      const response = await markNotificationsRead();
      if (!response.success) throw new Error('Read acknowledgement failed');
    } catch (err) {
      console.error('Failed to mark notifications read:', err);
      if (mounted.current && requestOwner === currentOwner.current) setMarkError(true);
      return;
    } finally {
      markPending.current = false;
      setMarking(false);
    }
    if (mounted.current && requestOwner === currentOwner.current) await inbox.reload();
  };
  const highAlerts = alerts.filter(a => (a.severity || '').toLowerCase() === 'high').length;

  return { t, activeTab, setActiveTab, view, setView, inbox, clinical, notifications, alerts, inboxError, alertsError, markError, removeError, marking, loadAll, handleMarkAllRead, markOne, removeOne, isUnread, unreadCount, highAlerts };
}
/** Independently load a resource, invalidating old responses on retry, owner change and unmount. */
function useNotificationRead<T extends { success: boolean }>(load: () => Promise<T>, owner: string, enabled: boolean) {
  const generation = useRef(0);
  const [state, setState] = useState<{ owner: string; data: T | null; status: 'loading' | 'ready' | 'failed' }>({ owner, data: null, status: 'loading' });
  const reload = useCallback(async () => {
    if (!enabled) return;
    const request = ++generation.current;
    setState({ owner, data: null, status: 'loading' });
    try {
      const data = await load();
      if (!data.success) throw new Error('Notification resource read failed');
      if (request === generation.current) setState({ owner, data, status: 'ready' });
    } catch (error) {
      console.error('Notification resource read failed:', error);
      if (request === generation.current) setState({ owner, data: null, status: 'failed' });
    }
  }, [load, owner, enabled]);
  useEffect(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);
  return { ...(state.owner === owner ? state : { data: null, status: 'loading' as const }), reload };
}

type NotificationModel = ReturnType<typeof useNotificationsPage>;

/** Render NotificationHeader using the current account resource states. */
function NotificationHeader(model: NotificationModel) {
  const { t, inbox, clinical, inboxError, alertsError, markError, marking, loadAll, handleMarkAllRead, unreadCount, highAlerts } = model;
  return <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">{t('notifications.title')}</h1>
          <p className="text-content-muted">
            {inbox.status !== 'ready' ? t('common.dataUnavailable') : unreadCount > 0 ? t('notifications.unread', { count: unreadCount }) : t('notifications.allCaughtUp')}
            {highAlerts > 0 ? ` • ${t('notifications.highPriorityCount', { count: highAlerts })}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={marking}
              className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-brand-fg rounded-lg text-xs font-semibold"
            >
              {t('notifications.markAllRead')}
            </button>
          )}
          <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            inbox.status === 'ready' && clinical.status === 'ready' ? 'bg-ok-subtle text-ok-subtle-fg' : 'bg-caution-subtle text-caution-subtle-fg'
          }`}>
            {inbox.status === 'ready' && clinical.status === 'ready' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {inbox.status === 'ready' && clinical.status === 'ready' ? t('common.live') : t('common.dataUnavailable')}
          </span>
          <button
            onClick={() => void loadAll()}
            aria-label={t('common.refresh')}
            className="p-2 text-content-muted hover:bg-surface-sunken rounded-lg"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {markError && <p role="alert">{t('notifications.markReadFailed')}</p>}
      {model.removeError && <p role="alert">{t('notifications.removeFailed')}</p>}
      {inboxError && <div role="alert" className="patient-card"><p>{t('notifications.inboxFailed')}</p><button onClick={() => void loadAll('inbox')}>{t('notifications.retryInbox')}</button></div>}
      {alertsError && <div role="alert" className="patient-card"><p>{t('notifications.alertsFailed')}</p><button onClick={() => void loadAll('alerts')}>{t('notifications.retryAlerts')}</button></div>}
      {(inbox.status === 'loading' || clinical.status === 'loading') && <p role="status"><Loader2 className="inline w-4 h-4 animate-spin" />{t('notifications.loading')}</p>}
  </>;
}

/** Render NotificationBanner using the current account resource states. */
function NotificationBanner(model: NotificationModel) {
  const { t, highAlerts } = model;
  return <>
      {/* High Priority Alert Banner */}
      {highAlerts > 0 && (
        <div className="bg-critical-subtle border border-critical rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-critical-subtle-fg mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-critical-subtle-fg">
              {t('notifications.highBannerTitle', { count: highAlerts })}
            </p>
            <p className="text-sm text-critical-subtle-fg">
              {t('notifications.highBannerBody')}
            </p>
          </div>
        </div>
      )}

  </>;
}

/** Render NotificationTabs using the current account resource states. */
function NotificationTabs(model: NotificationModel) {
  const { t, activeTab, setActiveTab, inbox, clinical, notifications, alerts, unreadCount, highAlerts } = model;
  return <>
      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab('notifications')}
          className={`relative px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'notifications'
              ? 'border-brand text-brand'
              : 'border-transparent text-content-muted hover:text-content-secondary'
          }`}
        >
          {inbox.status === 'ready' ? t('notifications.tabNotifications', { count: notifications.length }) : t('notifications.title')}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-700 text-white text-xs rounded-full flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('alerts')}
          className={`relative px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'alerts'
              ? 'border-brand text-brand'
              : 'border-transparent text-content-muted hover:text-content-secondary'
          }`}
        >
          {clinical.status === 'ready' ? t('notifications.tabAlerts', { count: alerts.length }) : t('notifications.clinicalTitle')}
          {highAlerts > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-700 text-white text-xs rounded-full flex items-center justify-center">
              {highAlerts}
            </span>
          )}
        </button>
      </div>

  </>;
}

/** Render NotificationInbox using the current account resource states. */
function NotificationInbox(model: NotificationModel) {
  const { t, activeTab, view, setView, inbox, notifications, isUnread, markOne, removeOne } = model;
  const formatTime = useNotificationTime();
  const fresh = notifications.filter(isUnread);
  const history = notifications.filter((n) => !isUnread(n));
  const shown = view === 'new' ? fresh : history;
  return <>
      {/* Notifications Tab */}
      {activeTab === 'notifications' && inbox.status === 'ready' && (
        <div className="space-y-3">
          <div role="tablist" aria-label={t('notifications.title')} className="flex gap-2">
            {(['new', 'history'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={view === tab}
                onClick={() => setView(tab)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                  view === tab ? 'bg-brand text-brand-fg' : 'bg-surface-sunken text-content-secondary'
                }`}
              >
                {tab === 'new'
                  ? t('notifications.viewNew', { count: fresh.length })
                  : t('notifications.viewHistory', { count: history.length })}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <p className="text-content-muted">
                {notifications.length === 0
                  ? t('notifications.noNotifications')
                  : view === 'new' ? t('notifications.noNew') : t('notifications.noHistory')}
              </p>
            </div>
          ) : (
            shown.map((n, idx) => (
              <div
                key={n.key || n.notification_id || n.id || idx}
                className={`patient-card ${isUnread(n) ? 'border-l-4 border-l-primary-400' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isUnread(n) ? 'bg-brand-subtle' : 'bg-surface-sunken'
                  }`}>
                    <Bell className={`w-4 h-4 ${isUnread(n) ? 'text-brand' : 'text-content-muted'}`} />
                  </div>
                  <button
                    type="button"
                    onClick={() => void markOne(n)}
                    className="flex-1 min-w-0 text-left"
                  >
                    {n.title && (
                      <p className="font-medium text-content">{n.title}</p>
                    )}
                    {n.message && <p className="text-sm text-content-secondary">{n.message}</p>}
                    {(n.created_at || n.timestamp) && (
                      <p className="text-xs text-content-muted mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(n.created_at || n.timestamp)}
                      </p>
                    )}
                    {isUnread(n) && n.key && (
                      <span className="mt-1 inline-block text-xs font-medium text-brand">{t('notifications.markRead')}</span>
                    )}
                  </button>
                  {!isUnread(n) && (
                    <span className="text-xs text-content-muted">{t('notifications.read')}<CheckCircle className="w-4 h-4" /></span>
                  )}
                  {n.key && (
                    <button
                      type="button"
                      onClick={() => void removeOne(n)}
                      aria-label={t('notifications.removeLabel', { title: n.title ?? '' })}
                      title={t('notifications.remove')}
                      className="p-2 -m-1 rounded-lg text-content-muted hover:bg-surface-sunken"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

  </>;
}

/** Render ClinicalAlerts using the current account resource states. */
function ClinicalAlerts(model: NotificationModel) {
  const { t, activeTab, clinical, alerts } = model;
  const formatTime = useNotificationTime();
  const getSeverityBadge = useSeverityBadge();
  return <>      {activeTab === 'alerts' && clinical.status === 'ready' && (
        <div className="space-y-3">
          {alerts.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="w-12 h-12 text-content-muted mx-auto mb-3" />
              <p className="text-content-muted">{t('notifications.noAlerts')}</p>
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
                      (alert.severity || '').toLowerCase() === 'high' ? 'bg-critical-subtle' :
                      (alert.severity || '').toLowerCase() === 'medium' ? 'bg-caution-subtle' :
                      'bg-notice-subtle'
                    }`}>
                      <AlertTriangle className={`w-4 h-4 ${
                        (alert.severity || '').toLowerCase() === 'high' ? 'text-critical-subtle-fg' :
                        (alert.severity || '').toLowerCase() === 'medium' ? 'text-caution-subtle-fg' :
                        'text-notice-subtle-fg'
                      }`} />
                    </div>
                    <div>
                      {alert.title && (
                        <p className="font-medium text-content">{alert.title}</p>
                      )}
                      <p className="text-sm text-content-secondary">
                        {alert.description || alert.message}
                      </p>
                      {alert.created_at && (
                        <p className="text-xs text-content-muted mt-1 flex items-center gap-1">
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
  </>;
}

/** Show independently recoverable inbox and clinical alert resources for the signed-in patient. */
export function NotificationsPage() {
  const model = useNotificationsPage();
  return <div className="p-4 md:p-6 space-y-6">
    <NotificationHeader {...model} />
    <NotificationBanner {...model} />
    <NotificationTabs {...model} />
    <NotificationInbox {...model} />
    <ClinicalAlerts {...model} />
  </div>;
}


/** Format optional event timestamps for display. */
function useNotificationTime() {
  const { t } = useTranslation();
  const formatTime = (value?: string | number) => {
    if (value === undefined) return '';
    // API timestamps are Unix seconds. Treating them as JavaScript milliseconds
    // displayed recent clinical alerts as dates in January 1970.
    const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t('notifications.minsAgoShort', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('notifications.hoursAgoShort', { count: hours });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return formatTime;
}

/** Render the supported clinical severity labels. */
function useSeverityBadge() {
  const { t } = useTranslation();
  const getSeverityBadge = (severity?: string) => {
    switch ((severity || '').toLowerCase()) {
      case 'high':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-critical-subtle text-critical-subtle-fg">
            <AlertTriangle className="w-3 h-3" />
            {t('notifications.sevHigh')}
          </span>
        );
      case 'medium':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-caution-subtle text-caution-subtle-fg">
            <AlertTriangle className="w-3 h-3" />
            {t('notifications.sevMedium')}
          </span>
        );
      case 'low':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-notice-subtle text-notice-subtle-fg">
            <Info className="w-3 h-3" />
            {t('notifications.sevLow')}
          </span>
        );
      default:
        return null;
    }
  };

  return getSeverityBadge;
}
