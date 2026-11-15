import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RegisterPatientPage from './RegisterPatientPage';
import { useAuthStore } from '../store';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

const REGISTERED = {
  success: true,
  patient_id: 'PAT-123',
  nfc_tag_id: 'TAG-123',
  activation_code: 'ABCD-EFGH-JKMN',
  activation_expires_at: '2026-10-03T10:00:00Z',
};

/** Everything the form requires. */
function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Full Name \*/i), { target: { value: 'John Doe' } });
  fireEvent.change(screen.getByLabelText(/Date of Birth \*/i), { target: { value: '1990-01-01' } });
  fireEvent.change(screen.getByLabelText(/National ID \*/i), { target: { value: 'NIN-123' } });
  fireEvent.change(screen.getByLabelText(/Blood Type \(optional\)/i), { target: { value: 'O+' } });
  fireEvent.change(screen.getByLabelText(/Contact Name \*/i), { target: { value: 'Jane Doe' } });
  fireEvent.change(screen.getByLabelText(/Phone Number \*/i), { target: { value: '+123456789' } });
  fireEvent.change(screen.getByLabelText(/Relationship \*/i), { target: { value: 'Spouse' } });
}

describe('RegisterPatientPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuthStore).mockReturnValue({
      user: { userId: 'DOC-001' }
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => REGISTERED,
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
    fireEvent.change(screen.getByLabelText(/Blood Type \(optional\)/i), { target: { value: 'O+' } });
    fireEvent.change(screen.getByLabelText(/Contact Name \*/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/Phone Number \*/i), { target: { value: '+123456789' } });
    fireEvent.change(screen.getByLabelText(/Relationship \*/i), { target: { value: 'Spouse' } });

    fireEvent.submit(screen.getByRole('button', { name: /Register Patient/i }).closest('form')!);

    await waitFor(() => {
      // On success the form is replaced by the confirmation panel carrying the
      // new patient id and NFC tag.
      expect(screen.getAllByText('PAT-123').length).toBeGreaterThan(0);
      expect(screen.getByText('TAG-123')).toBeInTheDocument();
    });
  });

  it('registers a patient whose blood group is not known as Unknown, not a guess', async () => {
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    render(
      <MemoryRouter>
        <RegisterPatientPage />
      </MemoryRouter>
    );
    const bloodType = screen.getByLabelText(/Blood Type \(optional\)/i) as HTMLSelectElement;
    expect(Array.from(bloodType.options).map((o) => o.value)).toContain('Unknown');

    fireEvent.change(screen.getByLabelText(/Full Name \*/i), { target: { value: 'Untyped Patient' } });
    fireEvent.change(screen.getByLabelText(/Date of Birth \*/i), { target: { value: '1990-01-01' } });
    fireEvent.change(screen.getByLabelText(/National ID \*/i), { target: { value: 'NIN-124' } });
    fireEvent.change(bloodType, { target: { value: 'Unknown' } });
    fireEvent.change(screen.getByLabelText(/Contact Name \*/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/Phone Number \*/i), { target: { value: '+123456789' } });
    fireEvent.change(screen.getByLabelText(/Relationship \*/i), { target: { value: 'Spouse' } });
    fireEvent.submit(screen.getByRole('button', { name: /Register Patient/i }).closest('form')!);

    await waitFor(() => {
      const register = fetchSpy.mock.calls.find(([url]) => String(url).includes('/register'));
      expect(register, 'no registration request was sent').toBeTruthy();
      expect(JSON.parse(String((register![1] as RequestInit).body)).blood_type).toBe('Unknown');
    });
  });

  it('omits blood type when the clinician has not typed the patient', async () => {
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<MemoryRouter><RegisterPatientPage /></MemoryRouter>);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Blood Type \(optional\)/i), {
      target: { value: '' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /Register Patient/i }).closest('form')!);

    await waitFor(() => {
      const register = fetchSpy.mock.calls.find(([url]) => String(url).includes('/register'));
      expect(register, 'no registration request was sent').toBeTruthy();
      const body = JSON.parse(String((register![1] as RequestInit).body));
      expect(body).not.toHaveProperty('blood_type');
    });
  });

  it('shows error message on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
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
    fireEvent.change(screen.getByLabelText(/Blood Type \(optional\)/i), { target: { value: 'O+' } });
    fireEvent.change(screen.getByLabelText(/Contact Name \*/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/Phone Number \*/i), { target: { value: '+123456789' } });
    fireEvent.change(screen.getByLabelText(/Relationship \*/i), { target: { value: 'Spouse' } });

    fireEvent.submit(screen.getByRole('button', { name: /Register Patient/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Database error/i)).toBeInTheDocument();
    });
  });

  // The clinic never chooses or sees a secret. Registration returns a one-time
  // activation code; the patient sets their own password with it.
  it('does not ask for any account address or identity at registration', () => {
    render(<MemoryRouter><RegisterPatientPage /></MemoryRouter>);

    expect(screen.queryByLabelText(/address beginning|account address/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Generate$/ })).not.toBeInTheDocument();
  });

  it('sends no account or identity field in the registration body', async () => {
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<MemoryRouter><RegisterPatientPage /></MemoryRouter>);
    fillRequiredFields();
    fireEvent.submit(screen.getByRole('button', { name: /Register Patient/i }).closest('form')!);

    await waitFor(() => {
      const register = fetchSpy.mock.calls.find(([url]) => String(url).includes('/register'));
      expect(register, 'no registration request was sent').toBeTruthy();
      const body = JSON.parse(String((register![1] as RequestInit).body));
      expect(body).not.toHaveProperty('user_id');
      expect(Object.keys(body).filter((key) => /address|identity|key/i.test(key))).toEqual([]);
    });
  });

  it('shows the activation code once, with the patient id, and a way to print it', async () => {
    render(<MemoryRouter><RegisterPatientPage /></MemoryRouter>);
    fillRequiredFields();
    fireEvent.submit(screen.getByRole('button', { name: /Register Patient/i }).closest('form')!);

    await waitFor(() => expect(screen.getByTestId('one-time-code')).toHaveTextContent('ABCD-EFGH-JKMN'));
    expect(screen.getByRole('button', { name: /Print/i })).toBeInTheDocument();
    // The clinic hands the patient the code; the password is theirs to choose.
    expect(screen.getByText(/never sees the password/i)).toBeInTheDocument();
  });
});
