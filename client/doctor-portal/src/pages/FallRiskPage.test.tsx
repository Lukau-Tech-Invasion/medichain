import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import FallRiskPage from './FallRiskPage';
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

describe('FallRiskPage', () => {
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

  it('renders fall risk assessment page', () => {
    render(<FallRiskPage />);

    expect(screen.getByText(/Fall Risk Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Morse Fall Scale/i)).toBeInTheDocument();
  });

  it('displays assessment criteria', () => {
    render(<FallRiskPage />);

    expect(screen.getByText(/History of falling/i)).toBeInTheDocument();
    expect(screen.getByText(/Secondary diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/Ambulatory aid/i)).toBeInTheDocument();
  });

  it('calculates risk score', () => {
    render(<FallRiskPage />);

    // Click "Yes" for history of falling (should add points)
    const yesButtons = screen.getAllByText(/Yes/i);
    fireEvent.click(yesButtons[0]);

    expect(screen.getByText(/Total Score:/i)).toBeInTheDocument();
  });
});
