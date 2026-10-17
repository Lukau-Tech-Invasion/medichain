import { render, screen, fireEvent } from '@testing-library/react';
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
    userId: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
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
    fireEvent.change(screen.getByLabelText(/RR ≥22/i), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText(/SBP ≤100 mmHg/i), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText(/GCS <15/i), { target: { value: '15' } });
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('leaves unmeasured observations empty instead of inventing a normal score', () => {
    render(<SepsisPage />);
    expect(screen.getByLabelText(/RR ≥22/i)).toHaveValue(null);
    expect(screen.getByLabelText(/SBP ≤100 mmHg/i)).toHaveValue(null);
    expect(screen.getByLabelText(/GCS <15/i)).toHaveValue(null);
    expect(screen.queryAllByText('0/3').some((element) => element.classList.contains('text-4xl'))).toBe(false);
  });
});
