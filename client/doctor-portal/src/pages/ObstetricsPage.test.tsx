import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ObstetricsPage from './ObstetricsPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getPatients: vi.fn(),
  createOb: vi.fn(),
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

describe('ObstetricsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  const mockPatients = [
    { patient_id: 'PAT-001', full_name: 'Jane Doe' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue(mockPatients);
  });

  it('renders obstetrics page', async () => {
    render(<ObstetricsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Obstetrics Assessment/i)).toBeInTheDocument();
      expect(screen.getByText(/Fetal Heart Monitoring/i)).toBeInTheDocument();
    });
  });

  it('allows entering gravida and para', async () => {
    render(<ObstetricsPage />);

    const gravidaInput = screen.getByLabelText(/Gravida/i);
    fireEvent.change(gravidaInput, { target: { value: '2' } });
    expect(gravidaInput).toHaveValue(2);

    const paraInput = screen.getByLabelText(/Para/i);
    fireEvent.change(paraInput, { target: { value: '1' } });
    expect(paraInput).toHaveValue(1);
  });

  it('displays fetal heart baseline', async () => {
    render(<ObstetricsPage />);

    const baselineInput = screen.getByLabelText(/Baseline FHR/i);
    expect(baselineInput).toHaveValue(140);
  });
});
