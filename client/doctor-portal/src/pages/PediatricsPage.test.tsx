import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as shared from '@medichain/shared';

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatients: vi.fn(),
}));

const isoMonthsAgo = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
};

beforeEach(() => {
  // The page filters the patient register to under-18s by date of birth. It
  // used to ship two invented children instead of reading the register at all.
  (shared.getPatients as any).mockResolvedValue([
    { patient_id: 'PED-001', full_name: 'Yusuf Al-Rashid', health_id: 'MCHI-1', date_of_birth: isoMonthsAgo(8), gender: 'male' },
    { patient_id: 'PED-002', full_name: 'Sara Hassan', health_id: 'MCHI-2', date_of_birth: isoMonthsAgo(54), gender: 'female' },
    { patient_id: 'ADT-001', full_name: 'Adult Patient', health_id: 'MCHI-3', date_of_birth: isoMonthsAgo(420), gender: 'male' },
  ]);
});
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PediatricsPage from './PediatricsPage';

describe('PediatricsPage', () => {
  it('renders pediatrics page', () => {
    render(<PediatricsPage />);

    expect(screen.getByText(/Pediatric Assessment/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search by name or MRN/i)).toBeInTheDocument();
  });

  it('lists only paediatric patients from the register', async () => {
    render(<PediatricsPage />);

    await waitFor(() =>
      expect(screen.getByText(/Yusuf Al-Rashid/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/Sara Hassan/i)).toBeInTheDocument();
    // Over 18: paediatrics does not chart them.
    expect(screen.queryByText(/Adult Patient/i)).not.toBeInTheDocument();
  });

  it('allows selecting a patient', async () => {
    render(<PediatricsPage />);

    const patient = await screen.findByText(/Yusuf Al-Rashid/i);
    fireEvent.click(patient);

    // Selecting a child opens their growth panel. An 8-month-old with no
    // recorded assessment shows dashes, not a fabricated curve.
    await waitFor(() =>
      expect(screen.getAllByText(/Growth/i).length).toBeGreaterThan(0)
    );
  });
});
