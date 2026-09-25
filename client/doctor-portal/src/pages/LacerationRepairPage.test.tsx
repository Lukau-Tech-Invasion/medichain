import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
        walletAddress: '5DoctorTest',
        userId: '5DoctorTest',
        username: 'Dr Test',
        role: 'Doctor',
        createdAt: '2026-09-18T00:00:00Z',
      },
    });
    vi.mocked(shared.getApiClient).mockReturnValue({
      get: mockGet.mockResolvedValue([]),
      getSessionHeaders: vi.fn().mockReturnValue({}),
    } as unknown as ReturnType<typeof shared.getApiClient>);
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

    fireEvent.click(screen.getByRole('button', { name: /Save Repair/i }));

    await waitFor(() => {
      expect(shared.createLaceration).toHaveBeenCalledWith(expect.objectContaining({
        patient_id: 'PAT-001',
        location: 'Left forearm',
        length_cm: 3.5,
        number_of_sutures: 4,
        suture_size: '4-0',
        suture_material: 'Nylon',
      }));
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
