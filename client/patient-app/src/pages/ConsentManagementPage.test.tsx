import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { ConsentManagementPage } from './ConsentManagementPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatientConsents: vi.fn().mockResolvedValue({ consents: [] }),
  getConsentTypes: vi.fn().mockResolvedValue({ consent_types: [] }),
  signConsent: vi.fn().mockResolvedValue({}),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ConsentManagementPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    userId: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/access/patient/HEALTH123/grants')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            grants: [
              {
                id: 'grant1',
                providerId: 'PROV1',
                providerName: 'Dr. Smith',
                providerRole: 'Physician',
                organization: 'City Hospital',
                accessType: 'full',
                grantedAt: new Date().toISOString(),
                expiresAt: null,
                status: 'active',
                lastAccessed: null,
                accessCount: 0,
              }
            ]
          }),
        });
      }
      // The server's shape: camelCase (`AccessRequestEntity` is
      // `rename_all = "camelCase"`) under a `requests` key.
      if (url.includes('/api/access/patient/HEALTH123/requests')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({
            requests: [
              {
                id: 'req1',
                providerId: 'PROV2',
                providerName: 'Dr. Mensah',
                providerRole: 'Physician',
                organization: 'Korle Bu',
                requestedAt: new Date().toISOString(),
                reason: 'Follow-up after discharge',
                status: 'pending',
              }
            ]
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders a pending request with the fields the server sends', async () => {
    render(
      <MemoryRouter>
        <ConsentManagementPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Dr. Smith/i)).toBeInTheDocument();
    });
    // The tab, not the pending-requests banner that also names them.
    fireEvent.click(screen.getByRole('button', { name: /^Requests/i }));

    expect(screen.getByText(/Dr. Mensah/i)).toBeInTheDocument();
    expect(screen.getByText(/Follow-up after discharge/i)).toBeInTheDocument();
  });

  it('renders consent management page with active grants', async () => {
    render(
      <MemoryRouter>
        <ConsentManagementPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Access Control/i)).toBeInTheDocument();
      expect(screen.getByText(/Dr. Smith/i)).toBeInTheDocument();
    });
  });

  it('allows switching between tabs', async () => {
    render(
      <MemoryRouter>
        <ConsentManagementPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Dr. Smith/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Requests/i }));
    
    expect(screen.getByText(/Dr. Mensah/i)).toBeInTheDocument();
    expect(screen.queryByText(/Dr. Smith/i)).not.toBeInTheDocument();

    // 'History' appears as both a tab and a section label.
    const historyTab = screen.getAllByText(/History/i)[0];
    fireEvent.click(historyTab);
    
    expect(screen.getAllByText(/History/i).length).toBeGreaterThan(0);

    const formsTab = screen.getByRole('button', { name: /^Forms$/i });
    fireEvent.click(formsTab);
    
    expect(screen.getByText(/Signed Consent Forms/i)).toBeInTheDocument();
  });

  it('filters active grants by search query', async () => {
    render(
      <MemoryRouter>
        <ConsentManagementPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Dr. Smith/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search providers/i);
    fireEvent.change(searchInput, { target: { value: 'Dr. Jones' } });

    expect(screen.queryByText(/Dr. Smith/i)).not.toBeInTheDocument();
  });

  it('identifies the exact grant and provider, explains its scope and allows cancellation without revoking', async () => {
    render(<MemoryRouter><ConsentManagementPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Dr. Smith/ }));
    expect(screen.getByText('Recorded disclosures using this grant')).toBeVisible();
    expect(screen.getByText(/Counts retained audit entries explicitly linked to this grant, not visits/)).toBeVisible();
    expect(screen.queryByText('Total Accesses')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Access' }));
    expect(screen.getByRole('heading', { name: 'Revoke this access grant?' })).toBeVisible();
    expect(screen.getByText('PROV1')).toBeVisible();
    expect(screen.getByText('grant1')).toBeVisible();
    expect(screen.getByText(/this grant will no longer authorize new record requests by Dr. Smith/)).toBeVisible();
    expect(screen.getByText(/Other authorized access may still apply/)).toBeVisible();
    expect(screen.queryByText(/does not automatically block access/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Revoke this access grant?' })).not.toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith('/api/access/grants/grant1/revoke'))).toBe(false);
  });

  it('presents grant details and the revoke confirmation as modal dialogs with keyboard handling', async () => {
    render(<MemoryRouter><ConsentManagementPage /></MemoryRouter>);
    const card = await screen.findByRole('button', { name: /Dr. Smith/ });
    card.focus();
    fireEvent.click(card);

    const details = screen.getByRole('dialog', { name: 'Access Details' });
    expect(details).toHaveAttribute('aria-modal', 'true');
    expect(details).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible();

    // Tab from the last control wraps to the first instead of leaving the dialog.
    const revoke = screen.getByRole('button', { name: 'Revoke Access' });
    revoke.focus();
    fireEvent.keyDown(revoke, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

    // The destructive confirmation is an alert dialog, and Cancel takes focus.
    fireEvent.click(revoke);
    const confirm = screen.getByRole('alertdialog', { name: 'Revoke this access grant?' });
    expect(confirm).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // Escape closes the details too, and focus goes back to the card that opened them.
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Access Details' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(card);
    expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith('/api/access/grants/grant1/revoke'))).toBe(false);
  });

  it('shows unavailable access with retry instead of zero counts or an empty grant claim', async () => {
    const original = shared.listPatientAccessGrants;
    const read = vi.spyOn(shared, 'listPatientAccessGrants')
      .mockImplementation(original).mockRejectedValueOnce(new Error('Synthetic outage'));
    try {
      render(<MemoryRouter><ConsentManagementPage /></MemoryRouter>);
      expect(await screen.findByRole('alert')).toHaveTextContent('Who has access could not be loaded');
      expect(screen.queryByText('No active access grants')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Active (0)' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('button', { name: /Dr. Smith/ })).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      read.mockRestore();
    }
  });
});
