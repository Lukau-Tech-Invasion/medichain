import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LabQCPage from './LabQCPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listLabQc: vi.fn(),
  createLabQc: vi.fn(),
}));

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

describe('LabQCPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
  };

  const mockQcData = {
    items: [
      {
        test_id: '1',
        date: '2025-01-01',
        time: '08:00',
        instrument: 'Abbott Alinity',
        analyte: 'Glucose',
        level: 'Level 1',
        result: 'pass',
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.listLabQc as any).mockResolvedValue(mockQcData);
  });

  it('renders lab QC page', async () => {
    render(<LabQCPage />);

    await waitFor(() => {
      expect(screen.getByText(/Laboratory Quality Control/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Abbott Alinity/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Glucose/i)).toBeInTheDocument();
    });
  });

  it('allows switching to calibrations tab', async () => {
    render(<LabQCPage />);

    const calTab = screen.getByText(/Calibrations/i);
    fireEvent.click(calTab);
    
    expect(screen.getByText(/Calibrations/i)).toBeInTheDocument();
  });

  it('allows switching to new QC tab', async () => {
    render(<LabQCPage />);

    const newTab = screen.getByText(/New QC/i);
    fireEvent.click(newTab);
    
    expect(screen.getByText(/Record QC Test/i)).toBeInTheDocument();
  });
});
