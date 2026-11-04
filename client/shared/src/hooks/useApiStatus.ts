import { useState, useEffect } from 'react';
import { getApiClient } from '../api/client';
import { unsentSyncItems } from '../utils/indexedDB';

/**
 * useApiStatus hook
 *
 * Provides real-time information about the API connection status and how many
 * of the signed-in user's writes are saved on this device but not yet sent.
 */
export function useApiStatus() {
  const apiClient = getApiClient();
  const [isOnline, setIsOnline] = useState(apiClient.getConnectionStatus());
  const [queueSize, setQueueSize] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const countUnsent = () => {
      const owner = apiClient.getUserId();
      if (!owner) {
        setQueueSize(0);
        return;
      }
      unsentSyncItems(owner)
        .then((items) => { if (!cancelled) setQueueSize(items.length); })
        .catch(() => { /* an unreadable queue shows no badge rather than a guess */ });
    };
    countUnsent();

    const unsubscribe = apiClient.addConnectionListener((connected) => {
      setIsOnline(connected);
      countUnsent();
    });

    // Writes are queued without a connection change, so the count is polled too.
    const interval = setInterval(() => {
      countUnsent();
      // Heartbeat check if offline
      if (!apiClient.getConnectionStatus()) {
        apiClient.checkHealth().catch(() => {});
      }
    }, 5000);

    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(interval);
    };
  }, [apiClient]);

  return {
    isOnline,
    queueSize,
    checkConnection: () => apiClient.checkHealth()
  };
}
