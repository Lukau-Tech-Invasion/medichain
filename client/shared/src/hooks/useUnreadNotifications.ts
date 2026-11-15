import { useCallback, useEffect, useState } from 'react';
import { getNotifications } from '../api/endpoints';

/** Tell every bell to re-read its unread count now. */
export function refreshNotificationBadges(): void {
  window.dispatchEvent(new Event('medichain:sidebar-refresh'));
}

const POLL_MS = 60_000;

/**
 * The signed-in account's unread notification count, for a bell badge.
 *
 * Re-read on mount, every minute, and whenever `refreshNotificationBadges` is
 * called (reading, removing or marking all read), so the badge changes the
 * moment the list does. `null` until the first read answers: an unknown count
 * shows no badge rather than a zero or a stale one.
 */
export function useUnreadNotifications(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await getNotifications();
      setCount(body.unread_count);
    } catch {
      // Keep the last known count; a failed read is not "no notifications".
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return undefined;
    }
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onRefresh = () => void load();
    window.addEventListener('medichain:sidebar-refresh', onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('medichain:sidebar-refresh', onRefresh);
    };
  }, [enabled, load]);

  return count;
}
