import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import OperativeNotePage from './OperativeNotePage';
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

describe('OperativeNotePage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Surgeon',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders operative note page', () => {
    render(<OperativeNotePage />);

    expect(screen.getByText(/Operative Note/i)).toBeInTheDocument();
    expect(screen.getByText(/Detailed documentation of surgical procedures/i)).toBeInTheDocument();
  });

  it('displays procedure details section', () => {
    render(<OperativeNotePage />);

    expect(screen.getByText(/Pre-operative Diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/Post-operative Diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/Procedure Performed/i)).toBeInTheDocument();
  });

  it('allows entering surgeon name', () => {
    render(<OperativeNotePage />);

    const input = screen.getByLabelText(/Surgeon/i);
    fireEvent.change(input, { target: { value: 'Dr. Cut' } });
    expect(input).toHaveValue('Dr. Cut');
  });
});
