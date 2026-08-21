import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import OperativeNotePage from './OperativeNotePage';
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

describe('OperativeNotePage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Surgeon',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders operative note page', () => {
    render(<OperativeNotePage />);

    expect(screen.getAllByText(/Operative Note/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Surgical procedure documentation/i)).toBeInTheDocument();
  });

  it('displays procedure details section', () => {
    render(<OperativeNotePage />);

    expect(screen.getByText(/Pre-operative Diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/Post-operative Diagnosis/i)).toBeInTheDocument();
    expect(screen.getByText(/Procedure Name/i)).toBeInTheDocument();
  });

  it('allows entering surgeon name', () => {
    render(<OperativeNotePage />);

    const input = screen.getByLabelText(/Surgeon/i);
    fireEvent.change(input, { target: { value: 'Dr. Cut' } });
    expect(input).toHaveValue('Dr. Cut');
  });
});
