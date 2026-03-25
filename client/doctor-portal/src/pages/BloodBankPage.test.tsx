import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BloodBankPage from './BloodBankPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BloodBankPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        inventory: [
          { group: 'O+', units: 25, status: 'Stable' },
          { group: 'A-', units: 5, status: 'Low' },
        ],
      }),
    });
  });

  it('renders blood bank page', async () => {
    render(<BloodBankPage />);

    await waitFor(() => {
      expect(screen.getByText(/Blood Bank Management/i)).toBeInTheDocument();
      expect(screen.getByText(/Inventory Overview/i)).toBeInTheDocument();
    });
  });

  it('displays blood groups and units', async () => {
    render(<BloodBankPage />);

    await waitFor(() => {
      expect(screen.getByText('O+')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
      expect(screen.getByText('A-')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });
});
