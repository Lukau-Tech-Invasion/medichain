import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import NursingPage from './NursingPage';
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

describe('NursingPage', () => {
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

  it('renders nursing page', () => {
    render(<NursingPage />);

    expect(screen.getByText(/Nursing Documentation/i)).toBeInTheDocument();
    expect(screen.getByText(/MAR, Intake\/Output, and Care Plans/i)).toBeInTheDocument();
  });

  it('displays assessment tabs', () => {
    render(<NursingPage />);

    expect(screen.getAllByText(/MAR/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Intake/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Care Plan/i).length).toBeGreaterThan(0);
  });

  it('allows switching to the care plan tab', async () => {
    render(<NursingPage />);

    // Tab bodies render behind the page's initial load spinner, so wait for
    // the MAR tab (the default) to have content before switching away.
    const carePlansTab = await screen.findByRole('button', { name: /Care Plans/i });
    fireEvent.click(carePlansTab);
    expect(carePlansTab.className).toContain('bg-primary-600');
  });
});
