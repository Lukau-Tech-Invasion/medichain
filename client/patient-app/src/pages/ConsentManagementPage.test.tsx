import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ConsentManagementPage } from './ConsentManagementPage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
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
    (usePatientAuthStore as any).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url) => {
      if (url.includes('/api/access/patient/HEALTH123/grants')) {
        return Promise.resolve({
          ok: true,
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
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  it('renders consent management page with active grants', async () => {
    render(
      <MemoryRouter>
        <ConsentManagementPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Consent Management/i)).toBeInTheDocument();
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
      expect(screen.getByText(/Consent Management/i)).toBeInTheDocument();
    });

    const requestsTab = screen.getByText(/Requests/i);
    fireEvent.click(requestsTab);
    
    expect(screen.getByText(/Pending Access Requests/i)).toBeInTheDocument();

    const historyTab = screen.getByText(/History/i);
    fireEvent.click(historyTab);
    
    expect(screen.getByText(/Access History/i)).toBeInTheDocument();

    const formsTab = screen.getByText(/Consent Forms/i);
    fireEvent.click(formsTab);
    
    expect(screen.getByText(/Legal Consent Forms/i)).toBeInTheDocument();
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

    const searchInput = screen.getByPlaceholderText(/Search healthcare providers/i);
    fireEvent.change(searchInput, { target: { value: 'Dr. Jones' } });

    expect(screen.queryByText(/Dr. Smith/i)).not.toBeInTheDocument();
  });
});
