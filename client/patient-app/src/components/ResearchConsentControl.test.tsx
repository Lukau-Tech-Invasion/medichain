import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ResearchConsentControl } from './ResearchConsentControl';

// The control calls the shared API client, so the network edge is mocked.
const mockFetch = vi.fn();
global.fetch = mockFetch;

function answer(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
  });
}

const ACTIVE = {
  consent_id: 'CONS-1', consent_type: 'CONSENT-RESEARCH', signed_at: 1_790_000_000,
  status: 'granted', revoked: false, version: 'research-consent-v1',
};

function renderControl() {
  render(<I18nProvider><ResearchConsentControl patientId="PAT-001" /></I18nProvider>);
}

describe('ResearchConsentControl', () => {
  beforeEach(() => mockFetch.mockReset());

  it('gives a versioned research consent through the consent endpoint', async () => {
    let signed = false;
    mockFetch.mockImplementation((raw: unknown) => {
      const url = String(raw);
      if (url.includes('/api/consent/sign')) {
        signed = true;
        return answer(201, { success: true, consent_id: 'CONS-1' });
      }
      return answer(200, { consents: signed ? [ACTIVE] : [] });
    });
    renderControl();
    expect(await screen.findByText('Not given')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Give consent/i }));
    expect(await screen.findByText(/terms research-consent-v1/i)).toBeInTheDocument();
    const signCall = mockFetch.mock.calls.find(([url]) => String(url).includes('/api/consent/sign'));
    const sent = JSON.parse(String((signCall?.[1] as RequestInit).body));
    expect(sent).toMatchObject({ type_id: 'CONSENT-RESEARCH', popia_section_11_basis: 'consent', special_information_basis: 'consent' });
  });

  it('withdraws by revoking the consent, not by flipping a preference', async () => {
    let revoked = false;
    mockFetch.mockImplementation((raw: unknown) => {
      const url = String(raw);
      if (url.includes('/revoke')) {
        revoked = true;
        return answer(200, { success: true });
      }
      return answer(200, { consents: [{ ...ACTIVE, revoked }] });
    });
    renderControl();
    fireEvent.click(await screen.findByRole('button', { name: /Withdraw consent/i }));
    await waitFor(() => expect(screen.getByText('Not given')).toBeInTheDocument());
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/api/consent/CONS-1/revoke'))).toBe(true);
  });

  it('shows a failed load as an error, not as "not given"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetch.mockImplementation(() => answer(403, { error: { code: 'FORBIDDEN', message: 'Access denied' } }));
    renderControl();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByText('Not given')).not.toBeInTheDocument();
  });
});
