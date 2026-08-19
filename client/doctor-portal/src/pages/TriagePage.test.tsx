import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TriagePage from './TriagePage';
import { useAuthStore } from '../store';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TriagePage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    mockFetch.mockImplementation((url: string) => {
      // Each endpoint returns the shape the component parses. Previously every
      // URL got `{ queue: [...] }`, but the patient list reads `data.data` and
      // the queue reads `data.queue`, so the patient tab rendered empty and
      // the tests failed looking for names the page was never given.
      if (String(url).includes('/api/clinical/triage/queue')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          status: 200,
          json: () => Promise.resolve({
            success: true,
            total: 2,
            queue: [
              // The shape the page actually reads: `assessment_id`,
              // `esi_level`, `chief_complaint`, `performed_at`. The generated
              // fixture used `patientName`/`acuity`/`complaint`, which the
              // component never looks at.
              {
                assessment_id: 't1',
                patient_id: 'PAT-001',
                esi_level: 1,
                chief_complaint: 'Chest Pain',
                performed_at: 1755000000,
              },
              {
                assessment_id: 't2',
                patient_id: 'PAT-002',
                esi_level: 3,
                chief_complaint: 'Ankle injury',
                performed_at: 1755000600,
              },
            ],
          }),
        });
      }

      // Everything else is the patient list, which the page reads as
      // `data.data`.
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                patient_id: 'PAT-001',
                full_name: 'Alice Smith',
                health_id: 'MCHI-001',
                date_of_birth: '1990-01-01',
              },
              {
                patient_id: 'PAT-002',
                full_name: 'Bob Jones',
                health_id: 'MCHI-002',
                date_of_birth: '1985-05-05',
              },
            ],
          }),
      });
    });
  });

  it('renders triage page and offers patients once the search is opened', async () => {
    render(
      <MemoryRouter>
        <TriagePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/ESI Triage Assessment/i)).toBeInTheDocument();
    });

    // Patients are a search dropdown, not a list on load: the component only
    // opens it on focus. Asserting the names without this was asserting a
    // behaviour the page correctly does not have.
    fireEvent.focus(screen.getByPlaceholderText(/Search patient/i));

    await waitFor(() => {
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Bob Jones/i)).toBeInTheDocument();
    });
  });

  it('displays acuity levels', async () => {
    render(
      <MemoryRouter>
        <TriagePage />
      </MemoryRouter>
    );

    // The triage queue only loads once its tab is opened.
    fireEvent.click(screen.getByText(/Triage Queue/i));

    await waitFor(() => {
      expect(screen.getByText(/Chest Pain/i)).toBeInTheDocument();
    });
  });

  it('allows selecting a patient for triage', async () => {
    render(
      <MemoryRouter>
        <TriagePage />
      </MemoryRouter>
    );

    fireEvent.focus(screen.getByPlaceholderText(/Search patient/i));

    await waitFor(() => {
      const patient = screen.getByText(/Alice Smith/i);
      fireEvent.click(patient);
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Triage Assessment/i).length).toBeGreaterThan(0);
      expect(screen.getByLabelText(/Chief Complaint/i)).toBeInTheDocument();
    });
  });
});
