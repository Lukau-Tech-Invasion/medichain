import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createRadiologyOrder, getPatients, listRadiologyOrders } from '@medichain/shared';
import ImagingPage from './ImagingPage';
import { patientFixture, selectPatient } from '../test/selectPatient';
import { useAuthStore } from '../store/authStore';

// Mock the auth store
// Spread the real module: it also exports `isHealthcareProvider`,
// `canEditMedicalRecords` and `isAdmin`, and replacing the whole module
// left those undefined — which surfaces as "Element type is invalid"
// when a component that uses one is rendered.
vi.mock('../store/authStore', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return {
    ...actual,
    createRadiologyOrder: vi.fn(),
    getPatients: vi.fn(),
    listRadiologyOrders: vi.fn(),
  };
});

describe('ImagingPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Doctor',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    vi.mocked(getPatients).mockResolvedValue([{ patient_id: 'PAT-001', full_name: 'Test Patient' }] as never);
    vi.mocked(listRadiologyOrders).mockResolvedValue({
      success: true,
      total: 1,
      items: [{
        id: 'IMG-1', patientId: 'PAT-001', patientName: 'Test Patient',
        modality: 'ct', study: 'Abdominal CT', bodyPart: 'Abdomen',
        laterality: 'n/a', indication: 'Abdominal pain', priority: 'routine',
        status: 'ordered', orderedBy: 'Dr Smith', orderedAt: new Date().toISOString(),
        contrast: true, allergies: '', criticalValue: false,
      }],
    });
    vi.mocked(createRadiologyOrder).mockResolvedValue({ id: 'IMG-NEW', success: true } as never);
  });

  it('renders imaging page', async () => {
    render(
      <MemoryRouter>
        <ImagingPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Imaging Studies/i)).toBeInTheDocument();
      expect(screen.getByText(/Abdominal CT/i)).toBeInTheDocument();
    });
  });

  it('lists ordered studies', async () => {
    render(
      <MemoryRouter>
        <ImagingPage />
      </MemoryRouter>
    );

    // This is an order-entry page, not a PACS viewer: orders are listed with
    // their study, indication and status, and no pixel data is fetched.
    await waitFor(() =>
      expect(screen.getAllByText(/Abdominal CT/i).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText(/Test Patient/i).length).toBeGreaterThan(0);
  });

  it('writes through the typed client and refreshes the durable list', async () => {
    render(<MemoryRouter><ImagingPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /New Order/i }));
    await waitFor(() => expect(listRadiologyOrders).toHaveBeenCalled());
    const readsBeforeSubmit = vi.mocked(listRadiologyOrders).mock.calls.length;
    await selectPatient(/Patient/i, 'Test Patient');
    fireEvent.change(screen.getByLabelText(/Clinical Indication/i), { target: { value: 'Persistent abdominal pain' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Imaging Order/i }));

    await waitFor(() => expect(createRadiologyOrder).toHaveBeenCalledWith(expect.objectContaining({
      patient_id: 'PAT-001',
      indication: 'Persistent abdominal pain',
      ordering_provider: mockUser.walletAddress,
    })));
    expect(vi.mocked(listRadiologyOrders).mock.calls.length).toBeGreaterThan(readsBeforeSubmit);
  });
});
