import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import RadiologyPage from './RadiologyPage';
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

describe('RadiologyPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Radiologist',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    // One blanket response is not enough: the page loads patients and
    // radiology orders in the same Promise.all, so handing the patients call a
    // radiology payload rejects the pair and the page renders its error state.
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ patients: [] }),
        });
      }
      // listRadiology() GETs /api/platform/list/radiology-orders and wraps the
      // raw array as `orders.items`, so the endpoint must answer with the array
      // itself — not an `{ studies: [...] }` envelope, which nothing unwraps.
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve([
          {
            order_id: 'r1',
            accession_number: 'ACC-0001',
            patient_id: 'PAT-001',
            patient_name: 'Jane Doe',
            modality: 'XR',
            study_description: 'Chest X-Ray',
            study_date: new Date().toISOString(),
            referring_physician: 'Dr. Smith',
            status: 'final',
            priority: 'routine',
            num_images: 2,
          },
        ]),
      });
    });
  });

  it('renders radiology page', async () => {
    render(
      <MemoryRouter>
        <RadiologyPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Radiology Worklist/i)).toBeInTheDocument();
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/Chest X-Ray/i)).toBeInTheDocument();
    });
  });

  it('shows study status', async () => {
    render(
      <MemoryRouter>
        <RadiologyPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      // Radiology reports are pending -> in-progress -> preliminary -> final
      // -> addendum; there is no 'completed' state.
      expect(screen.getAllByText(/Final/i).length).toBeGreaterThan(0);
    });
  });
});
