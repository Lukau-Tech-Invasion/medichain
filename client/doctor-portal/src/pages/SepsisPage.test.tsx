import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SepsisPage from './SepsisPage';
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

describe('SepsisPage', () => {
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

  it('renders sepsis page', () => {
    render(<SepsisPage />);

    expect(screen.getAllByText(/Sepsis Protocol/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Time-critical sepsis management bundle/i)).toBeInTheDocument();
  });

  it('displays screening tools', () => {
    render(<SepsisPage />);

    // Rendered twice: the section heading and the score panel below it.
    expect(screen.getAllByText(/qSOFA Score/i).length).toBeGreaterThan(0);
  });

  it('allows calculating qSOFA', () => {
    render(<SepsisPage />);

    const systolicInput = screen.getByLabelText(/SBP ≤100 mmHg/i);
    fireEvent.click(systolicInput);

    // The running total renders as "<n>/3" beneath the criteria, not as a
    // "qSOFA Total:" caption.
    expect(screen.getAllByText(/\/3$/).length).toBeGreaterThan(0);
  });
});
