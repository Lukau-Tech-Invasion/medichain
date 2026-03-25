import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DeathCertificatePage from './DeathCertificatePage';
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

describe('DeathCertificatePage', () => {
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

  it('renders death certificate page', () => {
    render(<DeathCertificatePage />);

    expect(screen.getByText(/Death Certificate Documentation/i)).toBeInTheDocument();
    expect(screen.getByText(/Medical Certification of Cause of Death/i)).toBeInTheDocument();
  });

  it('displays cause of death sections', () => {
    render(<DeathCertificatePage />);

    expect(screen.getByText(/Part I: Immediate and Underlying Causes/i)).toBeInTheDocument();
    expect(screen.getByText(/Part II: Other Significant Conditions/i)).toBeInTheDocument();
  });

  it('allows entering immediate cause', () => {
    render(<DeathCertificatePage />);

    const input = screen.getByLabelText(/Immediate Cause/i);
    fireEvent.change(input, { target: { value: 'Septic Shock' } });
    expect(input).toHaveValue('Septic Shock');
  });
});
