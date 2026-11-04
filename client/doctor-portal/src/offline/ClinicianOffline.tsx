/**
 * Working without signal (owner request, 2026-11-04).
 *
 * One provider, mounted in the signed-in layout, owns everything offline:
 *
 *  - keeps the clinician's day (`offlineRoster.ts`) on the device and fresh;
 *  - opts the documentation writes in to the queue (`offlinePolicy.ts`);
 *  - when signal returns, confirms a session that was opened offline, then
 *    sends what was saved, oldest first (`replayQueue`);
 *  - tells the clinician, in one bar, whether they are online and what is still
 *    waiting — and what the server refused, which is never dropped silently.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CLINICIAN_OFFLINE_ROUTES,
  STORES,
  clearCompletedSyncItems,
  deleteItem,
  getAllSyncItems,
  getApiClient,
  notifySuccess,
  readOfflineRoster,
  refreshOfflineRoster,
  replayQueue,
  useTranslation,
} from '@medichain/shared';
import type { OfflineBundle, ReplayOutcome, SyncQueueItem } from '@medichain/shared';
import { useAuthStore } from '../store';

/** How often the day list is downloaded again while online. */
const ROSTER_REFRESH_MS = 10 * 60 * 1000;
/** How often to look for signal and unsent work. */
const TICK_MS = 30 * 1000;

export interface ClinicianOfflineState {
  /** The server can be reached. */
  online: boolean;
  /** The day kept on this device, or `null` when there is none. */
  roster: OfflineBundle | null;
  /** This account's saved-but-unsent work, oldest first. */
  waiting: SyncQueueItem[];
  /** Work the server refused, with its reason, for the clinician to redo. */
  refused: SyncQueueItem[];
  /** Whether a send is running now. */
  syncing: boolean;
  /** Send now (also runs by itself when signal returns). */
  syncNow: () => Promise<void>;
  /** Remove a refused item once the clinician has dealt with it. */
  dismiss: (id: string) => Promise<void>;
}

const OfflineContext = createContext<ClinicianOfflineState | null>(null);

/** The offline state, or a neutral one outside the provider (tests, sign-in). */
export function useClinicianOffline(): ClinicianOfflineState {
  return useContext(OfflineContext) ?? NEUTRAL;
}

const NEUTRAL: ClinicianOfflineState = {
  online: true,
  roster: null,
  waiting: [],
  refused: [],
  syncing: false,
  syncNow: async () => undefined,
  dismiss: async () => undefined,
};

function isReachable(): boolean {
  const navigatorOnline = typeof navigator === 'undefined' || navigator.onLine;
  return navigatorOnline && getApiClient().getConnectionStatus();
}

function announce(outcome: ReplayOutcome, t: (k: string, v?: Record<string, string | number>) => string): void {
  const sent = outcome.sent + outcome.alreadyApplied;
  if (sent > 0) notifySuccess(t('clinicianOffline.sent', { n: sent }));
}

export function ClinicianOfflineProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const owner = useAuthStore((s) => s.user?.userId);
  const offlineSession = useAuthStore((s) => s.offlineSession);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const [online, setOnline] = useState(isReachable);
  const [roster, setRoster] = useState<OfflineBundle | null>(null);
  const [items, setItems] = useState<SyncQueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const running = useRef(false);
  const rosterAt = useRef(0);

  useEffect(() => {
    getApiClient().setOfflineRoutes(CLINICIAN_OFFLINE_ROUTES);
    return () => getApiClient().setOfflineRoutes([]);
  }, []);

  const loadQueue = useCallback(async () => {
    if (!owner) return;
    try {
      const all = await getAllSyncItems();
      setItems(all.filter((i) => i.ownerUserId === owner && i.method !== 'GET').sort((a, b) => a.timestamp - b.timestamp));
    } catch {
      setItems([]);
    }
  }, [owner]);

  const loadRoster = useCallback(async (force: boolean) => {
    if (!owner) return;
    if (!force && Date.now() - rosterAt.current < ROSTER_REFRESH_MS) return;
    try {
      setRoster(await refreshOfflineRoster(owner));
      rosterAt.current = Date.now();
    } catch {
      // No signal or refused: keep what the device already holds.
      setRoster(await readOfflineRoster(owner));
    }
  }, [owner]);

  const syncNow = useCallback(async () => {
    if (!owner || running.current) return;
    running.current = true;
    setSyncing(true);
    try {
      // A session opened without the server is confirmed before anything is
      // sent under it; if the server says it is over, `restoreSession` signs out.
      if (useAuthStore.getState().offlineSession && !(await restoreSession())) return;
      if (useAuthStore.getState().offlineSession) return; // still no signal
      announce(await replayQueue(), t);
      // Sent items have done their job; keeping them only fills the device.
      await clearCompletedSyncItems(owner).catch(() => undefined);
      await loadRoster(false);
    } catch {
      // Unreachable mid-send: the queue keeps its place, and the next tick retries.
    } finally {
      running.current = false;
      setSyncing(false);
      setOnline(isReachable() && !useAuthStore.getState().offlineSession);
      await loadQueue();
    }
  }, [owner, restoreSession, loadRoster, loadQueue, t]);

  useEffect(() => {
    if (!owner) return;
    void readOfflineRoster(owner).then(setRoster);
    void loadQueue();
    void syncNow();
    const tick = () => {
      // A failed request marks the client disconnected and nothing else marks
      // it connected again; ask the server, and its listener below picks it up.
      if (!getApiClient().getConnectionStatus()) getApiClient().checkHealth().catch(() => undefined);
      setOnline(isReachable() && !useAuthStore.getState().offlineSession);
      void loadQueue();
      if (isReachable() || useAuthStore.getState().offlineSession) void syncNow();
    };
    const timer = setInterval(tick, TICK_MS);
    const unsubscribe = getApiClient().addConnectionListener((connected) => {
      setOnline(connected && !useAuthStore.getState().offlineSession);
      if (connected) void syncNow();
    });
    const goneOnline = () => void syncNow();
    const goneOffline = () => setOnline(false);
    window.addEventListener('online', goneOnline);
    window.addEventListener('offline', goneOffline);
    return () => {
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener('online', goneOnline);
      window.removeEventListener('offline', goneOffline);
    };
  }, [owner, loadQueue, syncNow]);

  // A save just queued changes the count; pick it up without waiting a tick.
  useEffect(() => {
    const onQueued = () => void loadQueue();
    window.addEventListener('medichain:offline-queued', onQueued);
    return () => window.removeEventListener('medichain:offline-queued', onQueued);
  }, [loadQueue]);

  const dismiss = useCallback(async (id: string) => {
    await deleteItem(STORES.SYNC_QUEUE, id);
    await loadQueue();
  }, [loadQueue]);

  const value = useMemo<ClinicianOfflineState>(() => ({
    online: online && !offlineSession,
    roster,
    waiting: items.filter((i) => i.status === 'pending' || i.status === 'in-progress'),
    refused: items.filter((i) => i.status === 'failed'),
    syncing,
    syncNow,
    dismiss,
  }), [online, offlineSession, roster, items, syncing, syncNow, dismiss]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
