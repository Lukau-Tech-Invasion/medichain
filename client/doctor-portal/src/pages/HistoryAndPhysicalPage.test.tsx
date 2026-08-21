import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import HistoryAndPhysicalPage from './HistoryAndPhysicalPage';
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

  it('renders H&P page', async () => {
    render(<HistoryAndPhysicalPage />);

    expect(screen.getByText(/History & Physical/i)).toBeInTheDocument();
    expect(screen.getByText(/Document comprehensive patient evaluations/i)).toBeInTheDocument();
  });

  it('displays assessment sections', async () => {
    render(<HistoryAndPhysicalPage />);

    // The H&P form is in the 'New H&P' tab; the page opens on the records
    // list, and fetches on mount so the tab strip is not there at once.
    await waitFor(() => expect(screen.getAllByText(/New H&P/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/New H&P/i)[0]);

    expect(screen.getAllByText(/Chief Complaint/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/History of Present Illness/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Review of Systems/i).length).toBeGreaterThan(0);
  });

  it('allows entering chief complaint', async () => {
    render(<HistoryAndPhysicalPage />);

    // The H&P form is in the 'New H&P' tab; the page opens on the records
    // list, and fetches on mount so the tab strip is not there at once.
    await waitFor(() => expect(screen.getAllByText(/New H&P/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/New H&P/i)[0]);

    const input = screen.getByLabelText(/Chief Complaint/i);
    fireEvent.change(input, { target: { value: 'Severe headache' } });
    expect(input).toHaveValue('Severe headache');
  });
});
