import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CDSAlertsPage from './CDSAlertsPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('CDSAlertsPage', () => {
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

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        // listCdsAlerts() GETs a bare array from
        // /api/platform/list/cds-alerts and wraps it as `items`. This page
        // configures CDS *rules*, so records carry a ruleId/name/category and
        // lower-case severity — not per-patient alert instances.
        json: () => Promise.resolve([
          {
            ruleId: 'CDS-001',
            name: 'Drug Interaction Warning',
            category: 'medication',
            description: 'Warfarin and Aspirin interaction',
            severity: 'high',
            triggerType: 'interaction',
            conditions: [],
            actions: [],
            status: 'active',
            priority: 8,
            createdBy: 'Dr Smith',
            createdAt: '2026-08-01T00:00:00Z',
            lastModified: '2026-08-01T00:00:00Z',
            triggerCount: 0,
            isEnabled: true,
            testMode: false,
          },
        ]),
      });
    });
  });

  it('renders CDS alerts page', async () => {
    render(
      <MemoryRouter>
        <CDSAlertsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/CDS Alerts Configuration/i)).toBeInTheDocument();
      expect(screen.getByText(/Drug Interaction Warning/i)).toBeInTheDocument();
      expect(screen.getByText(/Warfarin and Aspirin interaction/i)).toBeInTheDocument();
    });
  });

  it('shows severity badge', async () => {
    render(
      <MemoryRouter>
        <CDSAlertsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/High/i).length).toBeGreaterThan(0);
    });
  });
});
