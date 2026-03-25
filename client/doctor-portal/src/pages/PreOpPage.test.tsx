import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PreOpPage from './PreOpPage';
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

describe('PreOpPage', () => {
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

  it('renders pre-op page', () => {
    render(<PreOpPage />);

    expect(screen.getByText(/Pre-Operative Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Pre-surgical evaluation and checklist/i)).toBeInTheDocument();
  });

  it('displays checklist items', () => {
    render(<PreOpPage />);

    expect(screen.getByText(/Informed Consent Signed/i)).toBeInTheDocument();
    expect(screen.getByText(/NPO Status Verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Surgical Site Marked/i)).toBeInTheDocument();
  });

  it('allows selecting ASA classification', () => {
    render(<PreOpPage />);

    const select = screen.getByLabelText(/ASA Class/i);
    fireEvent.change(select, { target: { value: '2' } });
    expect(select).toHaveValue('2');
  });
});
