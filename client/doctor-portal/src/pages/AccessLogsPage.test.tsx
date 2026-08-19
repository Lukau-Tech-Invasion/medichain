import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AccessLogsPage from './AccessLogsPage';
import { useAuthStore } from '../store';

// Mock the auth store.
//
// The component reads the store through the STATIC api —
// `useAuthStore.getState().user` (AccessLogsPage.tsx:45) — not through the
// hook. A bare `vi.fn()` has no `.getState`, so the call threw, the surrounding
// try/catch swallowed it, and the component bailed with `setLogs([])` before
// ever issuing a fetch. Every assertion then failed against an empty page while
// the component was behaving correctly.
//
// Zustand stores are callable AND carry statics, so the mock has to be both.
vi.mock('../store', () => ({
  useAuthStore: Object.assign(vi.fn(), { getState: vi.fn() }),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AccessLogsPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });
    // Both call styles must be configured: the hook for render-time reads, and
    // `getState()` for the effect that actually fetches.
    (useAuthStore as any).getState.mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    // The key must be one the component actually reads. AccessLogsPage does
    // `data.access_logs || data.data || []` (AccessLogsPage.tsx:64); the
    // original fixture used `logs`, which matches none of them, so the page
    // received an empty list and rendered its empty state. The component was
    // correct — the test had invented an API contract.
    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({
          // Matches the component's `AccessLog` interface
          // (AccessLogsPage.tsx:19) field for field. The original fixture was
          // camelCase with an entirely different model — `patientName`,
          // `providerName`, `resourceType`, `status` — none of which exist.
          // The page renders `patient_id`/`accessor_id`, never a person's name,
          // so the old assertions on /John Doe/i could never have passed.
          access_logs: [
            {
              access_id: 'ACC-001',
              patient_id: 'PAT-001',
              accessor_id: 'DOC-001',
              accessor_role: 'Doctor',
              access_type: 'View Record',
              location: 'Ward A',
              timestamp: new Date().toISOString(),
              emergency: false,
            }
          ],
        }),
      });
    });
  });

  it('renders access logs page', async () => {
    render(
      <MemoryRouter>
        <AccessLogsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Access Logs/i).length).toBeGreaterThan(0);
      // The page shows identifiers, not names — assert what it renders.
      expect(screen.getByText(/PAT-001/i)).toBeInTheDocument();
      expect(screen.getByText(/View Record/i)).toBeInTheDocument();
    });
  });

  it('displays log details in the table', async () => {
    render(
      <MemoryRouter>
        <AccessLogsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      // `resourceType`/`status` do not exist on AccessLog. The table shows the
      // accessor and their role.
      expect(screen.getByText(/DOC-001/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Doctor/i).length).toBeGreaterThan(0);
    });
  });
});
