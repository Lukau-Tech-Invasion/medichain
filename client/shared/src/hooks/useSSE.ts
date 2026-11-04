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
 * Uses fetch + ReadableStream so the bearer token can be sent as a header.
 */
export function useSSE(): UseSSEReturn {
  const [events, setEvents] = useState<PushEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(5000);
  /** The user id the live stream was opened for; null when not streaming. */
  const connectedUserRef = useRef<string | null>(null);
  const connectedAuthRef = useRef<string | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const connect = useCallback(async () => {
    const apiClient = getApiClient();
    const userId = apiClient.getUserId();
    const baseUrl = apiClient.getBaseUrl();
    const sessionHeaders = apiClient.getSessionHeaders();

    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // `/api/events` is a protected stream. This used to send
    // an `anonymous` identity whenever no session existed, so simply loading
    // the login page produced a 401 in the console and then retried it every
    // five seconds forever. Wait for an identity instead of guessing one; the
    // watcher in the effect below connects as soon as sign-in provides it.
    if (!userId || document.visibilityState === 'hidden' || !document.hasFocus()) {
      connectedUserRef.current = null;
      connectedAuthRef.current = null;
      setIsConnected(false);
      setError(null);
      debugLog('useSSE', 'No authenticated user yet — deferring SSE connection');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    connectedUserRef.current = userId;
    connectedAuthRef.current = sessionHeaders.Authorization ?? null;
    let retryAfterMs = 0;

    try {
      debugLog('useSSE', `Connecting to SSE at ${baseUrl}/api/events ...`);
      const response = await fetch(`${baseUrl}/api/events`, {
        headers: {
          ...sessionHeaders,
          'Accept': 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (controller.signal.aborted || abortControllerRef.current !== controller) return;
      if (!response.ok) {
        // A rejected credential is not a transient fault, so retrying it on a
        // timer only produces a repeating 401 against a protected endpoint.
        // Stop, and let the identity watcher retry when the session changes.
        if (response.status === 401 || response.status === 403) {
          setIsConnected(false);
          setError(`SSE not authorized: ${response.status}`);
          debugLog('useSSE', 'SSE rejected the session; waiting for re-authentication');
          return;
        }
        if (response.status === 429) {
          const seconds = Number(response.headers.get('Retry-After'));
          if (Number.isFinite(seconds) && seconds > 0) {
            retryAfterMs = Math.min(Math.max(seconds * 1000, 5000), 60000);
          }
        }
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      retryDelayRef.current = 5000;
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
        if (controller.signal.aborted || abortControllerRef.current !== controller) return;
        if (done) {
          debugLog('useSSE', 'SSE stream ended');
          // Clear the connected identity so the watcher re-opens the stream.
          // Without this a server-side close left the hook permanently silent
          // while still reporting itself connected.
          setIsConnected(false);
          const delay = retryDelayRef.current;
          retryDelayRef.current = Math.min(delay * 2, 60000);
          reconnectTimerRef.current = setTimeout(() => {
            if (!controller.signal.aborted) void connect();
          }, delay);
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
                // ux-allow(console-catch): a malformed server event; nothing the user did failed.
                console.error('Failed to parse SSE data:', e, part);
              }
            }
          }
        }
      }
    } catch (err) {
      if (abortControllerRef.current !== controller) return;
      // An abort is this hook's own teardown, not a failure: reconnecting after
      // one would fight the unmount that caused it. Narrowed rather than read
      // off `any`, because a thrown non-Error (a string, a rejected fetch
      // value) has no `.name` and the old code compared `undefined` to
      // 'AbortError' and took the reconnect branch.
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (aborted) {
        debugLog('useSSE', 'SSE connection aborted');
        connectedUserRef.current = null;
      } else {
        // The stream state below remains visible to the UI and reconnects. Do
        // not emit a production console error for a recoverable reconnect.
        debugLog('useSSE', 'SSE transport unavailable; scheduling reconnect', err);
        setError(err instanceof Error ? err.message : 'SSE connection failed');
        setIsConnected(false);

        // Keep this identity marked as pending so the one-second watcher does
        // not defeat rate-limit backoff. A changed session still reconnects.
        const delay = Math.max(retryAfterMs, retryDelayRef.current);
        retryDelayRef.current = Math.min(delay * 2, 60000);
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          if (!controller.signal.aborted) {
            void connect();
          }
        }, delay);
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
    // HTTP/1.1 tabs share a small connection pool. Only the focused page
    // holds a live stream; background pages retain ordinary request access.
    const syncActivity = () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        connectedUserRef.current = null;
        connectedAuthRef.current = null;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        setIsConnected(false);
        return;
      }
      if (!connectedUserRef.current || connectedAuthRef.current !== (getApiClient().getSessionHeaders().Authorization ?? null)) void connect();
    };
    document.addEventListener('visibilitychange', syncActivity);
    window.addEventListener('focus', syncActivity);
    window.addEventListener('blur', syncActivity);
    const watcher = setInterval(() => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) return;
      const currentUser = getApiClient().getUserId() ?? null;
      const currentAuth = getApiClient().getSessionHeaders().Authorization ?? null;
      if (currentUser === connectedUserRef.current && currentAuth === connectedAuthRef.current) return;

      if (!currentUser) {
        abortControllerRef.current?.abort();
        connectedUserRef.current = null;
        connectedAuthRef.current = null;
        setIsConnected(false);
        setEvents([]);
        return;
      }
      connect();
    }, 1000);

    return () => {
      clearInterval(watcher);
      document.removeEventListener('visibilitychange', syncActivity);
      window.removeEventListener('focus', syncActivity);
      window.removeEventListener('blur', syncActivity);
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

