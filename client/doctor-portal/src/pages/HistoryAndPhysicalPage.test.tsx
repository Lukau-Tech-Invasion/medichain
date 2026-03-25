import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import HistoryAndPhysicalPage from './HistoryAndPhysicalPage';
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

describe('HistoryAndPhysicalPage', () => {
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

  it('renders H&P page', () => {
    render(<HistoryAndPhysicalPage />);

    expect(screen.getByText(/History & Physical Examination/i)).toBeInTheDocument();
    expect(screen.getByText(/Comprehensive clinical assessment and documentation/i)).toBeInTheDocument();
  });

  it('displays assessment sections', () => {
    render(<HistoryAndPhysicalPage />);

    expect(screen.getByText(/Chief Complaint/i)).toBeInTheDocument();
    expect(screen.getByText(/History of Present Illness/i)).toBeInTheDocument();
    expect(screen.getByText(/Review of Systems/i)).toBeInTheDocument();
  });

  it('allows entering chief complaint', () => {
    render(<HistoryAndPhysicalPage />);

    const input = screen.getByLabelText(/Chief Complaint/i);
    fireEvent.change(input, { target: { value: 'Severe headache' } });
    expect(input).toHaveValue('Severe headache');
  });
});
