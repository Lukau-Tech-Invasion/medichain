import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NursingCarePlanPage from './NursingCarePlanPage';
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

  it('renders nursing care plan page', async () => {
    render(<NursingCarePlanPage />);

    // The diagnosis form lives in the 'New Plan' tab, not the default list.
    // The page fetches on mount, so the tab strip is not present on the
    // first synchronous render — wait for it before navigating.
    await waitFor(() => expect(screen.getByText(/New Plan/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Plan/i));

    expect(screen.getAllByText(/Nursing Care Plan/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Create and manage patient care plans/i)).toBeInTheDocument();
  });

  it('displays assessment sections', async () => {
    render(<NursingCarePlanPage />);

    // The diagnosis form lives in the 'New Plan' tab, not the default list.
    // The page fetches on mount, so the tab strip is not present on the
    // first synchronous render — wait for it before navigating.
    await waitFor(() => expect(screen.getByText(/New Plan/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Plan/i));

    // A plan is a nursing diagnosis with its goals and interventions.
    expect(screen.getByText(/Nursing Diagnosis \*/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Risk for Falls/i)).toBeInTheDocument();
  });

  it('allows entering nursing diagnosis', async () => {
    render(<NursingCarePlanPage />);

    // The diagnosis form lives in the 'New Plan' tab, not the default list.
    // The page fetches on mount, so the tab strip is not present on the
    // first synchronous render — wait for it before navigating.
    await waitFor(() => expect(screen.getByText(/New Plan/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Plan/i));

    const input = screen.getByLabelText(/Nursing Diagnosis \*/i);
    fireEvent.change(input, { target: { value: 'Impaired Gas Exchange' } });
    expect(input).toHaveValue('Impaired Gas Exchange');
  });
});
