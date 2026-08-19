import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import WoundCarePage from './WoundCarePage';
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

describe('WoundCarePage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([]);

    // The shared default in src/test/setup.ts resolves `{ success: true,
    // data: [] }`, but this page calls `data.map(...)` on the parsed body — so
    // the default drove it into its ERROR branch (`data.map is not a
    // function`), and the error branch hides the tab strip entirely. The test
    // then failed looking for a tab that the component was right not to render.
    // Supplying the shape this endpoint actually returns is the fix.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [],
    }) as unknown as typeof fetch;
  });

  // WoundCarePage fetches on mount and renders EVERYTHING behind
  // `{!loading && !error && ...}` (WoundCarePage.tsx:237), with `loading`
  // initialised to `true`. A synchronous assertion straight after `render()`
  // therefore only ever sees the spinner — which is why these three tests
  // failed against a component that works correctly. The fix is to await the
  // loaded state, not to change the component.

  it('renders wound care page', async () => {
    render(<WoundCarePage />);

    // The header renders immediately (it sits outside the loading gate).
    expect(await screen.findByText(/Wound Care/i)).toBeInTheDocument();
  });

  it('displays assessment sections once loading resolves', async () => {
    render(<WoundCarePage />);

    // Wait for the mount fetch to settle before asserting on gated content.
    await waitFor(() => {
      expect(screen.queryByText(/Loading wound assessments/i)).not.toBeInTheDocument();
    });

    // `getAllBy*`: these words legitimately appear more than once on the page
    // (heading plus field labels). `getBy*` throws "Found multiple elements",
    // which is a defect in the query, not in the component.
    expect(screen.getAllByText(/Assessment/i).length).toBeGreaterThan(0);
  });

  it('allows entering wound type', async () => {
    render(<WoundCarePage />);

    // TWO gates, not one. Beyond the loading gate, the assessment form lives
    // behind `activeTab === 'assess'` (WoundCarePage.tsx:350) and the page
    // opens on the 'wounds' tab. The original test assumed the form was
    // present on first paint; it never has been.
    const tab = await screen.findByText(/New Assessment/i);
    fireEvent.click(tab);

    const select = await screen.findByLabelText(/Wound Type/i);
    fireEvent.change(select, { target: { value: 'pressure-ulcer' } });
    expect(select).toHaveValue('pressure-ulcer');
  });
});
