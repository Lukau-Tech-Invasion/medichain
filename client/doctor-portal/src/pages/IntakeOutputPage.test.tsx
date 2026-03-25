import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IntakeOutputPage from './IntakeOutputPage';
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

describe('IntakeOutputPage', () => {
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

  it('renders I/O page', () => {
    render(<IntakeOutputPage />);

    expect(screen.getByText(/Intake & Output Monitoring/i)).toBeInTheDocument();
    expect(screen.getByText(/Fluid balance tracking and documentation/i)).toBeInTheDocument();
  });

  it('displays balance summary', () => {
    render(<IntakeOutputPage />);

    expect(screen.getByText(/Total Intake/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Output/i)).toBeInTheDocument();
    expect(screen.getByText(/Net Balance/i)).toBeInTheDocument();
  });

  it('allows adding intake entry', () => {
    render(<IntakeOutputPage />);

    const addButton = screen.getByText(/Add Intake/i);
    fireEvent.click(addButton);

    expect(screen.getByText(/New Intake Entry/i)).toBeInTheDocument();
  });
});
