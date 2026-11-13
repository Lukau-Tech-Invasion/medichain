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
  useScoringCatalog: vi.fn(),
  apiUrl: (path: string) => path,
}));

// What the catalog endpoint serves. One test below serves different
// cut-points, to prove the page holds none of its own.
const catalogWith = (qsofa: Record<string, number> | undefined) =>
  ({ catalog: qsofa ? { qsofa } : null, isLoading: false, error: null }) as unknown as ReturnType<typeof shared.useScoringCatalog>;
const SERVED = { respiratory_rate_at_or_above: 22, systolic_bp_at_or_below: 100, gcs_below: 15, positive_threshold: 2 };

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
    vi.mocked(shared.useScoringCatalog).mockReturnValue(catalogWith(SERVED));
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

  // The bundle counters also read "0/3"; the qSOFA total is the large one.
  const qsofaTotals = () => screen.queryAllByText(/^[0-3]\/3$/)
    .filter((element) => element.classList.contains('text-4xl'))
    .map((element) => element.textContent);

  const enterObservations = () => {
    fireEvent.change(screen.getByLabelText(/RR ≥22/i), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText(/SBP ≤100 mmHg/i), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText(/GCS <15/i), { target: { value: '15' } });
  };

  it('scores the preview from the served cut-points, not from its own', () => {
    vi.mocked(shared.useScoringCatalog).mockReturnValue(
      catalogWith({ respiratory_rate_at_or_above: 30, systolic_bp_at_or_below: 80, gcs_below: 15, positive_threshold: 2 }));
    render(<SepsisPage />);
    enterObservations();
    expect(qsofaTotals()).toEqual(['0/3']);
  });

  it('shows a dash, not a score, until the catalog has arrived', () => {
    vi.mocked(shared.useScoringCatalog).mockReturnValue(catalogWith(undefined));
    render(<SepsisPage />);
    enterObservations();
    expect(qsofaTotals()).toEqual([]);
  });

  it('leaves unmeasured observations empty instead of inventing a normal score', () => {
    render(<SepsisPage />);
    expect(screen.getByLabelText(/RR ≥22/i)).toHaveValue(null);
    expect(screen.getByLabelText(/SBP ≤100 mmHg/i)).toHaveValue(null);
    expect(screen.getByLabelText(/GCS <15/i)).toHaveValue(null);
    expect(screen.queryAllByText('0/3').some((element) => element.classList.contains('text-4xl'))).toBe(false);
  });
});
