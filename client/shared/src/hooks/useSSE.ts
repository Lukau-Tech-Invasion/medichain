import { useEffect, useState, useCallback, useRef } from 'react';
import { getApiClient } from '../api/client';
import { PushEvent } from '../types';
import { debugLog } from '../config';

export interface UseSSEReturn {
  events: PushEvent[];
  isConnected: boolean;
  error: string | null;
  clearEvents: () => void;
}

/**
 * useSSE Hook
 * 
 * Subscribes to Server-Sent Events from the backend.
 * Uses fetch + ReadableStream to support custom headers (X-User-Id).
 */
export function useSSE(): UseSSEReturn {
  const [events, setEvents] = useState<PushEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const connect = useCallback(async () => {
    const apiClient = getApiClient();
    const userId = apiClient.getUserId();
    const baseUrl = apiClient.getBaseUrl();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      debugLog('useSSE', `Connecting to SSE at ${baseUrl}/api/events ...`);
      const response = await fetch(`${baseUrl}/api/events`, {
        headers: {
          'X-User-Id': userId || 'anonymous',
          'Accept': 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      setIsConnected(true);
      setError(null);
      debugLog('useSSE', 'SSE Connected');

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('ReadableStream not supported on this browser');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          debugLog('useSSE', 'SSE stream ended');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // SSE frames are separated by double newlines
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as PushEvent;
                setEvents(prev => [data, ...prev].slice(0, 50)); // Keep last 50 events
                debugLog('useSSE', `Received ${data.event_type} event`);
              } catch (e) {
                console.error('Failed to parse SSE data:', e, part);
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        debugLog('useSSE', 'SSE connection aborted');
      } else {
        console.error('SSE Error:', err);
        setError(err.message);
        setIsConnected(false);
        
        // Attempt reconnect after 5 seconds if not aborted
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          if (!controller.signal.aborted) {
            connect();
          }
        }, 5000);
      }
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return { events, isConnected, error, clearEvents };
}
