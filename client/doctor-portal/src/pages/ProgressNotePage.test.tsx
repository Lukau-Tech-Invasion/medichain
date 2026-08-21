import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ProgressNotePage from './ProgressNotePage';
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

describe('ProgressNotePage', () => {
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

  it('renders progress note page', async () => {
    render(<ProgressNotePage />);

    // The SOAP fields live in the 'New Note' tab, not the default note list.
    // The page fetches on mount, so the tab strip is not present on the
    // first synchronous render — wait for it before navigating.
    await waitFor(() => expect(screen.getByText(/New Note/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Note/i));

    expect(screen.getAllByText(/Progress Notes/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Clinical documentation and patient timeline/i)).toBeInTheDocument();
  });

  it('displays note sections', async () => {
    render(<ProgressNotePage />);

    // The SOAP fields live in the 'New Note' tab, not the default note list.
    // The page fetches on mount, so the tab strip is not present on the
    // first synchronous render — wait for it before navigating.
    await waitFor(() => expect(screen.getByText(/New Note/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Note/i));

    expect(screen.getByText(/Subjective \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Objective \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Assessment \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Plan \*/i)).toBeInTheDocument();
  });

  it('allows entering subjective note', async () => {
    render(<ProgressNotePage />);

    // The SOAP fields live in the 'New Note' tab, not the default note list.
    // The page fetches on mount, so the tab strip is not present on the
    // first synchronous render — wait for it before navigating.
    await waitFor(() => expect(screen.getByText(/New Note/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/New Note/i));

    const input = screen.getByLabelText(/Subjective/i);
    fireEvent.change(input, { target: { value: 'Patient reports feeling better today.' } });
    expect(input).toHaveValue('Patient reports feeling better today.');
  });
});
