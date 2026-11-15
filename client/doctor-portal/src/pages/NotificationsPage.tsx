import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getApiErrorMessage,
  getNotifications,
  markNotificationRead,
  markNotificationsRead,
  removeNotification,
  splitInbox,
  useTranslation,
  Alert,
  LoadingSpinner,
  formatTimestamp,
  refreshNotificationBadges,
} from '@medichain/shared';
import type { InboxNotification } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import { AlertTriangle, Bell, Check, CheckCheck, FlaskConical, Heart, ShieldAlert, X } from 'lucide-react';

/**
 * The screen behind the bell.
 *
 * The header badge counted notifications and its button navigated to
 * `/notifications` — a path no route served, so React Router's catch-all
 * redirected the click to the dashboard. The count was visible, the list was
 * not, and nothing could ever be marked read because `unread_count` was the
 * length of the list.
 *
 * Every entry here is derived by the server from live clinical state: a
 * critical value that was reported, a code blue that was called, lab results
 * waiting on this doctor, an emergency access of this patient's card. Nothing
 * on this page is generated in the browser.
 *
 * New holds what this account has not read; opening one, or marking it read,
 * moves it to History. Removing one takes it off this account's screen only:
 * the record underneath and its audit log are kept, and nobody else's list
 * changes.
 */

/** Where a notification's subject lives, so the entry is worth clicking. */
const DESTINATION: Record<string, string> = {
  critical_value: '/critical-value',
  code_blue: '/code-blue',
  pending_approval: '/lab-results',
  lab_result: '/lab-results',
  emergency_access: '/access-logs',
};

function iconFor(type: string) {
  switch (type) {
    case 'critical_value':
      return <AlertTriangle className="w-5 h-5" />;
    case 'code_blue':
      return <Heart className="w-5 h-5" />;
    case 'emergency_access':
      return <ShieldAlert className="w-5 h-5" />;
    case 'lab_result':
    case 'pending_approval':
      return <FlaskConical className="w-5 h-5" />;
    default:
      return <Bell className="w-5 h-5" />;
  }
}

/** The priority the server assigned, in this palette's tokens. */
function priorityClasses(priority: string): string {
  switch (priority) {
    case 'critical':
      return 'bg-critical-subtle text-critical-subtle-fg border-critical';
    case 'high':
      return 'bg-caution-subtle text-caution-subtle-fg border-caution';
    case 'medium':
      return 'bg-notice-subtle text-notice-subtle-fg border-notice';
    default:
      return 'bg-surface-sunken text-content-secondary border-border-strong';
  }
}

const NotificationsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToastActions();
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [view, setView] = useState<'new' | 'history'>('new');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getNotifications();
      setNotifications(response.notifications || []);
    } catch (err) {
      // "No notifications" and "the list could not be read" are opposite
      // findings about an alerting surface, so the empty state is not shown
      // for a failure.
      setError(getApiErrorMessage(err, t('docNotifications.errorLoad')));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await markNotificationsRead();
    } catch (err) {
      showError(getApiErrorMessage(err, t('docNotifications.errorMarkRead')));
      return;
    }
    await fetchNotifications();
    refreshNotificationBadges();
    showSuccess(t('docNotifications.markedRead'));
  };

  /** Mark one read on the server, then move it to History here. */
  const markRead = async (entry: InboxNotification): Promise<boolean> => {
    if (entry.read || !entry.key) return true;
    try {
      await markNotificationRead(entry.key);
    } catch (err) {
      showError(getApiErrorMessage(err, t('docNotifications.errorMarkRead')));
      return false;
    }
    setNotifications((list) => list.map((n) => (n.key === entry.key ? { ...n, read: true } : n)));
    refreshNotificationBadges();
    return true;
  };

  const open = async (entry: InboxNotification, destination: string) => {
    await markRead(entry);
    navigate(destination);
  };

  const remove = async (entry: InboxNotification) => {
    if (!entry.key) return;
    try {
      await removeNotification(entry.key);
    } catch (err) {
      showError(getApiErrorMessage(err, t('docNotifications.errorRemove')));
      return;
    }
    setNotifications((list) => list.filter((n) => n.key !== entry.key));
    refreshNotificationBadges();
  };

  const { fresh, history } = splitInbox(notifications);
  const shown = view === 'new' ? fresh : history;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-content flex items-center gap-2">
            <Bell className="w-6 h-6" />
            {t('docNotifications.title')}
          </h1>
          <p className="text-content-muted mt-1">
            {t('docNotifications.unreadOfTotal', {
              unread: fresh.length,
              total: notifications.length,
            })}
          </p>
        </div>
        <button
          onClick={handleMarkAllRead}
          disabled={isLoading || fresh.length === 0}
          className="px-4 py-2 bg-brand hover:bg-brand-hover text-brand-fg rounded-lg text-sm font-semibold flex items-center gap-2 disabled:bg-none disabled:bg-disabled disabled:text-disabled-fg disabled:opacity-100"
        >
          <CheckCheck className="w-4 h-4" />
          {t('docNotifications.markAllRead')}
        </button>
      </div>

      <div role="tablist" aria-label={t('docNotifications.title')} className="flex gap-2 border-b border-border mb-4">
        {(['new', 'history'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={view === tab}
            onClick={() => setView(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${
              view === tab ? 'border-brand text-brand' : 'border-transparent text-content-muted hover:text-content-secondary'
            }`}
          >
            {tab === 'new'
              ? t('docNotifications.tabNew', { count: fresh.length })
              : t('docNotifications.tabHistory', { count: history.length })}
          </button>
        ))}
      </div>

      {error && (
        <Alert variant="error" className="mb-6" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {isLoading && (
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-content-muted">
          <LoadingSpinner size="sm" />
          {t('common.loading')}
        </div>
      )}

      {!isLoading && !error && shown.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-content-muted">
          {notifications.length === 0
            ? t('docNotifications.empty')
            : view === 'new'
              ? t('docNotifications.emptyNew')
              : t('docNotifications.emptyHistory')}
        </div>
      )}

      <ul className="space-y-3">
        {shown.map((entry) => {
          const destination = DESTINATION[entry.type];
          return (
            <li
              key={entry.key ?? `${entry.type}-${entry.id}`}
              className={`border rounded-lg p-4 flex items-start gap-3 ${priorityClasses(entry.priority)}`}
            >
              <span className="mt-0.5">{iconFor(entry.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{entry.title}</p>
                <p className="text-sm mt-1">
                  {entry.timestamp ? formatTimestamp(entry.timestamp * 1000) : t('docNotifications.timeUnknown')}
                  {entry.patient_id ? ` · ${entry.patient_id}` : ''}
                </p>
              </div>
              {!entry.read && (
                <span className="px-2 py-0.5 rounded-full bg-surface text-xs font-semibold text-content-secondary">
                  {t('docNotifications.newBadge')}
                </span>
              )}
              {!entry.read && entry.key && (
                <button
                  type="button"
                  onClick={() => void markRead(entry)}
                  className="px-3 py-1.5 bg-surface hover:bg-surface-sunken border border-border-strong rounded-lg text-sm font-semibold text-content-secondary flex items-center gap-1"
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  {t('docNotifications.markRead')}
                </button>
              )}
              {destination && (
                <button
                  type="button"
                  onClick={() => void open(entry, destination)}
                  className="px-3 py-1.5 bg-surface hover:bg-surface-sunken border border-border-strong rounded-lg text-sm font-semibold text-content-secondary"
                >
                  {t('docNotifications.openButton')}
                </button>
              )}
              {entry.key && (
                <button
                  type="button"
                  onClick={() => void remove(entry)}
                  aria-label={t('docNotifications.removeLabel', { title: entry.title })}
                  title={t('docNotifications.remove')}
                  className="p-1.5 rounded-lg hover:bg-surface text-content-secondary"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {notifications.length > 0 && (
        <p className="mt-6 text-xs text-content-muted">{t('docNotifications.removeNote')}</p>
      )}
    </div>
  );
};

export default NotificationsPage;
