import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PsychPage from './PsychPage';
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
  getPatients: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('PsychPage', () => {
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

  it('renders psychiatry page', () => {
    render(<PsychPage />);

    expect(screen.getByText(/Psychiatric Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/Mental Status Examination/i)).toBeInTheDocument();
  });

  it('displays MSE sections', () => {
    render(<PsychPage />);

    expect(screen.getByText(/Appearance/i)).toBeInTheDocument();
    expect(screen.getByText(/Mood \(patient states\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Affect \(observed\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Thought Content/i)).toBeInTheDocument();
  });

  it('allows entering mood description', () => {
    render(<PsychPage />);

    const input = screen.getByLabelText(/Mood/i);
    fireEvent.change(input, { target: { value: 'Euthymic' } });
    expect(input).toHaveValue('Euthymic');
  });
});
