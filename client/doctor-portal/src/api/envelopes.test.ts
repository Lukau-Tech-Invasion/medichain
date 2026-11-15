/**
 * Replies that carry a list beside other fields reach the page whole.
 *
 * The API client unwraps `{ patients: [...] }` (and `items`, `records`, ...)
 * to the bare array. The nurse's ward panel reads three lists from one reply
 * and the shift-handoff draft reads `since` beside `patients`; unwrapped, the
 * ward panel reported every reply as a failure and the draft was always empty.
 * Page tests mock these functions, so only a test through the real client sees it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMyWard, getShiftHandoffDraft } from '@medichain/shared';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function answer(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });
}

describe('list envelopes', () => {
  beforeEach(() => mockFetch.mockReset());

  it("keeps the ward reply's three lists", async () => {
    mockFetch.mockImplementation(() => answer({ shifts: [], wards: [], patients: [] }));
    await expect(getMyWard()).resolves.toEqual({ shifts: [], wards: [], patients: [] });
  });

  it("keeps the handoff draft's patients beside since", async () => {
    const reply = { since: '2026-11-03T06:00:00Z', patients: [{ patient_id: 'QA-PAT' }] };
    mockFetch.mockImplementation(() => answer(reply));
    await expect(getShiftHandoffDraft()).resolves.toEqual(reply);
  });
});
