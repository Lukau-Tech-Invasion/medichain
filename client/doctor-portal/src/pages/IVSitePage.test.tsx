import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IVSitePage, { toIVSite, calculateDaysActive } from './IVSitePage';
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

/** Choose the seeded patient — everything past the picker depends on it. */
const selectPatient = async () => {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Test Patient/i })).toBeInTheDocument()
  );
  fireEvent.click(screen.getByRole('button', { name: /Test Patient/i }));
};

describe('IVSitePage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    // IV sites hang off a patient: with no patient chosen the page shows only
    // the picker, so the assessment tabs never render.
    vi.mocked(shared.getPatients).mockResolvedValue([
      patientProfile(),
    ]);
  });

  it('renders IV site page', () => {
    render(<IVSitePage />);

    expect(screen.getByText(/IV Site Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Document and monitor intravenous access sites/i)).toBeInTheDocument();
  });

  it('reports completed dwell days without rounding up or inventing unknown elapsed time', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    expect(calculateDaysActive('2026-10-10T11:59:00Z', now)).toBe(0);
    expect(calculateDaysActive('2026-10-09T12:00:00Z', now)).toBe(1);
    expect(calculateDaysActive('2026-10-08T12:00:00Z', now)).toBe(2);
    for (const value of ['', 'invalid', '2026-10-10', '2026-10-11T12:00:00Z']) {
      expect(calculateDaysActive(value, now)).toBeUndefined();
    }
  });

  it('reads active status, insertion details and assessments from a stored database row', () => {
    const site = toIVSite({
      id: 'IV-PAT-001-SITE-1', site_id: 'SITE-1', patient_id: 'PAT-001',
      site_discontinued: false, catheter_type: 'peripheral', catheter_gauge: '22G',
      data: { location: 'right-hand', locationDetail: 'Dorsal vein',
        insertedAt: '2026-10-08T00:00:00Z', insertedBy: 'nurse-1',
        assessments: [{ id: 'ASSESS-1', assessedAt: '2026-10-08T00:05:00Z',
          assessedBy: 'nurse-1', conditions: ['clean-dry-intact'], dressingType: 'transparent',
          infusing: '', notes: 'Site remains clean', phlebitisScore: 0, infiltrationGrade: 0 }] },
    });
    expect(site.isActive).toBe(true);
    expect(site.id).toBe('SITE-1');
    expect(site.locationDetail).toBe('Dorsal vein');
    expect(site.assessments[0].notes).toBe('Site remains clean');
    expect(toIVSite({ site_discontinued: true, data: { isActive: true } }).isActive).toBe(false);
  });

  it('displays assessment criteria', async () => {
    render(<IVSitePage />);
    await selectPatient();

    // Both complications are staged, on their own scales: infiltration on the
    // INS grade and phlebitis on the VIP score.
    await waitFor(() =>
      expect(screen.getAllByText(/Infiltration/i).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/Phlebitis/i).length).toBeGreaterThan(0);
  });

  it('allows selecting IV location', async () => {
    render(<IVSitePage />);
    await selectPatient();

    // The entry form is its own tab; the page opens on the active-sites list.
    fireEvent.click(screen.getByRole('button', { name: /Add New Site/i }));
    const select = screen.getByLabelText(/Insertion Site/i);
    fireEvent.change(select, { target: { value: 'right-forearm' } });
    expect(select).toHaveValue('right-forearm');
  });

  it('requires an explicit discontinuation reason and permits cancellation', async () => {
    render(<IVSitePage />);
    await selectPatient();
    fireEvent.click(screen.getByRole('button', { name: 'Add New Site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add IV Site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discontinue' }));
    expect(screen.getByRole('button', { name: 'Confirm discontinuation' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Assess Site' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discontinue' }));
    fireEvent.change(screen.getByLabelText('Reason for discontinuation'), { target: { value: 'QA fictional completion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discontinuation' }));
    expect(screen.queryByRole('button', { name: 'Assess Site' })).not.toBeInTheDocument();
    expect(screen.getByText(/QA fictional completion/)).toBeInTheDocument();
  });

  it('leaves a new IV assessment unassessed and permits deselecting the last finding', async () => {
    render(<IVSitePage />);
    await selectPatient();
    fireEvent.click(screen.getByRole('button', { name: 'Add New Site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add IV Site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assess Site' }));
    expect(screen.getByLabelText('Dressing Type')).toHaveValue('');
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(screen.queryByText('Continue monitoring')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Redness/Erythema' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redness/Erythema' }));
    expect(screen.queryByText('Continue monitoring')).not.toBeInTheDocument();
  });
});
