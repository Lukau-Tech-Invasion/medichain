import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IVSitePage from './IVSitePage';
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

describe('IVSitePage', () => {
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

  it('renders IV site page', () => {
    render(<IVSitePage />);

    expect(screen.getByText(/IV Site & Vascular Access/i)).toBeInTheDocument();
    expect(screen.getByText(/Documentation and monitoring of intravenous access sites/i)).toBeInTheDocument();
  });

  it('displays assessment criteria', () => {
    render(<IVSitePage />);

    expect(screen.getByText(/Infiltration/i)).toBeInTheDocument();
    expect(screen.getByText(/Phlebitis/i)).toBeInTheDocument();
  });

  it('allows selecting IV location', () => {
    render(<IVSitePage />);

    const select = screen.getByLabelText(/Insertion Site/i);
    fireEvent.change(select, { target: { value: 'Right Forearm' } });
    expect(select).toHaveValue('Right Forearm');
  });
});
