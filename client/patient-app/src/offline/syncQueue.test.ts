/**
 * What replay must guarantee.
 *
 * The safety argument for sending queued clinical writes rests on one property:
 * every attempt to send a given item carries **the same** `Idempotency-Key`, so
 * the server's `UNIQUE (subject, method, route, idempotency_key)` claim turns a
 * second delivery into a no-op rather than a second dose, a second discharge or
 * a second consent withdrawal. These tests pin that property, the ordering, and
 * the three outcomes a pass can have.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { replayQueue } from '@medichain/shared';
import { ApiClientError } from '@medichain/shared';

const items: Array<Record<string, unknown>> = [];
const statuses: Array<[string, string, string | undefined]> = [];

vi.mock('@medichain/shared/src/utils/indexedDB', () => ({
  getPendingSyncItems: async () => items,
  updateSyncStatus: async (id: string, status: string, error?: string) => {
    statuses.push([id, status, error]);
  },
  enqueueSyncItem: async () => 'unused',
}));

const replay = vi.fn();
vi.mock('@medichain/shared/src/api/client', async () => {
  const actual = await vi.importActual<typeof import('@medichain/shared/src/api/client')>('@medichain/shared/src/api/client');
  return {
    ...actual,
    getApiClient: () => ({ replayQueuedMutation: replay }),
  };
});

function item(id: string, timestamp: number, method = 'POST') {
  return {
    id,
    action: 'update',
    endpoint: `/api/reminders/adherence`,
    method,
    body: { reminder_id: id },
    category: 'medications',
    description: 'dose',
    timestamp,
    status: 'pending',
    retryCount: 0,
    priority: 'medium',
  };
}

beforeEach(() => {
  items.length = 0;
  statuses.length = 0;
  replay.mockReset();
});

describe('replayQueue', () => {
  it('sends each item under its own id as the idempotency key', async () => {
    items.push(item('sync_a', 2), item('sync_b', 1));
    replay.mockResolvedValue({});

    const outcome = await replayQueue();

    expect(outcome.sent).toBe(2);
    // The key is the item id, not a fresh one. This is the whole safety
    // property: a second delivery of sync_b must collide with the first.
    expect(replay).toHaveBeenNthCalledWith(1, 'POST', expect.any(String), expect.anything(), 'sync_b');
    expect(replay).toHaveBeenNthCalledWith(2, 'POST', expect.any(String), expect.anything(), 'sync_a');
  });

  it('sends oldest first, whatever order the store returns them in', async () => {
    items.push(item('sync_late', 900), item('sync_early', 100));
    replay.mockResolvedValue({});

    await replayQueue();

    const keys = replay.mock.calls.map((call) => call[3]);
    expect(keys).toEqual(['sync_early', 'sync_late']);
  });

  it('counts a 409 as already applied, not as a failure', async () => {
    items.push(item('sync_dup', 1));
    replay.mockRejectedValue(new ApiClientError('duplicate', 'IDEMPOTENCY_DUPLICATE', 409));

    const outcome = await replayQueue();

    expect(outcome.alreadyApplied).toBe(1);
    expect(outcome.rejected).toBe(0);
    // Done means done: the item is cleared, not retried forever.
    expect(statuses).toContainEqual(['sync_dup', 'completed', undefined]);
  });

  it('stops at the first unreachable server and leaves the rest pending', async () => {
    items.push(item('sync_1', 1), item('sync_2', 2), item('sync_3', 3));
    replay
      .mockResolvedValueOnce({})
      .mockRejectedValue(new ApiClientError('offline', 'NETWORK_ERROR', 0));

    const outcome = await replayQueue();

    expect(outcome.sent).toBe(1);
    expect(outcome.deferred).toBe(2);
    // Nothing is marked failed: the network is at fault, not the records, and a
    // "failed" row invites a patient to discard work the server never refused.
    expect(statuses.some(([, status]) => status === 'failed')).toBe(false);
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it('records why an item was refused on its merits', async () => {
    items.push(item('sync_bad', 1));
    replay.mockRejectedValue(new ApiClientError('reminder not found', 'NOT_FOUND', 404));

    const outcome = await replayQueue();

    expect(outcome.rejected).toBe(1);
    expect(statuses).toContainEqual(['sync_bad', 'failed', 'reminder not found']);
  });

  it('ignores queued reads, which are not unsent work', async () => {
    items.push(item('sync_get', 1, 'GET'));

    const outcome = await replayQueue();

    expect(replay).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sent: 0, alreadyApplied: 0, rejected: 0, deferred: 0 });
  });
});
