import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SpecimenPage from './SpecimenPage';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { patientFixture, selectPatient } from '../test/selectPatient';

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
  openAccessContext: vi.fn(),
  getPatients: vi.fn(),
  rejectSpecimen: vi.fn(),
  createSpecimen: vi.fn(),
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
    userId: '5GrwvaEF...mock',
    role: 'Laboratory Tech',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.openAccessContext).mockResolvedValue({
      access_context_id: 'CTX-PAGE-QA',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    } as Awaited<ReturnType<typeof shared.openAccessContext>>);
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

  it('refreshes the persisted worklist after recording a collection', async () => {
    let saved = false;
    vi.mocked(shared.getPatients).mockResolvedValue([patientFixture({ patient_id: 'PAT-QA', full_name: 'Thandiwe Ndlovu' })] as never);
    vi.mocked(shared.createSpecimen).mockImplementation(async () => {
      saved = true;
      return { success: true, collection_id: 'SPC-QA' } as never;
    });
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, specimens: saved ? [{
        id: 'SPC-QA', patient_id: 'PAT-QA', specimen_type: 'blood', collector_id: 'LAB-QA',
        collected_at: '2026-10-08T16:00:00Z', created_at: '2026-10-08T16:00:00Z',
        data: { tests_ordered: 'QA refreshed CBC', priority: 'routine' },
      }] : [] }),
    })) as typeof fetch;
    render(<SpecimenPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Collect Specimen' }));
    await selectPatient(/Patient/, 'Thandiwe Ndlovu');
    fireEvent.change(screen.getByLabelText(/Tests Ordered/), { target: { value: 'QA refreshed CBC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Collection' }));
    await screen.findByText('Specimen collection recorded.');
    fireEvent.click(screen.getByRole('button', { name: 'All Specimens' }));
    expect(await screen.findByText('QA refreshed CBC')).toBeInTheDocument();
  });

  it('shows a persisted rejection instead of a collected badge', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ specimens: [{
        id: 'SPC-REJECTED', patient_id: 'PAT-QA', specimen_type: 'blood', collector_id: 'LAB-QA',
        rejected: true, collected_at: '2026-10-08T16:00:00Z', created_at: '2026-10-08T16:00:00Z',
      }] }),
    }) as typeof fetch;
    render(<SpecimenPage />);
    expect(await screen.findByRole('button', { name: /SPC-REJECTED.*rejected/ })).toBeInTheDocument();
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
