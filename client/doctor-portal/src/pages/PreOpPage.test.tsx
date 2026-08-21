import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PreOpPage from './PreOpPage';
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

describe('PreOpPage', () => {
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

  it('renders pre-op page', () => {
    render(<PreOpPage />);

    expect(screen.getByText(/Pre-Operative Assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/ASA Classification & Surgical Readiness/i)).toBeInTheDocument();
  });

  it('displays checklist items', async () => {
    render(<PreOpPage />);

    // The checklist is its own tab; the page opens on the assessment tab.
    fireEvent.click(screen.getByRole('button', { name: /Pre-Op Checklist/i }));

    await waitFor(() =>
      expect(screen.getByText(/All consents signed and witnessed/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/NPO status verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Surgical site marked by surgeon/i)).toBeInTheDocument();
  });

  it('allows selecting ASA classification', () => {
    render(<PreOpPage />);

    // ASA status is a radio group of option buttons, not a <select>: each
    // class carries a description that a dropdown option cannot show.
    const group = screen.getByLabelText(/ASA Class/i);
    expect(group).toHaveAttribute('role', 'radiogroup');

    const asaIII = screen.getByRole('radio', { name: /ASA III/i });
    expect(asaIII).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(asaIII);
    expect(asaIII).toHaveAttribute('aria-checked', 'true');
  });
});
