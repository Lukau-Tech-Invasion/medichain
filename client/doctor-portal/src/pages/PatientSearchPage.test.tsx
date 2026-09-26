import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PatientSearchPage from './PatientSearchPage';
import { useAuthStore } from '../store';

vi.mock('../store', () => ({ useAuthStore: vi.fn() }));

const patients = [{
  patient_id: 'PAT-001',
  full_name: 'John Doe',
  date_of_birth: '1980-01-01',
  facility: 'Clinic One',
  content_available: true,
  // A defensive UI test: even if a rogue server sends clinical fields, the
  // directory must not turn them into discovery hints.
  emergency_info: { blood_type: 'O+', allergies: ['Peanuts'] },
}];

describe('PatientSearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: { walletAddress: '0x123', role: 'Doctor' },
      isAuthenticated: true,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: patients, total: 1, unreadable_count: 0 }),
    });
  });

  it('shows directory fields without clinical discovery hints', async () => {
    render(<MemoryRouter><PatientSearchPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('John Doe')).toBeInTheDocument());
    expect(screen.getByText('PAT-001')).toBeInTheDocument();
    expect(screen.getByText('Clinic One')).toBeInTheDocument();
    expect(screen.queryByText('O+')).not.toBeInTheDocument();
    expect(screen.queryByText('Peanuts')).not.toBeInTheDocument();
    expect(screen.queryByText(/blood type/i)).not.toBeInTheDocument();
  });

  it('sends a name search to the server', async () => {
    render(<MemoryRouter><PatientSearchPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('John Doe')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'John' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));
    await waitFor(() => expect(vi.mocked(global.fetch).mock.calls.some(([url]) =>
      String(url).includes('q=John'))).toBe(true));
  });
});
