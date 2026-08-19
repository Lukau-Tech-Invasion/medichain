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
  /** The user id the live stream was opened for; null when not streaming. */
  const connectedUserRef = useRef<string | null>(null);

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

    // `/api/events` is a protected stream. This used to send
    // `X-User-Id: 'anonymous'` whenever no session existed, so simply loading
    // the login page produced a 401 in the console and then retried it every
    // five seconds forever. Wait for an identity instead of guessing one; the
    // watcher in the effect below connects as soon as sign-in provides it.
    if (!userId) {
      connectedUserRef.current = null;
      setIsConnected(false);
      setError(null);
      debugLog('useSSE', 'No authenticated user yet — deferring SSE connection');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    connectedUserRef.current = userId;

    try {
      debugLog('useSSE', `Connecting to SSE at ${baseUrl}/api/events ...`);
      const response = await fetch(`${baseUrl}/api/events`, {
        headers: {
          'X-User-Id': userId,
          'Accept': 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        // A rejected credential is not a transient fault, so retrying it on a
        // timer only produces a repeating 401 against a protected endpoint.
        // Stop, and let the identity watcher retry when the session changes.
        if (response.status === 401 || response.status === 403) {
          connectedUserRef.current = null;
          setIsConnected(false);
          setError(`SSE not authorized: ${response.status}`);
          debugLog('useSSE', 'SSE rejected the session; waiting for re-authentication');
          return;
        }
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

      // `for (;;)` rather than `while (true)`: identical behaviour, but it is
      // the form `no-constant-condition` accepts, so the intent-revealing
      // infinite read loop needs no disable comment. The loop is bounded by the
      // stream: it breaks when the reader reports `done`.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          debugLog('useSSE', 'SSE stream ended');
          // Clear the connected identity so the watcher re-opens the stream.
          // Without this a server-side close left the hook permanently silent
          // while still reporting itself connected.
          connectedUserRef.current = null;
          setIsConnected(false);
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
        connectedUserRef.current = null;
      } else {
        console.error('SSE Error:', err);
        setError(err.message);
        setIsConnected(false);
        connectedUserRef.current = null;

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

    // The stream is tied to an identity, but sign-in and sign-out happen in the
    // API client rather than in this hook's props, so there is nothing to put in
    // a dependency array. Watch the client's user id and react to it changing:
    // connect on sign-in (which is what makes the deferred first attempt
    // recover), and tear the stream down on sign-out or account switch so one
    // user's events can never arrive on another user's session.
    const watcher = setInterval(() => {
      const currentUser = getApiClient().getUserId() ?? null;
      if (currentUser === connectedUserRef.current) return;

      if (!currentUser) {
        abortControllerRef.current?.abort();
        connectedUserRef.current = null;
        setIsConnected(false);
        setEvents([]);
        return;
      }
      connect();
    }, 1000);

    return () => {
      clearInterval(watcher);
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
