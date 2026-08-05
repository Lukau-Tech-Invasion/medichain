import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AutopsyPage from './AutopsyPage';
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
 * ones expected "Case Information" / "External Examination" sections and a
 * labelled "Primary Cause of Death" field; the page is a tabbed report browser
 * (All Reports / New Report / Pending) with search and status filters. Strings
 * verified against `docAutopsy` in shared/src/i18n/locales/en-US.ts.
 */
describe('AutopsyPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({ user: mockUser });
    (shared.getPatients as any).mockResolvedValue([]);
  });

  it('renders the autopsy reports header', async () => {
    render(<AutopsyPage />);

    await waitFor(() =>
      expect(screen.getAllByText(/Autopsy Report/i).length).toBeGreaterThan(0)
    );
    expect(
      screen.getByText(/Post-mortem examination documentation and findings/i)
    ).toBeInTheDocument();
  });

  it('offers the report tabs', async () => {
    render(<AutopsyPage />);

    await waitFor(() => expect(screen.getByText(/All Reports/i)).toBeInTheDocument());
    expect(screen.getByText(/New Report/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Pending/i).length).toBeGreaterThan(0);
  });

  it('offers search and status filtering', async () => {
    render(<AutopsyPage />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Search reports/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/All Statuses/i)).toBeInTheDocument();
  });
});
