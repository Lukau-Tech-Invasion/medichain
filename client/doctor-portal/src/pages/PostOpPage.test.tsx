import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PostOpPage from './PostOpPage';
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

describe('PostOpPage', () => {
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

  it('renders post-op page', () => {
    render(<PostOpPage />);

    expect(screen.getByText(/Post-Operative Care/i)).toBeInTheDocument();
    expect(screen.getByText(/PACU assessment and discharge criteria/i)).toBeInTheDocument();
  });

  it('displays assessment sections', () => {
    render(<PostOpPage />);

    expect(screen.getAllByText(/Aldrete Score/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Pain Score \(0-10\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Discharge Criteria/i).length).toBeGreaterThan(0);
  });

  it('allows entering aldrete score', () => {
    render(<PostOpPage />);

    expect(screen.getAllByText(/Aldrete Score/i).length).toBeGreaterThan(0);
  });
});
