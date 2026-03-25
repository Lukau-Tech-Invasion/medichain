import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AMAPage from './AMAPage';
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

describe('AMAPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders AMA page', () => {
    render(<AMAPage />);

    expect(screen.getByText(/Discharge Against Medical Advice/i)).toBeInTheDocument();
    expect(screen.getByText(/Documentation of patient refusal of care and AMA discharge/i)).toBeInTheDocument();
  });

  it('displays assessment sections', () => {
    render(<AMAPage />);

    expect(screen.getByText(/Capacity Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Risks Explained/i)).toBeInTheDocument();
    expect(screen.getByText(/Patient Statements/i)).toBeInTheDocument();
  });

  it('allows selecting capacity status', () => {
    render(<AMAPage />);

    const select = screen.getByLabelText(/Patient has capacity to refuse/i);
    fireEvent.change(select, { target: { value: 'yes' } });
    expect(select).toHaveValue('yes');
  });
});
