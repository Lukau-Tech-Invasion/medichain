import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import WoundCarePage from './WoundCarePage';
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

describe('WoundCarePage', () => {
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

  it('renders wound care page', () => {
    render(<WoundCarePage />);

    expect(screen.getByText(/Wound Care & Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Documentation of wound assessment, treatment, and healing progress/i)).toBeInTheDocument();
  });

  it('displays assessment sections', () => {
    render(<WoundCarePage />);

    expect(screen.getByText(/Wound Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Treatment/i)).toBeInTheDocument();
  });

  it('allows entering wound type', () => {
    render(<WoundCarePage />);

    const select = screen.getByLabelText(/Wound Type/i);
    fireEvent.change(select, { target: { value: 'pressure-ulcer' } });
    expect(select).toHaveValue('pressure-ulcer');
  });
});
