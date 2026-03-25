import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ShiftHandoffPage from './ShiftHandoffPage';
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

describe('ShiftHandoffPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders shift handoff page', () => {
    render(<ShiftHandoffPage />);

    expect(screen.getByText(/Nursing Shift Handoff/i)).toBeInTheDocument();
    expect(screen.getByText(/Structured ISBAR communication for clinical handovers/i)).toBeInTheDocument();
  });

  it('displays ISBAR sections', () => {
    render(<ShiftHandoffPage />);

    expect(screen.getByText(/Situation/i)).toBeInTheDocument();
    expect(screen.getByText(/Background/i)).toBeInTheDocument();
    expect(screen.getByText(/Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Recommendation/i)).toBeInTheDocument();
  });

  it('allows entering situation', () => {
    render(<ShiftHandoffPage />);

    const input = screen.getByLabelText(/Situation/i);
    fireEvent.change(input, { target: { value: 'Patient admitted with chest pain.' } });
    expect(input).toHaveValue('Patient admitted with chest pain.');
  });
});
