import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NursingCarePlanPage from './NursingCarePlanPage';
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

describe('NursingCarePlanPage', () => {
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

  it('renders nursing care plan page', () => {
    render(<NursingCarePlanPage />);

    expect(screen.getByText(/Nursing Care Plan/i)).toBeInTheDocument();
    expect(screen.getByText(/Nursing Diagnoses, Interventions, and Outcomes/i)).toBeInTheDocument();
  });

  it('displays assessment sections', () => {
    render(<NursingCarePlanPage />);

    expect(screen.getByText(/Nursing Diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/Interventions/i)).toBeInTheDocument();
    expect(screen.getByText(/Expected Outcomes/i)).toBeInTheDocument();
  });

  it('allows entering nursing diagnosis', () => {
    render(<NursingCarePlanPage />);

    const input = screen.getByLabelText(/Nursing Diagnosis/i);
    fireEvent.change(input, { target: { value: 'Impaired Gas Exchange' } });
    expect(input).toHaveValue('Impaired Gas Exchange');
  });
});
