import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import LacerationRepairPage from './LacerationRepairPage';
import { patientFixture, selectPatient } from '../test/selectPatient';
import { useAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLaceration: vi.fn(),
  getPatients: vi.fn(),
  getApiClient: vi.fn(),
  openAccessContext: vi.fn(),
  uploadMedicalRecord: vi.fn(),
}));

describe('LacerationRepairPage', () => {
  const mockGet = vi.fn();

  beforeEach(() => {
    // The picker can only offer a patient the server knows.
    vi.mocked(shared.getPatients).mockResolvedValue([
      patientFixture({ patient_id: 'PAT-001', full_name: 'Test Patient' }),
    ] as never);
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: {
        userId: '5DoctorTest',
        username: 'Dr Test',
        role: 'Doctor',
        createdAt: '2026-09-18T00:00:00Z',
      },
    });
    vi.mocked(shared.getApiClient).mockReturnValue({
      getUserId: () => '5DoctorTest',
      getSessionRevision: () => 1,
      get: mockGet.mockResolvedValue([]),
      getSessionHeaders: vi.fn().mockReturnValue({}),
      setPatientAccessContext: vi.fn(),
    } as unknown as ReturnType<typeof shared.getApiClient>);
    vi.mocked(shared.openAccessContext).mockResolvedValue({
      access_context_id: 'CTX-LACERATIONS',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    } as Awaited<ReturnType<typeof shared.openAccessContext>>);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ patient_id: 'PAT-001', full_name: 'Test Patient', mrn: 'MRN-001' }],
      }),
    });
  });

  it('renders laceration repair page', async () => {
    render(<LacerationRepairPage />);

    expect(screen.getAllByText(/Laceration Repair/i).length).toBeGreaterThan(0);
    // The page opens on the repairs list; the entry form is the 'New Repair' tab.
    expect(await screen.findByRole('button', { name: /New Repair/i })).toBeInTheDocument();
  });

  it('displays wound description section', async () => {
    render(<LacerationRepairPage />);

    // The entry form is its own tab; the page opens on the list.
    fireEvent.click(await screen.findByRole('button', { name: /New Repair/i }));
    expect(screen.getByLabelText(/Length \(cm\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Depth/i)).toBeInTheDocument();
  });

  it('allows entering suture details', async () => {
    render(<LacerationRepairPage />);

    // The entry form is its own tab; the page opens on the list.
    fireEvent.click(await screen.findByRole('button', { name: /New Repair/i }));
    const sutureSelect = screen.getByLabelText(/Suture Type/i);
    fireEvent.change(sutureSelect, { target: { value: '5-0 Nylon' } });
    expect(sutureSelect).toHaveValue('5-0 Nylon');

    const countInput = screen.getByLabelText(/^Count/i);
    fireEvent.change(countInput, { target: { value: '5' } });
    expect(countInput).toHaveValue(5);
  });

  it('does not infer an injury date from the repair timestamp', async () => {
    mockGet.mockResolvedValueOnce([{ id: 'LAC-date', patient_id: 'PAT-001',
      performed_at: '2026-10-11T05:00:00Z', location: 'Synthetic forearm', data: {} }]);
    render(<LacerationRepairPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Synthetic forearm/i }));
    expect(screen.getByText('Injury Date').parentElement).toHaveTextContent('Not recorded');
    expect(screen.getByText('Anesthesia:').parentElement).toHaveTextContent('Not recorded');
  });

  it('submits only documented repair details and refreshes the durable list', async () => {
    vi.mocked(shared.createLaceration).mockResolvedValue({
      success: true,
      record_id: 'LAC-verified',
    });
    render(<LacerationRepairPage />);

    fireEvent.click(await screen.findByRole('button', { name: /New Repair/i }));
    await selectPatient(/Patient/i, 'Test Patient');
    fireEvent.change(screen.getByLabelText(/^Location/i), { target: { value: 'Left forearm' } });
    fireEvent.change(screen.getByLabelText(/Length \(cm\)/i), { target: { value: '3.5' } });
    fireEvent.change(screen.getByLabelText(/^Count/i), { target: { value: '4' } });
    vi.mocked(shared.uploadMedicalRecord).mockResolvedValue({ success: true, ipfs_hash: 'repair-photo' } as never);
    const photo = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'QA.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Photo Upload'), { target: { files: [photo] } });
    expect(screen.getByRole('button', { name: /Save Repair/i })).toBeDisabled();
    await screen.findByText('Photo 1 attached');

    fireEvent.click(screen.getByRole('button', { name: /Save Repair/i }));

    await waitFor(() => {
      expect(shared.createLaceration).toHaveBeenCalledWith(expect.objectContaining({
        patient_id: 'PAT-001',
        location: 'Left forearm',
        length_cm: 3.5,
        number_of_sutures: 4,
        suture_size: '4-0',
        suture_material: 'Nylon',
        photos: ['repair-photo'],
      }));
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /New Repair/i }));
    expect(screen.queryByText('Photo 1 attached')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Photo Upload')).toBeDisabled();
  });

  /** Enter a fictional repair through the labelled form controls. */
  async function enterRepair() {
    fireEvent.click(await screen.findByRole('button', { name: /New Repair/i }));
    await selectPatient(/Patient/i, 'Test Patient');
    fireEvent.change(screen.getByLabelText(/^Location/i), { target: { value: 'Fictional QA site' } });
    fireEvent.change(screen.getByLabelText(/Length \(cm\)/i), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText(/^Notes/i), { target: { value: 'No treatment occurred' } });
  }

  it('clears a confirmed write despite refresh failure and retries only the read', async () => {
    mockGet.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Private transport detail'));
    vi.mocked(shared.createLaceration).mockResolvedValue({ success: true, record_id: 'LAC-confirmed' });
    render(<LacerationRepairPage />); await enterRepair();
    fireEvent.click(screen.getByRole('button', { name: /Save Repair/i }));
    await screen.findByText('Repair documented as LAC-confirmed.');
    expect(await screen.findByRole('alert')).toHaveTextContent('The repair was saved, but the list could not be refreshed');
    expect(screen.queryByText('Private transport detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry list refresh' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(shared.createLaceration).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /New Repair/i }));
    expect(screen.getByLabelText(/^Location/i)).toHaveValue('');
    expect(screen.getByLabelText(/^Notes/i)).toHaveValue('');
  });

  it('locks draft fields and sends one write during a batched repeat click', async () => {
    let finish!: (result: Awaited<ReturnType<typeof shared.createLaceration>>) => void;
    vi.mocked(shared.createLaceration).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<LacerationRepairPage />); await enterRepair();
    const save = screen.getByRole('button', { name: /Save Repair/i });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    expect(shared.createLaceration).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Location/i)).toBeDisabled();
    expect(screen.getByLabelText('Photo Upload')).toBeDisabled();
    await act(async () => { finish({ success: true, record_id: 'LAC-once' }); });
    await waitFor(() => expect(screen.getByRole('button', { name: /New Repair/i })).toBeEnabled());
  });
});
