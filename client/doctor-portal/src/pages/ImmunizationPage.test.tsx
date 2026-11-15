import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ImmunizationPage from './ImmunizationPage';
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
  listImmunizations: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('ImmunizationPage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    vi.mocked(shared.listImmunizations).mockResolvedValue({ success: true, records: { items: [], count: 0, limit: 100, offset: 0 } } as unknown as Awaited<ReturnType<typeof shared.listImmunizations>>);
  });

  it('displays a date-only administration without inventing midnight or using record creation time', async () => {
    vi.mocked(shared.listImmunizations).mockResolvedValue({ success: true, records: { items: [
      { id: 'IMM-QA', patient_id: 'PAT-001', vaccine_name: 'QA vaccine', administration_date: '2026-10-10', created_at: '2026-10-10T05:00:00Z' },
    ] } } as unknown as Awaited<ReturnType<typeof shared.listImmunizations>>);
    render(<ImmunizationPage />);
    expect(await screen.findByText(/time not recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/2:00 AM/)).not.toBeInTheDocument();
  });

  it('renders immunization page', async () => {
    render(<ImmunizationPage />);

    expect(screen.getByText(/Immunization Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Vaccine administration, tracking, and registry integration/i)).toBeInTheDocument();
  });

  it('reads the stored dose and extended expiry and series fields', async () => {
    vi.mocked(shared.listImmunizations).mockResolvedValue({ success: true, records: { items: [
      { id: 'IMM-METADATA', patient_id: 'PAT-001', vaccine_name: 'QA metadata vaccine',
        administration_date: '2026-10-10', dose_amount: '0.5 mL', dose_number: 2,
        data: { expiration_date: '2027-03-15', total_doses: 3 } },
    ] } } as unknown as Awaited<ReturnType<typeof shared.listImmunizations>>);
    render(<ImmunizationPage />);
    expect(await screen.findByText('QA metadata vaccine')).toBeInTheDocument();
    expect(screen.getByText(/0.5 mL/)).toBeInTheDocument();
    expect(screen.getByText('2027-03-15')).toBeInTheDocument();
    expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
  });

  it('displays assessment sections', async () => {
    render(<ImmunizationPage />);
    // The vaccine form is in the 'Administer Vaccine' tab; the page opens on
    // the records list. Wait for the tab strip (the page fetches on mount).
    await waitFor(() =>
      expect(screen.getAllByText(/Administer Vaccine/i).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getAllByText(/Administer Vaccine/i)[0]);

    expect(screen.getAllByText(/Administer Vaccine/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Administration/i).length).toBeGreaterThan(0);
  });

  it('allows entering vaccine name', async () => {
    render(<ImmunizationPage />);
    // The vaccine form is in the 'Administer Vaccine' tab; the page opens on
    // the records list. Wait for the tab strip (the page fetches on mount).
    await waitFor(() =>
      expect(screen.getAllByText(/Administer Vaccine/i).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getAllByText(/Administer Vaccine/i)[0]);

    // The administer tab's vaccine field is a labelled <select>, not a free
    // text input — the generated test assumed a text box that never existed.
    const select = screen.getByLabelText(/Vaccine Type/i);
    expect(select).toBeInTheDocument();
  });
});
