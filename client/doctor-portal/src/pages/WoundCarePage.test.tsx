import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import WoundCarePage, { toWoundAssessment, groupWoundAssessments } from './WoundCarePage';
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
  getWound: vi.fn(),
  apiUrl: (path: string) => path,
}));

describe('WoundCarePage', () => {
  const mockUser = {
    userId: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
    });
    vi.mocked(shared.getPatients).mockResolvedValue([]);

    // The shared default in src/test/setup.ts resolves `{ success: true,
    // data: [] }`, but this page calls `data.map(...)` on the parsed body — so
    // the default drove it into its ERROR branch (`data.map is not a
    // function`), and the error branch hides the tab strip entirely. The test
    // then failed looking for a tab that the component was right not to render.
    // Supplying the shape this endpoint actually returns is the fix.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [],
    }) as unknown as typeof fetch;
  });

  // WoundCarePage fetches on mount and renders EVERYTHING behind
  // `{!loading && !error && ...}` (WoundCarePage.tsx:237), with `loading`
  // initialised to `true`. A synchronous assertion straight after `render()`
  // therefore only ever sees the spinner — which is why these three tests
  // failed against a component that works correctly. The fix is to await the
  // loaded state, not to change the component.

  it('renders wound care page', async () => {
    render(<WoundCarePage />);

    // The header renders immediately (it sits outside the loading gate).
    expect(await screen.findByText(/Wound Care/i)).toBeInTheDocument();
  });

  it('keeps unmeasured dimensions and pain unknown', () => {
    const wound = toWoundAssessment({
      id: 'WND-1', patient_id: 'PAT-001', wound_id: 'WND-1', wound_location: 'Left forearm',
      wound_type: 'traumatic', length_cm: '2.00', width_cm: '1.00', depth_cm: null,
      tissue_type: null, drainage_amount: 'none', pain_level: null, notes: 'Observed abrasion',
      assessed_by: 'nurse-1', assessed_at: '2026-10-08T00:00:00Z',
    });
    expect(wound.measurements[0]).toMatchObject({ length: 2, width: 1, depth: null, area: 2 });
    expect(wound.painLevel).toBeNull();
    const unknown = toWoundAssessment({
      id: 'WND-2', patient_id: 'PAT-001', wound_id: 'WND-2', wound_location: 'Left forearm',
      wound_type: 'traumatic', length_cm: null, width_cm: null, depth_cm: null,
      tissue_type: null, drainage_amount: null, pain_level: null, notes: null,
      assessed_by: 'nurse-1', assessed_at: '2026-10-08T00:00:00Z',
    });
    expect(unknown.exudate).toBeNull();
    expect(unknown.edges).toBeNull();
    expect(unknown.status).toBe('unknown');
    expect(unknown.needsAttention).toBe(false);
  });

  it('groups same-wound follow-ups chronologically without combining separate wounds', () => {
    const first = { id: 'WND-1', patient_id: 'PAT-001', wound_id: 'WND-ROOT', wound_location: 'Forearm',
      wound_type: 'traumatic', length_cm: 2, width_cm: 1, depth_cm: null, tissue_type: null,
      drainage_amount: null, pain_level: null, notes: 'First', assessed_by: 'nurse-1', assessed_at: '2026-10-08T08:00:00Z' };
    const second = { ...first, id: 'WND-2', length_cm: 1, notes: 'Second', assessed_at: '2026-10-10T08:00:00Z' };
    const grouped = groupWoundAssessments([second, { ...first, id: 'OTHER', wound_id: 'OTHER-ROOT' }, first]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].id).toBe('WND-2');
    expect(grouped[0].measurements.map(item => item.area)).toEqual([2, 1]);
    expect(grouped[0].notes).toBe('Second');
    expect(grouped[0].historyTotal).toBe(2);
  });

  it('opens a persisted wound detail without replacing its view with raw database fields', async () => {
    const row = {
      id: 'WND-1', patient_id: 'PAT-001', wound_id: 'WND-1', wound_location: 'Left forearm',
      wound_type: 'traumatic', length_cm: '2.00', width_cm: '1.00', depth_cm: null,
      tissue_type: null, drainage_amount: 'none', pain_level: 1, notes: 'Durable wound narrative',
      assessed_by: 'nurse-1', assessed_at: '2026-10-08T00:00:00Z',
    };
    vi.mocked(shared.getWound).mockResolvedValue(row as unknown as Awaited<ReturnType<typeof shared.getWound>>);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [row],
    }) as unknown as typeof fetch;
    render(<WoundCarePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Healing Trends' }));
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All Wounds' }));
    fireEvent.click(await screen.findByRole('button', { name: /PAT-001 Traumatic/ }));
    await waitFor(() => expect(shared.getWound).toHaveBeenCalledWith('WND-1'));
    expect(await screen.findByText('Durable wound narrative')).toBeInTheDocument();
    expect(screen.getByText('2 × 1 × — cm (2.0 cm²)')).toBeInTheDocument();
  });

  it('displays assessment sections once loading resolves', async () => {
    render(<WoundCarePage />);

    // Wait for the mount fetch to settle before asserting on gated content.
    await waitFor(() => {
      expect(screen.queryByText(/Loading wound assessments/i)).not.toBeInTheDocument();
    });

    // `getAllBy*`: these words legitimately appear more than once on the page
    // (heading plus field labels). `getBy*` throws "Found multiple elements",
    // which is a defect in the query, not in the component.
    expect(screen.getAllByText(/Assessment/i).length).toBeGreaterThan(0);
  });

  it('allows entering wound type', async () => {
    render(<WoundCarePage />);

    // TWO gates, not one. Beyond the loading gate, the assessment form lives
    // behind `activeTab === 'assess'` (WoundCarePage.tsx:350) and the page
    // opens on the 'wounds' tab. The original test assumed the form was
    // present on first paint; it never has been.
    const tab = await screen.findByText(/New Assessment/i);
    fireEvent.click(tab);

    const select = await screen.findByLabelText(/Wound Type/i);
    expect(select).toHaveValue('');
    expect(screen.getByLabelText('Exudate')).toHaveValue('');
    fireEvent.change(select, { target: { value: 'pressure-ulcer' } });
    expect(select).toHaveValue('pressure-ulcer');
  });
});
