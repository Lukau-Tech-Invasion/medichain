/**
 * Draining the offline sync queue — actually sending what the device could not.
 *
 * ## What was here before
 *
 * Two queue implementations existed and **neither had an enqueue caller**:
 *
 * * `offlineQueue.ts`'s `OfflineQueue` class (localStorage). `ApiClient` held an
 *   instance and `useApiStatus` displayed `.size()`, which was therefore always
 *   0. Its `processQueue` sent without an `Idempotency-Key` and fell back to
 *   `localhost:8080` — the IPFS gateway port, not the API.
 * * `indexedDB.ts`'s `SYNC_QUEUE` store, whose `enqueueSyncItem` had no caller
 *   anywhere.
 *
 * Meanwhile `OfflineSyncPage` called `performSync({patient_id})` against
 * `POST /api/sync`, whose `SyncRequest` fields all carry `#[serde(default)]` —
 * so the server read `device_id: ""` with `items: []`, synced nothing, and
 * answered 200. The page reported "synced". A queue UI, a sync button and a
 * success state over a feature that did not exist.
 *
 * This module drains the IndexedDB queue, which is the one the page renders and
 * the only one carrying what a clinical record needs: category, priority,
 * patient, a human description, per-item status and the failure reason.
 *
 * ## Why replay is safe now, and was not before
 *
 * `ApiClient.request()` carried this, and it was correct when written:
 *
 * > Do not auto-submit mutations after reconnect. Durable server-side
 * > idempotency (including encrypted replay state) is not complete, so
 * > automatic replay could duplicate a clinical or governance action after a
 * > response loss.
 *
 * It is complete now. `api/src/middleware/idempotency.rs` claims every keyed
 * mutation in PostgreSQL under
 * `UNIQUE (subject, method, route, idempotency_key)`, and that claim "survives
 * process restart and replica routing".
 *
 * That is exactly the mechanism Kleppmann prescribes — *Designing Data-Intensive
 * Applications*, "Suppressing duplicate requests using a unique ID":
 * `ALTER TABLE requests ADD UNIQUE (request_id)`, so that an operation "you can
 * perform multiple times … has the same effect as if you performed it once".
 *
 * The queue item's own id is that unique id, and it is **stable across every
 * replay attempt** — which is the whole point. A fresh key per attempt, which is
 * what `request()` mints for a live mutation, would turn a response-loss retry
 * into a second write.
 *
 * ## Why these replay as ordinary requests
 *
 * Each item records the `endpoint`, `method` and `body` of a real API call, so
 * replaying it passes through the same validation, authorization and audit as an
 * online write. Draining the queue through a bulk endpoint instead would create
 * a second way to write clinical data — the duplication that once made a
 * surgical prescription invisible to the pharmacy. One writer.
 */

import { getApiClient, ApiClientError } from '../api/client';

// Re-exported so callers import the queue's vocabulary from one place.
export { OfflineQueuedError } from '../api/client';
import {
  getPendingSyncItems,
  updateSyncStatus,
  enqueueSyncItem,
  type SyncQueueItem,
} from './indexedDB';

/** What a replay pass actually did. Every field is counted, never estimated. */
export interface ReplayOutcome {
  /** Items the server accepted on this pass. */
  sent: number;
  /**
   * Items the server had already applied, recognised by their idempotency key.
   * Not a failure — the work is done. Counted separately because a patient
   * asking "did that go through twice?" deserves the real answer.
   */
  alreadyApplied: number;
  /** Items the server refused on their merits (validation, authorization). */
  rejected: number;
  /** Items still queued because the device could not reach the server. */
  deferred: number;
}

/**
 * Queue a mutation the device could not send.
 *
 * Returns the queue item id, which becomes the `Idempotency-Key` on replay.
 */
export async function queueMutation(params: {
  endpoint: string;
  method: 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  category: SyncQueueItem['category'];
  description: string;
  priority?: SyncQueueItem['priority'];
  patientId?: string;
}): Promise<string> {
  return enqueueSyncItem({
    action: params.method === 'DELETE' ? 'delete' : 'update',
    endpoint: params.endpoint,
    method: params.method,
    body: params.body,
    category: params.category,
    description: params.description,
    priority: params.priority ?? 'medium',
    patientId: params.patientId,
  });
}

/** How many writes are waiting to be sent. */
export async function pendingMutationCount(): Promise<number> {
  return (await getPendingSyncItems()).filter(isMutation).length;
}

function isMutation(
  item: SyncQueueItem
): item is SyncQueueItem & { method: 'POST' | 'PUT' | 'DELETE' } {
  return item.method === 'POST' || item.method === 'PUT' || item.method === 'DELETE';
}

/**
 * Send every pending item, oldest first.
 *
 * Order matters and is not incidental: a medication administration recorded
 * before a discharge has to reach the server in that order, or the record reads
 * as though the patient was given a drug after going home.
 *
 * An unreachable server stops the pass rather than burning through the queue
 * marking everything failed — those items are still good, the network is not.
 */
export async function replayQueue(): Promise<ReplayOutcome> {
  const outcome: ReplayOutcome = { sent: 0, alreadyApplied: 0, rejected: 0, deferred: 0 };

  // Mutations only. `SyncQueueItem.method` also admits `GET`, for the
  // `action: 'download'` prefetch case — a queued *read* is not unsent work,
  // and the pages refetch on load anyway.
  const pending = (await getPendingSyncItems())
    .filter(isMutation)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (pending.length === 0) {
    return outcome;
  }

  const client = getApiClient();

  for (const [index, item] of pending.entries()) {
    try {
      await updateSyncStatus(item.id, 'in-progress');
      await client.replayQueuedMutation(item.method, item.endpoint, item.body, item.id);
      await updateSyncStatus(item.id, 'completed');
      outcome.sent++;
    } catch (error) {
      const apiError = error instanceof ApiClientError ? error : null;

      // The server recognised this operation's key and refused to run it a
      // second time. That is the guard working, and the item is done.
      if (apiError?.status === 409) {
        await updateSyncStatus(item.id, 'completed');
        outcome.alreadyApplied++;
        continue;
      }

      // Still unreachable. Leave this item and everything after it pending:
      // marking them failed would lose the ordering above and invite someone to
      // discard work the server never actually refused.
      if (!apiError || apiError.isNetworkError()) {
        await updateSyncStatus(item.id, 'pending');
        outcome.deferred = pending.length - index;
        break;
      }

      // A real refusal — malformed, unauthorised, or no longer valid. It will
      // not succeed on a retry, and the reason is kept so the user can see why.
      await updateSyncStatus(item.id, 'failed', apiError.message);
      outcome.rejected++;
    }
  }

  return outcome;
}
