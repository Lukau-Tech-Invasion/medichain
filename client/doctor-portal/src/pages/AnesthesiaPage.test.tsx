import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AnesthesiaPage from './AnesthesiaPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getPatients: vi.fn(),
  createAnesthesia: vi.fn(),
  apiUrl: (path: string) => path,
}));

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

describe('AnesthesiaPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    username: 'Dr. Anesthesia',
  };

  const mockPatients = [
    { patient_id: 'PAT-001', full_name: 'John Doe' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue(mockPatients);
  });

  it('renders anesthesia page', async () => {
    render(<AnesthesiaPage />);

    await waitFor(() => {
      expect(screen.getByText(/Anesthesia Documentation/i)).toBeInTheDocument();
      expect(screen.getByText(/New Record/i)).toBeInTheDocument();
    });
  });

  it('allows selecting a patient', async () => {
    render(<AnesthesiaPage />);

    await waitFor(() => {
      const select = screen.getByLabelText(/Select Patient/i);
      fireEvent.change(select, { target: { value: 'PAT-001' } });
      expect(select).toHaveValue('PAT-001');
    });
  });

  it('allows entering procedure details', async () => {
    render(<AnesthesiaPage />);

    const input = screen.getByLabelText(/Procedure/i);
    fireEvent.change(input, { target: { value: 'Appendectomy' } });
    expect(input).toHaveValue('Appendectomy');
  });
});
