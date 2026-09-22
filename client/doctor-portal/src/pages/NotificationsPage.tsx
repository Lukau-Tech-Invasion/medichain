import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getApiErrorMessage,
  getNotifications,
  markNotificationsRead,
  useTranslation,
  Alert,
  LoadingSpinner,
} from '@medichain/shared';
import type { InboxNotification } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import { AlertTriangle, Bell, CheckCheck, FlaskConical, Heart, ShieldAlert } from 'lucide-react';

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
  const [readAt, setReadAt] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getNotifications();
      setNotifications(response.notifications || []);
      setReadAt(response.read_at || 0);
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
    showSuccess(t('docNotifications.markedRead'));
  };

  const unread = notifications.filter((entry) => (entry.timestamp ?? 0) > readAt);

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
              unread: unread.length,
              total: notifications.length,
            })}
          </p>
        </div>
        <button
          onClick={handleMarkAllRead}
          disabled={isLoading || unread.length === 0}
          className="px-4 py-2 bg-brand hover:bg-brand-hover text-brand-fg rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
        >
          <CheckCheck className="w-4 h-4" />
          {t('docNotifications.markAllRead')}
        </button>
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

      {!isLoading && !error && notifications.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-content-muted">
          {t('docNotifications.empty')}
        </div>
      )}

      <ul className="space-y-3">
        {notifications.map((entry) => {
          const isUnread = (entry.timestamp ?? 0) > readAt;
          const destination = DESTINATION[entry.type];
          return (
            <li
              key={`${entry.type}-${entry.id}`}
              className={`border rounded-lg p-4 flex items-start gap-3 ${priorityClasses(
                entry.priority
              )} ${isUnread ? '' : 'opacity-70'}`}
            >
              <span className="mt-0.5">{iconFor(entry.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{entry.title}</p>
                <p className="text-sm mt-1">
                  {entry.timestamp
                    ? new Date(entry.timestamp * 1000).toLocaleString()
                    : t('docNotifications.timeUnknown')}
                  {entry.patient_id ? ` · ${entry.patient_id}` : ''}
                </p>
              </div>
              {isUnread && (
                <span className="px-2 py-0.5 rounded-full bg-surface text-xs font-semibold text-content-secondary">
                  {t('docNotifications.newBadge')}
                </span>
              )}
              {destination && (
                <button
                  onClick={() => navigate(destination)}
                  className="px-3 py-1.5 bg-surface hover:bg-surface-sunken border border-border-strong rounded-lg text-sm font-semibold text-content-secondary"
                >
                  {t('docNotifications.openButton')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default NotificationsPage;
