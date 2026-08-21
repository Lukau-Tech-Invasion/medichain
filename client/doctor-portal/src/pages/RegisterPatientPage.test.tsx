import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RegisterPatientPage from './RegisterPatientPage';
import { useAuthStore } from '../store';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

describe('RegisterPatientPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as any).mockReturnValue({
      user: { userId: 'DOC-001' }
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        patient_id: 'PAT-123',
        nfc_tag_id: 'TAG-123',
      }),
    });
  });

  it('renders registration form', () => {
    render(
      <MemoryRouter>
        <RegisterPatientPage />
      </MemoryRouter>
    );

    expect(screen.getByLabelText(/Full Name \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/National ID \*/i)).toBeInTheDocument();
  });

  it('submits form with valid data', async () => {
    render(
      <MemoryRouter>
        <RegisterPatientPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Full Name \*/i), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByLabelText(/Date of Birth \*/i), { target: { value: '1990-01-01' } });
    fireEvent.change(screen.getByLabelText(/National ID \*/i), { target: { value: 'NIN-123' } });
    fireEvent.change(screen.getByLabelText(/Blood Type \*/i), { target: { value: 'O+' } });
    fireEvent.change(screen.getByLabelText(/Contact Name \*/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/Phone Number \*/i), { target: { value: '+123456789' } });
    fireEvent.change(screen.getByLabelText(/Relationship \*/i), { target: { value: 'Spouse' } });

    fireEvent.submit(screen.getByRole('button', { name: /Register Patient/i }).closest('form')!);

    await waitFor(() => {
      // On success the form is replaced by the confirmation panel carrying the
      // new patient id and NFC tag.
      expect(screen.getByText('PAT-123')).toBeInTheDocument();
      expect(screen.getByText('TAG-123')).toBeInTheDocument();
    });
  });

  it('shows error message on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Database error' }),
    });

    render(
      <MemoryRouter>
        <RegisterPatientPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Full Name \*/i), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByLabelText(/Date of Birth \*/i), { target: { value: '1990-01-01' } });
    fireEvent.change(screen.getByLabelText(/National ID \*/i), { target: { value: 'NIN-123' } });
    fireEvent.change(screen.getByLabelText(/Blood Type \*/i), { target: { value: 'O+' } });
    fireEvent.change(screen.getByLabelText(/Contact Name \*/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/Phone Number \*/i), { target: { value: '+123456789' } });
    fireEvent.change(screen.getByLabelText(/Relationship \*/i), { target: { value: 'Spouse' } });

    fireEvent.submit(screen.getByRole('button', { name: /Register Patient/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Database error/i)).toBeInTheDocument();
    });
  });
});
