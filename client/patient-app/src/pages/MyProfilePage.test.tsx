import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MyProfilePage } from './MyProfilePage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPatient: vi.fn(),
  updateDemographics: vi.fn(),
}));

const mockPatientId = 'HEALTH123';

const storeState = {
  patient: {
    healthId: mockPatientId,
    userId: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
  },
};

describe('MyProfilePage (Patient)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shared.updateDemographics).mockResolvedValue({ success: true, patient_id: mockPatientId, message: 'saved' });

    // One object, created once. Rebuilding it per call hands the component a
    // new `patient` reference on every render, which the real store never does
    // — and a callback depending on it is then rebuilt every render, re-running
    // its effect forever. The page never leaves its loading skeleton.
    (usePatientAuthStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: unknown) => unknown) => selector(storeState),
    );

    vi.mocked(shared.getPatient).mockResolvedValue({
      patient_id: 'HEALTH123',
      full_name: 'Test Patient',
      date_of_birth: '1990-01-01',
      national_id: 'ID12345',
      emergency_info: {
        patient_id: 'HEALTH123',
        blood_type: 'O+',
        allergies: [{ name: 'Peanuts', severity: 'mild', reaction: '' }],
        chronic_conditions: ['Asthma'],
        current_medications: ['Inhaler'],
        emergency_contacts: [
          { name: 'Jane Doe', phone: '555-1212', relationship: 'Wife' }
        ],
        organ_donor: true,
        dnr_status: false,
        last_updated: '2025-01-01',
      },
      last_updated: '2025-01-01',
      created_at: '2025-01-01',
    });
  });

  it('renders my profile page with patient information', async () => {
    render(
      <MemoryRouter>
        <MyProfilePage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText(/Personal Information/i)).toBeInTheDocument()
    );

    await waitFor(() => {
      expect(screen.getByText(/Test Patient/i)).toBeInTheDocument();
      expect(screen.getByText(/ID12345/i)).toBeInTheDocument();
      expect(screen.getByText(/O\+/i)).toBeInTheDocument();
    });
  });

  it('displays emergency contacts', async () => {
    render(
      <MemoryRouter>
        <MyProfilePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Emergency Contacts/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
      expect(screen.getByText(/Wife/i)).toBeInTheDocument();
    });
  });

  it('renders absent organ-donation and DNR statuses as not recorded', async () => {
    vi.mocked(shared.getPatient).mockResolvedValue({
      patient_id: 'HEALTH123', full_name: 'Test Patient', date_of_birth: '1990-01-01',
      emergency_info: { blood_type: 'O+' },
    } as never);
    render(<MemoryRouter><MyProfilePage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText(/Personal Information/i)).toBeInTheDocument());
    expect(screen.queryAllByText(/^No$/i)).toHaveLength(0);
    expect(screen.getAllByText(/Not recorded/i).length).toBeGreaterThanOrEqual(2);
  });

  it('allows opening the add contact form', async () => {
    render(
      <MemoryRouter>
        <MyProfilePage />
      </MemoryRouter>
    );

    // 'Add Emergency Contact' is the section heading; the control that opens
    // the form is a button labelled just 'Add'.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Add$/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));

    // The form opens asynchronously after the click inside waitFor above; the
    // placeholders are the example values, not the field names.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Jane Doe/i)).toBeInTheDocument()
    );
    expect(screen.getByPlaceholderText(/801-234-5678/i)).toBeInTheDocument();
  });
  it('rejects reversed insurance dates without posting the profile', async () => {
    render(<MemoryRouter><MyProfilePage /></MemoryRouter>);
    await screen.findByText('Test Patient');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[2]);
    fireEvent.change(screen.getByLabelText('Provider *'), { target: { value: 'QA Cover' } });
    fireEvent.change(screen.getByLabelText('Policy Number *'), { target: { value: 'QA-1' } });
    fireEvent.change(screen.getByLabelText('Valid From'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Valid To'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Enter valid coverage dates. The end date must be on or after the start date.')).toBeVisible();
    expect(shared.updateDemographics).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Valid From')).toHaveValue('2026-12-31');
  });

  it('shows required address validation in the address form without saving', async () => {
    render(<MemoryRouter><MyProfilePage /></MemoryRouter>);
    await screen.findByText('Test Patient');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/city.*country/i);
    expect(shared.updateDemographics).not.toHaveBeenCalled();
  });

  it('keeps an address draft after a failed save and retries successfully', async () => {
    vi.mocked(shared.updateDemographics).mockRejectedValueOnce(new Error('QA storage outage'));
    render(<MemoryRouter><MyProfilePage /></MemoryRouter>);
    await screen.findByText('Test Patient');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    fireEvent.change(screen.getByLabelText('City *'), { target: { value: 'Johannesburg' } });
    fireEvent.change(screen.getByLabelText('Country *'), { target: { value: 'ZA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Address details could not be saved. Please try again.');
    expect(screen.getByLabelText('City *')).toHaveValue('Johannesburg');
    expect(screen.queryByText(/Failed to save emergency contact/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.queryByLabelText('City *')).not.toBeInTheDocument());
    expect(shared.updateDemographics).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Johannesburg')).toBeVisible();
  });

});
