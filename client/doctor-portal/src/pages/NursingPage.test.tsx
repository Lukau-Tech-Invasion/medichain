import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NursingPage from './NursingPage';
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

describe('NursingPage', () => {
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

  it('renders nursing page', () => {
    render(<NursingPage />);

    expect(screen.getByText(/Nursing Documentation/i)).toBeInTheDocument();
    expect(screen.getByText(/Patient monitoring and shift documentation/i)).toBeInTheDocument();
  });

  it('displays assessment tabs', () => {
    render(<NursingPage />);

    expect(screen.getByText(/Daily Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Shift Note/i)).toBeInTheDocument();
    expect(screen.getByText(/Wound Care/i)).toBeInTheDocument();
  });

  it('allows entering a shift note', () => {
    render(<NursingPage />);

    fireEvent.click(screen.getByText(/Shift Note/i));

    const input = screen.getByPlaceholderText(/Enter shift summary/i);
    fireEvent.change(input, { target: { value: 'Patient stable throughout shift.' } });
    expect(input).toHaveValue('Patient stable throughout shift.');
  });
});
