import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AutopsyPage from './AutopsyPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getPatients: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('AutopsyPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Pathologist',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders autopsy page', async () => {
    render(<AutopsyPage />);

    await waitFor(() => {
      expect(screen.getByText(/Autopsy Report/i)).toBeInTheDocument();
      expect(screen.getByText(/Case Information/i)).toBeInTheDocument();
    });
  });

  it('displays external examination section', async () => {
    render(<AutopsyPage />);

    await waitFor(() => {
      expect(screen.getByText(/External Examination/i)).toBeInTheDocument();
    });
  });

  it('allows entering cause of death', async () => {
    render(<AutopsyPage />);

    const input = screen.getByLabelText(/Primary Cause of Death/i);
    fireEvent.change(input, { target: { value: 'Myocardial Infarction' } });
    expect(input).toHaveValue('Myocardial Infarction');
  });
});
