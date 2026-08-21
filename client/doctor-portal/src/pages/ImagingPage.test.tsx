import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ImagingPage from './ImagingPage';
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

describe('ImagingPage', () => {
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
        // This page orders imaging studies; it reads radiology *orders* as a
        // bare array (or `{ orders }`) and renders no thumbnails.
        json: () => Promise.resolve([
          {
            id: 'IMG-1',
            patientId: 'PAT-001',
            patientName: 'Test Patient',
            modality: 'ct',
            study: 'Abdominal CT',
            bodyPart: 'Abdomen',
            laterality: 'n/a',
            indication: 'Abdominal pain',
            priority: 'routine',
            status: 'ordered',
            orderedBy: 'Dr Smith',
            orderedAt: new Date().toISOString(),
            contrast: true,
            allergies: '',
            creatinine: '',
            pregnant: false,
            criticalValue: false,
          },
        ]),
      });
    });
  });

  it('renders imaging page', async () => {
    render(
      <MemoryRouter>
        <ImagingPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Imaging Studies/i)).toBeInTheDocument();
      expect(screen.getByText(/Abdominal CT/i)).toBeInTheDocument();
    });
  });

  it('lists ordered studies', async () => {
    render(
      <MemoryRouter>
        <ImagingPage />
      </MemoryRouter>
    );

    // This is an order-entry page, not a PACS viewer: orders are listed with
    // their study, indication and status, and no pixel data is fetched.
    await waitFor(() =>
      expect(screen.getAllByText(/Abdominal CT/i).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/Test Patient/i).length).toBeGreaterThan(0);
  });
});
