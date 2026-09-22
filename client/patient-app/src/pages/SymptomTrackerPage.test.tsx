import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { buildSymptomReport, SymptomTrackerPage } from './SymptomTrackerPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('@medichain/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@medichain/shared')>();
  return { ...actual, getSymptomHistory: vi.fn(), logSymptom: vi.fn(), retractSymptom: vi.fn() };
});

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

describe('SymptomTrackerPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
      isAuthenticated: true,
    });

    vi.mocked(shared.getSymptomHistory).mockResolvedValue({
      success: true,
      patient_id: 'HEALTH123',
      total_entries: 1,
      entries: [{
        id: 'sym1',
        symptom: 'Headache',
        category: 'Pain',
        severity: 3,
        timestamp: new Date().toISOString(),
        notes: 'Morning headache',
      }],
    });
    vi.mocked(shared.logSymptom).mockResolvedValue({ success: true });
    vi.mocked(shared.retractSymptom).mockResolvedValue({
      success: true,
      entry_id: 'sym1',
      message: 'Symptom entry retracted',
    });
  });

  it('creates a CSV report from loaded records and neutralizes spreadsheet formulas', () => {
    expect(buildSymptomReport([{
      id: 'sym1', symptom: '=SUM(A1:A2)', category: 'pain', severity: 4,
      timestamp: '2026-09-20T08:00:00Z', notes: 'Quoted "note"', triggers: ['stress'], relievedBy: [],
    }])).toBe(
      'timestamp,symptom,category,severity,duration,notes,triggers,relieved_by\r\n' +
      '"2026-09-20T08:00:00Z","\'=SUM(A1:A2)","pain","4","","Quoted ""note""","stress",""'
    );
  });

  it('renders symptom tracker page with entries', async () => {
    render(
      <MemoryRouter>
        <SymptomTrackerPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Symptom Tracker/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Headache/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Morning headache/i)).toBeInTheDocument();
    });
  });

  it('allows opening the add symptom modal', async () => {
    render(
      <MemoryRouter>
        <SymptomTrackerPage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText(/Log New Symptom/i)).toBeInTheDocument()
    );
    const addButton = screen.getByText(/Log New Symptom/i);
    fireEvent.click(addButton);

    expect(screen.getByText(/Log Symptom/i)).toBeInTheDocument();
    expect(screen.getByText(/Pain/i)).toBeInTheDocument();
    expect(screen.getByText(/Respiratory/i)).toBeInTheDocument();
  });

  it('retracts an entry through the API instead of only hiding it locally', async () => {
    render(
      <MemoryRouter>
        <SymptomTrackerPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText(/retract symptom entry/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/retract symptom entry/i));

    await waitFor(() => {
      expect(shared.retractSymptom).toHaveBeenCalledWith('HEALTH123', 'sym1');
      expect(screen.queryByText(/Morning headache/i)).not.toBeInTheDocument();
    });
  });
});
