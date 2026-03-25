import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AccessLogsPage from './AccessLogsPage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AccessLogsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          logs: [
            {
              id: '1',
              timestamp: new Date().toISOString(),
              action: 'View Record',
              patientId: 'PAT-001',
              patientName: 'John Doe',
              providerId: 'DOC-001',
              providerName: 'Dr. Smith',
              resourceType: 'MedicalRecord',
              status: 'Success',
            }
          ],
        }),
      });
    });
  });

  it('renders access logs page', async () => {
    render(
      <MemoryRouter>
        <AccessLogsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Access & Audit Logs/i)).toBeInTheDocument();
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/View Record/i)).toBeInTheDocument();
    });
  });

  it('displays log details in the table', async () => {
    render(
      <MemoryRouter>
        <AccessLogsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/MedicalRecord/i)).toBeInTheDocument();
      expect(screen.getByText(/Success/i)).toBeInTheDocument();
    });
  });
});
