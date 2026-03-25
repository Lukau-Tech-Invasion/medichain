import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import InsurancePage from './InsurancePage';
import { usePatientAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getPatientInsuranceClaims: vi.fn().mockResolvedValue([]),
  apiUrl: (path: string) => path,
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('InsurancePage (Patient)', () => {
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
      if (url.includes('/api/insurance/patient/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              id: 'ins1',
              type: 'medical',
              providerName: 'Blue Cross',
              planName: 'PPO Silver',
              memberId: 'BC123456',
              groupNumber: 'GRP999',
              subscriberName: 'Test Patient',
              status: 'active',
              isPrimary: true,
              lastVerified: '2025-01-01',
              copay: { primaryCare: 25, specialist: 50, urgentCare: 75, emergency: 150 },
              deductible: { individual: 1500, family: 3000, met: 500 },
              outOfPocketMax: { individual: 5000, family: 10000, met: 1000 },
              customerServicePhone: '555-0199',
              providerPortalUrl: 'https://bluecross.com'
            }
          ]),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    });
  });

  it('renders insurance page with cards', async () => {
    render(
      <MemoryRouter>
        <InsurancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Insurance & Coverage/i)).toBeInTheDocument();
      expect(screen.getByText(/Blue Cross/i)).toBeInTheDocument();
      expect(screen.getByText(/BC123456/i)).toBeInTheDocument();
    });
  });

  it('allows switching to claims tab', async () => {
    render(
      <MemoryRouter>
        <InsurancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Insurance & Coverage/i)).toBeInTheDocument();
    });

    const claimsTab = screen.getByText(/Claims/i);
    fireEvent.click(claimsTab);
    
    expect(screen.getByText(/Recent Insurance Claims/i)).toBeInTheDocument();
  });

  it('allows switching to add insurance tab', async () => {
    render(
      <MemoryRouter>
        <InsurancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Insurance & Coverage/i)).toBeInTheDocument();
    });

    const addTab = screen.getByText(/Add New/i);
    fireEvent.click(addTab);
    
    expect(screen.getByText(/Add New Insurance Coverage/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Insurance Provider/i)).toBeInTheDocument();
  });
});
