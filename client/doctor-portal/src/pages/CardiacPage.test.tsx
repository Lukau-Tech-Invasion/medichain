import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CardiacPage from './CardiacPage';
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
  createCardiac: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('CardiacPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
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

  it('renders cardiac page', async () => {
    render(
      <MemoryRouter>
        <CardiacPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Cardiac Event Documentation/i)).toBeInTheDocument();
      expect(screen.getAllByText(/ECG Readings/i).length).toBeGreaterThan(0);
    });
  });

  it('allows selecting a patient', async () => {
    render(
      <MemoryRouter>
        <CardiacPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      const select = screen.getByPlaceholderText(/Search patients/i);
      fireEvent.change(select, { target: { value: 'PAT-001' } });
      expect(select).toHaveValue('PAT-001');
    });
  });

  it('allows entering event details', async () => {
    render(
      <MemoryRouter>
        <CardiacPage />
      </MemoryRouter>
    );

    // Event type is a grid of buttons under an <h2>, not a <select>: the
    // generated test assumed a dropdown that does not exist.
    expect(screen.getByText(/Event Type/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByText(/^STEMI$/i)[0]);
  });
});
