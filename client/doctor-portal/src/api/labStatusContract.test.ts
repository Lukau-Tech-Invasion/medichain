import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllLabSubmissions, getPatientLabSubmissions, getPendingLabResults, reviewLabResult } from '../../../shared/src/api/endpoints';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../shared/src/api/client', () => ({ getApiClient: () => ({ get, post }) }));

describe('lab status response contract', () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });

  it.each(['approve', 'reject'] as const)('maps the server review outcome %s', async (action) => {
    post.mockResolvedValue({ new_status: action });
    const result = await reviewLabResult({ submission_id: 'synthetic-result', action });
    expect(result.status).toBe(action === 'approve' ? 'approved' : 'rejected');
  });

  it('refuses an unverifiable review outcome', async () => {
    post.mockResolvedValue({ new_status: 'unknown' });
    await expect(reviewLabResult({ submission_id: 'synthetic-result', action: 'approve' }))
      .rejects.toThrow('could not be verified');
  });

  it.each([
    [getPendingLabResults, 'Pending', 'pending'],
    [getAllLabSubmissions, 'Approved', 'approved'],
    [() => getPatientLabSubmissions('synthetic-patient'), 'Rejected', 'rejected'],
  ] as const)('normalizes the stored status through each reader', async (read, wireStatus, status) => {
    get.mockResolvedValue([{ id: 'synthetic-result', status: wireStatus }]);
    expect(await read()).toEqual([{ id: 'synthetic-result', status }]);
  });

  it('preserves canonical lowercase statuses', async () => {
    get.mockResolvedValue([{ status: 'approved' }]);
    expect(await getAllLabSubmissions()).toEqual([{ status: 'approved' }]);
  });

  it('refuses an unknown status instead of claiming it is pending', async () => {
    get.mockResolvedValue([{ status: 'Unrecognized' }]);
    await expect(getPendingLabResults()).rejects.toThrow('unsupported review status');
  });
});
