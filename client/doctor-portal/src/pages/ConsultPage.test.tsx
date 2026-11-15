import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ConsultPage, { toConsult } from './ConsultPage';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// The specifier must match the one the component imports -- this page imports
// '../store/authStore', and a mock registered against '../store' silently does
// not apply, leaving the user undefined.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ConsultPage', () => {
  it('shows the persisted specialist response after reloading the consult list', () => {
    const consult = toConsult({
      consult_id: 'CON-synthetic', status: 'completed',
      examination_findings: 'Stable diabetes', recommendations: 'Routine review',
      follow_up_plan: 'Three months', consulting_provider: 'doctor-synthetic',
      completed_at: '2026-10-07T18:45:00Z',
    });
    expect(consult.response).toEqual({
      responseId: 'CON-synthetic',
      assessment: 'Stable diabetes', recommendations: 'Routine review',
      followUp: 'Three months', respondedBy: 'doctor-synthetic',
      respondedAt: '2026-10-07T18:45:00Z',
    });
  });
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Specialist',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation(() => {
      // The page calls the typed client `listConsults()`, which returns
      // `{ success, items }`. The generated fixture used `{ consultations }`
      // with `id`/`patientName`, so the list stayed empty and every assertion
      // about its contents failed.
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({
          success: true,
          items: [
            {
              consultId: 'CONS-001',
              patientId: 'PAT-001',
              patientName: 'John Doe',
              specialty: 'cardiology',
              urgency: 'routine',
              // Must be one of the statuses the page's icon map knows
              // (requested/acknowledged/in-progress/completed/declined/
              // cancelled) — an unknown value renders `undefined` as a
              // component and crashes the page.
              status: 'requested',
              reason: 'Chest pain evaluation',
              clinicalQuestion: 'Rule out ACS',
              relevantHistory: 'Hypertension',
              requestedBy: 'Dr Smith',
              requestedAt: '2026-08-11T09:00:00Z',
            },
          ],
        }),
      });
    });
  });

  it('renders consult page', async () => {
    render(
      <MemoryRouter>
        <ConsultPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Specialty Consultations/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/John Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/Chest pain evaluation/i)).toBeInTheDocument();
    });
  });

  it('allows filtering by status', async () => {
    render(
      <MemoryRouter>
        <ConsultPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Requested/i).length).toBeGreaterThan(0);
    });
  });
});
