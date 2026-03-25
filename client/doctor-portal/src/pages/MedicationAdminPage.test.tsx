import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MedicationAdminPage from './MedicationAdminPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', () => ({
  getPatients: vi.fn(),
  listMar: vi.fn(),
  administerMedication: vi.fn(),
}));

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

describe('MedicationAdminPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  const mockMeds = [
    {
      med_id: '1',
      patient_id: 'PAT-001',
      patient_name: 'John Doe',
      medication_name: 'Aspirin',
      dose: '100mg',
      route: 'PO',
      frequency: 'Daily',
      scheduled_times: ['08:00', '20:00'],
      priority: 'routine',
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([{ patient_id: 'PAT-001', full_name: 'John Doe' }]);
    (shared.listMar as any).mockResolvedValue(mockMeds);
  });

  it('renders MAR page with medications', async () => {
    render(<MedicationAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/Electronic MAR/i)).toBeInTheDocument();
      expect(screen.getByText(/Aspirin/i)).toBeInTheDocument();
      expect(screen.getByText(/100mg/i)).toBeInTheDocument();
    });
  });

  it('allows switching to history tab', async () => {
    render(<MedicationAdminPage />);

    await waitFor(() => {
      const historyTab = screen.getByText(/History/i);
      fireEvent.click(historyTab);
    });
    
    expect(screen.getByText(/Administration History/i)).toBeInTheDocument();
  });

  it('allows selecting a medication for administration', async () => {
    render(<MedicationAdminPage />);

    await waitFor(() => {
      const medRow = screen.getByText(/Aspirin/i);
      fireEvent.click(medRow);
    });

    expect(screen.getByText(/Administer Medication/i)).toBeInTheDocument();
  });
});
