import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { ConsentManagementPage } from './ConsentManagementPage';
import { usePatientAuthStore } from '../store/authStore';

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
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
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
});
