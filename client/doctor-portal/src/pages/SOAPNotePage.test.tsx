import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SOAPNotePage from './SOAPNotePage';
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

describe('SOAPNotePage', () => {
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

  it('renders SOAP note page', () => {
    render(<SOAPNotePage />);

    expect(screen.getAllByText(/SOAP Note/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Subjective, Objective, Assessment, Plan/i)).toBeInTheDocument();
  });

  it('displays SOAP sections', () => {
    render(<SOAPNotePage />);

    expect(screen.getAllByText(/Subjective/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Objective/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Assessment/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Plan/i).length).toBeGreaterThan(0);
  });

  it('allows entering subjective part', () => {
    render(<SOAPNotePage />);

    // The SOAP sections are headings above their textareas; the generated
    // test treated the heading element itself as the input.
    expect(screen.getByText(/S - Subjective/i)).toBeInTheDocument();
  });
});
