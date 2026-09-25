import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SpecimenPage from './SpecimenPage';
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

// Mock only the data call; the rest of the package (i18n, apiUrl) stays real so
// the component renders its actual copy.
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
  rejectSpecimen: vi.fn(),
  apiUrl: (path: string) => path,
}));

/**
 * Assertions rewritten 2026-07-31 against what the page renders today. The old
 * ones expected a "Specimen Details" section and a labelled "Specimen Type"
 * field; the page is tabbed (All Specimens / Collect Specimen / Tracking) with
 * summary counters. Strings verified against `docSpecimen` in
 * shared/src/i18n/locales/en-US.ts.
 */
describe('SpecimenPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      status: 200,
      json: async () => [],
      text: async () => '[]',
    }) as unknown as typeof fetch;
  });

  it('renders the specimen collection header', async () => {
    render(<SpecimenPage />);

    await waitFor(() =>
      expect(screen.getByText(/Specimen Collection/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Track and manage laboratory specimens/i)).toBeInTheDocument();
  });

  it('offers the specimen tabs', async () => {
    render(<SpecimenPage />);

    await waitFor(() => expect(screen.getByText(/All Specimens/i)).toBeInTheDocument());
    expect(screen.getByText(/Collect Specimen/i)).toBeInTheDocument();
    expect(screen.getByText(/Tracking/i)).toBeInTheDocument();
  });

  it('shows the STAT orders counter', async () => {
    render(<SpecimenPage />);

    // STAT specimens are time-critical; the counter must stay on the summary row.
    await waitFor(() => expect(screen.getByText(/STAT Orders/i)).toBeInTheDocument());
  });

  it('renders the persisted specimen envelope without inventing patient demographics', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      status: 200,
      json: async () => ({
        success: true,
        specimens: [{
          id: 'SPC-001', patient_id: 'PAT-001', specimen_type: 'blood',
          collector_id: 'LAB-001', collected_at: '2026-09-20T10:00:00Z',
          received_at: null, created_at: '2026-09-20T09:55:00Z',
          data: { priority: 'stat', tests_ordered: 'CBC' },
        }],
      }),
      text: async () => '',
    }) as unknown as typeof fetch;

    render(<SpecimenPage />);

    await waitFor(() => expect(screen.getByText(/SPC-001/)).toBeInTheDocument());
    expect(screen.getAllByText('PAT-001').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/collected/i).length).toBeGreaterThan(1);
    expect(screen.getByText(/^stat$/i)).toBeInTheDocument();
  });

  it('rejects the open specimen with what the technician chose, and nothing it did not', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      status: 200,
      json: async () => ({
        success: true,
        specimens: [{
          id: 'SPC-001', patient_id: 'PAT-001', specimen_type: 'blood',
          collector_id: 'LAB-001', collected_at: '2026-09-20T10:00:00Z',
          received_at: null, created_at: '2026-09-20T09:55:00Z',
          data: { priority: 'routine', tests_ordered: 'CBC' },
        }],
      }),
      text: async () => '',
    }) as unknown as typeof fetch;
    vi.mocked(shared.rejectSpecimen).mockResolvedValue({ success: true, rejection_id: 'REJ-1' });
    render(<SpecimenPage />);

    fireEvent.click(await screen.findByText(/SPC-001/));
    // Nothing chosen yet: refused on the page, nothing sent.
    fireEvent.click(screen.getByRole('button', { name: /Reject specimen/i }));
    expect(await screen.findByText(/Choose a category and give a reason/i)).toBeInTheDocument();
    expect(shared.rejectSpecimen).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Reason category/i), { target: { value: 'specimen_quality' } });
    fireEvent.change(screen.getByLabelText(/^Reason$/i), { target: { value: 'Haemolysed' } });
    fireEvent.click(screen.getByRole('button', { name: /Reject specimen/i }));

    await waitFor(() => expect(shared.rejectSpecimen).toHaveBeenCalledWith({
      specimen_id: 'SPC-001',
      rejection_reason: 'Haemolysed',
      rejection_category: 'specimen_quality',
      recollection_required: false,
    }));
    expect(await screen.findByText(/Rejection REJ-1 recorded/i)).toBeInTheDocument();
  });
});
