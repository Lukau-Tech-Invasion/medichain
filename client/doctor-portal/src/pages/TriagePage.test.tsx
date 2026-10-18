import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as shared from '@medichain/shared';
import TriagePage, { triageLevel } from './TriagePage';
import { useAuthStore } from '../store';
import { selectPatient } from '../test/selectPatient';

// Mock the auth store
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openAccessContext: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TriagePage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.openAccessContext).mockResolvedValue({
      access_context_id: 'CTX-TRIAGE',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    } as Awaited<ReturnType<typeof shared.openAccessContext>>);
    vi.mocked(useAuthStore).mockReturnValue({
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
                esi_level: 'Level1Resuscitation',
                chief_complaint: 'Chest Pain',
                performed_at: 1755000000,
              },
              {
                assessment_id: 't2',
                patient_id: 'PAT-002',
                esi_level: 'Level3Urgent',
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

  it('searches the server for the patient being triaged, not the first page of patients', async () => {
    render(
      <MemoryRouter>
        <TriagePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/ESI Triage Assessment/i)).toBeInTheDocument();
    });

    // The page used to filter the first 50 rows of `GET /api/patients`
    // locally, so the fifty-first patient could never be found.
    fireEvent.change(screen.getByLabelText(/Search patient/i), { target: { value: 'Alic' } });
    expect(await screen.findByRole('button', { name: /Alice Smith/i })).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(([url]) => /\/api\/patients\?.*q=Alic/.test(String(url)))
    ).toBe(true);
  });

  it('says the queue could not be loaded rather than that nobody is waiting, and retries', { timeout: 60000 }, async () => {
    let queueDown = true;
    const listPatients = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/clinical/triage/queue')) {
        if (queueDown) {
          return Promise.resolve({
            ok: false, status: 503, statusText: 'Service Unavailable',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ error: { code: 'TRIAGE_UNAVAILABLE', message: 'The triage queue could not be loaded' } }),
          });
        }
      }
      return listPatients(url, init);
    });
    render(<MemoryRouter><TriagePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /^Triage Queue$/ }));

    expect(await screen.findByText(/triage queue could not be loaded/i, {}, { timeout: 30000 })).toBeInTheDocument();
    expect(screen.queryByText('No patients in triage queue')).not.toBeInTheDocument();

    queueDown = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Chest Pain', {}, { timeout: 10000 })).toBeInTheDocument();
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
      expect(screen.getByText('ESI 1: Resuscitation')).toBeInTheDocument();
      expect(screen.getByText('ESI 3: Urgent')).toBeInTheDocument();
    });
  });

  it('allows selecting a patient for triage', async () => {
    render(
      <MemoryRouter>
        <TriagePage />
      </MemoryRouter>
    );

    await selectPatient(/Search patient/i, 'Alice Smith');

    await waitFor(() => {
      expect(screen.getAllByText(/Triage Assessment/i).length).toBeGreaterThan(0);
      expect(screen.getByLabelText(/Chief Complaint/i)).toBeInTheDocument();
    });
  });

  it('keeps the entered form and hides raw server errors after a rejected submission', async () => {
    render(<MemoryRouter><TriagePage /></MemoryRouter>);
    await selectPatient(/Search patient/i, 'Alice Smith');
    fireEvent.click(screen.getByRole('button', { name: /5 Non-Urgent/ }));
    fireEvent.change(screen.getByLabelText('Chief Complaint'), { target: { value: 'Synthetic rehearsal' } });
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400, statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Private server diagnostic' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Triage Assessment' }));
    expect(await screen.findByText('Failed to create triage assessment')).toBeInTheDocument();
    expect(screen.getByLabelText('Chief Complaint')).toHaveValue('Synthetic rehearsal');
    expect(screen.queryByText(/Private server diagnostic|400 Bad Request/)).not.toBeInTheDocument();
  });
});

it('reads every serialized ESI enum without inventing a level for unknown values', () => {
  ['Level1Resuscitation', 'Level2Emergent', 'Level3Urgent', 'Level4LessUrgent', 'Level5NonUrgent']
    .forEach((value, index) => expect(triageLevel(value)).toBe(index + 1));
  expect(triageLevel({ level: 2 })).toBe(2);
  expect(triageLevel(4)).toBe(4);
  expect(triageLevel('Unrecognized')).toBeNull();
  expect(triageLevel(0)).toBeNull();
});
