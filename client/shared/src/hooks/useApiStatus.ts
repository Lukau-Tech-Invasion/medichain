import { useState, useEffect } from 'react';
import { getApiClient } from '../api/client';

/**
 * useApiStatus hook
 * 
 * Provides real-time information about the API connection status
 * and the size of the offline operation queue.
 */
export function useApiStatus() {
  const apiClient = getApiClient();
  const [isOnline, setIsOnline] = useState(apiClient.getConnectionStatus());
  const [queueSize, setQueueSize] = useState(apiClient.getOfflineQueue().size());

  useEffect(() => {
    // Listen for connection changes from ApiClient
    const unsubscribe = apiClient.addConnectionListener((connected) => {
      setIsOnline(connected);
      setQueueSize(apiClient.getOfflineQueue().size());
    });

    // Also poll queue size periodically (as enqueue might happen without connection change)
    const interval = setInterval(() => {
      const currentQueueSize = apiClient.getOfflineQueue().size();
      if (currentQueueSize !== queueSize) {
        setQueueSize(currentQueueSize);
      }
      
      // Heartbeat check if offline
      if (!apiClient.getConnectionStatus()) {
        apiClient.checkHealth().catch(() => {});
      }
    }, 5000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [apiClient, queueSize]);

  return { 
    isOnline, 
    queueSize,
    checkConnection: () => apiClient.checkHealth()
  };
}
