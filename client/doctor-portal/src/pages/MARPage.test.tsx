import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import MARPage from './MARPage';
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
  listMar: vi.fn(),
  apiUrl: (path: string) => path,
}));

/** Choose the seeded patient — the chart only exists for a patient. */
const selectPatient = async () => {
  const row = await screen.findByText(/Test Patient/i);
  fireEvent.click(row);
};

describe('MARPage', () => {
  const mockUser = {
    walletAddress: '5GrwvaEF...mock',
    role: 'Nurse',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: mockUser,
    });
    (shared.getPatients as any).mockResolvedValue([
      { patient_id: 'PAT-001', full_name: 'Test Patient', health_id: 'MCHI-1' },
    ]);
    // The MAR is per patient and per day: the schedule grid is generated from
    // that patient's active orders, so with no orders there are no time slots.
    (shared.listMar as any).mockResolvedValue([
      {
        patient_id: 'PAT-001',
        record_date: new Date().toISOString().split('T')[0],
        scheduled_medications: [
          {
            medication_id: 'MED-1',
            name: 'Paracetamol',
            dose: '1 g',
            route: 'PO',
            frequency: 'TID',
          },
        ],
        prn_medications: [
          {
            medication_id: 'MED-2',
            name: 'Morphine',
            dose: '2 mg',
            route: 'IV',
            indication: 'Breakthrough pain',
          },
        ],
      },
    ]);
  });

  it('renders MAR page', async () => {
    render(<MARPage />);

    expect(screen.getAllByText(/Medication Administration Record/i).length).toBeGreaterThan(0);
    // With no patient chosen the page is a picker, not a chart.
    await waitFor(() =>
      expect(screen.getByText(/Select a Patient/i)).toBeInTheDocument()
    );
  });

  it('displays schedule timeline', async () => {
    render(<MARPage />);
    await selectPatient();

    // A TID order schedules 08:00 / 14:00 / 20:00.
    await waitFor(() =>
      expect(screen.getByText(/Scheduled Administrations/i)).toBeInTheDocument()
    );
    expect(screen.getAllByText(/08:00/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/14:00/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/20:00/i).length).toBeGreaterThan(0);
  });

  it('lists PRN medications separately from the schedule', async () => {
    render(<MARPage />);
    await selectPatient();

    await waitFor(() =>
      expect(screen.getByText(/PRN Medications Available/i)).toBeInTheDocument()
    );
    expect(screen.getAllByText(/Morphine/i).length).toBeGreaterThan(0);
  });
});
