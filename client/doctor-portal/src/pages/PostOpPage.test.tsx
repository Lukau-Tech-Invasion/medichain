import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PostOpPage from './PostOpPage';
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

describe('PostOpPage', () => {
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

  it('renders post-op page', () => {
    render(<PostOpPage />);

    expect(screen.getByText(/Post-Operative Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/PACU documentation and recovery monitoring/i)).toBeInTheDocument();
  });

  it('displays assessment sections', () => {
    render(<PostOpPage />);

    expect(screen.getByText(/Neurological/i)).toBeInTheDocument();
    expect(screen.getByText(/Cardiovascular/i)).toBeInTheDocument();
    expect(screen.getByText(/Respiratory/i)).toBeInTheDocument();
  });

  it('allows entering aldrete score', () => {
    render(<PostOpPage />);

    expect(screen.getByText(/Aldrete Score/i)).toBeInTheDocument();
  });
});
