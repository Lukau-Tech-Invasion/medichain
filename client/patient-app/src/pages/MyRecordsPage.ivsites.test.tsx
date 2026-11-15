import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MyRecordsPage } from './MyRecordsPage';
import { usePatientAuthStore } from '../store/authStore';

// The IV-site section of a patient's own record (rule 10). The clinical IV
// list is closed to patient sessions, so this summary section is the only
// way the person with the cannula reads what was recorded about it.
const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('../components/Toast', () => ({
  useToastActions: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

const json = (body: unknown) => Promise.resolve({
  ok: true,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: () => Promise.resolve(body),
});

describe('MyRecordsPage IV sites', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    vi.clearAllMocks();
    usePatientAuthStore.setState({
      patient: {
        userId: 'iv-patient-user', healthId: 'PAT-IV', fullName: 'IV Patient',
        firstName: 'IV', createdAt: '2025-01-01T00:00:00Z',
      },
      isAuthenticated: true,
    });
    mockFetch.mockImplementation((url: string) => url.includes('/records-summary')
      ? json({
        patient_id: 'PAT-IV', page: 0, per_page: 50, unavailable: [],
        sections: {
          'iv-sites': { iv_sites: [
            { id: 'IV-GRADED', site_location: 'left-forearm', catheter_gauge: '20G', catheter_type: 'peripheral',
              phlebitis_grade: 2, assessed_by: 'Nurse QA', assessed_at: '2026-11-13T08:00:00Z' },
            { id: 'IV-UNASSESSED', site_location: 'right-hand', catheter_gauge: '22G', phlebitis_grade: null,
              site_discontinued: true, discontinuation_reason: 'Routine change',
              assessed_by: 'Nurse QA', assessed_at: '2026-11-12T08:00:00Z' },
          ] },
        },
      })
      : json({ records: [] }));
  });

  it("shows each cannula, its grade, and an unassessed site as unassessed rather than grade 0", async () => {
    render(<MemoryRouter><MyRecordsPage /></MemoryRouter>);
    const graded = await screen.findByRole('button', { name: /^IV cannula: left forearm/ });
    expect(graded).toHaveTextContent(/Phlebitis grade 2/);
    const unassessed = screen.getByRole('button', { name: /^IV cannula: right hand/ });
    expect(unassessed).toHaveTextContent(/Site not yet assessed/);
    expect(unassessed).not.toHaveTextContent(/grade 0/);
    expect(unassessed).toHaveTextContent(/Removed: Routine change/);
  });
});
