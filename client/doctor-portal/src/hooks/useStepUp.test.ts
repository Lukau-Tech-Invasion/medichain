import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStepUp, stepUpDemandOf } from '@medichain/shared';
import { mfaChallenge } from '../../../shared/src/api/endpoints';
import { getApiClient } from '../../../shared/src/api/client';

// The hook lives in `@medichain/shared`; the test lives here because that is
// where a runner is configured, and because this portal is the consumer whose
// role and guardianship screens depend on the behaviour.
//
// The mocked specifiers are the ones `useStepUp.ts` itself imports -- the inner
// modules, not the `@medichain/shared` barrel. Mocking the barrel leaves the
// hook holding the real `mfaChallenge`, which then fails on a network call and
// surfaces as the generic fallback message. That is the same trap
// `AdminDashboardPage.test.tsx` records: Vitest keys mocks by the specifier the
// consumer resolves, so a mock on a different path silently does nothing.
vi.mock('../../../shared/src/api/endpoints', () => ({ mfaChallenge: vi.fn() }));
vi.mock('../../../shared/src/api/client', () => ({ getApiClient: vi.fn() }));

/**
 * The shapes are the server's own, not invented: `require_privileged_assurance`
 * answers 403 with `MFA_REQUIRED` when a session needs a fresh step-up, and
 * `MFA_ENROLLMENT_REQUIRED` when the account has no MFA at all. Matching on the
 * code rather than the message is deliberate — the message is prose and will be
 * reworded, and a step-up that silently stops being offered because somebody
 * improved a sentence is the regression this guards.
 */
const stepUpRefusal = { code: 'MFA_REQUIRED', message: 'MFA step-up required for this operation.' };
const enrolRefusal = { code: 'MFA_ENROLLMENT_REQUIRED', message: 'This operation requires MFA.' };

describe('stepUpDemandOf', () => {
  it('recognises both refusals, at the top level and nested under data.error', () => {
    expect(stepUpDemandOf(stepUpRefusal)).toBe('step_up');
    expect(stepUpDemandOf(enrolRefusal)).toBe('enrollment');
    expect(stepUpDemandOf({ data: { error: { code: 'MFA_REQUIRED' } } })).toBe('step_up');
  });

  it('is not fooled by an unrelated failure', () => {
    expect(stepUpDemandOf(new Error('network down'))).toBeNull();
    expect(stepUpDemandOf({ code: 'INSUFFICIENT_ROLE' })).toBeNull();
  });
});

describe('useStepUp', () => {
  const setTokens = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApiClient).mockReturnValue({ setTokens } as never);
  });

  it('passes a successful action straight through', async () => {
    const { result } = renderHook(() => useStepUp());
    const action = vi.fn().mockResolvedValue('done');

    let value: unknown;
    await act(async () => {
      value = await result.current.run(action);
    });

    expect(value).toBe('done');
    expect(result.current.demand).toBeNull();
  });

  it('holds a refused action, then retries it with the elevated token', async () => {
    const { result } = renderHook(() => useStepUp());
    const action = vi.fn().mockRejectedValueOnce(stepUpRefusal).mockResolvedValueOnce('done');
    vi.mocked(mfaChallenge).mockResolvedValue({
      success: true,
      access_token: 'elevated-token',
      token_type: 'Bearer',
      expires_in: 900,
      mfa: true,
    });

    await act(async () => {
      await result.current.run(action);
    });
    await waitFor(() => expect(result.current.demand).toBe('step_up'));

    await act(async () => {
      await result.current.submitCode('123456');
    });

    // Installing the new token is not bookkeeping: the retry on the old one is
    // refused identically, which looks like the code having been wrong.
    expect(setTokens).toHaveBeenCalledWith('elevated-token');
    expect(action).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.demand).toBeNull());
  });

  it('keeps the action held when the code is wrong', async () => {
    const { result } = renderHook(() => useStepUp());
    const action = vi.fn().mockRejectedValue(stepUpRefusal);
    vi.mocked(mfaChallenge).mockRejectedValue(new Error('Invalid code'));

    await act(async () => {
      await result.current.run(action);
    });
    await act(async () => {
      await result.current.submitCode('000000');
    });

    // A second refusal is a wrong code, not a new demand — the person gets to
    // try again rather than starting the action over.
    await waitFor(() => expect(result.current.error).toMatch(/invalid code/i));
    expect(result.current.demand).toBe('step_up');
  });

  it('asks for enrollment rather than a code when there is no MFA', async () => {
    const { result } = renderHook(() => useStepUp());
    const action = vi.fn().mockRejectedValue(enrolRefusal);

    await act(async () => {
      await result.current.run(action);
    });

    // A code cannot fix a missing enrollment, and prompting for one would be a
    // dead end dressed as a remedy.
    await waitFor(() => expect(result.current.demand).toBe('enrollment'));
  });

  it('rethrows a failure that is not about assurance', async () => {
    const { result } = renderHook(() => useStepUp());
    const action = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(
      act(async () => {
        await result.current.run(action);
      })
    ).rejects.toThrow(/network down/);
    expect(result.current.demand).toBeNull();
  });
});
