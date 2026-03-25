import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ImmunizationPage from './ImmunizationPage';
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

describe('ImmunizationPage', () => {
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

  it('renders immunization page', () => {
    render(<ImmunizationPage />);

    expect(screen.getByText(/Immunization Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Track and document patient vaccinations/i)).toBeInTheDocument();
  });

  it('displays assessment sections', () => {
    render(<ImmunizationPage />);

    expect(screen.getByText(/Vaccine Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Administration/i)).toBeInTheDocument();
  });

  it('allows entering vaccine name', () => {
    render(<ImmunizationPage />);

    const input = screen.getByLabelText(/Vaccine/i);
    fireEvent.change(input, { target: { value: 'Influenza' } });
    expect(input).toHaveValue('Influenza');
  });
});
