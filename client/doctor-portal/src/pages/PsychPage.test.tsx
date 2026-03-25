import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PsychPage from './PsychPage';
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

describe('PsychPage', () => {
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

  it('renders psychiatry page', () => {
    render(<PsychPage />);

    expect(screen.getByText(/Psychiatric Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Mental Status Examination and psychiatric evaluation/i)).toBeInTheDocument();
  });

  it('displays MSE sections', () => {
    render(<PsychPage />);

    expect(screen.getByText(/Appearance & Behavior/i)).toBeInTheDocument();
    expect(screen.getByText(/Mood & Affect/i)).toBeInTheDocument();
    expect(screen.getByText(/Thought Content/i)).toBeInTheDocument();
  });

  it('allows entering mood description', () => {
    render(<PsychPage />);

    const input = screen.getByLabelText(/Mood/i);
    fireEvent.change(input, { target: { value: 'Euthymic' } });
    expect(input).toHaveValue('Euthymic');
  });
});
