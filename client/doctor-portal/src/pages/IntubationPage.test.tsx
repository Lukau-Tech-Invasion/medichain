import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IntubationPage from './IntubationPage';
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

describe('IntubationPage', () => {
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

  it('renders intubation page', () => {
    render(<IntubationPage />);

    expect(screen.getByText(/Intubation & Airway Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Documentation of advanced airway procedures/i)).toBeInTheDocument();
  });

  it('displays procedure details section', () => {
    render(<IntubationPage />);

    expect(screen.getByText(/Procedure Details/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Indication/i)).toBeInTheDocument();
  });

  it('allows selecting tube size', () => {
    render(<IntubationPage />);

    const select = screen.getByLabelText(/Tube Size/i);
    fireEvent.change(select, { target: { value: '7.5' } });
    expect(select).toHaveValue('7.5');
  });
});
