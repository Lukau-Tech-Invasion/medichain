import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ToxicologyPage from './ToxicologyPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock only the data call; the rest of the package (i18n, apiUrl) stays real so
// the component renders its actual copy.
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  apiUrl: (path: string) => path,
}));

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones expected sections named "Ingestion Details", "Toxidrome Recognition" and
 * "Antidote Checklist", and a labelled "Suspected Toxidrome" select — none of
 * which exist. The page is tabbed (New Case / History) with an "Exposure
 * Information" form, plus Antidotes and Decontamination sections. Strings
 * verified against `docToxicology` in shared/src/i18n/locales/en-US.ts.
 */
describe('ToxicologyPage', () => {
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

  it('renders the toxicology header', () => {
    render(<ToxicologyPage />);

    expect(screen.getByText(/Toxicology \/ Overdose/i)).toBeInTheDocument();
    expect(screen.getByText(/Poisoning assessment and antidote management/i)).toBeInTheDocument();
  });

  it('surfaces the poison control hotline', () => {
    render(<ToxicologyPage />);

    // Safety-critical: this number must stay visible on the overdose page.
    expect(screen.getByText(/Poison Control: 1-800-222-1222/i)).toBeInTheDocument();
  });

  it('offers the case tabs and exposure form', () => {
    render(<ToxicologyPage />);

    expect(screen.getByText(/New Case/i)).toBeInTheDocument();
    expect(screen.getAllByText(/History/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Exposure Information/i)).toBeInTheDocument();
  });
});
