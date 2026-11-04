import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoctorToday } from '@medichain/shared';

const getDoctorToday = vi.fn();
vi.mock('@medichain/shared', async (orig) => ({
  ...(await orig<typeof import('@medichain/shared')>()),
  getDoctorToday: () => getDoctorToday(),
}));

import TodayPage from './TodayPage';

const empty: DoctorToday = {
  date: '2026-10-31', patients: [], appointments: [], consults: [], refills: [],
  results_to_review: [], critical_values: [], unavailable: [],
};
const thabo = { patient_id: 'PAT-1', full_name: 'Thabo Mokoena', date_of_birth: '1980-03-12', content_available: true };

describe('TodayPage', () => {
  beforeEach(() => getDoctorToday.mockReset());

  it('opens a consult in the patient workspace, naming the patient by two identifiers', async () => {
    getDoctorToday.mockResolvedValue({
      today: { ...empty, patients: [thabo], consults: [{ id: 'C1', patient_id: 'PAT-1', title: 'Cardiology', detail: 'Chest pain', at: '2026-10-31T08:00:00Z', urgency: 'urgent' }] },
      names: [thabo],
    });
    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    const consult = await screen.findByRole('link', { name: /cardiology/i });
    expect(consult).toHaveAttribute('href', '/patients/PAT-1/consult');
    expect(consult).toHaveTextContent('Thabo Mokoena');
    expect(consult).toHaveTextContent(/Born/);
    expect(consult).not.toHaveTextContent('PAT-1');
  });

  it('says which lists failed rather than showing them as empty', async () => {
    getDoctorToday.mockResolvedValue({ today: { ...empty, unavailable: ['consults'] }, names: [] });
    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Consults to answer/);
    expect(screen.queryByText(/Nothing is waiting/)).toBeNull();
  });

  it('explains an empty patient list', async () => {
    getDoctorToday.mockResolvedValue({ today: empty, names: [] });
    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    expect(await screen.findByText(/Nothing is waiting on you/)).toBeInTheDocument();
    expect(screen.getByText(/after an appointment, a referral/)).toBeInTheDocument();
  });
});
