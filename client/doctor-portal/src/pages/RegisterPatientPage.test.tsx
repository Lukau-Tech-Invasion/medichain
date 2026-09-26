import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RegisterPatientPage from './RegisterPatientPage';
import { useAuthStore } from '../store';
import { generateWalletIdentity } from '@medichain/shared';

vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@medichain/shared')>()),
  generateWalletIdentity: vi.fn(),
}));

const GENERATED = {
  address: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
  mnemonic: 'cave cotton kangaroo echo merge resist pear mixed execute index rotate involve',
};

/** Everything the form requires except the wallet, which each test decides. */
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
    // The wallet address is marked `required` on the form and was never
    // filled by this test. It passed anyway because nothing validated the
    // form -- the fixture was incomplete and no one could tell.
    fireEvent.change(screen.getByLabelText(/Wallet Address/i), {
      target: { value: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' },
    });
    fireEvent.change(screen.getByLabelText(/National ID \*/i), { target: { value: 'NIN-123' } });
    fireEvent.change(screen.getByLabelText(/Blood Type \(optional\)/i), { target: { value: 'O+' } });
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
    fireEvent.change(screen.getByLabelText(/Wallet Address/i), {
      target: { value: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' },
    });
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
    fireEvent.change(screen.getByLabelText(/Wallet Address/i), {
      target: { value: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' },
    });
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
    // The wallet address is marked `required` on the form and was never
    // filled by this test. It passed anyway because nothing validated the
    // form -- the fixture was incomplete and no one could tell.
    fireEvent.change(screen.getByLabelText(/Wallet Address/i), {
      target: { value: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' },
    });
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

  // A record bound to a wallet whose phrase nobody kept is one its patient
  // can never open, and nothing at the clinic can recover the phrase.
  it('will not register against a generated wallet until the phrase is confirmed handed over', async () => {
    vi.mocked(generateWalletIdentity).mockResolvedValue(GENERATED as never);
    render(
      <MemoryRouter>
        <RegisterPatientPage />
      </MemoryRouter>
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }));
    await waitFor(() => expect(screen.getByTestId('recovery-phrase')).toHaveTextContent(GENERATED.mnemonic));
    expect(screen.getByLabelText(/Wallet Address/i)).toHaveValue(GENERATED.address);

    const form = screen.getByRole('button', { name: /Register Patient/i }).closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Confirm the patient has their recovery phrase/i)).toBeInTheDocument());
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/The patient has this phrase/i));
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText('PAT-123')).toBeInTheDocument());
    // Still shown after registering: this is when the patient first signs in.
    expect(screen.getByTestId('recovery-phrase')).toHaveTextContent(GENERATED.mnemonic);
  });

  it('stops offering a generated phrase once another address is typed over it', async () => {
    vi.mocked(generateWalletIdentity).mockResolvedValue(GENERATED as never);
    render(
      <MemoryRouter>
        <RegisterPatientPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }));
    await waitFor(() => expect(screen.getByTestId('recovery-phrase')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Wallet Address/i), {
      target: { value: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' },
    });
    expect(screen.queryByTestId('recovery-phrase')).not.toBeInTheDocument();
  });
});
