import { describe, expect, it } from 'vitest';
import { ApiClientError, getApiErrorMessage } from '@medichain/shared';

// Every page that moved from raw `fetch` to the typed client catches what the
// client throws and passes it here. This used to parse the thrown error as if
// it were a response body, find no `error` field, and return the fallback --
// so the clinician saw "Request failed" instead of the server's reason.
describe('getApiErrorMessage', () => {
  it("keeps the server's message from an error the typed client threw", () => {
    const thrown = new ApiClientError('Patient not found', 'PATIENT_NOT_FOUND', 404);
    expect(getApiErrorMessage(thrown, 'fallback')).toBe('Patient not found');
  });

  it('still reads a raw response body in each envelope the API emits', () => {
    expect(getApiErrorMessage({ error: { code: 'X', message: 'nested' } }, 'f')).toBe('nested');
    expect(getApiErrorMessage({ error: 'flat', code: 'X' }, 'f')).toBe('flat');
    expect(
      getApiErrorMessage({ resourceType: 'OperationOutcome', issue: [{ diagnostics: 'fhir' }] }, 'f'),
    ).toBe('fhir');
  });

  it('falls back when there is no message to show', () => {
    expect(getApiErrorMessage(new ApiClientError('', 'X', 500), 'fallback')).toBe('fallback');
    expect(getApiErrorMessage({}, 'fallback')).toBe('fallback');
    expect(getApiErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
