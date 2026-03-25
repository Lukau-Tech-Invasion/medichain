import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ProgressNotePage from './ProgressNotePage';
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

describe('ProgressNotePage', () => {
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

  it('renders progress note page', () => {
    render(<ProgressNotePage />);

    expect(screen.getByText(/Daily Progress Note/i)).toBeInTheDocument();
    expect(screen.getByText(/Documentation of interval patient progress and updated plan/i)).toBeInTheDocument();
  });

  it('displays note sections', () => {
    render(<ProgressNotePage />);

    expect(screen.getByText(/Subjective/i)).toBeInTheDocument();
    expect(screen.getByText(/Objective/i)).toBeInTheDocument();
    expect(screen.getByText(/Assessment & Plan/i)).toBeInTheDocument();
  });

  it('allows entering subjective note', () => {
    render(<ProgressNotePage />);

    const input = screen.getByLabelText(/Subjective/i);
    fireEvent.change(input, { target: { value: 'Patient reports feeling better today.' } });
    expect(input).toHaveValue('Patient reports feeling better today.');
  });
});
