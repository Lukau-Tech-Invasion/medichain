import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MARPage from './MARPage';
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

describe('MARPage', () => {
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

  it('renders MAR page', () => {
    render(<MARPage />);

    expect(screen.getByText(/Medication Administration Record/i)).toBeInTheDocument();
    expect(screen.getByText(/Active Medications/i)).toBeInTheDocument();
  });

  it('displays schedule timeline', () => {
    render(<MARPage />);

    expect(screen.getByText(/08:00/i)).toBeInTheDocument();
    expect(screen.getByText(/12:00/i)).toBeInTheDocument();
    expect(screen.getByText(/16:00/i)).toBeInTheDocument();
  });

  it('allows switching to PRN tab', () => {
    render(<MARPage />);

    const prnTab = screen.getByText(/PRN Medications/i);
    fireEvent.click(prnTab);
    
    expect(screen.getByText(/As-Needed Medications/i)).toBeInTheDocument();
  });
});
