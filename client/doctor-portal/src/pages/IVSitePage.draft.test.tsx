import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { patientProfile } from '../test/fixtures';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import IVSitePage from './IVSitePage';
import { applyStaged, nextDraftKey, noStagedEdits } from './IVSitePage.staged';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';
import { selectPatient as pickPatient } from '../test/selectPatient';

vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openAccessContext: vi.fn().mockResolvedValue({ access_context_id: 'CTX-TEST', expires_at: '2099-01-01T00:00:00Z' }),
  getPatients: vi.fn(),
  createIvSite: vi.fn(),
  apiUrl: (path: string) => path,
}));

/** One cannula the server already holds for the patient. */
const storedRow = {
  id: 'IV-PAT-001-SITE-1', site_id: 'SITE-1', patient_id: 'PAT-001',
  site_discontinued: false, catheter_type: 'peripheral', catheter_gauge: '22G',
  data: { location: 'left-forearm', locationDetail: 'Cephalic vein',
    insertedAt: '2026-11-14T08:00:00Z', insertedBy: 'nurse-1', assessments: [] },
};

const selectPatient = () => pickPatient('', 'Test Patient', 'ivsite-patient-search');

function chooseSite() {
  fireEvent.change(document.getElementById('iv-location')!, { target: { value: 'right-hand' } });
  fireEvent.change(document.getElementById('iv-catheter-type')!, { target: { value: 'peripheral' } });
  fireEvent.click(screen.getByRole('button', { name: '20G' }));
}

describe('IV site draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({ user: { userId: 'nurse-me', role: 'Nurse' } });
    vi.mocked(shared.getPatients).mockResolvedValue([patientProfile()]);
    const client = shared.getApiClient();
    const realGet = client.get.bind(client);
    vi.spyOn(client, 'get').mockImplementation(((path: string, ...rest: unknown[]) =>
      path.startsWith('/api/clinical/iv-sites/')
        ? Promise.resolve({ sites: [storedRow] })
        : (realGet as (p: string, ...r: unknown[]) => Promise<unknown>)(path, ...rest)) as typeof client.get);
  });

  it('is not unsaved work when the stored sites load', async () => {
    render(<IVSitePage />);
    await selectPatient();
    expect(await screen.findByText(/Cephalic vein/)).toBeInTheDocument();
    expect(shared.readDraft('iv-site', 'PAT-001')).toBeUndefined();
  });

  it('keeps an added site as a draft, and only the staged edits', async () => {
    render(<IVSitePage />);
    await selectPatient();
    await screen.findByText(/Cephalic vein/);
    fireEvent.click(screen.getByRole('button', { name: 'Add New Site' }));
    chooseSite();
    fireEvent.click(screen.getByRole('button', { name: 'Add IV Site' }));
    await waitFor(() => expect(shared.readDraft('iv-site', 'PAT-001')).toBeDefined());
    const draft = shared.readDraft<{ staged: ReturnType<typeof noStagedEdits> }>('iv-site', 'PAT-001')!;
    expect(draft.staged.added).toHaveLength(1);
    // The stored site is the server's, not part of the draft.
    expect(JSON.stringify(draft)).not.toContain('Cephalic vein');
  });

  it('restores the staged edits over a fresh load and saves both', async () => {
    shared.writeDraft('iv-site', 'PAT-001', {
      staged: {
        added: [{ id: 'draft-1', draft: true, patientId: 'PAT-001', location: 'right-hand', locationDetail: 'Dorsal',
          catheterType: 'peripheral', gauge: '20G', insertedBy: 'nurse-me', insertedAt: '2026-11-15T09:00:00Z',
          expiresAt: '', isActive: true, assessments: [] }],
        assessments: { 'SITE-1': [{ id: 'ASSESS-9', assessedAt: '2026-11-15T09:05:00Z', assessedBy: 'nurse-me',
          conditions: ['clean-dry-intact'], infusing: '', notes: 'Checked' }] },
        discontinued: {},
      },
    });
    vi.mocked(shared.createIvSite).mockResolvedValue({ success: true, sites: [] } as unknown as Awaited<ReturnType<typeof shared.createIvSite>>);
    render(<IVSitePage />);
    await selectPatient();
    await screen.findByText(/Cephalic vein/);
    expect(screen.getByText(/Dorsal/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save All IV Records' }));
    await waitFor(() => expect(shared.createIvSite).toHaveBeenCalledTimes(1));
    const sites = vi.mocked(shared.createIvSite).mock.calls[0][0].sites as Array<Record<string, unknown>>;
    expect(sites).toHaveLength(2);
    const stored = sites.find((s) => s.id === 'SITE-1') as { assessments: Array<{ notes: string }> };
    expect(stored.assessments.map((a) => a.notes)).toEqual(['Checked']);
    expect(sites.find((s) => s.id === undefined)).toMatchObject({ location: 'right-hand' });
    await waitFor(() => expect(shared.readDraft('iv-site', 'PAT-001')).toBeUndefined());
  });
});

describe('applyStaged', () => {
  const site = (id: string) => ({ id, isActive: true, assessments: [] as string[] });

  it('lays added sites, assessments and discontinuations over the stored list', () => {
    const shown = applyStaged([site('A')], {
      added: [site('draft-1')],
      assessments: { A: ['a1'], 'draft-1': ['d1'] },
      discontinued: { A: { at: 't', by: 'n', reason: 'Removed' } },
    });
    expect(shown.map((s) => s.id)).toEqual(['A', 'draft-1']);
    expect(shown[0]).toMatchObject({ isActive: false, assessments: ['a1'], discontinuedReason: 'Removed' });
    expect(shown[1].assessments).toEqual(['d1']);
  });

  it('changes nothing with nothing staged', () => {
    const stored = [site('A')];
    expect(applyStaged(stored, noStagedEdits())[0]).toBe(stored[0]);
  });

  it('issues a local key not already staged', () => {
    expect(nextDraftKey([])).toBe('draft-1');
    expect(nextDraftKey([{ id: 'draft-2' }])).toBe('draft-3');
    expect(nextDraftKey([{ id: 'draft-1' }, { id: 'draft-3' }])).toBe('draft-4');
  });
});
